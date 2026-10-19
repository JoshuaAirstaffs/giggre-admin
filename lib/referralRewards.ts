import { doc, getDoc, Timestamp } from "firebase/firestore";
import { db } from "@/lib/firebase";

// ─── Referral reward settings ─────────────────────────────────────────────────
//
// Stored at referral_settings/rewards (signed-in users read; super admins and
// admins with the Referrals module write — see giggre_app's firestore.rules).
// Edited on /referrals/referral-settings and used by the Referral tree's earnings.
//
// Per level (0 = invited directly, 1 = level 2, 2 = level 3):
//   defaultRate — ₱ per person who completed a gig
//   promoRate   — optional rate that replaces the default from promoFrom up to
//                 promoUntil (Firestore Timestamps; exact date and time)
//   maxEarn     — most one referrer can earn from this level; 0 = no limit
// Plus totalMaxEarn at the document root — most one referrer can earn from
// all levels combined, applied after the per-level limits; 0 = no limit.

export const REFERRAL_REWARDS_DOC = doc(db, "referral_settings", "rewards");

export const LEVEL_LABELS = ["Invited directly", "Level 2", "Level 3"] as const;

export interface LevelReward {
  defaultRate: number;
  promoRate: number | null;
  /** Start of the time-limited rate, epoch ms */
  promoFrom: number | null;
  /** When the time-limited rate expires, epoch ms */
  promoUntil: number | null;
  maxEarn: number;
}

export type ReferralRewards = [LevelReward, LevelReward, LevelReward];

export interface ReferralSettings {
  levels: ReferralRewards;
  /** Most one user can earn from referrals overall; 0 = no limit */
  totalMaxEarn: number;
}

/** Factory defaults — what "Reset to defaults" restores. */
export const DEFAULT_REWARDS: ReferralRewards = [
  { defaultRate: 50, promoRate: null, promoFrom: null, promoUntil: null, maxEarn: 0 },
  { defaultRate: 5,  promoRate: null, promoFrom: null, promoUntil: null, maxEarn: 0 },
  { defaultRate: 1,  promoRate: null, promoFrom: null, promoUntil: null, maxEarn: 0 },
];

const num = (v: unknown, fallback: number) => (typeof v === "number" && isFinite(v) && v >= 0 ? v : fallback);

/**
 * Stored Timestamp → epoch ms. Also reads the earlier date-only "YYYY-MM-DD"
 * format: a From date meant the start of that day, an Until date the end of it.
 */
function instant(v: unknown, endOfDay: boolean): number | null {
  if (v instanceof Timestamp) return v.toMillis();
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v)) {
    const ms = new Date(`${v}T${endOfDay ? "23:59:59.999" : "00:00:00"}`).getTime();
    return isFinite(ms) ? ms : null;
  }
  return null;
}

/** Normalizes whatever is stored (missing, partial, or malformed) onto the defaults. */
export function parseRewards(raw: unknown): ReferralRewards {
  const levels = (raw as { levels?: unknown })?.levels;
  return DEFAULT_REWARDS.map((d, i) => {
    const l = Array.isArray(levels) ? (levels[i] as Record<string, unknown> | undefined) : undefined;
    return {
      defaultRate: num(l?.defaultRate, d.defaultRate),
      promoRate: typeof l?.promoRate === "number" && l.promoRate >= 0 ? l.promoRate : null,
      promoFrom: instant(l?.promoFrom, false),
      promoUntil: instant(l?.promoUntil, true),
      maxEarn: num(l?.maxEarn, d.maxEarn),
    };
  }) as ReferralRewards;
}

export const DEFAULT_SETTINGS: ReferralSettings = { levels: DEFAULT_REWARDS, totalMaxEarn: 0 };

export function parseSettings(raw: unknown): ReferralSettings {
  return {
    levels: parseRewards(raw),
    totalMaxEarn: num((raw as { totalMaxEarn?: unknown })?.totalMaxEarn, 0),
  };
}

/**
 * The saved settings, or null if Referral settings has never been saved.
 * Throws if the read fails — callers should say so rather than fall back to
 * built-in numbers that may not match what the admins configured.
 */
export async function loadReferralSettings(): Promise<ReferralSettings | null> {
  const snap = await getDoc(REFERRAL_REWARDS_DOC);
  return snap.exists() ? parseSettings(snap.data()) : null;
}

/** What gets written to Firestore: date-times as Timestamps. */
export function serializeRewards(rewards: ReferralRewards) {
  return rewards.map((l) => ({
    ...l,
    promoFrom: l.promoFrom == null ? null : Timestamp.fromMillis(l.promoFrom),
    promoUntil: l.promoUntil == null ? null : Timestamp.fromMillis(l.promoUntil),
  }));
}

/** e.g. "Nov 1, 2026, 8:00 AM" */
export function formatInstant(ms: number | null): string {
  return ms == null
    ? ""
    : new Date(ms).toLocaleString("en-US", {
        month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit",
      });
}

export type PromoState = "none" | "upcoming" | "active" | "expired";

/** Active from promoFrom (inclusive) up to promoUntil (exclusive). */
export function promoState(level: LevelReward, now = Date.now()): PromoState {
  if (level.promoRate == null || level.promoFrom == null || level.promoUntil == null) return "none";
  if (now < level.promoFrom) return "upcoming";
  if (now >= level.promoUntil) return "expired";
  return "active";
}

/** The rate in force at `now`: the time-limited rate inside its window, otherwise the default. */
export function effectiveRate(level: LevelReward, now = Date.now()): number {
  return promoState(level, now) === "active" ? level.promoRate! : level.defaultRate;
}

/** Earnings for one level, applying the cap. */
export function levelEarnings(level: LevelReward, qualifiedPeople: number, now = Date.now()) {
  const rate = effectiveRate(level, now);
  const uncapped = qualifiedPeople * rate;
  const capped = level.maxEarn > 0 && uncapped > level.maxEarn;
  return { rate, uncapped, earned: capped ? level.maxEarn : uncapped, capped };
}

/** Applies the overall limit to the sum of the (already per-level-capped) level earnings. */
export function totalEarnings(levelsEarned: number, totalMaxEarn: number) {
  const capped = totalMaxEarn > 0 && levelsEarned > totalMaxEarn;
  return { uncapped: levelsEarned, earned: capped ? totalMaxEarn : levelsEarned, capped };
}

/** Problems that should block saving, by level index. */
export function validateRewards(rewards: ReferralRewards): Record<number, string> {
  const errors: Record<number, string> = {};
  rewards.forEach((l, i) => {
    const hasAnyPromo = l.promoRate != null || l.promoFrom != null || l.promoUntil != null;
    if (hasAnyPromo) {
      if (l.promoRate == null) errors[i] = "Enter the time-limited rate, or clear its dates.";
      else if (l.promoFrom == null || l.promoUntil == null) errors[i] = "Set both the From and Until date and time.";
      else if (l.promoFrom >= l.promoUntil) errors[i] = "Until must be later than From.";
    }
  });
  return errors;
}

// ─── Activity log descriptions ────────────────────────────────────────────────

/**
 * Human-readable list of what changed between two saved versions, one entry
 * per level that changed, e.g.
 *   "Invited directly: default rate ₱50 → ₱60; maximum earnings no limit → ₱500"
 */
export function describeRewardChanges(
  from: ReferralRewards,
  to: ReferralRewards,
  money: (n: number) => string,
): string[] {
  const range = (l: LevelReward) =>
    l.promoFrom != null && l.promoUntil != null
      ? `${formatInstant(l.promoFrom)} – ${formatInstant(l.promoUntil)}`
      : "no dates";
  const cap = (n: number) => (n > 0 ? money(n) : "no limit");

  return to.flatMap((next, i) => {
    const prev = from[i];
    const parts: string[] = [];

    if (prev.defaultRate !== next.defaultRate) {
      parts.push(`default rate ${money(prev.defaultRate)} → ${money(next.defaultRate)}`);
    }

    const hadPromo = prev.promoRate != null;
    const hasPromo = next.promoRate != null;
    if (!hadPromo && hasPromo) {
      parts.push(`time-limited rate added ${money(next.promoRate!)} (${range(next)})`);
    } else if (hadPromo && !hasPromo) {
      parts.push(`time-limited rate ${money(prev.promoRate!)} (${range(prev)}) removed`);
    } else if (hadPromo && hasPromo) {
      if (prev.promoRate !== next.promoRate) {
        parts.push(`time-limited rate ${money(prev.promoRate!)} → ${money(next.promoRate!)}`);
      }
      if (prev.promoFrom !== next.promoFrom || prev.promoUntil !== next.promoUntil) {
        parts.push(`time-limited dates ${range(prev)} → ${range(next)}`);
      }
    }

    if (prev.maxEarn !== next.maxEarn) {
      parts.push(`maximum earnings ${cap(prev.maxEarn)} → ${cap(next.maxEarn)}`);
    }

    return parts.length ? [`${LEVEL_LABELS[i]}: ${parts.join("; ")}`] : [];
  });
}

/** "total limit ₱1,000 → no limit", or null when it didn't change. */
export function describeTotalLimitChange(from: number, to: number, money: (n: number) => string): string | null {
  if (from === to) return null;
  const cap = (n: number) => (n > 0 ? money(n) : "no limit");
  return `Total limit: ${cap(from)} → ${cap(to)}`;
}

/** Every change between two saved versions, levels first, then the total limit. */
export function describeSettingsChanges(
  from: ReferralSettings,
  to: ReferralSettings,
  money: (n: number) => string,
): string[] {
  const total = describeTotalLimitChange(from.totalMaxEarn, to.totalMaxEarn, money);
  return [...describeRewardChanges(from.levels, to.levels, money), ...(total ? [total] : [])];
}

/** One-line summary of all settings, for first-time saves and resets. */
export function describeSettings(settings: ReferralSettings, money: (n: number) => string): string {
  const total = `Total limit: ${settings.totalMaxEarn > 0 ? money(settings.totalMaxEarn) : "no limit"}`;
  return `${describeRewards(settings.levels, money)} · ${total}`;
}

/** One-line summary of every level's settings. */
export function describeRewards(rewards: ReferralRewards, money: (n: number) => string): string {
  return rewards
    .map((l, i) => {
      const bits = [`default rate ${money(l.defaultRate)}`];
      if (l.promoRate != null && l.promoFrom != null && l.promoUntil != null) {
        bits.push(`time-limited rate ${money(l.promoRate)} (${formatInstant(l.promoFrom)} – ${formatInstant(l.promoUntil)})`);
      }
      bits.push(`maximum earnings ${l.maxEarn > 0 ? money(l.maxEarn) : "no limit"}`);
      return `${LEVEL_LABELS[i]}: ${bits.join(", ")}`;
    })
    .join(" · ");
}
