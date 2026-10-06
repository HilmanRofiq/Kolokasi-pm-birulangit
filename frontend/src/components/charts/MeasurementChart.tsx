import { useState } from "react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { Measurement, SensorReading } from "../../types/sensor";

interface Series {
    key: Exclude<keyof SensorReading, "timestamp">;
    label: string;
    color: string;
    unit: string;
}

const groups: Record<Measurement, { label: string; series: Series[] }> = {
    pm25: {
        label: "PM2.5 · BL vs PA",
        series: [
            { key: "bl1", label: "BL Sensor 1", color: "#249b7c", unit: "µg/m³" },
            { key: "bl2", label: "BL Sensor 2", color: "#aa8700", unit: "µg/m³" },
            { key: "bl3", label: "BL Sensor 3", color: "#ac36df", unit: "µg/m³" },
            { key: "paA", label: "PA Channel A", color: "#245fd2", unit: "µg/m³" },
            { key: "paB", label: "PA Channel B", color: "#e54374", unit: "µg/m³" },
        ],
    },
    climate: {
        label: "Temperature & Humidity",
        series: [
            { key: "temperature", label: "Temperature", color: "#c77329", unit: "°C" },
            { key: "humidity", label: "Humidity", color: "#188caf", unit: "%" },
        ],
    },
    voltage: {
        label: "Battery Voltage",
        series: [{ key: "voltage", label: "Battery voltage", color: "#249b7c", unit: "V" }],
    },
};

const timeFormatter = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Jakarta",
    hour: "2-digit",
    minute: "2-digit",
});

function formatTime(timestamp: string) {
    return timeFormatter.format(new Date(timestamp));
}

export default function MeasurementChart({ readings }: { readings: SensorReading[] }) {
    const [measurement, setMeasurement] = useState<Measurement>("pm25");
    const [hidden, setHidden] = useState<string[]>([]);
    const group = groups[measurement];

    function toggleSeries(key: string) {
        setHidden(current => (current.includes(key) ? current.filter(item => item !== key) : [...current, key]));
    }

    return (
        <section className="chart-card">
            <div className="section-heading">
                <div>
                    <h2>Last hour</h2>
                    <p>2-minute readings · WIB (UTC+7)</p>
                </div>
                <span className="small-badge">Time series</span>
            </div>

            <div className="measurement-tabs" role="group" aria-label="Measurement">
                {(Object.keys(groups) as Measurement[]).map(key => (
                    <button
                        key={key}
                        aria-pressed={measurement === key}
                        className={measurement === key ? "selected" : ""}
                        onClick={() => {
                            setMeasurement(key);
                            setHidden([]);
                        }}
                    >
                        {groups[key].label}
                    </button>
                ))}
            </div>

            <div className="axis-caption">
                <span>{group.series[0].unit}</span>
                {measurement === "climate" && <span>Relative humidity (%)</span>}
            </div>

            {readings.length === 0 ? (
                <div className="empty-chart">No readings available for this period.</div>
            ) : (
                <div className="chart-container">
                    <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={readings} margin={{ top: 12, right: 12, bottom: 12 }}>
                            <CartesianGrid stroke="#c5dce2" strokeDasharray="3 4" />
                            <XAxis
                                dataKey="timestamp"
                                tickFormatter={formatTime}
                                minTickGap={38}
                                tick={{ fontSize: 11 }}
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
                                    domain={[0, 100]}
                                    width={38}
                                    tick={{ fontSize: 11 }}
                                    axisLine={false}
                                    tickLine={false}
                                />
                            )}
                            <Tooltip labelFormatter={label => `${formatTime(String(label))} WIB`} />
                            {group.series.map(series => (
                                <Line
                                    key={series.key}
                                    dataKey={series.key}
                                    name={`${series.label} (${series.unit})`}
                                    yAxisId={series.key === "humidity" ? "right" : "left"}
                                    stroke={series.color}
                                    strokeWidth={2}
                                    strokeDasharray={series.key.startsWith("pa") ? "5 3" : undefined}
                                    dot={false}
                                    activeDot={{ r: 4 }}
                                    connectNulls={false}
                                    hide={hidden.includes(series.key)}
                                    isAnimationActive={false}
                                />
                            ))}
                        </LineChart>
                    </ResponsiveContainer>
                </div>
            )}

            <div className="chart-legend">
                {group.series.map(series => (
                    <button
                        key={series.key}
                        className={hidden.includes(series.key) ? "muted" : ""}
                        aria-pressed={!hidden.includes(series.key)}
                        onClick={() => toggleSeries(series.key)}
                    >
                        <span style={{ backgroundColor: series.color }} />
                        {series.label}
                    </button>
                ))}
            </div>
        </section>
    );
}
