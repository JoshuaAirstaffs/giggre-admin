"use client";

import { useEffect, useState } from "react";
import type { LevelReward } from "@/lib/referralRewards";

// setTimeout can't wait longer than ~24.8 days; longer waits just re-arm
const MAX_TIMEOUT_MS = 2_147_483_647;

/**
 * "Now", for working out which referral rate applies — re-rendering exactly
 * when a time-limited rate starts or expires, so a page left open switches
 * back to the default rate on its own instead of showing a stale promo.
 * Also re-checks when the tab becomes visible (laptop sleep pauses timers).
 */
export function useRateClock(levels: readonly LevelReward[] | null | undefined): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const boundaries = (levels ?? [])
      .flatMap((l) => (l.promoRate == null ? [] : [l.promoFrom, l.promoUntil]))
      .filter((t): t is number => t != null && t > now);
    const next = boundaries.length ? Math.min(...boundaries) : null;

    const timer = next == null
      ? null
      : window.setTimeout(() => setNow(Date.now()), Math.min(next - now + 50, MAX_TIMEOUT_MS));
    const onVisible = () => {
      if (document.visibilityState === "visible") setNow(Date.now());
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      if (timer != null) window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [levels, now]);

  return now;
}
