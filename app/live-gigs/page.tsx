"use client";

import { useState, useEffect, useCallback, useMemo, Fragment, memo } from "react";
import AdminLayout from "@/components/layout/AdminLayout";
import Button from "@/components/ui/Button";
import Modal from "@/components/ui/Modal";
import {
  collection,
  getDocs,
  Timestamp,
  doc,
  updateDoc,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import {
  Briefcase,
  Search,
  RefreshCw,
  ChevronDown,
  MapPin,
  Filter,
  X,
} from "lucide-react";
import { useAuthGuard } from "@/hooks/useAuthGuard";
import { useAuth } from "@/context/AuthContext";
import { writeLog, buildDescription } from "@/lib/activitylog";

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

type GigType = "offered" | "open" | "quick";

interface GigBase {
  id: string;
  gigType: GigType;
  title: string;
  description?: string;
  status: string;
  category?: string;
  vacancy?: number;
  slot?: number;
  salary?: string | number;
  postedBy?: string;
  location?: string | GeoPoint | null;
  createdAt: Timestamp | null;
  applications: Application[];
  cancelledByAdmin?: boolean;
  cancellationReason?: string;
  cancellationTicketID?: string;
}

type Gig = GigBase & Record<string, unknown>;

type StatusFilter = "all" | "available" | "unavailable";
type GigTypeFilter = "all" | GigType;
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

function formatFieldLabel(key: string): string {
  return key
    .replace(/([A-Z])/g, " $1")
    .replace(/^./, (s) => s.toUpperCase())
    .trim();
}

function formatFieldValue(val: unknown): string {
  if (val === null || val === undefined) return "—";
  if (val instanceof Timestamp) return formatDate(val);
  if (
    typeof val === "object" &&
    "latitude" in (val as object) &&
    "longitude" in (val as object)
  ) {
    const gp = val as GeoPoint;
    return `${gp.latitude.toFixed(5)}, ${gp.longitude.toFixed(5)}`;
  }
  if (typeof val === "boolean") return val ? "Yes" : "No";
  if (typeof val === "number") return String(val);
  if (typeof val === "string") return val || "—";
  if (Array.isArray(val)) return val.join(", ") || "—";
  return JSON.stringify(val);
}

const GIG_TYPE_LABELS: Record<GigType, string> = {
  offered: "Offered",
  open: "Open",
  quick: "Quick",
};

const GIG_COLLECTIONS: Record<GigType, string> = {
  offered: "offered_gigs",
  open: "open_gigs",
  quick: "quick_gigs",
};

// Fields shown explicitly in the Details section — excluded from "Additional Details"
const BASE_FIELDS = new Set([
  "id",
  "gigType",
  "title",
  "description",
  "status",
  "category",
  "vacancy",
  "slot",
  "salary",
  "postedBy",
  "location",
  "createdAt",
  "applications",
]);

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function LiveGigsPage() {
  useAuthGuard({ module: "live-gigs" });
  const { user } = useAuth();

  const PAGE_SIZE = 10;

  const [gigs, setGigs] = useState<Gig[]>([]);
  const [loading, setLoading] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [gigTypeFilter, setGigTypeFilter] = useState<GigTypeFilter>("all");
  const [sort, setSort] = useState<SortOption>("newest");
  const [page, setPage] = useState(1);
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [cancelError, setCancelError] = useState<string | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [cancelModalGig, setCancelModalGig] = useState<Gig | null>(null);
  const [cancelReason, setCancelReason] = useState("");
  const [cancelTicketID, setCancelTicketId] = useState("");

  const openCancelModal = useCallback((gig: Gig) => {
    setCancelModalGig(gig);
    setCancelReason("");
    setCancelTicketId("");
    setCancelError(null);
  }, []);

  const cancelGig = useCallback(async () => {
    const gig = cancelModalGig;
    if (!gig || cancellingId) return;
    setCancellingId(gig.id);
    setCancelError(null);
    try {
      await updateDoc(doc(db, GIG_COLLECTIONS[gig.gigType], gig.id), {
        status: "cancelled",
        cancelledByAdmin: true,
        cancellationReason: cancelReason.trim() || null,
        cancellationTicketID: cancelTicketID.trim() || null,
      });
      setGigs((prev) =>
        prev.map((g) => (g.id === gig.id ? {
          ...g,
          status: "cancelled",
          cancelledByAdmin: true,
          cancellationReason: cancelReason.trim() || undefined,
          cancellationTicketID: cancelTicketID.trim() || undefined,
        } : g))
      );
      await writeLog({
        actorId:     user!.uid,
        actorName:   user!.displayName ?? "Unknown",
        actorEmail:  user!.email ?? "",
        module:      "gig_management",
        action:      "gig_cancelled",
        description: buildDescription.gigCancelled(gig.title || "Untitled Gig", gig.gigType),
        targetId:    gig.id,
        targetName:  gig.title || "Untitled Gig",
        meta: {
          other: {
            gigType: gig.gigType,
            collection: GIG_COLLECTIONS[gig.gigType],
            cancellationReason: cancelReason.trim() || null,
            cancellationTicketID: cancelTicketID.trim() || null,
          },
        },
      });
      setCancelModalGig(null);
    } catch (err) {
      console.error("Failed to cancel gig:", err);
      setCancelError(`Failed to cancel "${gig.title || "gig"}". Please try again.`);
    } finally {
      setCancellingId(null);
    }
  }, [cancelModalGig, cancellingId, cancelReason, cancelTicketID, user]);

  const fetchLiveGigs = useCallback(async () => {
    setLoading(true);
    setFetchError(null);
    try {
      const types: GigType[] = gigTypeFilter === "all"
        ? ["offered", "open", "quick"]
        : [gigTypeFilter];

      const snaps = await Promise.all(
        types.map((t) => getDocs(collection(db, GIG_COLLECTIONS[t])))
      );

      const rawGigs = snaps.flatMap((snap, i) =>
        snap.docs.map((d) => ({
          id: d.id,
          gigType: types[i],
          ...d.data(),
        }))
      ) as Omit<Gig, "applications">[];

      setGigs(rawGigs.map((g) => ({ ...g, applications: [] as Application[] })) as Gig[]);
    } catch (err) {
      console.error("Failed to fetch gigs:", err);
      setFetchError("Failed to load gigs. Please try again.");
    } finally {
      setLoading(false);
    }
  }, [gigTypeFilter]);

  useEffect(() => {
    fetchLiveGigs();
  }, [fetchLiveGigs]);

  // ── Derived ──────────────────────────────────────────────────────────────────

  const filtered = useMemo(() => {
    // Always shallow-copy so sort never mutates gigs state
    let list = gigs.slice();
    if (gigTypeFilter !== "all") {
      list = list.filter((g) => g.gigType === gigTypeFilter);
    }
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
    list.sort((a, b) => {
      if (sort === "newest") return (b.createdAt?.seconds ?? 0) - (a.createdAt?.seconds ?? 0);
      if (sort === "oldest") return (a.createdAt?.seconds ?? 0) - (b.createdAt?.seconds ?? 0);
      if (sort === "pay-high")
        return (parseFloat(String(b.salary ?? "0")) || 0) - (parseFloat(String(a.salary ?? "0")) || 0);
      if (sort === "pay-low")
        return (parseFloat(String(a.salary ?? "0")) || 0) - (parseFloat(String(b.salary ?? "0")) || 0);
      return 0;
    });
    return list;
  }, [gigs, search, statusFilter, gigTypeFilter, sort]);

  const stats = useMemo(() => {
    const total = gigs.length;
    const available = gigs.filter((g) => isAvailable(g.status)).length;
    // const totalApps = gigs.reduce((sum, g) => sum + (g.applications?.length ?? 0), 0);
    const offered = gigs.filter((g) => g.gigType === "offered").length;
    const open = gigs.filter((g) => g.gigType === "open").length;
    const quick = gigs.filter((g) => g.gigType === "quick").length;
    return { total, available, unavailable: total - available, offered, open, quick };
  }, [gigs]);

  // Reset to page 1 whenever filters/sort change
  useEffect(() => {
    setPage(1);
    setExpandedId(null);
  }, [search, statusFilter, gigTypeFilter, sort]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));

  // Clamp page if a cancel shrinks filtered.length below current page
  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [totalPages, page]);

  const paginated = useMemo(
    () => filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    [filtered, page]
  );

  const toggleExpand = (id: string) =>
    setExpandedId((prev) => (prev === id ? null : id));

  const hasActiveFilter = !!(search || statusFilter !== "all" || gigTypeFilter !== "all");

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
        .lg-badge--completed { background: rgba(59,130,246,0.12); color: var(--blue); }
        .lg-badge--category { background: rgba(59,130,246,0.12); color: var(--blue); }
        .lg-badge--pending { background: rgba(245,158,11,0.12); color: var(--amber); }
        .lg-badge--accepted { background: rgba(16,185,129,0.12); color: var(--green); }
        .lg-badge--rejected { background: rgba(239,68,68,0.12); color: var(--red); }
        .lg-badge--type-offered { background: rgba(245,158,11,0.12); color: var(--amber); }
        .lg-badge--type-open { background: rgba(59,130,246,0.12); color: var(--blue); }
        .lg-badge--type-quick { background: rgba(139,92,246,0.12); color: var(--purple); }
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
        .lg-expand-detail-val { font-size: 13px; color: var(--text-primary); font-weight: 500; word-break: break-word; }

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

        /* ── Cancel button ── */
        .lg-cancel-btn {
          padding: 4px 10px; border-radius: var(--radius-sm);
          border: 1px solid rgba(239,68,68,0.35); background: rgba(239,68,68,0.08);
          color: var(--red); font-size: 11px; font-weight: 600; font-family: inherit;
          cursor: pointer; transition: all 0.12s; white-space: nowrap;
        }
        .lg-cancel-btn:hover:not(:disabled) { background: rgba(239,68,68,0.18); border-color: var(--red); }
        .lg-cancel-btn:disabled { opacity: 0.5; cursor: not-allowed; }

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

        {/* ── Fetch error banner ── */}
        {fetchError && (
          <div style={{
            padding: "10px 16px", borderRadius: "var(--radius-sm)",
            background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)",
            color: "var(--red)", fontSize: 13, display: "flex", alignItems: "center", justifyContent: "space-between",
          }}>
            {fetchError}
            <button onClick={fetchLiveGigs} style={{ background: "none", border: "none", color: "var(--red)", fontSize: 12, cursor: "pointer", fontWeight: 600, padding: "0 4px" }}>
              Retry
            </button>
          </div>
        )}

        {/* ── Cancel error banner ── */}
        {cancelError && (
          <div style={{
            padding: "10px 16px", borderRadius: "var(--radius-sm)",
            background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)",
            color: "var(--red)", fontSize: 13, display: "flex", alignItems: "center", justifyContent: "space-between",
          }}>
            {cancelError}
            <button onClick={() => setCancelError(null)} style={{ background: "none", border: "none", color: "var(--red)", fontSize: 16, cursor: "pointer", lineHeight: 1, padding: "0 4px" }}>
              ×
            </button>
          </div>
        )}

        {/* ── Stats bar ── */}
        <div className="lg-stats">
          <StatCard value={stats.total} label="Total Gigs" color="var(--blue)" loading={loading} />
          <StatCard value={stats.available} label="Available" color="var(--green)" loading={loading} />
          <StatCard value={stats.unavailable} label="Unavailable" color="var(--red)" loading={loading} />
          {/* <StatCard value={stats.totalApps} label="Total Applications" color="var(--purple)" loading={loading} /> */}
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

          {/* Gig type filter */}
          <div className="lg-filter-group">
            {(["all", "open", "offered", "quick"] as GigTypeFilter[]).map((f) => (
              <button
                key={f}
                className={`lg-filter-btn${gigTypeFilter === f ? " lg-filter-btn--active" : ""}`}
                onClick={() => setGigTypeFilter(f)}
              >
                {f === "all" ? "All Types" : `${GIG_TYPE_LABELS[f as GigType]} Gigs`}
              </button>
            ))}
          </div>

          {/* Status filter */}
          <div className="lg-filter-group">
            {(["all", "available", "unavailable"] as StatusFilter[]).map((f) => (
              <button
                key={f}
                className={`lg-filter-btn${statusFilter === f ? " lg-filter-btn--active" : ""}`}
                onClick={() => setStatusFilter(f)}
              >
                {f === "all" ? "All Status" : f === "available" ? "Available" : "Unavailable"}
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

          {hasActiveFilter && (
            <Button
              variant="ghost"
              size="sm"
              icon={X}
              onClick={() => {
                setSearch("");
                setStatusFilter("all");
                setGigTypeFilter("all");
              }}
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
            <EmptyState hasFilter={hasActiveFilter} />
          ) : (
            <table className="lg-table">
              <thead>
                <tr>
                  <th>Gig</th>
                  <th>Type</th>
                  <th>Status</th>
                  <th>Applications</th>
                  <th>Posted</th>
                  <th>Actions</th>
                  <th style={{ width: 32 }} />
                </tr>
              </thead>
              <tbody>
                {paginated.map((gig) => {
                  const expanded = expandedId === gig.id;
                  const appCount = gig.applications?.length ?? 0;
                  const typeBadgeClass = `lg-badge--type-${gig.gigType}`;
                  const loc = formatLocation(gig.location);
                  return (
                    <Fragment key={gig.id}>
                      <tr
                        className={`lg-row${expanded ? " lg-row--expanded" : ""}`}
                        onClick={() => toggleExpand(gig.id)}
                      >
                        <td>
                          <div className="lg-gig-title">{gig.title || "Untitled Gig"}</div>
                          {loc && (
                            <div className="lg-gig-meta">
                              <MapPin size={10} />
                              {loc}
                            </div>
                          )}
                          {gig.postedBy && !loc && (
                            <div className="lg-gig-meta">by {gig.postedBy}</div>
                          )}
                        </td>
                        <td>
                          <span className={`lg-badge ${typeBadgeClass}`}>
                            {GIG_TYPE_LABELS[gig.gigType]}
                          </span>
                        </td>
                        <td>
                          <span
                            className={`lg-badge ${
                              isAvailable(gig.status)
                                ? "lg-badge--available"
                                : gig.status?.toLowerCase() === "completed"
                                  ? "lg-badge--completed"
                                  : "lg-badge--unavailable"
                            }`}
                          >
                            <span className="lg-badge-dot" />
                            {isAvailable(gig.status)
                              ? "Available"
                              : gig.status
                                  ? gig.status.charAt(0).toUpperCase() + gig.status.slice(1)
                                  : "Unknown"}
                          </span>
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
                        <td onClick={(e) => e.stopPropagation()}>
                          {gig.status?.toLowerCase() !== "cancelled" && gig.status?.toLowerCase() !== "completed" && (
                            <button
                              className="lg-cancel-btn"
                              disabled={cancellingId === gig.id}
                              onClick={(e) => { e.stopPropagation(); openCancelModal(gig); }}
                            >
                              {cancellingId === gig.id ? "Cancelling…" : "Cancel Gig"}
                            </button>
                          )}
                          {gig.status?.toLowerCase() === "cancelled" && (
                            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                              <span style={{ fontSize: 11, color: "var(--text-muted)", fontStyle: "italic" }}>
                                {gig.cancelledByAdmin ? "Cancelled by Admin" : "Cancelled"}
                              </span>
                              {gig.cancelledByAdmin && gig.cancellationTicketID && (
                                <span style={{ fontSize: 10, color: "var(--text-muted)" }}>
                                  Ticket: <span style={{ fontWeight: 600, color: "var(--text-secondary)" }}>{gig.cancellationTicketID}</span>
                                </span>
                              )}
                              {gig.cancelledByAdmin && gig.cancellationReason && (
                                <span style={{ fontSize: 10, color: "var(--text-muted)" }}>
                                  Reason: <span style={{ color: "var(--text-secondary)" }}>{gig.cancellationReason}</span>
                                </span>
                              )}
                            </div>
                          )}
                          {gig.status?.toLowerCase() === "completed" && (
                            <span style={{ fontSize: 11, color: "var(--blue)", fontStyle: "italic" }}>
                              Completed
                            </span>
                          )}
                        </td>
                        <td
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleExpand(gig.id);
                          }}
                        >
                          <ChevronDown
                            size={14}
                            className={`lg-chevron${expanded ? " lg-chevron--open" : ""}`}
                          />
                        </td>
                      </tr>

                      {expanded && (
                        <tr className="lg-expand">
                          <td colSpan={9}>
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
          {!loading && filtered.length > 0 && (
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

      {/* Cancel Gig Modal */}
      {cancelModalGig && (
        <Modal
          open
          onClose={() => { if (!cancellingId) { setCancelModalGig(null); setCancelError(null); } }}
          title="Cancel Gig"
          description={`"${cancelModalGig.title || "Untitled Gig"}" · ${GIG_TYPE_LABELS[cancelModalGig.gigType]}`}
          size="sm"
          footer={
            <>
              <Button
                variant="ghost" size="sm"
                onClick={() => { setCancelModalGig(null); setCancelError(null); }}
                disabled={!!cancellingId}
              >
                Dismiss
              </Button>
              <Button
                variant="danger" size="sm"
                loading={!!cancellingId}
                onClick={cancelGig}
              >
                Confirm Cancel
              </Button>
            </>
          }
        >
          <style>{`
            .cgm-field { display: flex; flex-direction: column; gap: 5px; margin-bottom: 12px; }
            .cgm-label { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; color: var(--text-muted); }
            .cgm-input {
              padding: 8px 10px; border-radius: var(--radius-sm);
              border: 1px solid var(--border); background: var(--bg-elevated);
              color: var(--text-primary); font-size: 13px; font-family: inherit;
              transition: border 0.15s; width: 100%; box-sizing: border-box;
            }
            .cgm-input:focus { outline: none; border-color: var(--blue); }
            .cgm-textarea { resize: vertical; min-height: 72px; }
            .cgm-error { font-size: 12px; color: var(--red); margin-top: 8px; }
          `}</style>

          <div className="cgm-field">
            <label className="cgm-label">Cancellation Ticket ID</label>
            <input
              className="cgm-input"
              placeholder="e.g. TKT-00123"
              value={cancelTicketID}
              onChange={(e) => setCancelTicketId(e.target.value)}
              disabled={!!cancellingId}
            />
          </div>

          <div className="cgm-field" style={{ marginBottom: 0 }}>
            <label className="cgm-label">Cancellation Reason</label>
            <textarea
              className="cgm-input cgm-textarea"
              placeholder="Describe why this gig is being cancelled…"
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
              disabled={!!cancellingId}
            />
          </div>

          {cancelError && <div className="cgm-error">{cancelError}</div>}
        </Modal>
      )}
    </AdminLayout>
  );
}

// ─── Stat Card ────────────────────────────────────────────────────────────────

const StatCard = memo(function StatCard({
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
});

// ─── Gig Expand Panel ─────────────────────────────────────────────────────────

function GigExpandPanel({ gig }: { gig: Gig }) {
  const accepted = gig.applications?.filter((a) => a.status === "accepted").length ?? 0;
  const pending = gig.applications?.filter((a) => a.status === "pending").length ?? 0;
  const rejected = gig.applications?.filter((a) => a.status === "rejected").length ?? 0;

  const typeBadgeClass = `lg-badge--type-${gig.gigType}`;
  const typeLabel = GIG_TYPE_LABELS[gig.gigType] ?? gig.gigType;

  // Collect type-specific extra fields
  const extraFields = Object.entries(gig).filter(
    ([key, val]) =>
      !BASE_FIELDS.has(key) &&
      val !== null &&
      val !== undefined &&
      val !== "" &&
      !Array.isArray(val)
  );

  return (
    <div className="lg-expand-inner">
      {/* Type & category tags */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <span className={`lg-badge ${typeBadgeClass}`}>{typeLabel} Gig</span>
        {gig.category && (
          <span className="lg-badge lg-badge--category">{gig.category}</span>
        )}
      </div>

      {/* Description */}
      {gig.description && (
        <div>
          <div className="lg-expand-section-title">Description</div>
          <div className="lg-expand-desc">{String(gig.description)}</div>
        </div>
      )}

      {/* Core details grid */}
      <div>
        <div className="lg-expand-section-title">Details</div>
        <div className="lg-expand-detail-grid">
          {gig.postedBy && (
            <DetailItem label="Posted by" value={String(gig.postedBy)} />
          )}
          {formatLocation(gig.location) && (
            <DetailItem label="Location" value={formatLocation(gig.location)!} />
          )}
          <DetailItem label="Posted" value={formatDate(gig.createdAt)} />
          {gig.salary !== undefined && gig.salary !== null && gig.salary !== "" && (
            <DetailItem label="Salary" value={`$${gig.salary}`} />
          )}
          {gig.vacancy !== undefined && (
            <DetailItem label="Vacancies" value={String(gig.vacancy ?? "—")} />
          )}
          {gig.slot !== undefined && (
            <DetailItem label="Slots" value={String(gig.slot ?? "—")} />
          )}
        </div>
      </div>

      {/* Type-specific / additional fields */}
      {extraFields.length > 0 && (
        <div>
          <div className="lg-expand-section-title">Additional Details</div>
          <div className="lg-expand-detail-grid">
            {extraFields.map(([key, val]) => (
              <DetailItem
                key={key}
                label={formatFieldLabel(key)}
                value={formatFieldValue(val)}
              />
            ))}
          </div>
        </div>
      )}

      {/* Applications */}
      <div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
          <span className="lg-expand-section-title" style={{ margin: 0 }}>
            Applications ({gig.applications?.length ?? 0})
          </span>
          {(gig.applications?.length ?? 0) > 0 && (
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

        {(gig.applications?.length ?? 0) === 0 ? (
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
                    <div className="lg-applicant-date">Applied {formatDate(app.appliedAt)}</div>
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

function DetailItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="lg-expand-detail">
      <span className="lg-expand-detail-label">{label}</span>
      <span className="lg-expand-detail-val">{value}</span>
    </div>
  );
}

// ─── Loading Skeleton ─────────────────────────────────────────────────────────

const LoadingSkeleton = memo(function LoadingSkeleton() {
  return (
    <div style={{ padding: "12px 20px", display: "flex", flexDirection: "column", gap: 14 }}>
      {[1, 2, 3, 4, 5].map((i) => (
        <div key={i} style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <div style={{ flex: 2, display: "flex", flexDirection: "column", gap: 5 }}>
            <div className="lg-skeleton" style={{ height: 13, width: "55%" }} />
            <div className="lg-skeleton" style={{ height: 10, width: "35%" }} />
          </div>
          <div className="lg-skeleton" style={{ height: 20, width: 60, borderRadius: 20 }} />
          <div className="lg-skeleton" style={{ height: 20, width: 70, borderRadius: 20 }} />
          <div className="lg-skeleton" style={{ height: 13, width: 30 }} />
          <div className="lg-skeleton" style={{ height: 13, width: 30 }} />
          <div className="lg-skeleton" style={{ height: 13, width: 40 }} />
          <div className="lg-skeleton" style={{ height: 13, width: 80 }} />
        </div>
      ))}
    </div>
  );
});

// ─── Empty State ──────────────────────────────────────────────────────────────

const EmptyState = memo(function EmptyState({ hasFilter }: { hasFilter: boolean }) {
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
          ? "Try adjusting your search, status, or gig type filter."
          : "Gigs posted on the platform will appear here."}
      </div>
    </div>
  );
});
