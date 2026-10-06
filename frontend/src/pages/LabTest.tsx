import { useEffect, useMemo, useRef, useState } from "react";
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { getHomeData } from "../services/sensorApi";
import type { SensorReading } from "../types/sensor";
// Shared page styles (analyze-* classes) — also imported by Analyze.tsx
import "../styles/analyze.css";

type BlKey = "bl1" | "bl2" | "bl3";
type Interval = "raw" | "hourly" | "daily";
type Filters = { start: string; end: string; interval: Interval };
type LoadStatus = "loading" | "ready" | "error";
type View = "cv" | "sensors";
type Row = {
    timestamp: string;
    bl1: number | null;
    bl2: number | null;
    bl3: number | null;
    n: number;
    mean: number | null;
    sd: number | null;
    cv: number | null;
};

const BL: BlKey[] = ["bl1", "bl2", "bl3"];
const sensors: Record<BlKey, { label: string; color: string }> = {
    bl1: { label: "BL Sensor 1", color: "#249b7c" },
    bl2: { label: "BL Sensor 2", color: "#aa8700" },
    bl3: { label: "BL Sensor 3", color: "#ac36df" },
};
const DAY = 86_400_000;
const HOUR = 3_600_000;
const OFFSET = 7 * HOUR;
const PAGE_SIZE = 15;
const DEFAULT_THRESHOLD = 10;

function localDate(timestamp: string) {
    return new Date(Date.parse(timestamp) + OFFSET).toISOString().slice(0, 10);
}
function timestampLabel(timestamp: string) {
    return new Intl.DateTimeFormat("en-GB", {
        timeZone: "Asia/Jakarta",
        dateStyle: "medium",
        timeStyle: "short",
    }).format(new Date(timestamp));
}
function display(value: number | null, digits = 2) {
    return value == null || !Number.isFinite(value) ? "—" : value.toFixed(digits);
}
function finite(values: (number | null | undefined)[]) {
    return values.filter((value): value is number => value != null && Number.isFinite(value));
}
function mean(values: number[]) {
    return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}
// Sample standard deviation (n − 1), same as pandas .std() default.
function stats(values: number[]) {
    const avg = mean(values);
    if (avg == null || values.length < 2) return { mean: avg, sd: null, cv: null };
    const sd = Math.sqrt(values.reduce((sum, value) => sum + (value - avg) ** 2, 0) / (values.length - 1));
    return { mean: avg, sd, cv: avg > 0 ? (sd / avg) * 100 : null };
}
function toRow(timestamp: string, bl1: number | null, bl2: number | null, bl3: number | null): Row {
    const values = finite([bl1, bl2, bl3]);
    return { timestamp, bl1, bl2, bl3, n: values.length, ...stats(values) };
}
// Average each BL sensor per interval first, then compute the inter-sensor SD/CV for that interval.
function buildRows(rows: SensorReading[], interval: Interval): Row[] {
    if (interval === "raw") return rows.map(row => toRow(row.timestamp, row.bl1, row.bl2, row.bl3));
    const size = interval === "daily" ? DAY : HOUR;
    const buckets = new Map<number, SensorReading[]>();
    rows.forEach(row => {
        const time = Math.floor((Date.parse(row.timestamp) + OFFSET) / size) * size - OFFSET;
        buckets.set(time, [...(buckets.get(time) ?? []), row]);
    });
    return [...buckets.entries()]
        .sort(([a], [b]) => a - b)
        .map(([time, members]) => {
            const [bl1, bl2, bl3] = BL.map(key => mean(finite(members.map(member => member[key]))));
            return toRow(new Date(time).toISOString(), bl1, bl2, bl3);
        });
}
function fullRange(rows: SensorReading[], interval: Interval = "hourly"): Filters {
    const today = localDate(new Date().toISOString());
    return {
        start: rows[0] ? localDate(rows[0].timestamp) : today,
        end: rows.length ? localDate(rows[rows.length - 1].timestamp) : today,
        interval,
    };
}
function csvCell(value: string) {
    return `"${value.replace(/"/g, '""')}"`;
}
function exportCsv(rows: Row[], filters: Filters, threshold: number) {
    const lines = [
        [
            "Timestamp (WIB UTC+7)",
            "Aggregation",
            "BL Sensor 1 (µg/m³)",
            "BL Sensor 2 (µg/m³)",
            "BL Sensor 3 (µg/m³)",
            "Sensors reporting",
            "Mean (µg/m³)",
            "SD (µg/m³)",
            "CV (%)",
            `Result (CV ≤ ${threshold}%)`,
        ],
        ...rows.map(row => [
            new Date(Date.parse(row.timestamp) + OFFSET).toISOString().replace("Z", "+07:00"),
            filters.interval,
            ...[row.bl1, row.bl2, row.bl3, row.n, row.mean, row.sd, row.cv].map(value =>
                value == null ? "" : String(value),
            ),
            row.cv == null ? "" : row.cv <= threshold ? "PASS" : "FAIL",
        ]),
    ];
    const blob = new Blob(["\uFEFF" + lines.map(line => line.map(csvCell).join(",")).join("\r\n")], {
        type: "text/csv;charset=utf-8;",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `labtest_bl_uniformity_${filters.start}_${filters.end}_${filters.interval}.csv`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Uses the same collocation endpoint as Home/Analyze; all SD/CV maths runs client-side.
export default function LabTest() {
    const [source, setSource] = useState<SensorReading[]>([]);
    const [status, setStatus] = useState<LoadStatus>("loading");
    const [loadError, setLoadError] = useState("");
    const [lastFetched, setLastFetched] = useState<Date | null>(null);
    const [reloadKey, setReloadKey] = useState(0);
    const userApplied = useRef(false);
    const [draft, setDraft] = useState<Filters>(() => fullRange([]));
    const [applied, setApplied] = useState<Filters>(() => fullRange([]));
    const [thresholdInput, setThresholdInput] = useState(String(DEFAULT_THRESHOLD));
    const [view, setView] = useState<View>("cv");
    const [mode, setMode] = useState<"chart" | "table">("chart");
    const [page, setPage] = useState(1);
    const [error, setError] = useState("");

    useEffect(() => {
        let cancelled = false;
        setStatus("loading");
        setLoadError("");
        getHomeData()
            .then(result => {
                if (cancelled) return;
                const sorted = [...result.readings].sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
                setSource(sorted);
                setLastFetched(new Date());
                setStatus("ready");
                if (!userApplied.current && sorted.length) {
                    setDraft(current => fullRange(sorted, current.interval));
                    setApplied(current => fullRange(sorted, current.interval));
                }
            })
            .catch((err: unknown) => {
                if (cancelled) return;
                setLoadError(err instanceof Error ? err.message : "Could not load sensor data.");
                setStatus("error");
            });
        return () => {
            cancelled = true;
        };
    }, [reloadKey]);

    const parsed = Number(thresholdInput);
    const thresholdValid = thresholdInput.trim() !== "" && Number.isFinite(parsed) && parsed > 0;
    const threshold = thresholdValid ? parsed : DEFAULT_THRESHOLD;
    const first = source[0];
    const last = source[source.length - 1];
    const initial = useMemo(() => fullRange(source), [source]);

    const filtered = useMemo(
        () =>
            source.filter(row => {
                const date = localDate(row.timestamp);
                return date >= applied.start && date <= applied.end;
            }),
        [source, applied],
    );
    const rows = useMemo(() => buildRows(filtered, applied.interval), [filtered, applied.interval]);
    const chartRows = useMemo(() => {
        const step = applied.interval === "daily" ? DAY : applied.interval === "hourly" ? HOUR : 120_000;
        const result: Row[] = [];
        rows.forEach((row, index) => {
            const previous = rows[index - 1];
            if (previous && Date.parse(row.timestamp) - Date.parse(previous.timestamp) > step * 1.5) {
                result.push(toRow(new Date(Date.parse(previous.timestamp) + step).toISOString(), null, null, null));
            }
            result.push(row);
        });
        return result;
    }, [rows, applied.interval]);

    const summary = useMemo(() => {
        const evaluated = rows.filter(row => row.cv != null);
        const cvs = evaluated.map(row => row.cv as number);
        const passed = cvs.filter(cv => cv <= threshold).length;
        const sensorMeans = BL.map(key => mean(finite(filtered.map(row => row[key]))));
        const meanCv = mean(cvs);
        return {
            evaluated: evaluated.length,
            passed,
            passRate: cvs.length ? (passed / cvs.length) * 100 : null,
            meanCv,
            maxCv: cvs.length ? Math.max(...cvs) : null,
            sensorMeans,
            periodCv: stats(finite(sensorMeans)).cv,
            verdict: meanCv == null ? null : meanCv <= threshold,
        };
    }, [rows, filtered, threshold]);

    const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
    const pageRows = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
    const dirty = JSON.stringify(draft) !== JSON.stringify(applied);
    const intervalLabel =
        applied.interval === "raw"
            ? "2-minute readings"
            : `${applied.interval === "hourly" ? "Hourly" : "Daily"} averages`;

    function quickRange(days: number) {
        const end = localDate(new Date().toISOString());
        const endTime = Date.parse(`${end}T00:00:00+07:00`);
        setDraft(current => ({
            ...current,
            start: localDate(new Date(endTime - (days - 1) * DAY).toISOString()),
            end,
        }));
    }
    function apply() {
        if (!draft.start || !draft.end || draft.start > draft.end) {
            setError("Choose a valid start date and an end date on or after it.");
            return;
        }
        userApplied.current = true;
        setApplied({ ...draft });
        setPage(1);
        setError("");
    }
    const badge =
        status === "loading"
            ? "Loading live data…"
            : status === "error"
              ? "API error"
              : `Live · ${lastFetched ? new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Jakarta", timeStyle: "short" }).format(lastFetched) : ""} WIB`;
    const tickFormat = (value: string) =>
        new Intl.DateTimeFormat("en-GB", {
            timeZone: "Asia/Jakarta",
            ...(applied.interval === "daily"
                ? ({ day: "2-digit", month: "short" } as const)
                : ({ day: "2-digit", hour: "2-digit", minute: "2-digit" } as const)),
        }).format(new Date(value));

    return (
        <div className="analyze-page lab-page">
            <header className="analyze-header">
                <div>
                    <p className="analyze-kicker">Lab Test</p>
                    <h1>BL sensor uniformity</h1>
                    <p className="analyze-subtitle">
                        Inter-sensor SD and CV across BL 1–3 · {intervalLabel}
                        {first && last
                            ? ` · data ${timestampLabel(first.timestamp)} – ${timestampLabel(last.timestamp)}`
                            : ""}
                    </p>
                </div>
                <div className="analyze-actions">
                    <span className="analyze-note">{badge}</span>
                    <button type="button" onClick={() => setReloadKey(key => key + 1)} disabled={status === "loading"}>
                        Refresh
                    </button>
                </div>
            </header>

            {status === "error" && <p className="analyze-error">{loadError}</p>}

            <div className="analyze-layout">
                <section className="analyze-panel">
                    <div className="analyze-actions">
                        <div className="analyze-tabs">
                            <button
                                type="button"
                                className={view === "cv" ? "chosen" : ""}
                                onClick={() => setView("cv")}
                            >
                                CV %
                            </button>
                            <button
                                type="button"
                                className={view === "sensors" ? "chosen" : ""}
                                onClick={() => setView("sensors")}
                            >
                                Sensors
                            </button>
                        </div>
                        <div className="analyze-toggle">
                            <button
                                type="button"
                                className={mode === "chart" ? "chosen" : ""}
                                onClick={() => setMode("chart")}
                            >
                                Chart
                            </button>
                            <button
                                type="button"
                                className={mode === "table" ? "chosen" : ""}
                                onClick={() => setMode("table")}
                            >
                                Table
                            </button>
                        </div>
                        <button
                            type="button"
                            className="primary"
                            disabled={!rows.length}
                            onClick={() => exportCsv(rows, applied, threshold)}
                        >
                            Download CSV
                        </button>
                    </div>

                    {!rows.length ? (
                        <p className="analyze-empty">
                            {status === "loading" ? "Loading sensor data…" : "No BL readings in the selected period."}
                        </p>
                    ) : mode === "chart" ? (
                        <div className="analyze-chart">
                            <ResponsiveContainer width="100%" height={360}>
                                <LineChart data={chartRows} margin={{ top: 12, right: 16, bottom: 4, left: 0 }}>
                                    <CartesianGrid stroke="#dbeaf0" strokeDasharray="3 3" />
                                    <XAxis
                                        dataKey="timestamp"
                                        tickFormatter={tickFormat}
                                        minTickGap={32}
                                        tick={{ fill: "#637e90", fontSize: 12 }}
                                    />
                                    <YAxis
                                        tick={{ fill: "#637e90", fontSize: 12 }}
                                        unit={view === "cv" ? "%" : ""}
                                        width={52}
                                    />
                                    <Tooltip
                                        labelFormatter={value => timestampLabel(String(value))}
                                        formatter={(value: any, name: any) => [
                                            display(typeof value === "number" ? value : Number(value)),
                                            name === "cv" ? "CV %" : (sensors[name as BlKey]?.label ?? name),
                                        ]}
                                    />
                                    {view === "cv" ? (
                                        <>
                                            <ReferenceLine
                                                y={threshold}
                                                stroke="#d0453f"
                                                strokeDasharray="6 4"
                                                label={{
                                                    value: `Limit ${threshold}%`,
                                                    fill: "#d0453f",
                                                    fontSize: 12,
                                                    position: "insideTopRight",
                                                }}
                                            />
                                            <Line
                                                dataKey="cv"
                                                stroke="#23458b"
                                                strokeWidth={2}
                                                dot={false}
                                                connectNulls={false}
                                            />
                                        </>
                                    ) : (
                                        BL.map(key => (
                                            <Line
                                                key={key}
                                                dataKey={key}
                                                stroke={sensors[key].color}
                                                strokeWidth={1.8}
                                                dot={false}
                                                connectNulls={false}
                                            />
                                        ))
                                    )}
                                </LineChart>
                            </ResponsiveContainer>
                        </div>
                    ) : (
                        <>
                            <div className="analyze-table-scroll">
                                <table className="analyze-table">
                                    <thead>
                                        <tr>
                                            <th>Time (WIB)</th>
                                            <th>BL 1</th>
                                            <th>BL 2</th>
                                            <th>BL 3</th>
                                            <th>n</th>
                                            <th>Mean</th>
                                            <th>SD</th>
                                            <th>CV %</th>
                                            <th>Result</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {pageRows.map(row => (
                                            <tr key={row.timestamp}>
                                                <td>{timestampLabel(row.timestamp)}</td>
                                                <td>{display(row.bl1)}</td>
                                                <td>{display(row.bl2)}</td>
                                                <td>{display(row.bl3)}</td>
                                                <td>{row.n}</td>
                                                <td>{display(row.mean)}</td>
                                                <td>{display(row.sd)}</td>
                                                <td>{display(row.cv)}</td>
                                                <td
                                                    style={{
                                                        fontWeight: 600,
                                                        color:
                                                            row.cv == null
                                                                ? "#728ba3"
                                                                : row.cv <= threshold
                                                                  ? "#249b7c"
                                                                  : "#d0453f",
                                                    }}
                                                >
                                                    {row.cv == null ? "—" : row.cv <= threshold ? "PASS" : "FAIL"}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                            <div className="analyze-pagination">
                                <button type="button" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>
                                    Previous
                                </button>
                                <span>
                                    Page {page} of {totalPages} · {rows.length} rows
                                </span>
                                <button type="button" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>
                                    Next
                                </button>
                            </div>
                        </>
                    )}
                </section>

                <aside className="analyze-panel analyze-filters">
                    <h2>Date range &amp; filters</h2>
                    <div className="analyze-quick">
                        {[1, 7, 30].map(days => (
                            <button key={days} type="button" onClick={() => quickRange(days)}>
                                {days === 1 ? "Today" : `${days} days`}
                            </button>
                        ))}
                        <button type="button" onClick={() => setDraft({ ...initial, interval: draft.interval })}>
                            All data
                        </button>
                    </div>
                    <label className="field">
                        Start date
                        <input
                            type="date"
                            value={draft.start}
                            onChange={e => setDraft({ ...draft, start: e.target.value })}
                        />
                    </label>
                    <label className="field">
                        End date
                        <input
                            type="date"
                            value={draft.end}
                            onChange={e => setDraft({ ...draft, end: e.target.value })}
                        />
                    </label>
                    <label className="field">
                        Averaging interval
                        <select
                            value={draft.interval}
                            onChange={e => setDraft({ ...draft, interval: e.target.value as Interval })}
                        >
                            <option value="raw">2-minute (raw)</option>
                            <option value="hourly">Hourly</option>
                            <option value="daily">Daily</option>
                        </select>
                    </label>
                    <label className="field">
                        CV pass threshold (%)
                        <input
                            type="number"
                            min="0.1"
                            step="0.5"
                            value={thresholdInput}
                            onChange={e => setThresholdInput(e.target.value)}
                        />
                    </label>
                    {!thresholdValid && (
                        <p className="analyze-error">Enter a threshold above 0. Using {DEFAULT_THRESHOLD}%.</p>
                    )}
                    {error && <p className="analyze-error">{error}</p>}
                    <button type="button" className="analyze-apply primary" disabled={!dirty} onClick={apply}>
                        Apply
                    </button>
                    <p className="analyze-note">
                        SD is the sample standard deviation (n − 1) of the three BL sensors per interval; CV = SD ÷ mean
                        × 100. Intervals with fewer than two sensors reporting are skipped.
                    </p>
                </aside>
            </div>

            <section className="analyze-panel">
                <h2>Selected period summary</h2>
                <div className="analyze-summary">
                    <div className="analyze-stat">
                        <span>Evaluated intervals</span>
                        <strong>{summary.evaluated}</strong>
                    </div>
                    <div className="analyze-stat">
                        <span>Pass rate</span>
                        <strong>{summary.passRate == null ? "—" : `${summary.passRate.toFixed(1)}%`}</strong>
                        <small>
                            {summary.passed} of {summary.evaluated} ≤ {threshold}%
                        </small>
                    </div>
                    <div className="analyze-stat">
                        <span>Mean CV</span>
                        <strong>{display(summary.meanCv)}%</strong>
                    </div>
                    <div className="analyze-stat">
                        <span>Max CV</span>
                        <strong>{display(summary.maxCv)}%</strong>
                    </div>
                    <div className="analyze-stat">
                        <span>Period CV (sensor means)</span>
                        <strong>{display(summary.periodCv)}%</strong>
                        <small>
                            {BL.map(
                                (key, i) =>
                                    `${sensors[key].label.replace("Sensor ", "")}: ${display(summary.sensorMeans[i])}`,
                            ).join(" · ")}
                        </small>
                    </div>
                    <div className="analyze-stat">
                        <span>Verdict</span>
                        <strong
                            style={{
                                color: summary.verdict == null ? "#728ba3" : summary.verdict ? "#249b7c" : "#d0453f",
                            }}
                        >
                            {summary.verdict == null ? "—" : summary.verdict ? "PASS" : "FAIL"}
                        </strong>
                        <small>Mean CV vs {threshold}% limit</small>
                    </div>
                </div>
            </section>
        </div>
    );
}
