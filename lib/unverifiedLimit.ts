"use client";

import { useEffect, useState } from "react";
import { doc, onSnapshot } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useFx } from "@/lib/fx";

// Unverified-account earning limit — mirrors giggre_app/functions/src/unverifiedLimits.ts
// (periodKey) and lib/core/services/unverified_limit.dart. Keep all three in sync.
//   general_config/unverified_limits { enabled, maxUsd, resetPeriod, resetEpoch }
//   transaction_totals/{uid} { periodKey, worker: {CCY: amt}, host: {CCY: amt}, gigs }

export const RESET_PERIODS = ["never", "daily", "weekly", "monthly", "yearly"] as const;
export type ResetPeriod = (typeof RESET_PERIODS)[number];

export interface LimitConfig { enabled: boolean; maxUsd: number | null; resetPeriod: ResetPeriod; resetEpoch: number }

const pos = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null);
const pad = (n: number) => String(n).padStart(2, "0");

export function toLimitConfig(d: Record<string, unknown> | undefined): LimitConfig {
  const p = RESET_PERIODS.includes(d?.resetPeriod as ResetPeriod) ? (d!.resetPeriod as ResetPeriod) : "never";
  return { enabled: d?.enabled === true, maxUsd: pos(d?.maxUsd), resetPeriod: p, resetEpoch: pos(d?.resetEpoch) ?? 0 };
}

/** Current counting period (Philippine time, weeks start Monday). */
export function periodKey(cfg: Pick<LimitConfig, "resetPeriod" | "resetEpoch">, nowMs = Date.now()): string {
  const t = new Date(nowMs + 8 * 3600_000);
  const y = t.getUTCFullYear(), m = t.getUTCMonth() + 1, d = t.getUTCDate();
  let bucket: string;
  switch (cfg.resetPeriod) {
    case "daily": bucket = `${y}-${pad(m)}-${pad(d)}`; break;
    case "weekly": {
      const mon = new Date(Date.UTC(y, m - 1, d - ((t.getUTCDay() + 6) % 7)));
      bucket = `${mon.getUTCFullYear()}-${pad(mon.getUTCMonth() + 1)}-${pad(mon.getUTCDate())}`;
      break;
    }
    case "monthly": bucket = `${y}-${pad(m)}`; break;
    case "yearly": bucket = `${y}`; break;
    default: bucket = "all";
  }
  return `${Math.round(cfg.resetEpoch)}|${cfg.resetPeriod}|${bucket}`;
}

export const RESET_LABEL: Record<ResetPeriod, string | null> = {
  never: null, daily: "Resets daily", weekly: "Resets every Monday", monthly: "Resets on the 1st", yearly: "Resets every Jan 1",
};

export interface LimitUsage {
  config: LimitConfig | null;
  workerUsd: number;
  hostUsd: number;
  usedUsd: number;
  gigs: number;
  loading: boolean;
}

/** Live usage of one user in the current period, in USD (PHP converted at the live rate). */
export function useUnverifiedLimit(uid: string): LimitUsage {
  const fx = useFx();
  const [config, setConfig] = useState<LimitConfig | null>(null);
  const [totals, setTotals] = useState<Record<string, unknown> | null | undefined>(undefined);

  useEffect(() => onSnapshot(doc(db, "general_config", "unverified_limits"),
    (s) => setConfig(toLimitConfig(s.data())), () => setConfig(toLimitConfig(undefined))), []);
  useEffect(() => onSnapshot(doc(db, "transaction_totals", uid),
    (s) => setTotals(s.data() ?? null), () => setTotals(null)), [uid]);

  const loading = config == null || totals === undefined;
  const current = config && totals && (totals.periodKey ?? "0|never|all") === periodKey(config) ? totals : null;
  const side = (k: string) => {
    let sum = 0;
    const m = current?.[k];
    if (m && typeof m === "object") {
      for (const [ccy, v] of Object.entries(m as Record<string, unknown>)) {
        const rate = ccy === "USD" ? 1 : ccy === "PHP" ? fx.php : null;
        if (typeof v === "number" && v > 0 && rate) sum += v / rate;
      }
    }
    return sum;
  };
  const workerUsd = side("worker"), hostUsd = side("host");
  return { config, workerUsd, hostUsd, usedUsd: workerUsd + hostUsd, gigs: Number(current?.gigs) || 0, loading };
}
