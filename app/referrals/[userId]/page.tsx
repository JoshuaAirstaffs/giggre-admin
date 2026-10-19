"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { collection, collectionGroup, doc, getDoc, getDocs, query, where, Timestamp } from "firebase/firestore";
import {
  ArrowLeft, BadgeCheck, Check, ChevronRight, ExternalLink, GitBranch, RefreshCw, User, X,
} from "lucide-react";
import AdminLayout from "@/components/layout/AdminLayout";
import Button from "@/components/ui/Button";
import { useAuthGuard } from "@/hooks/useAuthGuard";
import { useCurrency } from "@/context/CurrencyContext";
import { useRateClock } from "@/hooks/useRateClock";
import {
  LEVEL_LABELS, loadReferralSettings, levelEarnings, totalEarnings, promoState, formatInstant,
  type ReferralSettings,
} from "@/lib/referralRewards";
import { db } from "@/lib/firebase";

// ─── Types ────────────────────────────────────────────────────────────────────

/** One `users/{referrerId}/referrals_list/{uid}` doc — a single "invited" link. */
interface Member {
  uid: string;
  referrerId: string;
  name: string;
  isVerified: boolean;
  joinedMs: number | null;
  gigs: GigTally;
}

/** Completed gigs as a worker and as a host */
interface GigTally {
  worker: number;
  host: number;
}

const GIG_COLLECTIONS = ["quick_gigs", "open_gigs", "offered_gigs"];

/** ✓ when the person has finished at least one gig, either side; ✗ otherwise. */
function GigCompleted({ gigs }: { gigs: GigTally }) {
  const done = gigs.worker + gigs.host > 0;
  const detail = done
    ? [gigs.worker && `${gigs.worker} as worker`, gigs.host && `${gigs.host} as host`].filter(Boolean).join(" · ")
    : "No completed gigs yet";
  return (
    <span className={`rt-gig ${done ? "yes" : "no"}`} title={`Gig completed: ${done ? "yes" : "no"} — ${detail}`}>
      {done ? <Check size={12} strokeWidth={3} /> : <X size={12} strokeWidth={3} />}
    </span>
  );
}

/** A person in the tree with everyone they invited, directly or further down. */
interface TreeNode extends Member {
  children: TreeNode[];
  /** Everyone below this person in the tree */
  descendants: number;
  verifiedDescendants: number;
}

// Deep chains are rare; this keeps a bad data loop from running away
const MAX_DEPTH = 10;
/** Branches open by default down to this level */
const AUTO_OPEN_DEPTH = 2;

/** Index 0 = invited directly. Rates and limits come from Referral settings. */
const levelName = (i: number) => LEVEL_LABELS[i] ?? `Level ${i + 1}`;

const fmtDate = (ms: number | null) =>
  ms ? new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : null;

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ReferralTreePage() {
  useAuthGuard({ module: "referrals" });
  const router = useRouter();
  const { userId } = useParams<{ userId: string }>();

  const [rootName, setRootName] = useState<string>("");
  const [rootCode, setRootCode] = useState<string | null>(null);
  const [rootVerified, setRootVerified] = useState(false);
  const [rootGigs, setRootGigs] = useState<GigTally>({ worker: 0, host: 0 });
  /** null = not loaded / never saved; see rewardsStatus */
  const [settings, setSettings] = useState<ReferralSettings | null>(null);
  const rewards = settings?.levels ?? null;
  const [rewardsStatus, setRewardsStatus] = useState<"ok" | "missing" | "error">("ok");
  const [byReferrer, setByReferrer] = useState<Map<string, Member[]>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  /** Branches the admin toggled away from their default open/closed state */
  const [toggled, setToggled] = useState<Set<string>>(new Set());

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      // Every referral link in one query, then build the tree in memory. The
      // users read is for verification status: the copy on each referrals_list
      // doc is only kept in sync by a Cloud Function and can be stale.
      // Rates load on their own so a settings problem doesn't hide the tree
      loadReferralSettings()
        .then((r) => { setSettings(r); setRewardsStatus(r ? "ok" : "missing"); })
        .catch((err) => {
          console.error("[ReferralTree] referral settings load failed:", err);
          setSettings(null);
          setRewardsStatus("error");
        });

      const [rootSnap, edgeSnap, userSnap, ...completedSnaps] = await Promise.all([
        getDoc(doc(db, "users", userId)),
        getDocs(collectionGroup(db, "referrals_list")),
        getDocs(collection(db, "users")),
        ...GIG_COLLECTIONS.map((c) => getDocs(query(collection(db, c), where("status", "==", "completed")))),
      ]);
      const profiles = new Map(userSnap.docs.map((d) => [d.id, d.data()]));

      // Completed gigs per person. Workers: the app's own counter on the user
      // doc (earnings.completedGigs), or the completed gigs naming them as the
      // worker if that's higher. Hosts have no counter, so tally hostId.
      const hostDone = new Map<string, number>();
      const workerDone = new Map<string, number>();
      for (const snap of completedSnaps) {
        for (const g of snap.docs) {
          const data = g.data();
          const hostId = data.hostId;
          const workerId = data.workerId ?? data.assignedWorkerId;
          if (typeof hostId === "string") hostDone.set(hostId, (hostDone.get(hostId) ?? 0) + 1);
          if (typeof workerId === "string") workerDone.set(workerId, (workerDone.get(workerId) ?? 0) + 1);
        }
      }
      const gigsOf = (uid: string): GigTally => {
        const earnings = profiles.get(uid)?.earnings;
        const counter = typeof earnings?.completedGigs === "number" ? earnings.completedGigs : 0;
        return { worker: Math.max(counter, workerDone.get(uid) ?? 0), host: hostDone.get(uid) ?? 0 };
      };
      setRootGigs(gigsOf(userId));

      const root = rootSnap.data() ?? {};
      setRootName(typeof root.name === "string" && root.name ? root.name : userId.slice(0, 10));
      setRootVerified(root.isVerified === "verified");
      const refMap = root.referrals && typeof root.referrals === "object" ? root.referrals : {};
      setRootCode(typeof refMap.referral_code === "string" ? refMap.referral_code : null);

      const map = new Map<string, Member[]>();
      for (const d of edgeSnap.docs) {
        const referrerId = d.ref.parent.parent?.id;
        if (!referrerId) continue;
        const data = d.data();
        const profile = profiles.get(d.id);
        const name = profile?.name || data.name;
        map.set(referrerId, [...(map.get(referrerId) ?? []), {
          uid: d.id,
          referrerId,
          name: typeof name === "string" && name ? name : d.id.slice(0, 10),
          isVerified: (profile ? profile.isVerified : data.isVerified) === "verified",
          joinedMs: data.joined_at instanceof Timestamp ? data.joined_at.toMillis() : null,
          gigs: gigsOf(d.id),
        }]);
      }
      setByReferrer(map);
      setToggled(new Set());
    } catch (err) {
      console.error("[ReferralTree] load failed:", err);
      setError("Failed to load the referral tree. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (userId) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  // Build the tree under the user; `seen` guards against loops in bad data
  const { tree, levelCounts, levelQualified } = useMemo(() => {
    const seen = new Set<string>([userId]);
    const counts: number[] = [];
    const qualified: number[] = [];
    const build = (id: string, depth: number): TreeNode[] => {
      if (depth > MAX_DEPTH) return [];
      return (byReferrer.get(id) ?? [])
        .filter((m) => !seen.has(m.uid) && seen.add(m.uid))
        .sort((a, b) => (a.joinedMs ?? 0) - (b.joinedMs ?? 0))
        .map((m) => {
          counts[depth - 1] = (counts[depth - 1] ?? 0) + 1;
          qualified[depth - 1] = (qualified[depth - 1] ?? 0) + (m.gigs.worker + m.gigs.host > 0 ? 1 : 0);
          const children = build(m.uid, depth + 1);
          return {
            ...m,
            children,
            descendants: children.reduce((s, c) => s + 1 + c.descendants, 0),
            verifiedDescendants: children.reduce((s, c) => s + (c.isVerified ? 1 : 0) + c.verifiedDescendants, 0),
          };
        });
    };
    const tree = build(userId, 1);
    return { tree, levelCounts: counts, levelQualified: counts.map((_, i) => qualified[i] ?? 0) };
  }, [byReferrer, userId]);

  const { symbol } = useCurrency();
  const money = (n: number) => `${symbol}${n.toLocaleString()}`;

  // Earnings: one row per rewarded level, plus a note for deeper levels
  // Re-renders the moment a time-limited rate starts or expires
  const now = useRateClock(rewards);
  const earnings = (rewards ?? []).map((level, i) => {
    const people = levelCounts[i] ?? 0;
    const qualified = levelQualified[i] ?? 0;
    return {
      name: levelName(i), people, qualified, level,
      promoActive: promoState(level, now) === "active",
      ...levelEarnings(level, qualified, now),
    };
  });
  // Per-level limits first, then the overall limit on their sum
  const totalCap = totalEarnings(earnings.reduce((s, e) => s + e.earned, 0), settings?.totalMaxEarn ?? 0);
  const totalEarned = totalCap.earned;
  const explicitTotalMax = settings?.totalMaxEarn ?? 0;
  // With no total limit set, the per-level maximums still bound the total when
  // every level has one — show that as the effective total limit.
  const levelMaxSum = rewards && rewards.every((l) => l.maxEarn > 0)
    ? rewards.reduce((s, l) => s + l.maxEarn, 0)
    : 0;
  const totalMax = explicitTotalMax > 0
    ? (levelMaxSum > 0 ? Math.min(explicitTotalMax, levelMaxSum) : explicitTotalMax)
    : levelMaxSum;
  const totalMaxSource = explicitTotalMax > 0 && (levelMaxSum === 0 || explicitTotalMax <= levelMaxSum)
    ? "total limit"
    : "sum of the level limits";
  const rewardedLevels = rewards?.length ?? 0;
  const deeperPeople = rewards ? levelCounts.slice(rewardedLevels).reduce((s, c) => s + c, 0) : 0;

  const total = tree.reduce((s, n) => s + 1 + n.descendants, 0);
  const totalVerified = tree.reduce((s, n) => s + (n.isVerified ? 1 : 0) + n.verifiedDescendants, 0);

  const isOpen = (n: TreeNode, depth: number) => (depth < AUTO_OPEN_DEPTH) !== toggled.has(n.uid);
  const toggle = (uid: string) =>
    setToggled((prev) => {
      const next = new Set(prev);
      if (next.has(uid)) next.delete(uid); else next.add(uid);
      return next;
    });
  const setAll = (open: boolean) => {
    // Express "everything open/closed" as toggles relative to each default
    const next = new Set<string>();
    const walk = (nodes: TreeNode[], depth: number) => nodes.forEach((n) => {
      if (n.children.length && (depth < AUTO_OPEN_DEPTH) !== open) next.add(n.uid);
      walk(n.children, depth + 1);
    });
    walk(tree, 1);
    setToggled(next);
  };

  const renderNodes = (nodes: TreeNode[], depth: number) => (
    <ul className="rt-children">
      {nodes.map((n) => {
        const open = isOpen(n, depth);
        return (
          <li key={n.uid} className="rt-item">
            <div className="rt-node">
              {n.children.length > 0 ? (
                <button className="rt-toggle" onClick={() => toggle(n.uid)} aria-label={open ? "Collapse" : "Expand"}>
                  <ChevronRight size={13} className={`rt-chevron ${open ? "open" : ""}`} />
                </button>
              ) : (
                <span className="rt-toggle rt-leaf" />
              )}
              <span className={`rt-avatar ${n.isVerified ? "verified" : ""}`}>
                {n.isVerified ? <BadgeCheck size={13} /> : <User size={13} />}
              </span>
              <Link href={`/users/${n.uid}`} className="rt-name" title={`Open ${n.name}'s profile`}>
                {n.name}
              </Link>
              {fmtDate(n.joinedMs) && <span className="rt-date">joined {fmtDate(n.joinedMs)}</span>}
              <span
                className={`rt-level l${Math.min(depth, 4)}`}
                title={`Level ${depth} — ${depth === 1 ? `invited directly by ${rootName}` : `${depth - 1} step${depth > 2 ? "s" : ""} removed from ${rootName}`}`}
              >
                L{depth}
              </span>
              <GigCompleted gigs={n.gigs} />
              {n.children.length > 0 && (
                <Link href={`/referrals/${n.uid}`} className="rt-focus" title={`Show ${n.name}'s tree on its own`}>
                  <GitBranch size={11} /> Focus
                </Link>
              )}
            </div>
            {/* Always rendered so it can animate both ways; the grid row
                animates between 0fr and 1fr, i.e. to the content's real height */}
            {n.children.length > 0 && (
              <div className={`rt-collapse ${open ? "open" : ""}`} aria-hidden={!open}>
                <div className="rt-collapse-inner">{renderNodes(n.children, depth + 1)}</div>
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );

  return (
    <AdminLayout
      title="Referral tree"
      subtitle={rootName ? `Who joined through ${rootName}, and who they invited` : undefined}
      actions={
        <>
          <Button variant="ghost" size="sm" icon={ArrowLeft} onClick={() => router.push("/referrals")}>
            Referrals
          </Button>
          <Button variant="ghost" size="sm" icon={RefreshCw} onClick={load} disabled={loading}>
            Refresh
          </Button>
        </>
      }
    >
      <style>{`
        .rt-summary { display: flex; flex-wrap: wrap; gap: 10px; margin-bottom: 18px; }
        .rt-stat {
          padding: 10px 14px; border-radius: var(--radius-md);
          background: var(--bg-surface); border: 1px solid var(--border);
          font-size: 12px; color: var(--text-muted); min-width: 120px;
        }
        .rt-stat b { display: block; font-size: 20px; color: var(--text-primary); font-family: 'Space Mono', monospace; }
        .rt-panel {
          background: var(--bg-surface); border: 1px solid var(--border);
          border-radius: var(--radius-lg); padding: 18px 20px;
        }
        .rt-toolbar { display: flex; justify-content: space-between; align-items: center; gap: 10px; flex-wrap: wrap; margin-bottom: 12px; }
        .rt-levels { font-size: 12px; color: var(--text-muted); }
        .rt-levels b { color: var(--text-primary); }
        .rt-actions { display: flex; gap: 6px; }
        .rt-btn {
          padding: 4px 10px; font-size: 11px; font-weight: 600; border-radius: 999px; cursor: pointer;
          font-family: inherit; color: var(--text-secondary); background: var(--bg-elevated); border: 1px solid var(--border);
        }
        .rt-btn:hover { color: var(--text-primary); }

        .rt-root { display: flex; align-items: center; gap: 8px; padding: 8px 10px; border-radius: var(--radius-sm);
          background: var(--blue-dim); border: 1px solid var(--blue); width: fit-content; }
        .rt-root .rt-name { font-size: 14px; }
        .rt-code { font-family: 'Space Mono', monospace; font-size: 11px; color: var(--text-muted); }

        /* Connector lines: each list hangs off a vertical line, each item off a short horizontal one */
        .rt-children { list-style: none; margin: 0 0 0 18px; padding: 0 0 0 14px; border-left: 1px solid var(--border); }
        .rt-item { position: relative; padding-top: 6px; }
        .rt-item::before {
          content: ""; position: absolute; left: -14px; top: 21px; width: 12px; border-top: 1px solid var(--border);
        }
        .rt-item:last-child::after {
          /* hide the vertical line below the last child */
          content: ""; position: absolute; left: -15px; top: 22px; bottom: 0; width: 2px; background: var(--bg-surface);
        }
        .rt-node { display: flex; align-items: center; gap: 7px; flex-wrap: wrap; min-height: 30px; }
        .rt-toggle {
          width: 20px; height: 20px; display: inline-flex; align-items: center; justify-content: center;
          border-radius: 5px; border: 1px solid var(--border); background: var(--bg-elevated);
          color: var(--text-secondary); cursor: pointer; padding: 0; flex-shrink: 0;
        }
        .rt-leaf { border-color: transparent; background: none; cursor: default; }
        .rt-level {
          font-size: 9px; font-weight: 700; padding: 0 5px; border-radius: 999px;
          line-height: 15px; border: 1px solid;
        }
        .rt-level.l1 { color: var(--blue); background: var(--blue-dim); border-color: var(--blue); }
        .rt-level.l2 { color: var(--purple); background: var(--purple-dim); border-color: var(--purple); }
        .rt-level.l3 { color: var(--orange); background: var(--orange-dim); border-color: var(--orange); }
        .rt-level.l4 { color: var(--text-muted); background: var(--bg-elevated); border-color: var(--border); }
        .rt-chevron { transition: transform 0.25s ease; }
        .rt-chevron.open { transform: rotate(90deg); }
        .rt-collapse {
          display: grid; grid-template-rows: 0fr; opacity: 0;
          transition: grid-template-rows 0.3s ease, opacity 0.25s ease;
        }
        .rt-collapse.open { grid-template-rows: 1fr; opacity: 1; }
        .rt-collapse-inner { overflow: hidden; min-height: 0; }
        .rt-collapse:not(.open) .rt-collapse-inner { visibility: hidden; transition: visibility 0s 0.3s; }
        .rt-collapse > .rt-collapse-inner > .rt-children { transform: translateY(-4px); transition: transform 0.3s ease; }
        .rt-collapse.open > .rt-collapse-inner > .rt-children { transform: none; }
        @media (prefers-reduced-motion: reduce) {
          .rt-chevron, .rt-collapse, .rt-collapse > .rt-collapse-inner > .rt-children { transition: none; }
        }
        .rt-avatar {
          width: 22px; height: 22px; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center;
          background: var(--bg-elevated); color: var(--text-muted); flex-shrink: 0;
        }
        .rt-avatar.verified { background: var(--blue-dim); color: var(--blue); }
        .rt-name { font-size: 13px; font-weight: 600; color: var(--text-primary); text-decoration: none; }
        .rt-name:hover { color: var(--blue); text-decoration: underline; }
        .rt-date { font-size: 11px; color: var(--text-muted); }
        .rt-gig {
          width: 20px; height: 20px; border-radius: 50%; flex-shrink: 0;
          display: inline-flex; align-items: center; justify-content: center;
        }
        .rt-gig.yes { background: var(--green-dim); color: var(--green); }
        .rt-gig.no { background: var(--red-dim); color: var(--red); }
        .rt-focus { display: inline-flex; align-items: center; gap: 3px; font-size: 11px; color: var(--blue); text-decoration: none; opacity: 0; transition: opacity 0.15s; }
        .rt-node:hover .rt-focus { opacity: 1; }
        .rt-earn-head { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; flex-wrap: wrap; margin-bottom: 10px; }
        .rt-earn-title { font-size: 14px; font-weight: 700; color: var(--text-primary); }
        .rt-earn-sub { font-size: 11px; color: var(--text-muted); }
        .rt-earn { width: 100%; border-collapse: collapse; font-size: 13px; }
        .rt-earn th {
          text-align: left; font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.4px;
          color: var(--text-muted); padding: 0 10px 8px; border-bottom: 1px solid var(--border);
        }
        .rt-earn td { padding: 8px 10px; color: var(--text-secondary); border-bottom: 1px solid var(--border-muted); }
        .rt-earn td:first-child { color: var(--text-primary); font-weight: 500; }
        .rt-earn .num { text-align: right; font-family: 'Space Mono', monospace; }
        .rt-earn .earned { color: var(--green); font-weight: 700; }
        .rt-earn tfoot td { border-bottom: none; border-top: 1px solid var(--border); font-weight: 700; color: var(--text-primary); }
        .rt-tag {
          margin-left: 6px; font-size: 9px; font-weight: 700; padding: 0 5px; border-radius: 999px;
          text-transform: uppercase; vertical-align: 1px; font-family: inherit;
        }
        .rt-tag.promo { color: var(--blue); background: var(--blue-dim); }
        .rt-earn .limit { width: 190px; }
        .rt-limit { display: flex; flex-direction: column; gap: 4px; }
        .rt-limit-top { display: flex; justify-content: space-between; align-items: baseline; gap: 6px; }
        .rt-limit-status { font-size: 11px; font-weight: 700; padding: 1px 7px; border-radius: 999px; white-space: nowrap; }
        .rt-limit-status.reached { color: var(--orange); background: var(--orange-dim); }
        .rt-limit-status.open { color: var(--green); background: var(--green-dim); }
        .rt-limit-max { font-size: 11px; color: var(--text-muted); font-family: 'Space Mono', monospace; white-space: nowrap; }
        .rt-limit-bar { height: 4px; background: var(--bg-hover); border-radius: 2px; overflow: hidden; }
        .rt-limit-bar > div { height: 100%; border-radius: 2px; transition: width 0.3s ease; }
        .rt-limit-none { font-size: 11px; color: var(--text-muted); }
        .rt-earn-missing { font-size: 13px; color: var(--text-muted); padding: 10px 0 4px; }
        .rt-earn-note { margin-top: 10px; font-size: 11px; color: var(--text-muted); }
        .rt-empty { padding: 30px; text-align: center; color: var(--text-muted); font-size: 13px; }
        .rt-legend { margin-top: 14px; font-size: 11px; color: var(--text-muted); display: flex; gap: 14px; flex-wrap: wrap; align-items: center; }
      `}</style>

      {error && <div className="rt-empty" style={{ color: "var(--red)" }}>{error}</div>}

      {loading ? (
        <div className="rt-empty">Loading referral tree…</div>
      ) : (
        <>
          <div className="rt-summary">
            <div className="rt-stat"><b>{tree.length}</b>invited directly</div>
            <div className="rt-stat"><b>{total}</b>joined through this user</div>
            <div className="rt-stat"><b>{totalVerified}</b>verified</div>
            <div className="rt-stat" style={{ borderColor: "var(--green)" }}>
              <b style={{ color: "var(--green)" }}>{rewards ? money(totalEarned) : "—"}</b>referral earnings
            </div>
            {rootCode && <div className="rt-stat"><b style={{ fontSize: 15 }}>{rootCode}</b>referral code</div>}
          </div>

          <div className="rt-panel" style={{ marginBottom: 18 }}>
            <div className="rt-earn-head">
              <span className="rt-earn-title">Referral earnings</span>
              <span className="rt-earn-sub">
                Rates in effect today, per person with a completed gig ·{" "}
                <Link href="/referrals/referral-settings" style={{ color: "var(--blue)" }}>Edit rates</Link>
              </span>
            </div>
            {!rewards ? (
              <div className="rt-earn-missing">
                {rewardsStatus === "error"
                  ? "Couldn't load the referral rates, so earnings can't be calculated. Try Refresh."
                  : rewardsStatus === "missing"
                  ? "Referral rates haven't been set up yet."
                  : "Loading referral rates…"}
                {rewardsStatus !== "ok" && (
                  <> <Link href="/referrals/referral-settings" style={{ color: "var(--blue)" }}>Open Referral settings</Link></>
                )}
              </div>
            ) : (
            <>
            <table className="rt-earn">
              <thead>
                <tr>
                  <th>Level</th>
                  <th className="num">Rate</th>
                  <th className="num">People</th>
                  <th className="num">Earned</th>
                  <th className="limit">Limit</th>
                </tr>
              </thead>
              <tbody>
                {earnings.map((e) => (
                  <tr key={e.name}>
                    <td>{e.name}</td>
                    <td
                      className="num"
                      title={e.promoActive
                        ? `Time-limited rate until ${formatInstant(e.level.promoUntil)} (default ${money(e.level.defaultRate)})`
                        : "Default rate"}
                    >
                      {money(e.rate)}
                      {e.promoActive && <span className="rt-tag promo">promo</span>}
                    </td>
                    <td className="num">{e.people}</td>
                    <td
                      className="num earned"
                      title={`${e.qualified} with a completed gig × ${money(e.rate)} = ${money(e.uncapped)}`
                        + (e.capped ? ` — capped at the ${money(e.level.maxEarn)} limit` : "")}
                    >
                      {money(e.earned)}
                    </td>
                    <td className="limit">
                      {e.level.maxEarn > 0 ? (() => {
                        const reached = e.uncapped >= e.level.maxEarn;
                        const pct = Math.min(100, (e.earned / e.level.maxEarn) * 100);
                        return (
                          <div
                            className="rt-limit"
                            title={reached
                              ? `Limit reached — ${money(e.uncapped)} would have been earned without the ${money(e.level.maxEarn)} limit`
                              : `${money(e.earned)} of ${money(e.level.maxEarn)} earned — ${money(e.level.maxEarn - e.earned)} left`}
                          >
                            <div className="rt-limit-top">
                              <span className={`rt-limit-status ${reached ? "reached" : "open"}`}>
                                {reached ? "Limit reached" : `${money(e.level.maxEarn - e.earned)} left`}
                              </span>
                              <span className="rt-limit-max">of {money(e.level.maxEarn)}</span>
                            </div>
                            <div className="rt-limit-bar">
                              <div style={{ width: `${pct}%`, background: reached ? "var(--orange)" : "var(--green)" }} />
                            </div>
                          </div>
                        );
                      })() : (
                        <span className="rt-limit-none">No limit</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={3}>Total</td>
                  <td
                    className="num earned"
                    title={totalCap.capped ? `Levels add up to ${money(totalCap.uncapped)} — capped at the ${money(explicitTotalMax)} total limit` : undefined}
                  >
                    {money(totalEarned)}
                  </td>
                  <td className="limit">
                    {totalMax > 0 ? (() => {
                      // Earned can't pass the per-level limits either, so compare what was earned
                      const reached = totalEarned >= totalMax;
                      return (
                        <div
                          className="rt-limit"
                          title={(reached
                            ? `Total limit reached — ${money(totalMax)}`
                            : `${money(totalEarned)} of ${money(totalMax)} — ${money(totalMax - totalEarned)} left`)
                            + ` (${totalMaxSource})`}
                        >
                          <div className="rt-limit-top">
                            <span className={`rt-limit-status ${reached ? "reached" : "open"}`}>
                              {reached ? "Total limit reached" : `${money(totalMax - totalEarned)} left`}
                            </span>
                            <span className="rt-limit-max" title={totalMaxSource}>
                              of {money(totalMax)}
                            </span>
                          </div>
                          <div className="rt-limit-bar">
                            <div style={{
                              width: `${Math.min(100, (totalEarned / totalMax) * 100)}%`,
                              background: reached ? "var(--orange)" : "var(--green)",
                            }} />
                          </div>
                        </div>
                      );
                    })() : (
                      <span className="rt-limit-none">No total limit</span>
                    )}
                  </td>
                </tr>
              </tfoot>
            </table>
            <div className="rt-earn-note">
              <b>Earned</b> counts only people who have completed at least 1 gig (✓).
              {earnings.some((e) => e.capped) && " Levels that hit their limit stop earning more."}
              {totalCap.capped && ` The total is capped at the ${money(explicitTotalMax)} total limit.`}
              {totalMax > 0 && totalMaxSource === "sum of the level limits" &&
                ` Total limit ${money(totalMax)} = sum of the level limits (no separate total limit is set).`}
              {deeperPeople > 0 && ` ${deeperPeople} ${deeperPeople === 1 ? "person" : "people"} deeper than ${levelName(rewardedLevels - 1)} earn nothing.`}
            </div>
            </>
            )}
          </div>

          <div className="rt-panel">
            {tree.length > 0 && (
              <div className="rt-toolbar">
                <span className="rt-levels">
                  {levelCounts.map((c, i) => (
                    <span key={i}>{i > 0 && " · "}{levelName(i)}: <b>{c}</b></span>
                  ))}
                </span>
                <span className="rt-actions">
                  <button className="rt-btn" onClick={() => setAll(true)}>Expand all</button>
                  <button className="rt-btn" onClick={() => setAll(false)}>Collapse all</button>
                </span>
              </div>
            )}

            <div className="rt-root">
              <span className={`rt-avatar ${rootVerified ? "verified" : ""}`}>
                {rootVerified ? <BadgeCheck size={13} /> : <User size={13} />}
              </span>
              <Link href={`/users/${userId}`} className="rt-name">{rootName}</Link>
              {rootCode && <span className="rt-code">{rootCode}</span>}
              <GigCompleted gigs={rootGigs} />
            </div>

            {tree.length === 0
              ? <div className="rt-empty">{rootName} hasn&apos;t invited anyone yet.</div>
              : renderNodes(tree, 1)}

            {tree.length > 0 && (
              <div className="rt-legend">
                <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                  <BadgeCheck size={12} style={{ color: "var(--blue)" }} /> verified
                </span>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                  <GigCompleted gigs={{ worker: 1, host: 0 }} /> completed at least 1 gig
                  <GigCompleted gigs={{ worker: 0, host: 0 }} /> none yet
                </span>
                <span>Click a name to open their profile</span>
                <span>Hover a row and click <b>Focus</b> to see that person&apos;s tree on its own</span>
                <Link href={`/users/${userId}`} style={{ color: "var(--blue)", display: "inline-flex", alignItems: "center", gap: 3 }}>
                  Open {rootName}&apos;s profile <ExternalLink size={11} />
                </Link>
              </div>
            )}
          </div>
        </>
      )}
    </AdminLayout>
  );
}
