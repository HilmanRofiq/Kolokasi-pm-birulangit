import { useEffect, useState } from "react";
import { getHomeData } from "../services/sensorApi";
import type { HomeData } from "../types/sensor";

export function useHomeData() {
    const [data, setData] = useState<HomeData | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [requestId, setRequestId] = useState(0);

    useEffect(() => {
        let cancelled = false;

        async function load() {
            setLoading(true);
            setError(null);

            try {
                const result = await getHomeData();
                if (!cancelled) setData(result);
            } catch (cause) {
                if (!cancelled) {
                    setError(cause instanceof Error ? cause.message : "Unable to load readings.");
                }
            } finally {
                if (!cancelled) setLoading(false);
            }
        }

        void load();

        return () => {
            cancelled = true;
        };
    }, [requestId]);

    return {
        data,
        loading,
        error,
        refresh: () => setRequestId(value => value + 1),
    };
}
