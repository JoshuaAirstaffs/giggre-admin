"use client";

import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { collection, collectionGroup, getDocs } from "firebase/firestore";
import {
  ResponsiveContainer, ComposedChart, BarChart,
  Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from "recharts";
import {
  RefreshCw, UserPlus, Users, BadgeCheck, Clock, UserMinus,
  Maximize2, Minimize2, Briefcase, MapPin, Info, Award, type LucideIcon,
} from "lucide-react";
import AdminLayout from "@/components/layout/AdminLayout";
import Button from "@/components/ui/Button";
import Modal from "@/components/ui/Modal";
import { StatCard } from "@/components/ui/Card";
import { useAuthGuard } from "@/hooks/useAuthGuard";
import { useTheme } from "@/context/ThemeContext";
import { db } from "@/lib/firebase";
import {
  RANGE_OPTIONS, type RangeKey, buildPeriod, inRange,
  toMillis, average, pctChange, formatDuration, extractLatLng, recentMonths,
} from "./utils";
import { GIG_COLORS, type HeatPoint } from "./GigHeatmap";
import { ScoreExplainer, ScoreBreakdownDetail, SCORE_BREAKDOWN_CSS } from "./ScoreBreakdown";
import { buildWatchList, WATCH_RULES, type WatchFlag, type WatchUser, type ReportInput } from "./watchlist";
import {
  buildLeaderboard, LEADERBOARD_SIZE, LEADERBOARD_MIN_RATE, type Participation,
  buildBestRanking, BEST_MIN_COMPLETED, BEST_MIN_RATINGS, BEST_WEIGHTS,
  type GigOutcome, type BestUser, type BestEntry, type Ineligibility,
} from "./leaderboard";

// Leaflet requires browser APIs — no SSR
const GigHeatmap = dynamic(() => import("./GigHeatmap"), {
  ssr: false,
  loading: () => <div className="an-empty">Loading map…</div>,
});

// ─── Types ────────────────────────────────────────────────────────────────────

type GigType = "offered" | "open" | "quick";
type GigTypeFilter = "all" | GigType;

type TabKey = "growth" | "marketplace" | "heatmap";

const TABS: { key: TabKey; label: string; icon: LucideIcon }[] = [
  { key: "growth",      label: "Users & growth",     icon: Users },
  { key: "marketplace", label: "Marketplace health", icon: Briefcase },
  { key: "heatmap",     label: "Heatmap",            icon: MapPin },
];

const MAP_TYPES: { key: GigType; label: string; color: string }[] = [
  { key: "quick",   label: "Quick",   color: GIG_COLORS.quick },
  { key: "open",    label: "Open",    color: GIG_COLORS.open },
  { key: "offered", label: "Offered", color: GIG_COLORS.offered },
];

const GIG_COLLECTIONS: Record<GigType, string> = {
  offered: "offered_gigs",
  open: "open_gigs",
  quick: "quick_gigs",
};

interface UserRow {
  id: string;
  name: string;
  createdMs: number | null;
  isVerified: boolean;
  isDeleted: boolean;
  isBanned: boolean;
  suspendedUntilMs: number | null;
  quickGigTotalDeclines: number;
}

interface ReportRow extends ReportInput {
  createdMs: number | null;
}

/** badge_awards/{YYYY-MM}, written by giggre_app's awardMonthlyBadges function */
interface BadgeAward {
  awardedMs: number | null;
  hostIds: Set<string>;
  workerIds: Set<string>;
}

interface VerificationRow {
  status: string;
  submittedMs: number | null;
  reviewedMs: number | null;
}

interface GigRow {
  id: string;
  gigType: GigType;
  createdMs: number | null;
  completedMs: number | null;
  cancelledMs: number | null;
  cancelledBy: CancelledBy;
  status: string;
  hostId: string | null;
  hostName: string | null;
  workerId: string | null;
  workerName: string | null;
  coords: { lat: number; lng: number } | null;
}

/** A worker's slot on a multi-worker gig — {gigCollection}/{gigId}/workers/{workerId} */
interface SlotRow {
  gigKey: string; // `${gigType}/${gigId}`
  workerId: string;
  workerName: string | null;
  status: string;
  completedMs: number | null;
  cancelledBy: CancelledBy;
}

interface RatingRow {
  rateeId: string;
  role: "host" | "worker";
  stars: number;
  createdMs: number | null;
}

/** Who a cancellation counts against — "none" for admin/system cancels. */
type CancelledBy = "host" | "worker" | "none";

/**
 * Same convention as the app's cancellationRequestedBy(): the newest
 * `cancellation_reason` entry's `requestedBy` decides. Legacy entries without
 * it were worker requests; no request at all means the host cancelled directly.
 */
function cancelledByOf(data: Record<string, unknown>): CancelledBy {
  if (data.cancelledByAdmin === true) return "none";
  const reasons = Array.isArray(data.cancellation_reason) ? data.cancellation_reason : [];
  if (reasons.length === 0) return "host";
  const by = (reasons[reasons.length - 1] as { requestedBy?: unknown })?.requestedBy;
  if (by === "host") return "host";
  if (by === "system") return "none";
  return "worker";
}

/**
 * Gigs that ENDED inside the window, as per-user outcomes: completions, and
 * cancellations the user caused. Shared by Best performers and the Watch list.
 * Mirrored by awardMonthlyBadges in giggre_app/functions/src/badges.ts.
 */
function collectOutcomes(gigs: GigRow[], slots: SlotRow[], inWindow: (ms: number | null) => boolean) {
  const slotsByGig = new Map<string, SlotRow[]>();
  for (const sl of slots) {
    if (UNACCEPTED_SLOT_STATUSES.has(sl.status)) continue;
    slotsByGig.set(sl.gigKey, [...(slotsByGig.get(sl.gigKey) ?? []), sl]);
  }

  const host: GigOutcome[] = [];
  const worker: GigOutcome[] = [];
  for (const g of gigs) {
    const status = g.status.toLowerCase();
    const gigSlots = slotsByGig.get(`${g.gigType}/${g.id}`) ?? [];
    const hadWorker = gigSlots.length > 0 || g.workerId != null;

    // Hosts: completed gigs, and cancellations they caused after hiring someone
    if (g.hostId) {
      if (status === "completed" && inWindow(g.completedMs ?? g.createdMs)) {
        host.push({ userId: g.hostId, name: g.hostName, outcome: "completed" });
      } else if (status === "cancelled" && hadWorker && g.cancelledBy === "host" && inWindow(g.cancelledMs ?? g.createdMs)) {
        host.push({ userId: g.hostId, name: g.hostName, outcome: "cancelled" });
      }
    }

    // Workers: per slot on multi-worker gigs, else the gig's own worker
    if (gigSlots.length) {
      for (const sl of gigSlots) {
        if (sl.status === "completed" && inWindow(sl.completedMs ?? g.completedMs ?? g.createdMs)) {
          worker.push({ userId: sl.workerId, name: sl.workerName, outcome: "completed" });
        } else if (sl.status === "cancelled" && sl.cancelledBy === "worker" && inWindow(g.cancelledMs ?? g.createdMs)) {
          worker.push({ userId: sl.workerId, name: sl.workerName, outcome: "cancelled" });
        }
      }
    } else if (g.workerId) {
      if (status === "completed" && inWindow(g.completedMs ?? g.createdMs)) {
        worker.push({ userId: g.workerId, name: g.workerName, outcome: "completed" });
      } else if (status === "cancelled" && g.cancelledBy === "worker" && inWindow(g.cancelledMs ?? g.createdMs)) {
        worker.push({ userId: g.workerId, name: g.workerName, outcome: "cancelled" });
      }
    }
  }
  return { host, worker };
}

const WATCH_FLAG_LABELS: Record<WatchFlag, string> = {
  reports: "Reported",
  cancels: "Frequent cancels",
  ratings: "Low ratings",
  declines: "Quick Gig declines",
};

const INELIGIBLE_LABELS: Record<Ineligibility, string> = {
  unverified: "Not verified",
  restricted: "Banned / suspended",
  few_gigs: `< ${BEST_MIN_COMPLETED} completed`,
  few_ratings: `< ${BEST_MIN_RATINGS} ratings`,
};

// Slot states that are only an offer the worker never took
const UNACCEPTED_SLOT_STATUSES = new Set(["declined", "ringing", "calling"]);

// ─── Helpers ──────────────────────────────────────────────────────────────────

const str = (v: unknown) => (typeof v === "string" && v ? v : null);

const TOOLTIP_STYLE = {
  contentStyle: {
    background: "var(--bg-elevated)",
    border: "1px solid var(--border)",
    borderRadius: 8,
    fontSize: 12,
  },
  labelStyle: { color: "var(--text-primary)", fontWeight: 600 },
  itemStyle: { color: "var(--text-secondary)" },
};

const AXIS_PROPS = {
  stroke: "var(--text-muted)",
  tick: { fill: "var(--text-muted)", fontSize: 11 },
  tickLine: false,
  axisLine: false,
};

function trendOf(current: number, previous: number) {
  const value = pctChange(current, previous);
  return value == null ? undefined : { value, label: "vs previous period" };
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function AnalyticsPage() {
  useAuthGuard({ module: "analytics" });
  const { theme } = useTheme();

  const [range, setRange] = useState<RangeKey>("30d");
  const [gigType, setGigType] = useState<GigTypeFilter>("all");
  const [tab, setTab] = useState<TabKey>("growth");
  const [visitedTabs, setVisitedTabs] = useState<Set<TabKey>>(() => new Set<TabKey>(["growth"]));
  const selectTab = (key: TabKey) => {
    setTab(key);
    setVisitedTabs((prev) => (prev.has(key) ? prev : new Set(prev).add(key)));
  };
  const [mapLabels, setMapLabels] = useState(false);
  const [mapTypes, setMapTypes] = useState<GigType[]>(["quick", "open", "offered"]);

  const [users, setUsers] = useState<UserRow[]>([]);
  const [verifications, setVerifications] = useState<VerificationRow[]>([]);
  const [deletions, setDeletions] = useState<number[]>([]);
  const [gigs, setGigs] = useState<GigRow[]>([]);
  const [slots, setSlots] = useState<SlotRow[]>([]);
  const [ratings, setRatings] = useState<RatingRow[]>([]);
  const [reports, setReports] = useState<ReportRow[]>([]);
  const [awards, setAwards] = useState<Map<string, BadgeAward>>(new Map());
  const [watchFilter, setWatchFilter] = useState<WatchFlag | "all">("all");
  const months = useMemo(() => recentMonths(12), []);
  const [bestMonth, setBestMonth] = useState(() => months[0].key);
  const [showIneligible, setShowIneligible] = useState(false);
  const [marketView, setMarketView] = useState<"best" | "active" | "watch">("best");
  const [explainOpen, setExplainOpen] = useState(false);
  const [breakdown, setBreakdown] = useState<{ entry: BestEntry; role: "host" | "worker" } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // ── Load everything once; filters are applied client-side ──────────────────
  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const types: GigType[] = ["offered", "open", "quick"];
      const [userSnap, verifSnap, deleteSnap, slotSnap, ratingSnap, reportSnap, ...gigSnaps] = await Promise.all([
        getDocs(collection(db, "users")),
        getDocs(collection(db, "verification_requests")),
        getDocs(collection(db, "account_delete_requests")),
        getDocs(collectionGroup(db, "workers")),
        getDocs(collection(db, "ratings")),
        getDocs(collection(db, "reports")),
        ...types.map((t) => getDocs(collection(db, GIG_COLLECTIONS[t]))),
      ]);

      setUsers(userSnap.docs.map((d) => {
        const data = d.data();
        return {
          id: d.id,
          name: str(data.name) ?? "No Name",
          createdMs: toMillis(data.createdAt) ?? toMillis(data.joined_at),
          isVerified: data.isVerified === "verified",
          isDeleted: data.isDeleted === true,
          isBanned: data.isBanned === true,
          suspendedUntilMs: toMillis(data.suspended_until),
          quickGigTotalDeclines: typeof data.quickGigTotalDeclines === "number" ? data.quickGigTotalDeclines : 0,
        };
      }));

      setVerifications(verifSnap.docs.map((d) => {
        const data = d.data();
        return {
          status: str(data.status) ?? "pending",
          submittedMs: toMillis(data.submittedAt),
          reviewedMs: toMillis(data.reviewedAt),
        };
      }));

      setDeletions(
        deleteSnap.docs
          .map((d) => toMillis(d.data().createdAt) ?? toMillis(d.data().requestedAt))
          .filter((ms): ms is number => ms != null)
      );

      setGigs(gigSnaps.flatMap((snap, i) => snap.docs.map((d) => {
        const data = d.data();
        return {
          id: d.id,
          gigType: types[i],
          createdMs: toMillis(data.createdAt),
          completedMs: toMillis(data.completedAt),
          cancelledMs: toMillis(data.cancelledAt),
          cancelledBy: cancelledByOf(data),
          status: str(data.status) ?? "unknown",
          hostId: str(data.hostId),
          hostName: str(data.hostName) ?? str(data.postedBy),
          workerId: str(data.workerId) ?? str(data.assignedWorkerId),
          workerName: str(data.assignedWorkerName) ?? str(data.workerName),
          coords: extractLatLng(data.location),
        };
      })));

      const typeByCollection = Object.fromEntries(
        types.map((t) => [GIG_COLLECTIONS[t], t])
      ) as Record<string, GigType>;
      setSlots(slotSnap.docs.flatMap((d) => {
        const gigRef = d.ref.parent.parent;
        const type = gigRef && typeByCollection[gigRef.parent.id];
        if (!gigRef || !type) return [];
        const data = d.data();
        return [{
          gigKey: `${type}/${gigRef.id}`,
          workerId: str(data.workerId) ?? d.id,
          workerName: str(data.workerName),
          status: str(data.status) ?? "unknown",
          completedMs: toMillis(data.completedAt),
          cancelledBy: cancelledByOf(data),
        }];
      }));

      // Only revealed ratings count — the same ones users can see
      setRatings(ratingSnap.docs.flatMap((d) => {
        const data = d.data();
        const role = data.rateeRole;
        const stars = Number(data.stars);
        if (data.revealedAt == null || (role !== "host" && role !== "worker")) return [];
        if (!str(data.rateeId) || !(stars >= 1 && stars <= 5)) return [];
        return [{ rateeId: data.rateeId, role, stars, createdMs: toMillis(data.createdAt) }];
      }));

      // Dismissed reports don't count against anyone
      setReports(reportSnap.docs.flatMap((d) => {
        const data = d.data();
        if (data.status === "dismissed" || !str(data.reportedUserId) || !str(data.reporterId)) return [];
        return [{
          reportedUserId: data.reportedUserId,
          reporterId: data.reporterId,
          reason: str(data.reason),
          createdMs: toMillis(data.createdAt),
        }];
      }));

      // Optional — needs the badge_awards rule from giggre_app's firestore.rules
      getDocs(collection(db, "badge_awards"))
        .then((snap) => setAwards(new Map(snap.docs.map((d) => {
          const data = d.data();
          const ids = (list: unknown) =>
            new Set(Array.isArray(list) ? list.map((w: { userId?: string }) => w.userId).filter(Boolean) as string[] : []);
          return [d.id, { awardedMs: toMillis(data.awardedAt), hostIds: ids(data.hosts), workerIds: ids(data.workers) }];
        }))))
        .catch((err) => console.warn("[Analytics] badge_awards not readable:", err?.code ?? err));
    } catch (err) {
      console.error("[Analytics] load failed:", err);
      setError("Failed to load analytics data. Please try again.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const period = useMemo(() => buildPeriod(range), [range]);

  // ── 1. Users & growth ──────────────────────────────────────────────────────
  const userStats = useMemo(() => {
    const { start, end, prevStart, buckets } = period;
    const active = users.filter((u) => !u.isDeleted);

    const signups = users.filter((u) => inRange(u.createdMs, start, end)).length;
    const prevSignups = users.filter((u) => inRange(u.createdMs, prevStart, start)).length;

    // Users without a sign-up date predate tracking — count them in every bucket
    const undated = active.filter((u) => u.createdMs == null).length;
    const growth = buckets.map((b) => ({
      label: b.label,
      signups: users.filter((u) => inRange(u.createdMs, b.start, b.end)).length,
      total: undated + active.filter((u) => u.createdMs != null && u.createdMs < b.end).length,
    }));

    const periodVerifs = verifications.filter((v) => inRange(v.submittedMs, start, end));
    const verifByBucket = buckets.map((b) => {
      const row = { label: b.label, verified: 0, rejected: 0, pending: 0 };
      for (const v of periodVerifs) {
        if (!inRange(v.submittedMs, b.start, b.end)) continue;
        if (v.status === "verified") row.verified++;
        else if (v.status === "rejected") row.rejected++;
        else if (v.status === "pending") row.pending++;
      }
      return row;
    });

    const reviewTimes = verifications
      .filter((v) =>
        (v.status === "verified" || v.status === "rejected") &&
        v.submittedMs != null &&
        inRange(v.reviewedMs, start, end))
      .map((v) => v.reviewedMs! - v.submittedMs!)
      .filter((ms) => ms >= 0);

    return {
      signups,
      prevSignups,
      totalUsers: active.length,
      verifiedShare: active.length ? Math.round((active.filter((u) => u.isVerified).length / active.length) * 100) : 0,
      avgReview: average(reviewTimes),
      deletions: deletions.filter((ms) => inRange(ms, start, end)).length,
      prevDeletions: deletions.filter((ms) => inRange(ms, prevStart, start)).length,
      growth,
      verifByBucket,
      verifTotals: {
        submitted: periodVerifs.length,
        verified: periodVerifs.filter((v) => v.status === "verified").length,
        rejected: periodVerifs.filter((v) => v.status === "rejected").length,
        pending: periodVerifs.filter((v) => v.status === "pending").length,
      },
    };
  }, [users, verifications, deletions, period]);

  // ── 3. Marketplace health ──────────────────────────────────────────────────
  const marketStats = useMemo(() => {
    const { start, end } = period;
    const ofType = gigs.filter((g) => gigType === "all" || g.gigType === gigType);
    const inPeriod = ofType.filter((g) => inRange(g.createdMs, start, end));

    const userNames = new Map(users.map((u) => [u.id, u.name]));

    const slotsByGig = new Map<string, SlotRow[]>();
    for (const sl of slots) {
      if (UNACCEPTED_SLOT_STATUSES.has(sl.status)) continue;
      slotsByGig.set(sl.gigKey, [...(slotsByGig.get(sl.gigKey) ?? []), sl]);
    }

    const hostParts: Participation[] = [];
    const workerParts: Participation[] = [];
    for (const g of inPeriod) {
      const gigDone = g.status.toLowerCase() === "completed";
      if (g.hostId) hostParts.push({ userId: g.hostId, name: g.hostName, completed: gigDone });

      // Multi-worker gigs track each worker on their own slot; single-worker
      // gigs keep the worker on the gig doc itself.
      const gigSlots = slotsByGig.get(`${g.gigType}/${g.id}`);
      if (gigSlots?.length) {
        for (const sl of gigSlots) {
          workerParts.push({ userId: sl.workerId, name: sl.workerName, completed: sl.status === "completed" });
        }
      } else if (g.workerId) {
        workerParts.push({ userId: g.workerId, name: g.workerName, completed: gigDone });
      }
    }

    return {
      topHosts: buildLeaderboard(hostParts, userNames),
      topWorkers: buildLeaderboard(workerParts, userNames),
    };
  }, [gigs, slots, users, gigType, period]);

  // ── Best hosts / workers for the picked calendar month (all gig types) ────
  const bestStats = useMemo(() => {
    const month = months.find((m) => m.key === bestMonth) ?? months[0];
    const inMonth = (ms: number | null) => inRange(ms, month.start, month.end);
    const now = Date.now();

    const userInfo = new Map<string, BestUser>(users.map((u) => [u.id, {
      name: u.name,
      isVerified: u.isVerified,
      isRestricted: u.isDeleted || u.isBanned || (u.suspendedUntilMs != null && u.suspendedUntilMs > now),
    }]));

    const { host: hostOutcomes, worker: workerOutcomes } = collectOutcomes(gigs, slots, inMonth);

    const monthRatings = ratings.filter((r) => inMonth(r.createdMs));
    const pick = (entries: BestEntry[]) => {
      const eligible = entries.filter((e) => e.rank != null).slice(0, LEADERBOARD_SIZE);
      return {
        rows: showIneligible ? entries.slice(0, Math.max(LEADERBOARD_SIZE, eligible.length) + 5) : eligible,
        eligibleCount: entries.filter((e) => e.rank != null).length,
        candidateCount: entries.length,
      };
    };

    const award = awards.get(month.key) ?? null;
    const awardDate = new Date(month.end);
    awardDate.setDate(8);

    return {
      month,
      award,
      awardDate,
      hosts: pick(buildBestRanking(hostOutcomes, monthRatings.filter((r) => r.role === "host"), userInfo)),
      workers: pick(buildBestRanking(workerOutcomes, monthRatings.filter((r) => r.role === "worker"), userInfo)),
    };
  }, [gigs, slots, users, ratings, months, bestMonth, showIneligible, awards]);

  // ── Watch list — problem signals within the page's date range ─────────────
  const watchStats = useMemo(() => {
    const { start, end } = period;
    const inWindow = (ms: number | null) => inRange(ms, start, end);
    const now = Date.now();
    const { host, worker } = collectOutcomes(gigs, slots, inWindow);
    const windowRatings = ratings.filter((r) => inWindow(r.createdMs));
    const userInfo = new Map<string, WatchUser>(users.filter((u) => !u.isDeleted).map((u) => [u.id, {
      name: u.name,
      quickGigTotalDeclines: u.quickGigTotalDeclines,
      isBanned: u.isBanned,
      isSuspended: u.suspendedUntilMs != null && u.suspendedUntilMs > now,
    }]));
    const all = buildWatchList(
      { outcomes: host, ratings: windowRatings.filter((r) => r.role === "host") },
      { outcomes: worker, ratings: windowRatings.filter((r) => r.role === "worker") },
      reports.filter((r) => inWindow(r.createdMs)),
      userInfo,
    );
    const counts = Object.fromEntries(
      (Object.keys(WATCH_FLAG_LABELS) as WatchFlag[]).map((f) => [f, all.filter((e) => e.flags.includes(f)).length])
    ) as Record<WatchFlag, number>;
    return { all, counts, rows: watchFilter === "all" ? all : all.filter((e) => e.flags.includes(watchFilter)) };
  }, [gigs, slots, ratings, reports, users, period, watchFilter]);

  // ── Heatmap — has its own gig-type toggles, independent of the section filter ─
  const mapStats = useMemo(() => {
    const { start, end } = period;
    const located = gigs.filter((g) => g.coords != null && inRange(g.createdMs, start, end));
    const counts = Object.fromEntries(
      MAP_TYPES.map(({ key }) => [key, located.filter((g) => g.gigType === key).length])
    ) as Record<GigType, number>;
    const shown = located.filter((g) => mapTypes.includes(g.gigType));
    return {
      counts,
      points: shown.map((g): HeatPoint => ({ ...g.coords!, gigType: g.gigType })),
      totalInPeriod: gigs.filter((g) => mapTypes.includes(g.gigType) && inRange(g.createdMs, start, end)).length,
    };
  }, [gigs, period, mapTypes]);

  // ── Fullscreen — the whole panel, so the type toggles stay usable ─────────
  const mapPanelRef = useRef<HTMLDivElement>(null);
  const [mapFullscreen, setMapFullscreen] = useState(false);

  useEffect(() => {
    const onChange = () => setMapFullscreen(document.fullscreenElement === mapPanelRef.current);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  const toggleMapFullscreen = () => {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else mapPanelRef.current?.requestFullscreen().catch(() => {});
  };

  const toggleMapType = (t: GigType) =>
    setMapTypes((prev) => (prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]));


  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <AdminLayout
      title="Analytics"
      subtitle="Growth and marketplace trends over time"
      actions={
        <>
          <div className="an-pills" role="group" aria-label="Date range">
            {RANGE_OPTIONS.map((r) => (
              <button
                key={r.key}
                className={`an-pill ${range === r.key ? "active" : ""}`}
                onClick={() => setRange(r.key)}
              >
                {r.label}
              </button>
            ))}
          </div>
          <Button variant="ghost" size="sm" icon={RefreshCw} onClick={load} disabled={loading}>
            Refresh
          </Button>
        </>
      }
    >
      <style>{`
        .an-pills {
          display: flex; gap: 2px; padding: 3px;
          background: var(--bg-elevated); border: 1px solid var(--border);
          border-radius: var(--radius-sm);
        }
        .an-pill {
          padding: 5px 10px; font-size: 12px; font-weight: 600;
          color: var(--text-muted); background: none; border: none;
          border-radius: 6px; cursor: pointer; transition: all 0.15s;
        }
        .an-pill:hover { color: var(--text-secondary); }
        .an-pill.active { background: var(--bg-surface); color: var(--text-primary); }
        .an-tabs {
          display: flex; gap: 2px; padding: 4px; margin-bottom: 20px;
          background: var(--bg-elevated); border: 1px solid var(--border);
          border-radius: var(--radius-lg); overflow-x: auto; scrollbar-width: none;
        }
        .an-tabs::-webkit-scrollbar { display: none; }
        .an-tab {
          display: flex; align-items: center; gap: 6px; flex-shrink: 0;
          padding: 7px 14px; font-size: 12px; font-weight: 500; font-family: inherit;
          color: var(--text-muted); background: transparent;
          border: 1px solid transparent; border-radius: 8px;
          cursor: pointer; white-space: nowrap; transition: background 0.12s, color 0.12s;
        }
        .an-tab:hover:not(.active) { background: var(--bg-surface); color: var(--text-secondary); }
        .an-tab.active {
          background: var(--bg-surface); border-color: var(--border); color: var(--text-primary);
          box-shadow: 0 1px 3px rgba(0,0,0,0.1);
        }
        .an-section { margin-bottom: 36px; }
        .an-section[hidden] { display: none; }
        .an-section-head {
          display: flex; align-items: center; justify-content: space-between;
          gap: 12px; flex-wrap: wrap; margin-bottom: 14px;
        }
        .an-section-title { font-size: 16px; font-weight: 700; color: var(--text-primary); }
        .an-section-sub { font-size: 12px; color: var(--text-muted); margin-top: 2px; }
        .an-tiles {
          display: grid; gap: 14px; margin-bottom: 14px;
          grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
        }
        .an-grid {
          display: grid; gap: 14px;
          grid-template-columns: repeat(auto-fit, minmax(min(100%, 420px), 1fr));
        }
        .an-panel {
          background: var(--bg-surface); border: 1px solid var(--border);
          border-radius: var(--radius-lg); padding: 18px 20px; min-width: 0;
        }
        .an-panel-title { font-size: 13px; font-weight: 600; color: var(--text-primary); }
        .an-panel-sub { font-size: 11px; color: var(--text-muted); margin: 2px 0 14px; }
        .an-chart { height: 260px; }
        .an-map { height: max(420px, calc(100vh - 360px)); position: relative; }
        .an-map-panel:fullscreen {
          display: flex; flex-direction: column;
          border-radius: 0; border: none; padding: 20px 24px;
        }
        .an-map-panel:fullscreen .an-map { flex: 1; height: auto; }
        .an-map-note {
          position: absolute; top: 12px; left: 50%; transform: translateX(-50%);
          padding: 6px 12px; font-size: 12px; font-weight: 600;
          color: var(--text-primary); background: var(--bg-surface);
          border: 1px solid var(--border); border-radius: 999px;
          pointer-events: none; white-space: nowrap;
        }
        .an-panel-head {
          display: flex; align-items: flex-start; justify-content: space-between;
          gap: 12px; flex-wrap: wrap;
        }
        .an-chips { display: flex; gap: 6px; flex-wrap: wrap; }
        .an-chip {
          display: inline-flex; align-items: center; gap: 6px;
          padding: 4px 10px; font-size: 12px; font-weight: 600;
          color: var(--text-muted); background: none;
          border: 1px solid var(--border); border-radius: 999px;
          cursor: pointer; transition: all 0.15s;
        }
        .an-chip:hover { color: var(--text-secondary); }
        .an-chip.active { color: var(--text-primary); background: var(--bg-elevated); }
        .an-chip-dot { width: 8px; height: 8px; border-radius: 50%; opacity: 0.35; }
        .an-chip.active .an-chip-dot { opacity: 1; }
        .an-chip-count { font-family: 'Space Mono', monospace; font-weight: 400; color: var(--text-muted); }
        .an-empty {
          height: 100%; min-height: 120px; display: flex; align-items: center; justify-content: center;
          font-size: 13px; color: var(--text-muted);
        }
        .an-funnel { display: flex; flex-direction: column; gap: 10px; }
        .an-funnel-row { display: grid; grid-template-columns: 80px 1fr 44px; align-items: center; gap: 10px; font-size: 12px; }
        .an-funnel-label { color: var(--text-secondary); }
        .an-funnel-track { height: 10px; background: var(--bg-elevated); border-radius: 5px; overflow: hidden; }
        .an-funnel-bar { height: 100%; border-radius: 5px; }
        .an-funnel-val { text-align: right; font-family: 'Space Mono', monospace; color: var(--text-primary); }
        .an-views {
          display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px;
          margin-bottom: 20px; max-width: 820px;
        }
        .an-view {
          display: flex; flex-direction: column; align-items: flex-start; gap: 2px;
          padding: 10px 14px; text-align: left; font-family: inherit; cursor: pointer;
          background: var(--bg-surface); border: 1px solid var(--border);
          border-radius: var(--radius-md); transition: border-color 0.15s, background 0.15s;
        }
        .an-view:hover:not(.active) { background: var(--bg-elevated); }
        .an-view.active { border-color: var(--blue); background: var(--blue-dim); }
        .an-view-label { font-size: 13px; font-weight: 700; color: var(--text-primary); }
        .an-view-hint { font-size: 11px; color: var(--text-muted); }
        .an-legend {
          display: flex; flex-wrap: wrap; align-items: center; gap: 6px 14px;
          margin: -4px 0 14px; font-size: 11px; color: var(--text-muted);
        }
        .an-legend b { color: var(--text-secondary); font-family: 'Space Mono', monospace; font-weight: 700; }
        .an-award {
          display: flex; align-items: center; flex-wrap: wrap; gap: 6px; margin-bottom: 14px;
          padding: 8px 12px; font-size: 12px; color: var(--text-secondary);
          background: var(--bg-elevated); border: 1px dashed var(--border); border-radius: var(--radius-sm);
        }
        .an-award.done { color: var(--text-primary); border-style: solid; border-color: var(--amber); background: var(--amber-dim); }
        .an-award > svg { color: var(--amber); flex-shrink: 0; }
        .an-medal { color: var(--amber); vertical-align: -2px; flex-shrink: 0; }
        .an-name-line { display: flex; align-items: center; gap: 4px; min-width: 0; }
        .an-name-line a { min-width: 0; }
        .an-watch td { vertical-align: top; white-space: normal; }
        .an-watch-flags { display: flex; flex-wrap: wrap; gap: 6px; }
        .an-flag {
          font-size: 11px; padding: 3px 9px; border-radius: 999px; line-height: 1.4;
          color: var(--text-secondary); background: var(--bg-elevated); border: 1px solid var(--border);
        }
        .an-flag b { color: var(--text-primary); }
        .an-flag.reports { border-color: var(--red); background: var(--red-dim); }
        .an-flag.cancels { border-color: var(--orange); background: var(--orange-dim); }
        .an-flag.ratings { border-color: var(--amber); background: var(--amber-dim); }
        .an-flag.declines { border-color: var(--purple); background: var(--purple-dim); }
        .an-link {
          display: inline-flex; align-items: center; gap: 4px; margin-left: auto;
          padding: 0; font-size: 11px; font-weight: 600; font-family: inherit;
          color: var(--blue); background: none; border: none; cursor: pointer;
        }
        .an-link:hover { text-decoration: underline; }
        .an-table tr.clickable { cursor: pointer; }
        .an-table tr.clickable:hover td { background: var(--bg-elevated); }
        ${SCORE_BREAKDOWN_CSS}
        .an-legend-sep { width: 1px; height: 12px; background: var(--border); }
        .an-panel-bar {
          display: flex; align-items: center; justify-content: space-between;
          gap: 8px; margin-bottom: 12px;
        }
        .an-count {
          font-size: 11px; font-weight: 600; color: var(--text-muted);
          padding: 2px 8px; border-radius: 999px; background: var(--bg-elevated); white-space: nowrap;
        }
        .an-table { width: 100%; border-collapse: collapse; font-size: 12px; table-layout: fixed; }
        .an-table th, .an-table td { white-space: nowrap; }
        .an-table td.name { white-space: normal; }
        .an-table .name a { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .an-table th:first-child, .an-table td:first-child { padding-left: 0; }
        .an-table th:last-child, .an-table td:last-child { padding-right: 0; }
        .an-table th {
          text-align: left; font-weight: 600; color: var(--text-muted);
          text-transform: uppercase; font-size: 10px; letter-spacing: 0.3px;
          padding: 0 8px 8px; border-bottom: 1px solid var(--border);
        }
        .an-table td { padding: 8px; color: var(--text-secondary); border-bottom: 1px solid var(--border-muted); }
        .an-table .rank { width: 28px; font-family: 'Space Mono', monospace; color: var(--text-muted); }
        .an-table .name a { color: var(--text-primary); font-weight: 500; text-decoration: none; }
        .an-table .name a:hover { color: var(--blue); text-decoration: underline; }
        .an-table .num { text-align: right; font-family: 'Space Mono', monospace; }
        .an-sub-head {
          display: flex; align-items: center; justify-content: space-between;
          gap: 12px; flex-wrap: wrap; margin-bottom: 12px;
        }
        .an-sub-title { font-size: 14px; font-weight: 700; color: var(--text-primary); }
        .an-sub-controls { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
        .an-select {
          padding: 6px 10px; font-size: 12px; font-weight: 600; font-family: inherit;
          color: var(--text-primary); background: var(--bg-elevated);
          border: 1px solid var(--border); border-radius: var(--radius-sm); cursor: pointer;
        }
        .an-check { display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--text-secondary); cursor: pointer; }
        .an-table tr.muted td { opacity: 0.55; }
        .an-reasons { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 3px; }
        .an-reasons span {
          font-size: 10px; padding: 1px 6px; border-radius: 999px;
          color: var(--amber); background: var(--amber-dim);
        }
        .an-dim { color: var(--text-muted); font-size: 11px; }
        .an-table .num.strong { color: var(--text-primary); font-weight: 700; }
        .an-error {
          padding: 12px 16px; margin-bottom: 20px; font-size: 13px;
          color: var(--red); background: var(--red-dim); border-radius: var(--radius-md);
        }
      `}</style>

      {error && <div className="an-error">{error}</div>}

      <nav className="an-tabs" role="tablist" aria-label="Analytics sections">
        {TABS.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            role="tab"
            aria-selected={tab === key}
            className={`an-tab ${tab === key ? "active" : ""}`}
            onClick={() => selectTab(key)}
          >
            <Icon size={14} />
            {label}
          </button>
        ))}
      </nav>

      {/* ── 1. Users & growth ── */}
      {tab === "growth" && (
      <section className="an-section">
        <div className="an-section-head">
          <div>
            <div className="an-section-title">Users &amp; growth</div>
            <div className="an-section-sub">Sign-ups, verification and account deletions</div>
          </div>
        </div>

        <div className="an-tiles">
          <StatCard label="New sign-ups" value={loading ? "…" : userStats.signups} icon={UserPlus}
            color="var(--blue)" trend={loading ? undefined : trendOf(userStats.signups, userStats.prevSignups)} />
          <StatCard label="Total users" value={loading ? "…" : userStats.totalUsers.toLocaleString()} icon={Users}
            color="var(--purple)" />
          <StatCard label="Verified" value={loading ? "…" : `${userStats.verifiedShare}%`} icon={BadgeCheck}
            color="var(--green)" />
          <StatCard label="Avg review time" value={loading ? "…" : formatDuration(userStats.avgReview)} icon={Clock}
            color="var(--amber)" />
          <StatCard label="Deletion requests" value={loading ? "…" : userStats.deletions} icon={UserMinus}
            color="var(--red)" trend={loading ? undefined : trendOf(userStats.deletions, userStats.prevDeletions)} />
        </div>

        <div className="an-grid">
          <div className="an-panel">
            <div className="an-panel-title">Sign-ups &amp; total users</div>
            <div className="an-panel-sub">New sign-ups per period (bars) and running total (line)</div>
            <div className="an-chart">
              {loading ? <div className="an-empty">Loading…</div> : (
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={userStats.growth} margin={{ top: 4, right: 4, left: -16, bottom: 0 }}>
                    <CartesianGrid stroke="var(--border)" vertical={false} />
                    <XAxis dataKey="label" {...AXIS_PROPS} minTickGap={16} />
                    <YAxis yAxisId="left" {...AXIS_PROPS} allowDecimals={false} />
                    <YAxis yAxisId="right" orientation="right" {...AXIS_PROPS} allowDecimals={false} />
                    <Tooltip {...TOOLTIP_STYLE} cursor={{ fill: "var(--bg-hover)" }} />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Bar yAxisId="left" dataKey="signups" name="New sign-ups" fill="var(--blue)" radius={[4, 4, 0, 0]} />
                    <Line yAxisId="right" dataKey="total" name="Total users" stroke="var(--purple)" strokeWidth={2} dot={false} />
                  </ComposedChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>

          <div className="an-panel">
            <div className="an-panel-title">Verification requests</div>
            <div className="an-panel-sub">Submitted in this period, by current outcome</div>
            <div className="an-funnel" style={{ marginBottom: 16 }}>
              {([
                ["Submitted", userStats.verifTotals.submitted, "var(--blue)"],
                ["Verified",  userStats.verifTotals.verified,  "var(--green)"],
                ["Rejected",  userStats.verifTotals.rejected,  "var(--red)"],
                ["Pending",   userStats.verifTotals.pending,   "var(--amber)"],
              ] as const).map(([label, value, color]) => (
                <div className="an-funnel-row" key={label}>
                  <span className="an-funnel-label">{label}</span>
                  <div className="an-funnel-track">
                    <div className="an-funnel-bar" style={{
                      width: `${userStats.verifTotals.submitted ? (value / userStats.verifTotals.submitted) * 100 : 0}%`,
                      background: color,
                    }} />
                  </div>
                  <span className="an-funnel-val">{loading ? "…" : value}</span>
                </div>
              ))}
            </div>
            <div className="an-chart" style={{ height: 150 }}>
              {loading ? <div className="an-empty">Loading…</div> : (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={userStats.verifByBucket} margin={{ top: 4, right: 4, left: -16, bottom: 0 }}>
                    <CartesianGrid stroke="var(--border)" vertical={false} />
                    <XAxis dataKey="label" {...AXIS_PROPS} minTickGap={16} />
                    <YAxis {...AXIS_PROPS} allowDecimals={false} />
                    <Tooltip {...TOOLTIP_STYLE} cursor={{ fill: "var(--bg-hover)" }} />
                    <Bar dataKey="verified" name="Verified" stackId="v" fill="var(--green)" />
                    <Bar dataKey="rejected" name="Rejected" stackId="v" fill="var(--red)" />
                    <Bar dataKey="pending"  name="Pending"  stackId="v" fill="var(--amber)" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>
        </div>
      </section>
      )}

      {/* ── 3. Marketplace health ── */}
      {tab === "marketplace" && (
      <section className="an-section">
        <div className="an-views" role="tablist" aria-label="Ranking">
          {([
            ["best", "Best performers", "Quality score · used for badges"],
            ["active", "Most active", "Volume · most completed gigs"],
            ["watch", "Watch list", "Users who may need attention"],
          ] as const).map(([key, label, hint]) => (
            <button
              key={key}
              role="tab"
              aria-selected={marketView === key}
              className={`an-view ${marketView === key ? "active" : ""}`}
              onClick={() => setMarketView(key)}
            >
              <span className="an-view-label">{label}</span>
              <span className="an-view-hint">{hint}</span>
            </button>
          ))}
        </div>

        {/* ── Best hosts / workers ── */}
        {marketView === "best" && (
        <div className="an-block">
        <div className="an-sub-head">
          <div>
            <div className="an-sub-title">Best performers</div>
            <div className="an-section-sub">Badge ranking for the month · all gig types</div>
          </div>
          <div className="an-sub-controls">
            <label className="an-check">
              <input type="checkbox" checked={showIneligible} onChange={(e) => setShowIneligible(e.target.checked)} />
              Show not eligible
            </label>
            <select className="an-select" value={bestMonth} onChange={(e) => setBestMonth(e.target.value)} aria-label="Month">
              {months.map((m) => (
                <option key={m.key} value={m.key}>{m.label}{m.inProgress ? " (in progress)" : ""}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="an-legend">
          <span><b>{BEST_WEIGHTS.rating}%</b> Rating</span>
          <span><b>{BEST_WEIGHTS.reliability}%</b> Reliability</span>
          <span><b>{BEST_WEIGHTS.activity}%</b> Activity</span>
          <span className="an-legend-sep" />
          <span>Verified · {BEST_MIN_COMPLETED}+ completed · {BEST_MIN_RATINGS}+ ratings</span>
          <button className="an-link" onClick={() => setExplainOpen(true)}>
            <Info size={12} /> How is this calculated?
          </button>
        </div>

        <div className={`an-award ${bestStats.award ? "done" : ""}`}>
          <Award size={14} />
          {bestStats.award
            ? <>Badges for {bestStats.month.label} were awarded
                {bestStats.award.awardedMs ? ` on ${new Date(bestStats.award.awardedMs).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}` : ""}
                {" "}— winners are marked with <Award size={12} className="an-medal" /></>
            : <>{bestStats.month.inProgress ? "Month in progress — " : ""}
                Badges for {bestStats.month.label} are awarded automatically on{" "}
                {bestStats.awardDate.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</>}
        </div>

        <div className="an-grid">
          {([
            ["Best hosts", bestStats.hosts, "host"],
            ["Best workers", bestStats.workers, "worker"],
          ] as const).map(([title, data, role]) => (
            <div className="an-panel" key={title}>
              <div className="an-panel-bar">
                <div className="an-panel-title">{title}</div>
                {!loading && (
                  <span className="an-count" title={`Active in ${bestStats.month.label}`}>
                    {data.eligibleCount} of {data.candidateCount} qualify
                  </span>
                )}
              </div>
              {loading ? <div className="an-empty">Loading…</div> : data.rows.length === 0 ? (
                <div className="an-empty">
                  {data.candidateCount === 0 ? "No completed gigs this month" : "No one qualifies yet — tick “Show not eligible” to see who's close"}
                </div>
              ) : (
                <table className="an-table">
                  <colgroup>
                    <col style={{ width: 32 }} />
                    <col />
                    <col style={{ width: 56 }} />
                    <col style={{ width: 84 }} />
                    <col style={{ width: 80 }} />
                    <col style={{ width: 84 }} />
                  </colgroup>
                  <thead>
                    <tr>
                      <th className="rank">#</th>
                      <th>Name</th>
                      <th className="num">Score</th>
                      <th className="num">Rating</th>
                      <th className="num">Completed</th>
                      <th className="num">Reliability</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.rows.map((r) => (
                      <tr
                        key={r.userId}
                        className={`clickable ${r.rank == null ? "muted" : ""}`}
                        onClick={() => setBreakdown({ entry: r, role })}
                        title="See how this score was calculated"
                      >
                        <td className="rank">{r.rank ?? "—"}</td>
                        <td className="name">
                          <span className="an-name-line">
                            <Link href={`/users/${r.userId}`} title={r.name} onClick={(e) => e.stopPropagation()}>{r.name}</Link>
                            {(role === "host" ? bestStats.award?.hostIds : bestStats.award?.workerIds)?.has(r.userId) && (
                              <span title={`Awarded Best ${role} · ${bestStats.month.label}`}><Award size={13} className="an-medal" /></span>
                            )}
                          </span>
                          {r.ineligible.length > 0 && (
                            <div className="an-reasons">
                              {r.ineligible.map((k) => <span key={k}>{INELIGIBLE_LABELS[k]}</span>)}
                            </div>
                          )}
                        </td>
                        <td className="num strong">{r.score}</td>
                        <td className="num">
                          {r.avgRating == null ? "—" : `${r.avgRating.toFixed(1)}★`}
                          <span className="an-dim"> ({r.ratingCount})</span>
                        </td>
                        <td className="num">{r.completed}</td>
                        <td className="num">{r.reliability}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          ))}
        </div>

        </div>
        )}

        {/* ── Most active ── */}
        {marketView === "active" && (
        <div className="an-block">
        <div className="an-sub-head">
          <div>
            <div className="an-sub-title">Most active</div>
            <div className="an-section-sub">
              Most completed gigs, for gigs posted in the selected date range · {LEADERBOARD_MIN_RATE}%+ completion rate
            </div>
          </div>
          <div className="an-pills" role="group" aria-label="Gig type">
            {(["all", "offered", "open", "quick"] as GigTypeFilter[]).map((t) => (
              <button
                key={t}
                className={`an-pill ${gigType === t ? "active" : ""}`}
                onClick={() => setGigType(t)}
              >
                {t === "all" ? "All gigs" : t[0].toUpperCase() + t.slice(1)}
              </button>
            ))}
          </div>
        </div>

        <div className="an-grid">
          {([
            ["Top hosts", marketStats.topHosts, "Posted"],
            ["Top workers", marketStats.topWorkers, "Worked"],
          ] as const).map(([title, rows, totalLabel]) => (
            <div className="an-panel" key={title}>
              <div className="an-panel-bar">
                <div className="an-panel-title">{title}</div>
                <span className="an-count">Top {LEADERBOARD_SIZE}</span>
              </div>
              {loading ? <div className="an-empty">Loading…</div> : rows.length === 0 ? (
                <div className="an-empty">No one with completed gigs and a {LEADERBOARD_MIN_RATE}%+ rate in this period</div>
              ) : (
                <table className="an-table">
                  <colgroup>
                    <col style={{ width: 32 }} />
                    <col />
                    <col style={{ width: 84 }} />
                    <col style={{ width: 72 }} />
                    <col style={{ width: 64 }} />
                  </colgroup>
                  <thead>
                    <tr>
                      <th className="rank">#</th>
                      <th>Name</th>
                      <th className="num">Completed</th>
                      <th className="num">{totalLabel}</th>
                      <th className="num">Rate</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.userId}>
                        <td className="rank">{r.rank}</td>
                        <td className="name">
                          <Link href={`/users/${r.userId}`} title={r.name}>{r.name}</Link>
                        </td>
                        <td className="num strong">{r.completed}</td>
                        <td className="num">{r.total}</td>
                        <td className="num">{r.completionRate}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          ))}
        </div>
        </div>
        )}

        {/* ── Watch list ── */}
        {marketView === "watch" && (
        <div className="an-block">
        <div className="an-sub-head">
          <div>
            <div className="an-sub-title">Watch list</div>
            <div className="an-section-sub">Signals from the selected date range · Quick Gig declines are all-time</div>
          </div>
          <div className="an-pills" role="group" aria-label="Flag">
            {(["all", "reports", "cancels", "ratings", "declines"] as const).map((f) => (
              <button
                key={f}
                className={`an-pill ${watchFilter === f ? "active" : ""}`}
                onClick={() => setWatchFilter(f)}
              >
                {f === "all" ? `All · ${watchStats.all.length}` : `${WATCH_FLAG_LABELS[f]} · ${watchStats.counts[f]}`}
              </button>
            ))}
          </div>
        </div>

        <div className="an-legend">
          <span><b>Reported</b> {WATCH_RULES.minReporters}+ different people</span>
          <span><b>Frequent cancels</b> {WATCH_RULES.minCancellations}+ they caused, under {WATCH_RULES.maxReliability}% reliable</span>
          <span><b>Low ratings</b> under {WATCH_RULES.maxAvgRating}★ from {WATCH_RULES.minRatings}+ ratings</span>
          <span><b>Quick Gig declines</b> {WATCH_RULES.minDeclines}+ declined offers</span>
        </div>

        <div className="an-panel">
          {loading ? <div className="an-empty">Loading…</div> : watchStats.rows.length === 0 ? (
            <div className="an-empty">No one flagged in this period</div>
          ) : (
            <table className="an-table an-watch">
              <colgroup>
                <col style={{ width: "28%" }} />
                <col />
              </colgroup>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Why they&apos;re flagged</th>
                </tr>
              </thead>
              <tbody>
                {watchStats.rows.map((e) => (
                  <tr key={e.userId}>
                    <td className="name">
                      <Link href={`/users/${e.userId}`} title={e.name}>{e.name}</Link>
                      {(e.isBanned || e.isSuspended) && (
                        <div className="an-reasons"><span>{e.isBanned ? "Banned" : "Suspended"}</span></div>
                      )}
                    </td>
                    <td>
                      <div className="an-watch-flags">
                        {e.reports && (
                          <span className="an-flag reports">
                            Reported by <b>{e.reports.reporters}</b> people ({e.reports.total} reports)
                            {e.reports.topReason ? ` · mostly “${e.reports.topReason}”` : ""}
                          </span>
                        )}
                        {e.cancels?.map((c) => (
                          <span key={c.role} className="an-flag cancels">
                            As {c.role}: <b>{c.cancelled}</b> cancellations · {c.reliability}% reliable
                          </span>
                        ))}
                        {e.ratings?.map((r) => (
                          <span key={r.role} className="an-flag ratings">
                            As {r.role}: <b>{r.avg.toFixed(1)}★</b> from {r.count} ratings
                          </span>
                        ))}
                        {e.declines != null && (
                          <span className="an-flag declines">
                            <b>{e.declines}</b> Quick Gig offers declined
                          </span>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        </div>
        )}

        <Modal
          open={explainOpen}
          onClose={() => setExplainOpen(false)}
          title="How Best performers are scored"
          description="Plain-language summary of the badge ranking"
          size="lg"
        >
          <ScoreExplainer />
        </Modal>

        <Modal
          open={breakdown != null}
          onClose={() => setBreakdown(null)}
          title={breakdown ? `${breakdown.entry.name} — score ${breakdown.entry.score}` : ""}
          description={breakdown
            ? `${breakdown.entry.rank != null ? `#${breakdown.entry.rank} ` : "Not eligible · "}best ${breakdown.role} in ${bestStats.month.label}`
            : undefined}
          size="lg"
        >
          {breakdown && <ScoreBreakdownDetail entry={breakdown.entry} role={breakdown.role} />}
        </Modal>
      </section>
      )}

      {/* ── Heatmap — mounted on first visit, then only hidden, so it keeps its pan/zoom ── */}
      {visitedTabs.has("heatmap") && (
      <section className="an-section" hidden={tab !== "heatmap"}>
        <div className="an-section-head">
          <div>
            <div className="an-section-title">Heatmap</div>
            <div className="an-section-sub">Where gigs posted in this period are located</div>
          </div>
        </div>

        <div className="an-panel an-map-panel" ref={mapPanelRef}>
          <div className="an-panel-head">
            <div>
              <div className="an-panel-title">Where gigs are posted</div>
              <div className="an-panel-sub">
                {mapStats.points.length.toLocaleString()} of {mapStats.totalInPeriod.toLocaleString()} gigs have a location — shapes are colored by gig type, larger and brighter means more gigs
              </div>
            </div>
            <div className="an-chips" role="group" aria-label="Gig types on map">
              {MAP_TYPES.map(({ key, label, color }) => (
                <button
                  key={key}
                  className={`an-chip ${mapTypes.includes(key) ? "active" : ""}`}
                  aria-pressed={mapTypes.includes(key)}
                  onClick={() => toggleMapType(key)}
                >
                  <span className="an-chip-dot" style={{ background: color }} />
                  {label}
                  <span className="an-chip-count">{loading ? "…" : mapStats.counts[key]}</span>
                </button>
              ))}
              <button
                className={`an-chip ${mapLabels ? "active" : ""}`}
                aria-pressed={mapLabels}
                onClick={() => setMapLabels((v) => !v)}
                title={mapLabels ? "Hide place names" : "Show place names"}
              >
                Labels
              </button>
              <button
                className="an-chip"
                onClick={toggleMapFullscreen}
                aria-label={mapFullscreen ? "Exit full screen" : "Full screen"}
                title={mapFullscreen ? "Exit full screen" : "Full screen"}
              >
                {mapFullscreen ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
              </button>
            </div>
          </div>
          <div className="an-map">
            {/* Keep the map mounted across filter changes and refreshes so it holds its pan/zoom */}
            {loading && gigs.length === 0 ? <div className="an-empty">Loading…</div> : (
              <>
                <GigHeatmap points={mapStats.points} theme={theme === "light" ? "light" : "dark"} showLabels={mapLabels} />
                {mapStats.points.length === 0 && (
                  <div className="an-map-note">
                    {mapTypes.length === 0 ? "Select at least one gig type" : "No gig locations for this period"}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </section>
      )}
    </AdminLayout>
  );
}
