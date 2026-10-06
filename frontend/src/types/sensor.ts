export type Measurement = "pm25" | "climate" | "voltage";

export interface SensorReading {
    timestamp: string;
    bl1: number | null;
    bl2: number | null;
    bl3: number | null;
    paA: number | null;
    paB: number | null;
    temperature: number | null;
    humidity: number | null;
    voltage: number | null;
}

export interface HomeData {
    mode: "demo" | "live";
    deviceName: string;
    paName: string;
    readings: SensorReading[];
    batteryPercent: number | null;
    uptimeSeconds: number | null;
}
