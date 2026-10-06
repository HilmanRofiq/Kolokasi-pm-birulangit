interface MetricCardProps {
    label: string;
    value: string;
    unit?: string;
    note: string;
}

export default function MetricCard({ label, value, unit, note }: MetricCardProps) {
    return (
        <article className="metric-card">
            <h3>{label}</h3>

            <div className="metric-value">
                {value}
                {unit && <span>{unit}</span>}
            </div>

            <p>{note}</p>
        </article>
    );
}
