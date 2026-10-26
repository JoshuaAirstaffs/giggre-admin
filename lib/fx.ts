"use client";

import { useEffect, useState } from "react";
import { doc, onSnapshot, serverTimestamp, setDoc, type Timestamp } from "firebase/firestore";
import { getFunctions, httpsCallable } from "firebase/functions";
import app, { db } from "@/lib/firebase";
import { FUNCTIONS_REGION, fmtMoney } from "@/lib/gigPoints";

// Live USD→PHP rate (giggre_app/functions/src/fx.ts). Gig Points / Gig Wallet
// settings are entered in USD; PH users get them converted at this rate.

export const FX_DOC = doc(db, "general_config", "fx_rates");

export interface FxState {
  /** Effective PHP per 1 USD (override, else live). null = not fetched yet. */
  php: number | null;
  live: number | null;
  override: number | null;
  source: string | null;
  fetchedAt: Date | null;
  loading: boolean;
}

const pos = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null);

export function useFx(): FxState {
  const [st, setSt] = useState<FxState>({ php: null, live: null, override: null, source: null, fetchedAt: null, loading: true });
  useEffect(() => onSnapshot(FX_DOC, (snap) => {
    const d = snap.data() ?? {};
    const live = pos(d.rates?.PHP);
    const override = pos(d.override?.PHP);
    setSt({
      php: override ?? live, live, override,
      source: typeof d.source === "string" ? d.source : null,
      fetchedAt: (d.fetchedAt as Timestamp | undefined)?.toDate?.() ?? null,
      loading: false,
    });
  }, () => setSt((s) => ({ ...s, loading: false }))), []);
  return st;
}

/** "≈ ₱560.00" for a USD amount, or "" when the rate isn't known. */
export const phpHint = (usd: number | null | undefined, fx: FxState) =>
  usd != null && !Number.isNaN(usd) && fx.php ? `≈ ${fmtMoney(usd * fx.php, "PHP")}` : "";

export async function saveFxOverride(php: number | null, uid: string) {
  await setDoc(FX_DOC, { override: { PHP: php }, overrideBy: uid, overrideAt: serverTimestamp() }, { merge: true });
}

export const refreshFxNow = async () =>
  (await httpsCallable<Record<string, never>, { PHP: number; source: string }>(getFunctions(app, FUNCTIONS_REGION), "adminRefreshFxRates")({})).data;
