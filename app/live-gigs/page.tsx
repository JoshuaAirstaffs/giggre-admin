"use client";

import { useState, useEffect, useCallback, useMemo, Fragment } from "react";
import AdminLayout from "@/components/layout/AdminLayout";
import Button from "@/components/ui/Button";
import {
  collection,
  getDocs,
  query,
  where,
  orderBy,
  Timestamp,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import {
  Briefcase,
  Search,
  RefreshCw,
  ChevronDown,
  ChevronUp,
  MapPin,
  Users,
  Clock,
  Layers,
  Filter,
  X,
  AlertCircle,
} from "lucide-react";
import { useAuthGuard } from "@/hooks/useAuthGuard";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Application {
  id: string;
  gigId: string;
  userId: string;
  applicantName: string;
  status: "pending" | "accepted" | "rejected" | string;
  appliedAt: Timestamp | null;
}

interface GeoPoint {
  latitude: number;
  longitude: number;
}

interface Gig {
  id: string;
  title: string;
  description?: string;
  status: string;
  category?: string;
  vacancy?: number;
  slot?: number;
  salary?: string;
  postedBy?: string;
  location?: string | GeoPoint | null;
  createdAt: Timestamp | null;
  applications: Application[];
}

type StatusFilter = "all" | "available" | "unavailable";
type SortOption = "newest" | "oldest" | "pay-high" | "pay-low";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(ts: Timestamp | null): string {
  if (!ts) return "—";
  const d = ts.toDate();
  return d.toLocaleDateString("en-PH", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatLocation(loc: string | GeoPoint | null | undefined): string | null {
  if (!loc) return null;
  if (typeof loc === "string") return loc || null;
  return `${loc.latitude.toFixed(5)}, ${loc.longitude.toFixed(5)}`;
}

function formatDateShort(ts: Timestamp | null): string {
  if (!ts) return "—";
  const d = ts.toDate();
  return d.toLocaleDateString("en-PH", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function isAvailable(status: string): boolean {
  return status?.toLowerCase() === "available";
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function LiveGigsPage() {
  useAuthGuard({ module: "live-gigs" });

  const PAGE_SIZE = 10;

  const [gigs, setGigs] = useState<Gig[]>([]);
  const [loading, setLoading] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [sort, setSort] = useState<SortOption>("newest");
  const [page, setPage] = useState(1);

  const fetchLiveGigs = useCallback(async () => {
    setLoading(true);
    try {
      const gigsSnapshot = await getDocs(collection(db, "gigs"));
      const rawGigs = gigsSnapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      })) as Omit<Gig, "applications">[];

      const gigsWithApplications = await Promise.all(
        rawGigs.map(async (gig) => {
          const appsSnapshot = await getDocs(
            query(collection(db, "applications"), where("gigId", "==", gig.id))
          );
          const applications = await Promise.all(
            appsSnapshot.docs.map(async (appDoc) => {
              const appData = appDoc.data();
              const userSnapshot = await getDocs(
                query(collection(db, "users"), where("uid", "==", appData.userId))
              );
              const userData = userSnapshot.docs[0]?.data() ?? null;
              return {
                id: appDoc.id,
                ...appData,
                applicantName:
                  userData?.name ?? userData?.displayName ?? "Unknown",
              } as Application;
            })
          );
          return { ...gig, applications };
        })
      );

      setGigs(gigsWithApplications);
    } catch (err) {
      console.error("Failed to fetch gigs:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchLiveGigs();
  }, [fetchLiveGigs]);

  // ── Derived ──────────────────────────────────────────────────────────────────

  const filtered = useMemo(() => {
    let list = gigs;
    if (statusFilter !== "all") {
      list = list.filter((g) =>
        statusFilter === "available" ? isAvailable(g.status) : !isAvailable(g.status)
      );
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (g) =>
          g.title?.toLowerCase().includes(q) ||
          g.category?.toLowerCase().includes(q) ||
          g.postedBy?.toLowerCase().includes(q) ||
          formatLocation(g.location)?.toLowerCase().includes(q)
      );
    }
    list = [...list].sort((a, b) => {
      if (sort === "newest") return (b.createdAt?.seconds ?? 0) - (a.createdAt?.seconds ?? 0);
      if (sort === "oldest") return (a.createdAt?.seconds ?? 0) - (b.createdAt?.seconds ?? 0);
      if (sort === "pay-high") return (parseFloat(b.salary ?? "0") || 0) - (parseFloat(a.salary ?? "0") || 0);
      if (sort === "pay-low") return (parseFloat(a.salary ?? "0") || 0) - (parseFloat(b.salary ?? "0") || 0);
      return 0;
    });
    return list;
  }, [gigs, search, statusFilter, sort]);

  const stats = useMemo(() => {
    const total = gigs.length;
    const available = gigs.filter((g) => isAvailable(g.status)).length;
    const totalApps = gigs.reduce((sum, g) => sum + (g.applications?.length ?? 0), 0);
    const withApps = gigs.filter((g) => (g.applications?.length ?? 0) > 0).length;
    return { total, available, unavailable: total - available, totalApps, withApps };
  }, [gigs]);

  // Reset to page 1 whenever filters/sort change
  useEffect(() => { setPage(1); setExpandedId(null); }, [search, statusFilter, sort]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const paginated = useMemo(
    () => filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    [filtered, page, PAGE_SIZE]
  );

  const toggleExpand = (id: string) =>
    setExpandedId((prev) => (prev === id ? null : id));

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <AdminLayout
      title="Live Gigs"
      subtitle="Monitor and manage all active gig postings"
      actions={
        <Button
          variant="ghost"
          size="sm"
          icon={RefreshCw}
          onClick={fetchLiveGigs}
          disabled={loading}
        >
          Refresh
        </Button>
      }
    >
      <style>{`
        /* ── Layout ── */
        .lg-wrap { display: flex; flex-direction: column; gap: 20px; padding: 24px; }

        /* ── Stats ── */
        .lg-stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; }
        @media (max-width: 768px) { .lg-stats { grid-template-columns: repeat(2, 1fr); } }
        .lg-stat {
          padding: 14px 18px; border-radius: var(--radius-md);
          background: var(--bg-surface); border: 1px solid var(--border);
          display: flex; flex-direction: column; gap: 4;
        }
        .lg-stat-val { font-size: 22px; font-weight: 700; color: var(--text-primary); font-family: 'Space Mono', monospace; line-height: 1.2; }
        .lg-stat-label { font-size: 11px; color: var(--text-muted); font-weight: 500; text-transform: uppercase; letter-spacing: 0.05em; }
        .lg-stat-accent { width: 3px; height: 20px; border-radius: 2px; flex-shrink: 0; }

        /* ── Controls ── */
        .lg-controls { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
        .lg-search-wrap { flex: 1; min-width: 200px; position: relative; }
        .lg-search-icon { position: absolute; left: 10px; top: 50%; transform: translateY(-50%); color: var(--text-muted); pointer-events: none; }
        .lg-search {
          width: 100%; padding: 8px 12px 8px 32px;
          background: var(--bg-surface); border: 1px solid var(--border);
          border-radius: var(--radius-sm); color: var(--text-primary);
          font-size: 13px; font-family: inherit; transition: border 0.15s;
        }
        .lg-search:focus { outline: none; border-color: var(--blue); }
        .lg-search::placeholder { color: var(--text-muted); }
        .lg-filter-group { display: flex; gap: 4px; background: var(--bg-elevated); border: 1px solid var(--border); border-radius: var(--radius-sm); padding: 3px; }
        .lg-filter-btn {
          padding: 5px 12px; border: 1px solid transparent; border-radius: 6px;
          background: transparent; color: var(--text-muted); font-size: 12px;
          font-weight: 500; font-family: inherit; cursor: pointer; transition: all 0.12s; white-space: nowrap;
        }
        .lg-filter-btn:hover:not(.lg-filter-btn--active) { background: var(--bg-surface); color: var(--text-secondary); }
        .lg-filter-btn--active { background: var(--bg-surface); border-color: var(--border); color: var(--text-primary); box-shadow: 0 1px 3px rgba(0,0,0,0.1); }

        /* ── Table card ── */
        .lg-card { background: var(--bg-surface); border: 1px solid var(--border); border-radius: var(--radius-md); overflow: hidden; }
        .lg-card-header { padding: 14px 20px; border-bottom: 1px solid var(--border); display: flex; align-items: center; justify-content: space-between; }
        .lg-card-title { font-size: 13px; font-weight: 700; color: var(--text-primary); }
        .lg-card-count { font-size: 11px; color: var(--text-muted); }

        /* ── Table ── */
        .lg-table { width: 100%; border-collapse: collapse; }
        .lg-table th {
          padding: 10px 16px; text-align: left;
          font-size: 11px; font-weight: 600; letter-spacing: 0.05em;
          text-transform: uppercase; color: var(--text-muted);
          border-bottom: 1px solid var(--border); background: var(--bg-elevated);
        }
        .lg-table td { padding: 12px 16px; border-bottom: 1px solid var(--border); vertical-align: middle; }
        .lg-row:last-child > td { border-bottom: none; }
        .lg-row:hover > td { background: var(--bg-elevated); cursor: pointer; }
        .lg-row--expanded > td { background: var(--bg-elevated); }

        /* ── Gig title cell ── */
        .lg-gig-title { font-size: 13px; font-weight: 600; color: var(--text-primary); }
        .lg-gig-meta { font-size: 11px; color: var(--text-muted); margin-top: 2px; display: flex; align-items: center; gap: 4px; }

        /* ── Badges ── */
        .lg-badge {
          display: inline-flex; align-items: center; gap: 4px;
          padding: 3px 8px; border-radius: 20px;
          font-size: 11px; font-weight: 600;
        }
        .lg-badge--available { background: rgba(16,185,129,0.12); color: var(--green); }
        .lg-badge--unavailable { background: rgba(239,68,68,0.12); color: var(--red); }
        .lg-badge--category { background: rgba(59,130,246,0.12); color: var(--blue); }
        .lg-badge--pending { background: rgba(245,158,11,0.12); color: var(--amber); }
        .lg-badge--accepted { background: rgba(16,185,129,0.12); color: var(--green); }
        .lg-badge--rejected { background: rgba(239,68,68,0.12); color: var(--red); }
        .lg-badge-dot { width: 5px; height: 5px; border-radius: 50%; background: currentColor; flex-shrink: 0; }

        /* ── Number chip ── */
        .lg-num { font-family: 'Space Mono', monospace; font-size: 12px; font-weight: 700; color: var(--text-primary); }
        .lg-num-label { font-size: 11px; color: var(--text-muted); margin-left: 3px; }

        /* ── Expand panel ── */
        .lg-expand { background: var(--bg-base); border-top: 1px solid var(--border); }
        .lg-expand td { padding: 0 !important; }
        .lg-expand-inner { padding: 16px 20px; display: flex; flex-direction: column; gap: 14px; }
        .lg-expand-section-title { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-muted); margin-bottom: 8px; }
        .lg-expand-desc { font-size: 13px; color: var(--text-secondary); line-height: 1.6; }
        .lg-expand-detail-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: 10px; }
        .lg-expand-detail { display: flex; flex-direction: column; gap: 2px; }
        .lg-expand-detail-label { font-size: 10px; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.05em; font-weight: 600; }
        .lg-expand-detail-val { font-size: 13px; color: var(--text-primary); font-weight: 500; }

        /* ── Applicants list ── */
        .lg-applicants { display: flex; flex-direction: column; gap: 6px; }
        .lg-applicant { display: flex; align-items: center; justify-content: space-between; padding: 8px 12px; background: var(--bg-elevated); border-radius: var(--radius-sm); border: 1px solid var(--border); }
        .lg-applicant-name { font-size: 13px; color: var(--text-primary); font-weight: 500; }
        .lg-applicant-date { font-size: 11px; color: var(--text-muted); margin-top: 1px; }

        /* ── Empty / Loading ── */
        .lg-empty { padding: 60px 24px; text-align: center; color: var(--text-muted); }
        .lg-empty-icon { display: flex; justify-content: center; margin-bottom: 12px; opacity: 0.3; }
        .lg-empty-title { font-size: 14px; font-weight: 600; color: var(--text-secondary); margin-bottom: 4px; }
        .lg-empty-sub { font-size: 12px; }

        .lg-skeleton { background: var(--bg-elevated); border-radius: 6px; animation: lg-pulse 1.4s ease-in-out infinite; }
        @keyframes lg-pulse { 0%,100% { opacity: 0.4; } 50% { opacity: 0.9; } }

        .lg-chevron { color: var(--text-muted); transition: transform 0.18s; }
        .lg-chevron--open { transform: rotate(180deg); }

        /* ── Pagination ── */
        .lg-pagination {
          display: flex; align-items: center; justify-content: space-between;
          padding: 12px 20px; border-top: 1px solid var(--border);
          flex-wrap: wrap; gap: 10px;
        }
        .lg-page-info { font-size: 12px; color: var(--text-muted); }
        .lg-page-controls { display: flex; align-items: center; gap: 4px; }
        .lg-page-btn {
          min-width: 32px; height: 32px; padding: 0 8px;
          border: 1px solid var(--border); border-radius: var(--radius-sm);
          background: var(--bg-elevated); color: var(--text-secondary);
          font-size: 12px; font-weight: 600; font-family: inherit;
          cursor: pointer; transition: all 0.12s;
          display: flex; align-items: center; justify-content: center;
        }
        .lg-page-btn:hover:not(:disabled):not(.lg-page-btn--active) {
          background: var(--bg-hover); color: var(--text-primary);
        }
        .lg-page-btn:disabled { opacity: 0.35; cursor: not-allowed; }
        .lg-page-btn--active {
          background: var(--blue); border-color: var(--blue); color: white;
        }
        .lg-page-ellipsis { font-size: 12px; color: var(--text-muted); padding: 0 4px; }

        /* ── Sort select ── */
        .lg-sort {
          padding: 7px 28px 7px 10px; appearance: none;
          background: var(--bg-surface) url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6'%3E%3Cpath d='M0 0l5 6 5-6z' fill='%23888'/%3E%3C/svg%3E") no-repeat right 9px center;
          border: 1px solid var(--border); border-radius: var(--radius-sm);
          color: var(--text-primary); font-size: 12px; font-family: inherit;
          cursor: pointer; transition: border 0.15s; white-space: nowrap;
        }
        .lg-sort:focus { outline: none; border-color: var(--blue); }
      `}</style>

      <div className="lg-wrap">

        {/* ── Stats bar ── */}
        <div className="lg-stats">
          <StatCard
            value={stats.total}
            label="Total Gigs"
            color="var(--blue)"
            loading={loading}
          />
          <StatCard
            value={stats.available}
            label="Available"
            color="var(--green)"
            loading={loading}
          />
          <StatCard
            value={stats.unavailable}
            label="Unavailable"
            color="var(--red)"
            loading={loading}
          />
          <StatCard
            value={stats.totalApps}
            label="Total Applications"
            color="var(--purple)"
            loading={loading}
          />
        </div>

        {/* ── Controls ── */}
        <div className="lg-controls">
          <div className="lg-search-wrap">
            <Search size={13} className="lg-search-icon" />
            <input
              className="lg-search"
              placeholder="Search by title, category, posted by…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="lg-filter-group">
            {(["all", "available", "unavailable"] as StatusFilter[]).map((f) => (
              <button
                key={f}
                className={`lg-filter-btn${statusFilter === f ? " lg-filter-btn--active" : ""}`}
                onClick={() => setStatusFilter(f)}
              >
                {f === "all" ? "All" : f === "available" ? "Available" : "Unavailable"}
              </button>
            ))}
          </div>
          <select
            className="lg-sort"
            value={sort}
            onChange={(e) => setSort(e.target.value as SortOption)}
            title="Sort by"
          >
            <option value="newest">Newest</option>
            <option value="oldest">Oldest</option>
            <option value="pay-high">Highest Pay</option>
            <option value="pay-low">Lowest Pay</option>
          </select>
          {(search || statusFilter !== "all") && (
            <Button
              variant="ghost"
              size="sm"
              icon={X}
              onClick={() => { setSearch(""); setStatusFilter("all"); }}
            >
              Clear
            </Button>
          )}
        </div>

        {/* ── Table ── */}
        <div className="lg-card">
          <div className="lg-card-header">
            <span className="lg-card-title">Gig Listings</span>
            <span className="lg-card-count">
              {loading
                ? "Loading…"
                : filtered.length === gigs.length
                  ? `${gigs.length} gig${gigs.length !== 1 ? "s" : ""}`
                  : `${filtered.length} of ${gigs.length} gig${gigs.length !== 1 ? "s" : ""}`}
            </span>
          </div>

          {loading ? (
            <LoadingSkeleton />
          ) : filtered.length === 0 ? (
            <EmptyState hasFilter={!!(search || statusFilter !== "all")} />
          ) : (
            <table className="lg-table">
              <thead>
                <tr>
                  <th>Gig</th>
                  {/* <th>Category</th> */}
                  <th>Status</th>
                  <th>Vacancies</th>
                  <th>Slots</th>
                  <th>Applications</th>
                  <th>Posted</th>
                  <th style={{ width: 32 }} />
                </tr>
              </thead>
              <tbody>
                {paginated.map((gig) => {
                  const expanded = expandedId === gig.id;
                  const appCount = gig.applications?.length ?? 0;
                  return (
    <Fragment key={gig.id}>
                      <tr
                        // key={gig.id}
                        className={`lg-row${expanded ? " lg-row--expanded" : ""}`}
                        onClick={() => toggleExpand(gig.id)}
                      >
                        <td>
                          <div className="lg-gig-title">{gig.title || "Untitled Gig"}</div>
                          {formatLocation(gig.location) && (
                            <div className="lg-gig-meta">
                              <MapPin size={10} />
                              {formatLocation(gig.location)}
                            </div>
                          )}
                          {gig.postedBy && !formatLocation(gig.location) && (
                            <div className="lg-gig-meta">by {gig.postedBy}</div>
                          )}
                        </td>
                        {/* <td>
                          {gig.category ? (
                            <span className="lg-badge lg-badge--category">{gig.category}</span>
                          ) : (
                            <span style={{ fontSize: 11, color: "var(--text-muted)" }}>—</span>
                          )}
                        </td> */}
                        <td>
                          <span className={`lg-badge ${isAvailable(gig.status) ? "lg-badge--available" : "lg-badge--unavailable"}`}>
                            <span className="lg-badge-dot" />
                            {isAvailable(gig.status) ? "Available" : gig.status || "Unknown"}
                          </span>
                        </td>
                        <td>
                          <span className="lg-num">{gig.vacancy ?? "—"}</span>
                        </td>
                        <td>
                          <span className="lg-num">{gig.slot ?? "—"}</span>
                        </td>
                        <td>
                          <span className="lg-num">{appCount}</span>
                          {appCount > 0 && (
                            <span className="lg-num-label">
                              {appCount === 1 ? "applicant" : "applicants"}
                            </span>
                          )}
                        </td>
                        <td>
                          <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
                            {formatDateShort(gig.createdAt)}
                          </span>
                        </td>
                        <td onClick={(e) => { e.stopPropagation(); toggleExpand(gig.id); }}>
                          <ChevronDown
                            size={14}
                            className={`lg-chevron${expanded ? " lg-chevron--open" : ""}`}
                          />
                        </td>
                      </tr>

                      {expanded && (
                        <tr className="lg-expand" >
                          <td colSpan={8}>
                            <GigExpandPanel gig={gig} />
                          </td>
                        </tr>
                      )}
    </Fragment>
                  );
                })}
              </tbody>
            </table>
          )}

          {/* Pagination */}
          {!loading && filtered.length > 0 && totalPages > 1 && (
            <div className="lg-pagination">
              <span className="lg-page-info">
                Showing {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, filtered.length)} of {filtered.length}
              </span>
              <div className="lg-page-controls">
                <button
                  className="lg-page-btn"
                  onClick={() => setPage(1)}
                  disabled={page === 1}
                  title="First page"
                >
                  «
                </button>
                <button
                  className="lg-page-btn"
                  onClick={() => setPage((p) => p - 1)}
                  disabled={page === 1}
                  title="Previous page"
                >
                  ‹
                </button>

                {Array.from({ length: totalPages }, (_, i) => i + 1)
                  .filter((p) => p === 1 || p === totalPages || Math.abs(p - page) <= 1)
                  .reduce<(number | "…")[]>((acc, p, idx, arr) => {
                    if (idx > 0 && p - (arr[idx - 1] as number) > 1) acc.push("…");
                    acc.push(p);
                    return acc;
                  }, [])
                  .map((p, i) =>
                    p === "…" ? (
                      <span key={`e-${i}`} className="lg-page-ellipsis">…</span>
                    ) : (
                      <button
                        key={p}
                        className={`lg-page-btn${page === p ? " lg-page-btn--active" : ""}`}
                        onClick={() => setPage(p as number)}
                      >
                        {p}
                      </button>
                    )
                  )}

                <button
                  className="lg-page-btn"
                  onClick={() => setPage((p) => p + 1)}
                  disabled={page === totalPages}
                  title="Next page"
                >
                  ›
                </button>
                <button
                  className="lg-page-btn"
                  onClick={() => setPage(totalPages)}
                  disabled={page === totalPages}
                  title="Last page"
                >
                  »
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </AdminLayout>
  );
}

// ─── Stat Card ────────────────────────────────────────────────────────────────

function StatCard({
  value,
  label,
  color,
  loading,
}: {
  value: number;
  label: string;
  color: string;
  loading: boolean;
}) {
  return (
    <div className="lg-stat" style={{ borderLeft: `3px solid ${color}` }}>
      {loading ? (
        <div className="lg-skeleton" style={{ height: 24, width: "50%", marginBottom: 4 }} />
      ) : (
        <div className="lg-stat-val" style={{ color }}>
          {value}
        </div>
      )}
      <div className="lg-stat-label">{label}</div>
    </div>
  );
}

// ─── Gig Expand Panel ─────────────────────────────────────────────────────────

function GigExpandPanel({ gig }: { gig: Gig }) {
  const accepted = gig.applications?.filter((a) => a.status === "accepted").length ?? 0;
  const pending = gig.applications?.filter((a) => a.status === "pending").length ?? 0;
  const rejected = gig.applications?.filter((a) => a.status === "rejected").length ?? 0;

  return (
    <div className="lg-expand-inner">
      {/* Description */}
      {gig.description && (
        <div>
          <div className="lg-expand-section-title">Description</div>
          <div className="lg-expand-desc">{gig.description}</div>
        </div>
      )}

      {/* Detail grid */}
      <div>
        <div className="lg-expand-section-title">Details</div>
        <div className="lg-expand-detail-grid">
          {gig.postedBy && (
            <div className="lg-expand-detail">
              <span className="lg-expand-detail-label">Posted by</span>
              <span className="lg-expand-detail-val">{gig.postedBy}</span>
            </div>
          )}
          {formatLocation(gig.location) && (
            <div className="lg-expand-detail">
              <span className="lg-expand-detail-label">Location</span>
              <span className="lg-expand-detail-val">{formatLocation(gig.location)}</span>
            </div>
          )}
          <div className="lg-expand-detail">
            <span className="lg-expand-detail-label">Posted</span>
            <span className="lg-expand-detail-val">{formatDate(gig.createdAt)}</span>
          </div>
          {gig.salary && (
            <div className="lg-expand-detail">
              <span className="lg-expand-detail-label">Salary</span>
              <span className="lg-expand-detail-val">₱{gig.salary}</span>
            </div>
          )}
          <div className="lg-expand-detail">
            <span className="lg-expand-detail-label">Vacancies</span>
            <span className="lg-expand-detail-val">{gig.vacancy ?? "—"}</span>
          </div>
          <div className="lg-expand-detail">
            <span className="lg-expand-detail-label">Slots</span>
            <span className="lg-expand-detail-val">{gig.slot ?? "—"}</span>
          </div>
          {/* <div className="lg-expand-detail">
            <span className="lg-expand-detail-label">Category</span>
            <span className="lg-expand-detail-val">{gig.category ?? "—"}</span>
          </div> */}
        </div>
      </div>

      {/* Applications */}
      <div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
          <span className="lg-expand-section-title" style={{ margin: 0 }}>
            Applications ({gig.applications?.length ?? 0})
          </span>
          {gig.applications?.length > 0 && (
            <div style={{ display: "flex", gap: 6 }}>
              {accepted > 0 && (
                <span className="lg-badge lg-badge--accepted">{accepted} accepted</span>
              )}
              {pending > 0 && (
                <span className="lg-badge lg-badge--pending">{pending} pending</span>
              )}
              {rejected > 0 && (
                <span className="lg-badge lg-badge--rejected">{rejected} rejected</span>
              )}
            </div>
          )}
        </div>

        {gig.applications?.length === 0 ? (
          <div style={{ fontSize: 12, color: "var(--text-muted)", fontStyle: "italic" }}>
            No applications yet.
          </div>
        ) : (
          <div className="lg-applicants">
            {gig.applications.map((app) => (
              <div key={app.id} className="lg-applicant">
                <div>
                  <div className="lg-applicant-name">{app.applicantName}</div>
                  {app.appliedAt && (
                    <div className="lg-applicant-date">
                      Applied {formatDate(app.appliedAt)}
                    </div>
                  )}
                </div>
                <span
                  className={`lg-badge ${
                    app.status === "accepted"
                      ? "lg-badge--accepted"
                      : app.status === "rejected"
                      ? "lg-badge--rejected"
                      : "lg-badge--pending"
                  }`}
                >
                  {app.status}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Loading Skeleton ─────────────────────────────────────────────────────────

function LoadingSkeleton() {
  return (
    <div style={{ padding: "12px 20px", display: "flex", flexDirection: "column", gap: 14 }}>
      {[1, 2, 3, 4, 5].map((i) => (
        <div
          key={i}
          style={{ display: "flex", alignItems: "center", gap: 16 }}
        >
          <div style={{ flex: 2, display: "flex", flexDirection: "column", gap: 5 }}>
            <div className="lg-skeleton" style={{ height: 13, width: "55%" }} />
            <div className="lg-skeleton" style={{ height: 10, width: "35%" }} />
          </div>
          <div className="lg-skeleton" style={{ height: 20, width: 70, borderRadius: 20 }} />
          <div className="lg-skeleton" style={{ height: 20, width: 80, borderRadius: 20 }} />
          <div className="lg-skeleton" style={{ height: 13, width: 30 }} />
          <div className="lg-skeleton" style={{ height: 13, width: 30 }} />
          <div className="lg-skeleton" style={{ height: 13, width: 40 }} />
          <div className="lg-skeleton" style={{ height: 13, width: 80 }} />
        </div>
      ))}
    </div>
  );
}

// ─── Empty State ──────────────────────────────────────────────────────────────

function EmptyState({ hasFilter }: { hasFilter: boolean }) {
  return (
    <div className="lg-empty">
      <div className="lg-empty-icon">
        {hasFilter ? <Filter size={36} /> : <Briefcase size={36} />}
      </div>
      <div className="lg-empty-title">
        {hasFilter ? "No gigs match your filters" : "No gigs found"}
      </div>
      <div className="lg-empty-sub">
        {hasFilter
          ? "Try adjusting your search or status filter."
          : "Gigs posted on the platform will appear here."}
      </div>
    </div>
  );
}
