"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import AdminLayout from "@/components/layout/AdminLayout";
import Badge from "@/components/ui/Badge";
import { useAuthGuard } from "@/hooks/useAuthGuard";
import {
  collection,
  onSnapshot,
  getDocs,
  query,
  orderBy,
  limit,
  Timestamp,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import {
  Users,
  Briefcase,
  Map,
  Shield,
  Activity,
  BarChart2,
  Settings,
  File,
  RefreshCw,
  Zap,
  CheckCircle2,
  Clock,
} from "lucide-react";
import { getModuleConfig } from "@/lib/activityLogConfig";

// ─── Types ────────────────────────────────────────────────────────────────────

interface GigCounts {
  offered: { total: number; available: number };
  open: { total: number; available: number };
  quick: { total: number; available: number };
  pendingApplications: number;
}

type GigType = "offered" | "open" | "quick";

interface RecentGig {
  id: string;
  gigType: GigType;
  title: string;
  status: string;
  category?: string;
  salary?: string | number;
  postedBy?: string;
  createdAt: Date | null;
}

interface LogEntry {
  id: string;
  actorName: string;
  module?: string;
  description: string;
  createdAt: Date | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function timeAgo(d: Date | null): string {
  if (!d) return "—";
  const diff = Date.now() - d.getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function isAvailable(status: string): boolean {
  return status?.toLowerCase() === "available";
}

// ─── Stat Card ────────────────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  sub,
  icon,
  accent,
}: {
  label: string;
  value: number | string;
  sub?: string;
  icon: React.ReactNode;
  accent: string;
}) {
  return (
    <div
      style={{
        background: "var(--bg-surface)",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius-lg)",
        padding: "18px 20px",
        display: "flex",
        flexDirection: "column",
        gap: 10,
        flex: 1,
        minWidth: 160,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.6px", textTransform: "uppercase", color: "var(--text-muted)" }}>
          {label}
        </span>
        <span
          style={{
            width: 32,
            height: 32,
            borderRadius: 8,
            background: accent + "22",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: accent,
          }}
        >
          {icon}
        </span>
      </div>
      <div>
        <div style={{ fontSize: 28, fontWeight: 700, color: "var(--text-primary)", lineHeight: 1 }}>
          {value}
        </div>
        {sub && (
          <div style={{ fontSize: 11.5, color: "var(--text-muted)", marginTop: 4 }}>
            {sub}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Quick Link Card ──────────────────────────────────────────────────────────

function QuickLink({
  href,
  icon,
  label,
  accent,
}: {
  href: string;
  icon: React.ReactNode;
  label: string;
  accent: string;
}) {
  return (
    <Link
      href={href}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "10px 14px",
        background: "var(--bg-elevated)",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius-sm)",
        textDecoration: "none",
        color: "var(--text-secondary)",
        fontSize: 13,
        fontWeight: 500,
        transition: "all 0.15s",
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLAnchorElement).style.borderColor = accent;
        (e.currentTarget as HTMLAnchorElement).style.color = accent;
        (e.currentTarget as HTMLAnchorElement).style.background = accent + "11";
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLAnchorElement).style.borderColor = "var(--border)";
        (e.currentTarget as HTMLAnchorElement).style.color = "var(--text-secondary)";
        (e.currentTarget as HTMLAnchorElement).style.background = "var(--bg-elevated)";
      }}
    >
      <span style={{ color: accent, display: "flex", alignItems: "center" }}>{icon}</span>
      {label}
    </Link>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function DashboardPage() {
  useAuthGuard();

  const [totalUsers, setTotalUsers] = useState(0);
  const [onlineUsers, setOnlineUsers] = useState(0);
  const [gigCounts, setGigCounts] = useState<GigCounts>({
    offered: { total: 0, available: 0 },
    open:    { total: 0, available: 0 },
    quick:   { total: 0, available: 0 },
    pendingApplications: 0,
  });
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [recentGigs, setRecentGigs] = useState<RecentGig[]>([]);
  const [gigsLoading, setGigsLoading] = useState(true);
  const [logsLoading, setLogsLoading] = useState(true);

  // ── Live user counts ───────────────────────────────────────────────────────
  useEffect(() => {
    const unsub = onSnapshot(collection(db, "users"), (snap) => {
      setTotalUsers(snap.size);
      setOnlineUsers(snap.docs.filter((d) => d.data().isOnline === true).length);
    });
    return () => unsub();
  }, []);

  // ── Gig stats ──────────────────────────────────────────────────────────────
  const fetchGigs = useCallback(async () => {
    setGigsLoading(true);
    try {
      const [offeredSnap, openSnap, quickSnap] = await Promise.all([
        getDocs(collection(db, "offered_gigs")),
        getDocs(collection(db, "open_gigs")),
        getDocs(collection(db, "quick_gigs")),
      ]);

      let pending = 0;

      function countGig(snap: typeof offeredSnap) {
        let total = 0, available = 0;
        snap.docs.forEach((d) => {
          const data = d.data();
          total++;
          if (isAvailable(data.status)) available++;
          const apps: { status?: string }[] = Array.isArray(data.applications) ? data.applications : [];
          pending += apps.filter((a) => a.status === "pending").length;
        });
        return { total, available };
      }

      setGigCounts({
        offered: countGig(offeredSnap),
        open:    countGig(openSnap),
        quick:   countGig(quickSnap),
        pendingApplications: pending,
      });

      // Collect recent gigs across all types
      function toRecentGig(gigType: GigType, snap: typeof offeredSnap): RecentGig[] {
        return snap.docs.map((d) => {
          const data = d.data();
          const ts: unknown = data.createdAt;
          return {
            id: d.id,
            gigType,
            title: data.title ?? "Untitled",
            status: data.status ?? "",
            category: data.category,
            salary: data.salary,
            postedBy: data.postedBy,
            createdAt: ts instanceof Timestamp ? ts.toDate() : null,
          };
        });
      }

      const allRecent = [
        ...toRecentGig("offered", offeredSnap),
        ...toRecentGig("open", openSnap),
        ...toRecentGig("quick", quickSnap),
      ]
        .sort((a, b) => (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0))
        .slice(0, 8);

      setRecentGigs(allRecent);
    } finally {
      setGigsLoading(false);
    }
  }, []);

  // ── Recent activity logs ───────────────────────────────────────────────────
  const fetchLogs = useCallback(async () => {
    setLogsLoading(true);
    try {
      const snap = await getDocs(
        query(collection(db, "activityLogs"), orderBy("createdAt", "desc"), limit(8))
      );
      setLogs(
        snap.docs.map((d) => {
          const data = d.data();
          const ts: unknown = data.createdAt;
          return {
            id: d.id,
            actorName: data.actorName ?? "Unknown",
            module: data.module,
            description: data.description ?? "",
            createdAt: ts instanceof Timestamp ? ts.toDate() : null,
          };
        })
      );
    } finally {
      setLogsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchGigs();
    fetchLogs();
  }, [fetchGigs, fetchLogs]);

  const totalGigs =
    gigCounts.offered.total + gigCounts.open.total + gigCounts.quick.total;
  const availableGigs =
    gigCounts.offered.available + gigCounts.open.available + gigCounts.quick.available;

  return (
    <AdminLayout
      title="Dashboard"
      subtitle="Platform overview at a glance"
    >
      <style>{`
        .db-wrap { display: flex; flex-direction: column; gap: 20px; }
        .db-stats { display: flex; gap: 14px; flex-wrap: wrap; }
        .db-body { display: grid; grid-template-columns: 1fr 340px; gap: 16px; }
        @media (max-width: 900px) { .db-body { grid-template-columns: 1fr; } }

        /* section card */
        .db-card { background: var(--bg-surface); border: 1px solid var(--border); border-radius: var(--radius-lg); overflow: hidden; }
        .db-card-head { display: flex; align-items: center; justify-content: space-between; padding: 14px 18px; border-bottom: 1px solid var(--border); }
        .db-card-title { display: flex; align-items: center; gap: 8px; font-size: 12.5px; font-weight: 700; color: var(--text-primary); letter-spacing: 0.2px; }
        .db-card-body { padding: 4px 0; }
        .db-refresh-btn { display: flex; align-items: center; gap: 5px; padding: 5px 10px; border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--bg-elevated); color: var(--text-muted); font-size: 11px; font-family: inherit; cursor: pointer; transition: all 0.15s; }
        .db-refresh-btn:hover { background: var(--bg-hover); color: var(--text-secondary); }

        /* activity feed */
        .db-log-row { display: flex; align-items: flex-start; gap: 12px; padding: 11px 18px; border-bottom: 1px solid var(--border-muted); transition: background 0.1s; }
        .db-log-row:last-child { border-bottom: none; }
        .db-log-row:hover { background: var(--bg-elevated); }
        .db-log-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--blue); flex-shrink: 0; margin-top: 5px; }
        .db-log-content { flex: 1; min-width: 0; }
        .db-log-desc { font-size: 12.5px; color: var(--text-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .db-log-meta { display: flex; align-items: center; gap: 6px; margin-top: 3px; flex-wrap: wrap; }
        .db-log-actor { font-size: 11px; color: var(--text-muted); }
        .db-log-time { font-size: 11px; color: var(--text-muted); }
        .db-empty { padding: 32px 18px; text-align: center; font-size: 12.5px; color: var(--text-muted); }

        /* gig breakdown */
        .db-gig-row { display: flex; align-items: center; justify-content: space-between; padding: 12px 18px; border-bottom: 1px solid var(--border-muted); }
        .db-gig-row:last-child { border-bottom: none; }
        .db-gig-label { display: flex; align-items: center; gap: 8px; font-size: 12.5px; font-weight: 600; color: var(--text-primary); }
        .db-gig-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
        .db-gig-nums { display: flex; align-items: center; gap: 10px; }
        .db-gig-total { font-size: 14px; font-weight: 700; color: var(--text-primary); }
        .db-gig-avail { font-size: 11px; color: var(--text-muted); }

        /* quick links */
        .db-links { display: flex; flex-wrap: wrap; gap: 8px; padding: 14px; }

        /* recent gigs */
        .db-rgig-row { display: flex; align-items: center; gap: 12px; padding: 10px 18px; border-bottom: 1px solid var(--border-muted); transition: background 0.1s; }
        .db-rgig-row:last-child { border-bottom: none; }
        .db-rgig-row:hover { background: var(--bg-elevated); }
        .db-rgig-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
        .db-rgig-info { flex: 1; min-width: 0; }
        .db-rgig-title { font-size: 12.5px; font-weight: 600; color: var(--text-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .db-rgig-meta { display: flex; align-items: center; gap: 6px; margin-top: 2px; flex-wrap: wrap; }
        .db-rgig-sub { font-size: 11px; color: var(--text-muted); }
        .db-rgig-right { display: flex; flex-direction: column; align-items: flex-end; gap: 3px; flex-shrink: 0; }
        .db-rgig-salary { font-size: 12px; font-weight: 700; color: var(--text-primary); }
        .db-rgig-time { font-size: 10.5px; color: var(--text-muted); }

        /* skeleton */
        @keyframes skel-pulse { 0%,100%{opacity:.45} 50%{opacity:.9} }
        .sk { background: var(--bg-elevated); border-radius: 5px; animation: skel-pulse 1.4s ease-in-out infinite; }
      `}</style>

      <div className="db-wrap">
        {/* ── Stat Cards ──────────────────────────────────────────────── */}
        <div className="db-stats">
          <StatCard
            label="Total Users"
            value={totalUsers}
            sub={`${onlineUsers} online right now`}
            icon={<Users size={16} />}
            accent="var(--blue)"
          />
          <StatCard
            label="Online Now"
            value={onlineUsers}
            sub="Active sessions"
            icon={<Zap size={16} />}
            accent="var(--green)"
          />
          <StatCard
            label="Total Gigs"
            value={gigsLoading ? "—" : totalGigs}
            sub={gigsLoading ? undefined : `${availableGigs} available`}
            icon={<Briefcase size={16} />}
            accent="var(--orange)"
          />
          <StatCard
            label="Pending Applications"
            value={gigsLoading ? "—" : gigCounts.pendingApplications}
            sub="Awaiting review"
            icon={<Clock size={16} />}
            accent="var(--amber)"
          />
        </div>

        {/* ── Body ────────────────────────────────────────────────────── */}
        <div className="db-body">
          {/* Recent Gigs */}
          <div className="db-card">
            <div className="db-card-head">
              <div className="db-card-title">
                <Briefcase size={14} style={{ color: "var(--purple)" }} />
                Recent Gigs
              </div>
              <button
                className="db-refresh-btn"
                onClick={() => { fetchGigs(); }}
                title="Refresh"
              >
                <RefreshCw size={11} />
                Refresh
              </button>
            </div>
            <div className="db-card-body">
              {gigsLoading ? (
                <div style={{ padding: "12px 18px", display: "flex", flexDirection: "column", gap: 14 }}>
                  {Array.from({ length: 5 }).map((_, i) => (
                    <div key={i} style={{ display: "flex", gap: 12, alignItems: "center" }}>
                      <div className="sk" style={{ width: 8, height: 8, borderRadius: "50%", flexShrink: 0 }} />
                      <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 5 }}>
                        <div className="sk" style={{ height: 12, width: `${60 + (i % 4) * 8}%` }} />
                        <div className="sk" style={{ height: 10, width: 100 }} />
                      </div>
                      <div className="sk" style={{ height: 12, width: 50 }} />
                    </div>
                  ))}
                </div>
              ) : recentGigs.length === 0 ? (
                <div className="db-empty">No gigs found.</div>
              ) : (
                recentGigs.map((gig) => {
                  const GIG_COLORS: Record<GigType, string> = {
                    offered: "#F59E0B",
                    open:    "#3B82F6",
                    quick:   "#8B5CF6",
                  };
                  const GIG_LABELS: Record<GigType, string> = {
                    offered: "Offered",
                    open:    "Open",
                    quick:   "Quick",
                  };
                  const statusVariant =
                    gig.status.toLowerCase() === "available" ? "green" :
                    gig.status.toLowerCase() === "completed" ? "blue"  :
                    gig.status.toLowerCase() === "cancelled" ? "red"   : "gray";
                  const salary = gig.salary
                    ? (typeof gig.salary === "number"
                        ? `$${gig.salary.toLocaleString()}`
                        : String(gig.salary))
                    : null;
                  return (
                    <div key={`${gig.gigType}-${gig.id}`} className="db-rgig-row">
                      <div
                        className="db-rgig-dot"
                        style={{ background: GIG_COLORS[gig.gigType] }}
                      />
                      <div className="db-rgig-info">
                        <div className="db-rgig-title" title={gig.title}>{gig.title}</div>
                        <div className="db-rgig-meta">
                          <Badge variant={statusVariant as "green" | "blue" | "red" | "gray"}>
                            {gig.status || "—"}
                          </Badge>
                          <span
                            style={{
                              fontSize: 10,
                              fontWeight: 700,
                              color: GIG_COLORS[gig.gigType],
                              background: GIG_COLORS[gig.gigType] + "22",
                              borderRadius: 20,
                              padding: "2px 7px",
                            }}
                          >
                            {GIG_LABELS[gig.gigType]}
                          </span>
                          {gig.category && (
                            <span className="db-rgig-sub">{gig.category}</span>
                          )}
                        </div>
                      </div>
                      <div className="db-rgig-right">
                        {salary && <span className="db-rgig-salary">{salary}</span>}
                        <span className="db-rgig-time">{timeAgo(gig.createdAt)}</span>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
            {!gigsLoading && recentGigs.length > 0 && (
              <div style={{ padding: "10px 18px", borderTop: "1px solid var(--border)" }}>
                <Link
                  href="/live-gigs"
                  style={{ fontSize: 12, color: "var(--blue)", textDecoration: "none", fontWeight: 600 }}
                >
                  View all gigs →
                </Link>
              </div>
            )}
          </div>

          {/* Right column */}

                    {/* Activity Feed */}
          <div className="db-card">
            <div className="db-card-head">
              <div className="db-card-title">
                <Activity size={14} style={{ color: "var(--blue)" }} />
                Recent Activity
              </div>
              <button
                className="db-refresh-btn"
                onClick={() => { fetchLogs(); }}
                title="Refresh"
              >
                <RefreshCw size={11} />
                Refresh
              </button>
            </div>
            <div className="db-card-body">
              {logsLoading ? (
                <div style={{ padding: "12px 18px", display: "flex", flexDirection: "column", gap: 14 }}>
                  {Array.from({ length: 6 }).map((_, i) => (
                    <div key={i} style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
                      <div className="sk" style={{ width: 7, height: 7, borderRadius: "50%", marginTop: 5, flexShrink: 0 }} />
                      <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 5 }}>
                        <div className="sk" style={{ height: 12, width: `${70 + (i % 3) * 10}%` }} />
                        <div className="sk" style={{ height: 10, width: 120 }} />
                      </div>
                    </div>
                  ))}
                </div>
              ) : logs.length === 0 ? (
                <div className="db-empty">No activity logs yet.</div>
              ) : (
                logs.map((log) => {
                  const modCfg = log.module ? getModuleConfig(log.module) : null;
                  return (
                    <div key={log.id} className="db-log-row">
                      <div
                        className="db-log-dot"
                        style={{ background: modCfg?.accentColor ?? "var(--blue)" }}
                      />
                      <div className="db-log-content">
                        <div className="db-log-desc" title={log.description}>
                          {log.description}
                        </div>
                        <div className="db-log-meta">
                          {modCfg && (
                            <Badge variant={modCfg.variant}>{modCfg.label}</Badge>
                          )}
                          <span className="db-log-actor">{log.actorName}</span>
                          <span style={{ color: "var(--border)", fontSize: 10 }}>·</span>
                          <span className="db-log-time">{timeAgo(log.createdAt)}</span>
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
            {!logsLoading && logs.length > 0 && (
              <div style={{ padding: "10px 18px", borderTop: "1px solid var(--border)" }}>
                <Link
                  href="/activity-logs"
                  style={{ fontSize: 12, color: "var(--blue)", textDecoration: "none", fontWeight: 600 }}
                >
                  View all activity logs →
                </Link>
              </div>
            )}
          </div>
        </div>

        {/* Quick Navigate — full width */}
        <div className="db-card">
          <div className="db-card-head">
            <div className="db-card-title">
              <Zap size={14} style={{ color: "var(--purple)" }} />
              Quick Navigate
            </div>
          </div>
          <div className="db-links">
            <QuickLink href="/users"             icon={<Users size={14} />}      label="Users"              accent="var(--blue)"   />
            <QuickLink href="/live-gigs"          icon={<Briefcase size={14} />}  label="Live Gigs"          accent="var(--orange)" />
            <QuickLink href="/live-map"           icon={<Map size={14} />}        label="Live Map"           accent="var(--green)"  />
            <QuickLink href="/admins"             icon={<Shield size={14} />}     label="Admins"             accent="var(--purple)" />
            <QuickLink href="/activity-logs"      icon={<Activity size={14} />}   label="Activity Logs"      accent="var(--blue)"   />
            <QuickLink href="/reports"            icon={<BarChart2 size={14} />}  label="Support / Reports"  accent="var(--teal, #0d9488)"  />
            <QuickLink href="/settings"           icon={<Settings size={14} />}   label="Settings"           accent="var(--text-muted)"     />
            <QuickLink href="/content-management" icon={<File size={14} />}       label="Content Management" accent="var(--indigo, #6366f1)" />
          </div>
        </div>
      </div>
    </AdminLayout>
  );
}
