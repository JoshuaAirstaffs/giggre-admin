// ─── Top hosts / workers ──────────────────────────────────────────────────────
//
// One place that defines what "top" means, so future badges ("Top host",
// "Top worker", …) can be awarded from the exact same ranking the admin sees.

/** One user's part in one gig — as its host, or as one of its workers. */
export interface Participation {
  userId: string;
  name: string | null;
  completed: boolean;
}

export interface LeaderboardEntry {
  rank: number;
  userId: string;
  name: string;
  completed: number;
  total: number;
  /** completed ÷ total, 0–100 */
  completionRate: number;
}

export const LEADERBOARD_SIZE = 5;
/** Most active is volume-only, but anyone finishing under half their gigs is left out. */
export const LEADERBOARD_MIN_RATE = 50;

/**
 * Ranked by completed gigs; ties broken by completion rate, then by total.
 * Users below LEADERBOARD_MIN_RATE completion are excluded.
 * Users still tied on all three share a rank (1, 2, 2, 4 …).
 */
export function buildLeaderboard(
  parts: Participation[],
  userNames: Map<string, string>,
  size = LEADERBOARD_SIZE,
): LeaderboardEntry[] {
  const byUser = new Map<string, { name: string | null; completed: number; total: number }>();
  for (const p of parts) {
    const row = byUser.get(p.userId) ?? { name: null, completed: 0, total: 0 };
    row.name ??= p.name;
    row.total++;
    if (p.completed) row.completed++;
    byUser.set(p.userId, row);
  }

  const sorted = [...byUser.entries()]
    .map(([userId, r]) => ({
      userId,
      name: userNames.get(userId) ?? r.name ?? userId.slice(0, 10),
      completed: r.completed,
      total: r.total,
      completionRate: r.total ? Math.round((r.completed / r.total) * 100) : 0,
    }))
    .filter((e) => e.completed > 0 && e.completionRate >= LEADERBOARD_MIN_RATE)
    .sort((a, b) =>
      b.completed - a.completed ||
      b.completionRate - a.completionRate ||
      b.total - a.total ||
      a.name.localeCompare(b.name));

  const ranked: LeaderboardEntry[] = [];
  sorted.forEach((e, i) => {
    const prev = ranked[i - 1];
    const tied =
      prev &&
      prev.completed === e.completed &&
      prev.completionRate === e.completionRate &&
      prev.total === e.total;
    ranked.push({ ...e, rank: tied ? prev.rank : i + 1 });
  });
  return ranked.slice(0, size);
}

// ─── Best hosts / workers (badge ranking) ─────────────────────────────────────
//
// Score out of 100:
//   50% rating      — average stars, pulled toward the month's average when a
//                     user has few ratings, so one 5★ can't beat fifty 4.9★
//   30% reliability — completed ÷ (completed + cancelled)
//   20% activity    — completed gigs vs. the month's most active user (log scale,
//                     so volume alone can't win)

export const BEST_WEIGHTS = { rating: 50, reliability: 30, activity: 20 };
export const BEST_MIN_COMPLETED = 5;
export const BEST_MIN_RATINGS = 3;
/** How many "virtual" average ratings each user starts with. */
export const RATING_PRIOR_WEIGHT = 5;

export type Outcome = "completed" | "cancelled";

export interface GigOutcome {
  userId: string;
  name: string | null;
  outcome: Outcome;
}

export interface RatingInput {
  rateeId: string;
  stars: number;
}

export interface BestUser {
  name: string;
  isVerified: boolean;
  isRestricted: boolean; // banned, suspended or deleted
}

export type Ineligibility = "unverified" | "restricted" | "few_gigs" | "few_ratings";

export interface BestEntry {
  rank: number | null; // null when not eligible
  userId: string;
  name: string;
  score: number;
  avgRating: number | null;
  ratingCount: number;
  completed: number;
  cancelled: number;
  reliability: number; // 0–100
  ineligible: Ineligibility[];
  breakdown: ScoreBreakdown;
}

/** Every number behind a score, for the "how was this computed" view. */
export interface ScoreBreakdown {
  monthAvgRating: number;
  ratingSum: number;
  adjustedRating: number;
  ratingPoints: number;
  reliabilityPoints: number;
  maxCompleted: number;
  activityShare: number; // 0–1
  activityPoints: number;
}

export function buildBestRanking(
  outcomes: GigOutcome[],
  ratings: RatingInput[],
  users: Map<string, BestUser>,
): BestEntry[] {
  const stats = new Map<string, { name: string | null; completed: number; cancelled: number; stars: number[] }>();
  const get = (id: string) => {
    let s = stats.get(id);
    if (!s) stats.set(id, (s = { name: null, completed: 0, cancelled: 0, stars: [] }));
    return s;
  };
  for (const o of outcomes) {
    const s = get(o.userId);
    s.name ??= o.name;
    if (o.outcome === "completed") s.completed++;
    else s.cancelled++;
  }
  for (const r of ratings) get(r.rateeId).stars.push(r.stars);

  const allStars = ratings.map((r) => r.stars);
  const prior = allStars.length ? allStars.reduce((a, b) => a + b, 0) / allStars.length : 4.5;
  const maxCompleted = Math.max(1, ...[...stats.values()].map((s) => s.completed));

  const entries: BestEntry[] = [...stats.entries()].map(([userId, s]) => {
    const user = users.get(userId);
    const n = s.stars.length;
    const sum = s.stars.reduce((a, b) => a + b, 0);
    const adjusted = (RATING_PRIOR_WEIGHT * prior + sum) / (RATING_PRIOR_WEIGHT + n);
    const finished = s.completed + s.cancelled;
    const reliability = finished ? s.completed / finished : 0;
    const activity = Math.log1p(s.completed) / Math.log1p(maxCompleted);

    const ineligible: Ineligibility[] = [];
    if (!user?.isVerified) ineligible.push("unverified");
    if (user?.isRestricted) ineligible.push("restricted");
    if (s.completed < BEST_MIN_COMPLETED) ineligible.push("few_gigs");
    if (n < BEST_MIN_RATINGS) ineligible.push("few_ratings");

    const ratingPoints = BEST_WEIGHTS.rating * ((adjusted - 1) / 4);
    const reliabilityPoints = BEST_WEIGHTS.reliability * reliability;
    const activityPoints = BEST_WEIGHTS.activity * activity;

    return {
      rank: null,
      userId,
      name: user?.name ?? s.name ?? userId.slice(0, 10),
      score: Math.round(ratingPoints + reliabilityPoints + activityPoints),
      breakdown: {
        monthAvgRating: prior,
        ratingSum: sum,
        adjustedRating: adjusted,
        ratingPoints,
        reliabilityPoints,
        maxCompleted,
        activityShare: activity,
        activityPoints,
      },
      avgRating: n ? sum / n : null,
      ratingCount: n,
      completed: s.completed,
      cancelled: s.cancelled,
      reliability: Math.round(reliability * 100),
      ineligible,
    };
  });

  entries.sort((a, b) =>
    b.score - a.score ||
    b.completed - a.completed ||
    a.name.localeCompare(b.name));

  // Rank eligible users only; equal scores share a rank
  let i = 0;
  let prev: BestEntry | null = null;
  for (const e of entries) {
    if (e.ineligible.length) continue;
    i++;
    e.rank = prev && prev.score === e.score ? prev.rank : i;
    prev = e;
  }
  return entries;
}
