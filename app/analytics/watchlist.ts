// ─── Watch list ───────────────────────────────────────────────────────────────
//
// Users worth an admin's attention. Each flag is independent; a user can carry
// several, and more flags sort higher.

import type { GigOutcome, RatingInput } from "./leaderboard";

export const WATCH_RULES = {
  /** Frequent cancellers: at least this many cancellations they caused… */
  minCancellations: 3,
  /** …and finishing less than this share of the gigs that ended (%) */
  maxReliability: 70,
  /** Low ratings: average below this… */
  maxAvgRating: 3,
  /** …from at least this many ratings */
  minRatings: 3,
  /** Reported: at least this many different people reported them */
  minReporters: 2,
  /** Quick Gig decliners: lifetime declined offers */
  minDeclines: 10,
};

export type WatchFlag = "cancels" | "ratings" | "reports" | "declines";

export interface ReportInput {
  reportedUserId: string;
  reporterId: string;
  reason: string | null;
}

export interface WatchUser {
  name: string;
  quickGigTotalDeclines: number;
  isBanned: boolean;
  isSuspended: boolean;
}

export interface WatchEntry {
  userId: string;
  name: string;
  flags: WatchFlag[];
  isBanned: boolean;
  isSuspended: boolean;
  cancels?: { role: "host" | "worker"; cancelled: number; reliability: number }[];
  ratings?: { role: "host" | "worker"; avg: number; count: number }[];
  reports?: { reporters: number; total: number; topReason: string | null };
  declines?: number;
}

interface RoleInputs {
  outcomes: GigOutcome[];
  ratings: RatingInput[];
}

export function buildWatchList(
  host: RoleInputs,
  worker: RoleInputs,
  reports: ReportInput[],
  users: Map<string, WatchUser>,
): WatchEntry[] {
  const entries = new Map<string, WatchEntry>();
  const entryFor = (userId: string, fallbackName: string | null) => {
    let e = entries.get(userId);
    if (!e) {
      const u = users.get(userId);
      e = {
        userId,
        name: u?.name ?? fallbackName ?? userId.slice(0, 10),
        flags: [],
        isBanned: u?.isBanned ?? false,
        isSuspended: u?.isSuspended ?? false,
      };
      entries.set(userId, e);
    }
    return e;
  };
  const flag = (e: WatchEntry, f: WatchFlag) => {
    if (!e.flags.includes(f)) e.flags.push(f);
  };

  for (const [role, inputs] of [["host", host], ["worker", worker]] as const) {
    // Frequent cancellers
    const tally = new Map<string, { name: string | null; completed: number; cancelled: number }>();
    for (const o of inputs.outcomes) {
      const t = tally.get(o.userId) ?? { name: null, completed: 0, cancelled: 0 };
      t.name ??= o.name;
      if (o.outcome === "completed") t.completed++;
      else t.cancelled++;
      tally.set(o.userId, t);
    }
    for (const [userId, t] of tally) {
      const reliability = Math.round((t.completed / (t.completed + t.cancelled)) * 100);
      if (t.cancelled >= WATCH_RULES.minCancellations && reliability < WATCH_RULES.maxReliability) {
        const e = entryFor(userId, t.name);
        flag(e, "cancels");
        (e.cancels ??= []).push({ role, cancelled: t.cancelled, reliability });
      }
    }

    // Low ratings
    const stars = new Map<string, number[]>();
    for (const r of inputs.ratings) stars.set(r.rateeId, [...(stars.get(r.rateeId) ?? []), r.stars]);
    for (const [userId, list] of stars) {
      const avg = list.reduce((a, b) => a + b, 0) / list.length;
      if (list.length >= WATCH_RULES.minRatings && avg < WATCH_RULES.maxAvgRating) {
        const e = entryFor(userId, null);
        flag(e, "ratings");
        (e.ratings ??= []).push({ role, avg, count: list.length });
      }
    }
  }

  // Reported by several different people
  const byReported = new Map<string, { reporters: Set<string>; total: number; reasons: Map<string, number> }>();
  for (const r of reports) {
    const t = byReported.get(r.reportedUserId) ?? { reporters: new Set<string>(), total: 0, reasons: new Map() };
    t.reporters.add(r.reporterId);
    t.total++;
    if (r.reason) t.reasons.set(r.reason, (t.reasons.get(r.reason) ?? 0) + 1);
    byReported.set(r.reportedUserId, t);
  }
  for (const [userId, t] of byReported) {
    if (t.reporters.size < WATCH_RULES.minReporters) continue;
    const topReason = [...t.reasons.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
    const e = entryFor(userId, null);
    flag(e, "reports");
    e.reports = { reporters: t.reporters.size, total: t.total, topReason };
  }

  // Quick Gig decliners (lifetime counter on the user doc)
  for (const [userId, u] of users) {
    if (u.quickGigTotalDeclines >= WATCH_RULES.minDeclines) {
      const e = entryFor(userId, null);
      flag(e, "declines");
      e.declines = u.quickGigTotalDeclines;
    }
  }

  const ORDER: WatchFlag[] = ["reports", "cancels", "ratings", "declines"];
  return [...entries.values()]
    .map((e) => ({ ...e, flags: ORDER.filter((f) => e.flags.includes(f)) }))
    .sort((a, b) =>
      b.flags.length - a.flags.length ||
      ORDER.indexOf(a.flags[0]) - ORDER.indexOf(b.flags[0]) ||
      a.name.localeCompare(b.name));
}
