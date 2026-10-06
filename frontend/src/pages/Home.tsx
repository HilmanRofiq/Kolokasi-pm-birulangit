import MeasurementChart from "../components/charts/MeasurementChart";
import MetricCard from "../components/home/MetricCard";
import { useHomeData } from "../hooks/useHomeData";

function display(value: number | null | undefined, digits = 1) {
    return value == null ? "—" : value.toFixed(digits);
}

function mean(values: (number | null | undefined)[]) {
    const valid = values.filter((value): value is number => value != null);
    return valid.length ? valid.reduce((sum, value) => sum + value, 0) / valid.length : null;
}

function formatUptime(seconds: number | null) {
    if (seconds == null) return "—";
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const remaining = Math.floor(seconds % 60);
    return [hours, minutes, remaining].map(part => String(part).padStart(2, "0")).join(":");
}

export default function Home() {
    const { data, loading, error, refresh } = useHomeData();

    if (!data) {
        return (
            <section className="state-card" role="status">
                <h1>{loading ? "Loading dashboard…" : "Unable to load dashboard"}</h1>
                {error && <p>{error}</p>}
                {!loading && <button onClick={refresh}>Try again</button>}
            </section>
        );
    }

    const latest = data.readings[data.readings.length - 1];
    const blValues = [latest?.bl1, latest?.bl2, latest?.bl3];
    const paValues = [latest?.paA, latest?.paB];
    const blCount = blValues.filter(value => value != null).length;
    const paCount = paValues.filter(value => value != null).length;
    const validRows = data.readings.filter(row => [row.bl1, row.bl2, row.bl3].some(value => value != null)).length;

    const timestamp = latest
        ? new Intl.DateTimeFormat("en-GB", {
              timeZone: "Asia/Jakarta",
              dateStyle: "medium",
              timeStyle: "short",
          }).format(new Date(latest.timestamp))
        : "No readings";

    return (
        <>
            <header className="page-header">
                <div>
                    <p className="eyebrow">Collocation monitoring</p>
                    <h1>Home overview</h1>
                </div>
                <span className="mode-badge">
                    {data.mode === "demo" ? "Demo data · API not connected" : "API data"}
                </span>
            </header>

            {error && (
                <p className="error-message" role="alert">
                    Refresh failed: {error} Previously loaded readings are shown.
                </p>
            )}

            <div className="home-top">
                <MeasurementChart readings={data.readings} />

                <section className="device-summary">
                    <p className="eyebrow">Monitoring station</p>
                    <h2>Dashboard Collocation</h2>
                    <p className="description">BL and PurpleAir measurements in one view.</p>

                    <dl>
                        <div>
                            <dt>BL device</dt>
                            <dd>{data.deviceName}</dd>
                        </div>
                        <div>
                            <dt>PA sensor</dt>
                            <dd>{data.paName}</dd>
                        </div>
                        <div>
                            <dt>Latest measurement · WIB</dt>
                            <dd>{timestamp}</dd>
                        </div>
                    </dl>

                    <div className="connection-note">
                        <strong>{data.mode === "demo" ? "Sample measurements" : "API connected"}</strong>
                        <p>
                            {data.mode === "demo"
                                ? "Illustrative values only. Refresh reloads the same demo dataset."
                                : "Values show the latest received measurements."}
                        </p>
                    </div>

                    <button className="refresh-button" onClick={refresh} disabled={loading}>
                        {loading ? "Loading…" : data.mode === "demo" ? "Reload demo" : "Refresh data"}
                    </button>
                </section>
            </div>

            <div className="metrics-heading">
                <h2>Latest measurements</h2>
                <span>
                    {timestamp}
                    {latest ? " WIB" : ""}
                </span>
            </div>

            <section className="metrics-grid" aria-label="Measurement summary">
                <MetricCard
                    label="PM2.5 BL"
                    value={display(mean(blValues), 2)}
                    unit="µg/m³"
                    note={`Mean of ${blCount}/3 available BL sensors`}
                />
                <MetricCard
                    label="PM2.5 PA"
                    value={display(mean(paValues), 2)}
                    unit="µg/m³"
                    note={`Mean of ${paCount}/2 available PA channels`}
                />
                <MetricCard label="Temperature" value={display(latest?.temperature)} unit="°C" note="Latest reading" />
                <MetricCard
                    label="Relative humidity"
                    value={display(latest?.humidity)}
                    unit="%"
                    note="Latest reading"
                />
                <MetricCard
                    label="Battery level"
                    value={display(data.batteryPercent, 0)}
                    unit={data.batteryPercent == null ? undefined : "%"}
                    note={data.batteryPercent == null ? "Percentage unavailable" : "Reported battery level"}
                />
                <MetricCard
                    label="Latest voltage"
                    value={display(latest?.voltage, 3)}
                    unit="V"
                    note="Latest battery reading"
                />
                <MetricCard
                    label="Device uptime"
                    value={formatUptime(data.uptimeSeconds)}
                    note="Hours : minutes : seconds"
                />
                <MetricCard
                    label="BL observations"
                    value={String(validRows)}
                    unit="rows"
                    note="Rows with at least one BL reading"
                />
            </section>

            <footer className="page-footer">
                <span>Collocation dashboard</span>
                <span>Timezone: WIB (UTC+7)</span>
            </footer>
        </>
    );
}
