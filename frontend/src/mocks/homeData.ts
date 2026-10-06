import type { HomeData } from "../types/sensor";

const start = Date.parse("2026-09-15T10:00:00+07:00");
const rounded = (value: number) => Number(value.toFixed(2));

export const homeData: HomeData = {
    mode: "demo",
    deviceName: "LCS_PM-Kolokasi DLH Sby 1",
    paName: "PurpleAir · Example sensor",
    batteryPercent: null,
    uptimeSeconds: 7080,
    readings: Array.from({ length: 30 }, (_, index) => ({
        timestamp: new Date(start + index * 120_000).toISOString(),
        bl1: rounded(13 + Math.sin(index / 3) * 2),
        bl2: rounded(12 + Math.sin(index / 3 + 0.4) * 2),
        bl3: rounded(14 + Math.sin(index / 3 + 0.8) * 2),
        paA: rounded(13 + Math.cos(index / 4) * 1.7),
        paB: rounded(12 + Math.cos(index / 4 + 0.5) * 1.8),
        temperature: rounded(30 + Math.sin(index / 8)),
        humidity: rounded(62 + Math.cos(index / 8) * 3),
        voltage: rounded(14.23 - index * 0.004),
    })),
};
