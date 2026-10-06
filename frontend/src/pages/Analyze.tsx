import { useEffect, useMemo, useRef, useState } from "react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { getHomeData } from "../services/sensorApi";
import type { Measurement, SensorReading } from "../types/sensor";

type Key = Exclude<keyof SensorReading, "timestamp">;
type Interval = "raw" | "hourly" | "daily";
type Filters = { start: string; end: string; interval: Interval };
const groups: Record<Measurement, { label: string; keys: Key[] }> = {
    pm25: { label: "PM2:5", keys: ["bl1", "bl2", "bl3", "paA", "paB"] },
    climate: { label: "Temperature & Humidity", keys: ["temperature", "humidity"] },
    voltage: { label: "Battery Voltage", keys: ["voltage"] },
};
groups.pm25.label = "PM2.5 · BL vs PA";
const series: Record<Key, { label: string; unit: string; color: string }> = {
    bl1: { label: "BL Sensor 1", unit: "µg/m³", color: "#249b7c" },
    bl2: { label: "BL Sensor 2", unit: "µg/m³", color: "#aa8700" },
    bl3: { label: "BL Sensor 3", unit: "µg/m³", color: "#ac36df" },

    paA: { label: "PA Channel A", unit: "µg/m³", color: "#245fd2" },
    paB: { label: "PA Channel B", unit: "µg/m³", color: "#e54374" },
    temperature: { label: "Temperature", unit: "°C", color: "#c77329" },
    humidity: { label: "Relative humidity", unit: "%", color: "#188caf" },
    voltage: { label: "Battery voltage", unit: "V", color: "#249b7c" },
} as Record<Key, { label: string; unit: string; color: string }>;
const keys = Object.keys(series) as Key[];
const DAY = 86_400_000;
const OFFSET = 7 * 60 * 60 * 1000;
const PAGE_SIZE = 15;
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
function bucketTime(timestamp: string, interval: Interval) {
    const time = Date.parse(timestamp);
    const size = interval === "daily" ? DAY : 3_600_000;
    return Math.floor((time + OFFSET) / size) * size - OFFSET;
}
function aggregate(rows: SensorReading[], interval: Interval): SensorReading[] {
    if (interval === "raw") return rows;
    const buckets = new Map<number, SensorReading[]>();
    rows.forEach(row => {
        const time = bucketTime(row.timestamp, interval);
        buckets.set(time, [...(buckets.get(time) ?? []), row]);
    });
    return [...buckets.entries()]
        .sort(([a], [b]) => a - b)
        .map(([time, members]) => {
            const row = { timestamp: new Date(time).toISOString() } as SensorReading;
            keys.forEach(key => {
                const values = members
                    .map(member => member[key])
                    .filter((value): value is number => value != null && Number.isFinite(value));
                row[key] = values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
            });
            return row;
        });
}
function display(value: number | null) {
    return value == null ? "—" : value.toFixed(2);
}
function csvCell(value: string) {
    return `"${value.replace(/"/g, '""')}"`;
}
function exportCsv(rows: SensorReading[], selected: Key[], filters: Filters) {
    const headings = [
        "Timestamp (WIB UTC+7)",
        "Aggregation",
        ...selected.map(key => `${series[key].label} (${series[key].unit})`),
    ];
    const lines = [
        headings,
        ...rows.map(row => [
            new Date(Date.parse(row.timestamp) + OFFSET).toISOString().replace("Z", "+07:00"),
            filters.interval,
            ...selected.map(key => (row[key] == null ? "" : String(row[key]))),
        ]),
    ];
    const blob = new Blob(["\uFEFF" + lines.map(line => line.map(csvCell).join(",")).join("\r\n")], {
        type: "text/csv;charset=utf-8;",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `collocation_${filters.start}_${filters.end}_${filters.interval}.csv`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

type LoadStatus = "loading" | "ready" | "error";

function fullRange(rows: SensorReading[], interval: Interval = "raw"): Filters {
    const today = localDate(new Date().toISOString());
    const first = rows[0];
    const last = rows[rows.length - 1];
    return {
        start: first ? localDate(first.timestamp) : today,
        end: last ? localDate(last.timestamp) : today,
        interval,
    };
}

// Uses the same collocation endpoint as Home and filters/averages client-side.
// If the backend later adds start/end parameters, only the getHomeData() call below needs to change.
export default function Analyze() {
    const [source, setSource] = useState<SensorReading[]>([]);
    const [status, setStatus] = useState<LoadStatus>("loading");
    const [loadError, setLoadError] = useState("");
    const [lastFetched, setLastFetched] = useState<Date | null>(null);
    const [reloadKey, setReloadKey] = useState(0);
    const userApplied = useRef(false);
    const first = source[0];
    const last = source[source.length - 1];
    const initial = useMemo(() => fullRange(source), [source]);
    const [draft, setDraft] = useState<Filters>(() => fullRange([]));
    const [applied, setApplied] = useState<Filters>(() => fullRange([]));

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
                // Jump to the data's coverage on first load; keep the user's own range on refresh.
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
    const [measurement, setMeasurement] = useState<Measurement>("pm25");
    const [view, setView] = useState<"chart" | "table">("chart");
    const [selected, setSelected] = useState<Key[]>(keys);
    const [page, setPage] = useState(1);
    const [error, setError] = useState<string>("");
    const active = groups[measurement].keys.filter(key => selected.includes(key));
    const filtered = useMemo(
        () =>
            source
                .filter(row => {
                    const date = localDate(row.timestamp);
                    return date >= applied.start && date <= applied.end;
                })
                .sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp)),
        [source, applied],
    );
    const rows = useMemo(() => aggregate(filtered, applied.interval), [filtered, applied.interval]);
    // Insert null points at missing intervals so a line never bridges an absent period.
    const chartRows = useMemo(() => {
        const step = applied.interval === "daily" ? DAY : applied.interval === "hourly" ? 3_600_000 : 120_000;
        const result: SensorReading[] = [];
        rows.forEach((row, index) => {
            const previous = rows[index - 1];
            if (previous && Date.parse(row.timestamp) - Date.parse(previous.timestamp) > step * 1.5) {
                const gap = {
                    timestamp: new Date(Date.parse(previous.timestamp) + step).toISOString(),
                } as SensorReading;
                keys.forEach(key => {
                    gap[key] = null;
                });
                result.push(gap);
            }
            result.push(row);
        });
        return result;
    }, [rows, applied.interval]);
    const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
    const pageRows = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
    const dirty = JSON.stringify(draft) !== JSON.stringify(applied);
    function quickRange(days: number) {
        const now = new Date();
        const end = localDate(now.toISOString());
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
    return (
        <div className="analyze-page">
            <style>{`
      .analyze-page{color:#24334a}.analyze-page button,.analyze-page input,.analyze-page select{font:inherit}
      .analyze-header{display:flex;justify-content:space-between;align-items:center;gap:16px;margin-bottom:28px}
      .analyze-header h1{font-size:24px;color:#23458b;margin:8px 0}.analyze-kicker{font-size:10px;letter-spacing:2px;text-transform:uppercase;color:#728ba3}
      .analyze-demo{font-size:11px;background:#fff6df;border:1px solid #e7d4a8;border-radius:20px;padding:8px 12px;color:#886c31}
      .analyze-demo.ready{background:#dff5ea;border-color:#a9d9bf;color:#2a7451}.analyze-demo.error{background:#fbe5e1;border-color:#e6b4ab;color:#9d382d}
      .analyze-status{display:flex;align-items:center;gap:10px}
      .analyze-layout{display:grid;grid-template-columns:minmax(0,1fr) 275px;gap:24px;align-items:start}
      .analyze-panel{min-width:0;background:#d9f0f5;border:1px solid #b7d2dc;border-radius:12px;padding:22px;box-shadow:0 3px 5px #2039580b}
      .analyze-panel h2{font-size:19px;color:#23458b}.analyze-subtitle{font-size:12px;color:#637e90;line-height:1.7;margin:8px 0 18px}
      .analyze-tabs,.analyze-actions,.analyze-quick{display:flex;flex-wrap:wrap;gap:7px;margin:14px 0}
      .analyze-page button{border:1px solid #b7ceda;border-radius:7px;padding:9px 11px;background:#ffffffa0;color:#45627d;font-size:12px}
      .analyze-page button.chosen,.analyze-page button.primary{background:#23458b;border-color:#23458b;color:white}
      .analyze-actions{justify-content:space-between;align-items:center;border-top:1px solid #bfd9e2;padding-top:16px}.analyze-toggle{display:flex;gap:5px}
      .analyze-chart{height:330px;width:100%;margin-top:20px}.analyze-unit{font-size:11px;color:#66818e;display:flex;justify-content:space-between}
      .analyze-filters label.field{display:grid;gap:8px;font-size:12px;color:#486781;margin-top:18px}
      .analyze-filters input[type=date],.analyze-filters select{width:100%;min-width:0;border:1px solid #b7ceda;background:#f7fcff;padding:10px;border-radius:7px;color:#24334a;font-size:13px}
      .analyze-filters fieldset{border:0;border-top:1px solid #bdd6df;padding:16px 0 0;margin:22px 0 16px}.analyze-filters legend{font-size:12px;color:#486781;padding-right:8px}
      .analyze-check{display:flex;gap:8px;align-items:center;font-size:12px;margin:12px 0}.analyze-check input{accent-color:#23458b}
      .analyze-dot{width:8px;height:8px;border-radius:50%;display:inline-block}.analyze-apply{width:100%;margin-top:10px}
      .analyze-note{font-size:11px;line-height:1.7;color:#6c8395;margin-top:14px}.analyze-error{font-size:12px;color:#9d382d;margin:12px 0}
      .analyze-empty{min-height:300px;display:grid;place-content:center;text-align:center;color:#637e90;gap:12px;font-size:13px}
      .analyze-table-scroll{overflow:auto;max-height:390px;margin-top:20px}.analyze-table{width:100%;border-collapse:collapse;white-space:nowrap;font-size:12px}
      .analyze-table th{background:#cee6ee;color:#355874;position:sticky;top:0;text-align:left;padding:12px 14px}.analyze-table td{padding:12px 14px;border-bottom:1px solid #bdd7e0}.analyze-table tbody tr:nth-child(even){background:#ffffff40}
      .analyze-pagination{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-top:16px;font-size:11px;color:#637e90}
      .analyze-summary{display:grid;grid-template-columns:repeat(auto-fit,minmax(145px,1fr));gap:14px;margin-top:24px}.analyze-stat{border:1px solid #b7d2dc;background:#d9f0f5;padding:17px;border-radius:9px}.analyze-stat h3{font-size:12px;font-weight:500;color:#567488}.analyze-stat strong{font-size:23px;display:block;margin:14px 0 7px}.analyze-stat span{font-size:11px;color:#6c8395}
      @media(max-width:1050px){.analyze-layout{grid-template-columns:1fr}.analyze-filters{grid-row:1}.analyze-header{align-items:flex-start;flex-direction:column}}
      @media(max-width:600px){.analyze-panel{padding:15px}.analyze-chart{height:280px}.analyze-pagination{flex-wrap:wrap}}
    `}</style>
            <header className="analyze-header">
                <div>
                    <p className="analyze-kicker">Historical measurements</p>
                    <h1>Analyze</h1>
                </div>
                <div className="analyze-status">
                    <span className={`analyze-demo ${status}`}>{badge}</span>
                    <button disabled={status === "loading"} onClick={() => setReloadKey(key => key + 1)}>
                        Refresh
                    </button>
                </div>
            </header>
            {status === "error" && (
                <p className="analyze-error" role="alert">
                    Could not load data from the API: {loadError}
                </p>
            )}
            <div className="analyze-layout">
                <section className="analyze-panel">
                    <h2>{groups[measurement].label}</h2>
                    <p className="analyze-subtitle">
                        {applied.start} – {applied.end} ·{" "}
                        {applied.interval === "raw"
                            ? "2-minute readings"
                            : `${applied.interval === "hourly" ? "Hourly" : "Daily"} averages`}{" "}
                        · WIB (UTC+7)
                    </p>
                    <div className="analyze-tabs" role="group" aria-label="Measurement selection">
                        {(Object.keys(groups) as Measurement[]).map(key => (
                            <button
                                key={key}
                                className={measurement === key ? "chosen" : ""}
                                aria-pressed={measurement === key}
                                onClick={() => {
                                    setMeasurement(key);
                                    setPage(1);
                                }}
                            >
                                {groups[key].label}
                            </button>
                        ))}
                    </div>
                    <div className="analyze-actions">
                        <div className="analyze-toggle" role="group" aria-label="Display mode">
                            {(["chart", "table"] as const).map(mode => (
                                <button
                                    key={mode}
                                    className={view === mode ? "chosen" : ""}
                                    aria-pressed={view === mode}
                                    onClick={() => setView(mode)}
                                >
                                    {mode === "chart" ? "Chart" : "Table"}
                                </button>
                            ))}
                        </div>
                        <button
                            disabled={!rows.length || !active.length}
                            onClick={() => exportCsv(rows, active, applied)}
                        >
                            Download CSV
                        </button>
                    </div>
                    {status === "loading" && !source.length ? (
                        <div className="analyze-empty">
                            <strong>Loading sensor data…</strong>
                        </div>
                    ) : !active.length || !rows.length ? (
                        <div className="analyze-empty">
                            <strong>
                                {!active.length ? "Select at least one measurement" : "No data for these dates"}
                            </strong>
                            <span>
                                {!active.length
                                    ? "Use the checkboxes in the filter panel."
                                    : "Pick dates inside the available data range shown in the filter panel."}
                            </span>
                        </div>
                    ) : view === "chart" ? (
                        <>
                            <div className="analyze-unit">
                                <span>{measurement === "climate" ? "Temperature (°C)" : series[active[0]].unit}</span>
                                {measurement === "climate" && <span>Relative humidity (%)</span>}
                            </div>
                            <div className="analyze-chart">
                                <ResponsiveContainer width="100%" height="100%">
                                    <LineChart data={chartRows} margin={{ top: 8, right: 8, bottom: 8, left: 0 }}>
                                        <CartesianGrid stroke="#bfd8e1" strokeDasharray="3 4" />
                                        <XAxis
                                            dataKey="timestamp"
                                            tickFormatter={value =>
                                                new Intl.DateTimeFormat("en-GB", {
                                                    timeZone: "Asia/Jakarta",
                                                    ...(applied.interval === "daily"
                                                        ? ({ day: "2-digit", month: "short" } as const)
                                                        : ({
                                                              day: "2-digit",
                                                              month: "short",
                                                              hour: "2-digit",
                                                              minute: "2-digit",
                                                          } as const)),
                                                }).format(new Date(value))
                                            }
                                            minTickGap={40}
                                            tick={{ fontSize: 10 }}
                                            axisLine={false}
                                            tickLine={false}
                                        />
                                        <YAxis
                                            yAxisId="left"
                                            width={44}
                                            domain={measurement === "voltage" ? ["auto", "auto"] : [0, "auto"]}
                                            tick={{ fontSize: 11 }}
                                            axisLine={false}
                                            tickLine={false}
                                        />
                                        {measurement === "climate" && (
                                            <YAxis
                                                yAxisId="right"
                                                orientation="right"
                                                width={38}
                                                domain={[0, 100]}
                                                tick={{ fontSize: 11 }}
                                                axisLine={false}
                                                tickLine={false}
                                            />
                                        )}
                                        <Tooltip labelFormatter={value => `${timestampLabel(String(value))} WIB`} />
                                        {active.map(key => (
                                            <Line
                                                key={key}
                                                dataKey={key}
                                                name={`${series[key].label} (${series[key].unit})`}
                                                yAxisId={key === "humidity" ? "right" : "left"}
                                                stroke={series[key].color}
                                                strokeWidth={2}
                                                strokeDasharray={key.startsWith("pa") ? "5 3" : undefined}
                                                dot={rows.length < 3}
                                                activeDot={{ r: 4 }}
                                                connectNulls={false}
                                                isAnimationActive={false}
                                            />
                                        ))}
                                    </LineChart>
                                </ResponsiveContainer>
                            </div>
                            <div className="analyze-tabs">
                                {active.map(key => (
                                    <span key={key} className="analyze-note">
                                        <span className="analyze-dot" style={{ backgroundColor: series[key].color }} />{" "}
                                        {series[key].label}
                                    </span>
                                ))}
                            </div>
                        </>
                    ) : (
                        <>
                            <div className="analyze-table-scroll">
                                <table className="analyze-table">
                                    <thead>
                                        <tr>
                                            <th>Timestamp · WIB</th>
                                            {active.map(key => (
                                                <th key={key}>
                                                    {series[key].label}
                                                    <br />
                                                    {series[key].unit}
                                                </th>
                                            ))}
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {pageRows.map(row => (
                                            <tr key={row.timestamp}>
                                                <td>{timestampLabel(row.timestamp)}</td>
                                                {active.map(key => (
                                                    <td key={key}>{display(row[key])}</td>
                                                ))}
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                            <div className="analyze-pagination">
                                <span>
                                    {rows.length} rows · Page {page} of {totalPages}
                                </span>
                                <div>
                                    <button disabled={page === 1} onClick={() => setPage(value => value - 1)}>
                                        Previous
                                    </button>{" "}
                                    <button disabled={page === totalPages} onClick={() => setPage(value => value + 1)}>
                                        Next
                                    </button>
                                </div>
                            </div>
                        </>
                    )}
                    <p className="analyze-note">
                        {applied.interval === "raw"
                            ? "Sample timestamps are shown in WIB."
                            : "Averages use available valid readings. Timestamps mark the start of each WIB interval; partially populated intervals are included."}{" "}
                        CSV includes all filtered rows, not just the visible table page. Missing values export as empty
                        cells.
                    </p>
                </section>
                <aside className="analyze-panel analyze-filters">
                    <h2>Date range & filters</h2>
                    <p className="analyze-subtitle">Both selected dates are included.</p>
                    <label className="field">
                        Start date
                        <input
                            type="date"
                            value={draft.start}
                            onChange={event => setDraft({ ...draft, start: event.target.value })}
                        />
                    </label>
                    <label className="field">
                        End date
                        <input
                            type="date"
                            value={draft.end}
                            onChange={event => setDraft({ ...draft, end: event.target.value })}
                        />
                    </label>
                    <div className="analyze-quick">
                        <button onClick={() => quickRange(1)}>Today</button>
                        <button onClick={() => quickRange(7)}>Last 7 days</button>
                        <button onClick={() => quickRange(14)}>Last 14 days</button>
                    </div>
                    <label className="field">
                        Averaging interval
                        <select
                            value={draft.interval}
                            onChange={event => setDraft({ ...draft, interval: event.target.value as Interval })}
                        >
                            <option value="raw">2-minute readings</option>
                            <option value="hourly">Hourly averages</option>
                            <option value="daily">Daily averages</option>
                        </select>
                    </label>
                    <button className="primary analyze-apply" onClick={apply}>
                        Apply date range
                    </button>
                    {dirty && <p className="analyze-note">Date or interval changes have not been applied.</p>}
                    {error && (
                        <p className="analyze-error" role="alert">
                            {error}
                        </p>
                    )}
                    <fieldset>
                        <legend>Visible measurements · updates immediately</legend>
                        {groups[measurement].keys.map(key => (
                            <label key={key} className="analyze-check">
                                <input
                                    type="checkbox"
                                    checked={selected.includes(key)}
                                    onChange={() =>
                                        setSelected(current =>
                                            current.includes(key)
                                                ? current.filter(item => item !== key)
                                                : [...current, key],
                                        )
                                    }
                                />
                                <span className="analyze-dot" style={{ backgroundColor: series[key].color }} />
                                {series[key].label}
                            </label>
                        ))}
                    </fieldset>
                    <p className="analyze-note">
                        {first && last ? (
                            <>
                                Available data: {timestampLabel(first.timestamp)} – {timestampLabel(last.timestamp)} WIB
                                ({source.length} readings). Dates outside this range return no data.
                            </>
                        ) : (
                            "No data loaded yet."
                        )}
                    </p>
                    <button
                        disabled={!source.length}
                        onClick={() => {
                            const range = { ...initial, interval: draft.interval };
                            userApplied.current = false;
                            setDraft(range);
                            setApplied(range);
                            setError("");
                            setPage(1);
                        }}
                    >
                        Use full data range
                    </button>
                </aside>
            </div>
            <p className="analyze-note">
                Summary for the applied date range · means calculated from original available readings, not averages of
                averages.
            </p>
            <section className="analyze-summary" aria-label="Selected period summary">
                {active.map(key => {
                    const values = filtered
                        .map(row => row[key])
                        .filter((value): value is number => value != null && Number.isFinite(value));
                    const avg = values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
                    return (
                        <article className="analyze-stat" key={key}>
                            <h3>Mean {series[key].label}</h3>
                            <strong>
                                {display(avg)} <span>{series[key].unit}</span>
                            </strong>
                            <span>{values.length} valid source readings</span>
                        </article>
                    );
                })}
            </section>
        </div>
    );
}
