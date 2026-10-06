import type { HomeData } from "../types/sensor";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "";

function parseUptimeToSeconds(uptime: string | null | undefined): number | null {
    if (!uptime) return null;

    const parts = uptime.split(":").map(part => Number(part));
    if (parts.some(value => Number.isNaN(value))) return null;

    const [hours = 0, minutes = 0, seconds = 0] = parts;
    return hours * 3600 + minutes * 60 + seconds;
}

function normalizeReadings(apiData: any) {
    const timestamps = apiData?.per_2_menit?.timestamps ?? [];
    const pm = apiData?.per_2_menit?.pm ?? {};
    const temp = apiData?.per_2_menit?.th?.Tempoutv ?? [];
    const humid = apiData?.per_2_menit?.th?.Humidoutv ?? [];
    const voltage = apiData?.per_2_menit?.V_bat ?? [];

    return timestamps.map((timestamp: string, index: number) => ({
        timestamp,
        bl1: pm.PM25v_1?.[index] ?? null,
        bl2: pm.PM25v_2?.[index] ?? null,
        bl3: pm.PM25v_3?.[index] ?? null,
        paA: apiData?.purpleair?.sensors?.[0]?.per_10_menit?.PM25v_1?.[index] ?? null,
        paB: apiData?.purpleair?.sensors?.[0]?.per_10_menit?.PM25v_2?.[index] ?? null,
        temperature: temp[index] ?? null,
        humidity: humid[index] ?? null,
        voltage: voltage[index] ?? null,
    }));
}

export async function getHomeData(): Promise<HomeData> {
    const device = "Personal_Exposure_AQMS";
    const url = API_BASE_URL
        ? `${API_BASE_URL}/api/get/get_collocation_dashboard?device=${encodeURIComponent(device)}`
        : `/api/get/get_collocation_dashboard?device=${encodeURIComponent(device)}`;

    const response = await fetch(url);

    if (!response.ok) {
        throw new Error(`API error: ${response.status}`);
    }

    const data = await response.json();

    return {
        mode: "live",
        deviceName: data.device ?? "Unknown device",
        paName: data.purpleair?.sensors?.[0]?.device ?? "PurpleAir sensor",
        readings: normalizeReadings(data),
        batteryPercent: data.baterai?.Percent_bat ?? null,
        uptimeSeconds: parseUptimeToSeconds(data.uptime?.Uptime),
    };
}
