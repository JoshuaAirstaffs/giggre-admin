import type { Timestamp } from "firebase/firestore";

// ─── Types ────────────────────────────────────────────────────────────────────

export type RangeKey = "7d" | "30d" | "90d" | "365d";

export const RANGE_OPTIONS: { key: RangeKey; label: string; days: number }[] = [
  { key: "7d",   label: "7 days",   days: 7 },
  { key: "30d",  label: "30 days",  days: 30 },
  { key: "90d",  label: "90 days",  days: 90 },
  { key: "365d", label: "12 months", days: 365 },
];

export interface Bucket {
  label: string;
  start: number; // ms, inclusive
  end: number;   // ms, exclusive
}

export interface Period {
  start: number;
  end: number;
  prevStart: number;
  buckets: Bucket[];
}

// ─── Time helpers ─────────────────────────────────────────────────────────────

const DAY = 24 * 60 * 60 * 1000;

/** Firestore Timestamp / Date / millis → millis, anything else → null. */
export function toMillis(v: unknown): number | null {
  if (!v) return null;
  if (typeof v === "number") return v;
  if (v instanceof Date) return v.getTime();
  if (typeof (v as Timestamp).toMillis === "function") return (v as Timestamp).toMillis();
  return null;
}

function startOfDay(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/**
 * The selected window ending today, split into chart buckets:
 * daily for ≤30 days, weekly for 90 days, calendar months for 12 months.
 */
export function buildPeriod(range: RangeKey, now = Date.now()): Period {
  const days = RANGE_OPTIONS.find((r) => r.key === range)!.days;
  const end = startOfDay(now) + DAY;
  const buckets: Bucket[] = [];
  let start: number;

  if (range === "365d") {
    const first = new Date(end - DAY);
    first.setDate(1);
    first.setMonth(first.getMonth() - 11);
    start = first.getTime();
    for (let i = 0; i < 12; i++) {
      const s = new Date(first);
      s.setMonth(first.getMonth() + i);
      const e = new Date(s);
      e.setMonth(s.getMonth() + 1);
      buckets.push({
        label: s.toLocaleDateString("en-US", { month: "short", year: "2-digit" }),
        start: s.getTime(),
        end: Math.min(e.getTime(), end),
      });
    }
  } else {
    start = end - days * DAY;
    const step = range === "90d" ? 7 * DAY : DAY;
    for (let s = start; s < end; s += step) {
      buckets.push({
        label: new Date(s).toLocaleDateString("en-US", { month: "short", day: "numeric" }),
        start: s,
        end: Math.min(s + step, end),
      });
    }
  }

  return { start, end, prevStart: start - (end - start), buckets };
}

export function inRange(ms: number | null, start: number, end: number): ms is number {
  return ms != null && ms >= start && ms < end;
}

// ─── Number helpers ───────────────────────────────────────────────────────────

export function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/** % change vs previous period, or null when there's no baseline. */
export function pctChange(current: number, previous: number): number | null {
  if (previous === 0) return null;
  return Math.round(((current - previous) / previous) * 100);
}

export function formatDuration(ms: number | null): string {
  if (ms == null) return "—";
  const hours = ms / (60 * 60 * 1000);
  if (hours < 1) return `${Math.max(1, Math.round(hours * 60))}m`;
  if (hours < 48) return `${hours.toFixed(1)}h`;
  return `${(hours / 24).toFixed(1)}d`;
}

// ─── Location ─────────────────────────────────────────────────────────────────

/** Same shapes the Live Map accepts: GeoPoint-like object or anything with toJSON(). */
export function extractLatLng(location: unknown): { lat: number; lng: number } | null {
  if (!location || typeof location !== "object") return null;
  const src =
    "latitude" in location && "longitude" in location
      ? (location as { latitude: unknown; longitude: unknown })
      : typeof (location as { toJSON?: () => unknown }).toJSON === "function"
        ? ((location as { toJSON: () => unknown }).toJSON() as { latitude: unknown; longitude: unknown })
        : null;
  if (!src) return null;
  const lat = Number(src.latitude);
  const lng = Number(src.longitude);
  return isFinite(lat) && isFinite(lng) ? { lat, lng } : null;
}

// ─── Calendar months (badge periods) ──────────────────────────────────────────

export interface MonthOption {
  key: string; // "2026-10"
  label: string; // "October 2026"
  start: number;
  end: number;
  inProgress: boolean;
}

/** The current month and the `count - 1` before it, newest first. */
export function recentMonths(count = 12, now = Date.now()): MonthOption[] {
  const base = new Date(now);
  return Array.from({ length: count }, (_, i) => {
    const s = new Date(base.getFullYear(), base.getMonth() - i, 1);
    const e = new Date(base.getFullYear(), base.getMonth() - i + 1, 1);
    return {
      key: `${s.getFullYear()}-${String(s.getMonth() + 1).padStart(2, "0")}`,
      label: s.toLocaleDateString("en-US", { month: "long", year: "numeric" }),
      start: s.getTime(),
      end: e.getTime(),
      inProgress: i === 0,
    };
  });
}
