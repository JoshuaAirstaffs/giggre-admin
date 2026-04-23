"use client";

import { useState, useEffect, useCallback, useMemo, memo } from "react";
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
  MapPin,
  Filter,
  SlidersHorizontal,
  Eye,
  DollarSign,
  Users,
  Calendar,
  Tag,
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

type StatusFilter = "all" | "available" | "unavailable" | "cancelled" | "inactive";
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
  return d.toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" });
}

function isAvailable(status: string): boolean {
  return status?.toLowerCase() === "available";
}

function formatFieldLabel(key: string): string {
  return key.replace(/([A-Z])/g, " $1").replace(/^./, (s) => s.toUpperCase()).trim();
}

function formatFieldValue(val: unknown): string {
  if (val === null || val === undefined) return "—";
  if (val instanceof Timestamp) return formatDate(val);
  if (typeof val === "object" && "latitude" in (val as object) && "longitude" in (val as object)) {
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

const BASE_FIELDS = new Set([
  "id", "gigType", "title", "description", "status", "category",
  "vacancy", "slot", "salary", "postedBy", "location", "createdAt", "applications",
]);

function statusBadgeClass(status: string): string {
  const s = status?.toLowerCase();
  if (s === "available") return "lg-badge--available";
  if (s === "completed") return "lg-badge--completed";
  if (s === "cancelled") return "lg-badge--cancelled";
  if (s === "no_worker") return "lg-badge--inactive";
  return "lg-badge--unavailable";
}

function statusLabel(status: string): string {
  const s = status?.toLowerCase();
  if (s === "available") return "Available";
  if (s === "no_worker") return "No Worker";
  if (!s) return "Unknown";
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function LiveGigsPage() {
  useAuthGuard({ module: "live-gigs" });
  const { user } = useAuth();

  const PAGE_SIZE = 10;

  const [gigs, setGigs] = useState<Gig[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [gigTypeFilter, setGigTypeFilter] = useState<GigTypeFilter>("all");
  const [sort, setSort] = useState<SortOption>("newest");
  const [page, setPage] = useState(1);
  const [inactiveDays, setInactiveDays] = useState("");
  const [filterPanelOpen, setFilterPanelOpen] = useState(false);

  const [detailGig, setDetailGig] = useState<Gig | null>(null);

  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkCancelOpen, setBulkCancelOpen] = useState(false);
  const [bulkCancelReason, setBulkCancelReason] = useState("");
  const [bulkCancelTicketID, setBulkCancelTicketID] = useState("N/A");
  const [bulkCancelling, setBulkCancelling] = useState(false);
  const [bulkCancelError, setBulkCancelError] = useState<string | null>(null);

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

  const cancellableSelected = useMemo(() => {
    return Array.from(selectedIds)
      .map((id) => gigs.find((g) => g.id === id))
      .filter((g): g is Gig =>
        !!g &&
        g.status?.toLowerCase() !== "cancelled" &&
        g.status?.toLowerCase() !== "completed"
      );
  }, [selectedIds, gigs]);

  const openBulkCancelModal = useCallback(() => {
    setBulkCancelReason("");
    setBulkCancelTicketID("N/A");
    setBulkCancelError(null);
    setBulkCancelOpen(true);
  }, []);

  const bulkCancelGigs = useCallback(async () => {
    if (bulkCancelling || cancellableSelected.length === 0) return;
    setBulkCancelling(true);
    setBulkCancelError(null);
    try {
      await Promise.all(
        cancellableSelected.map((gig) =>
          updateDoc(doc(db, GIG_COLLECTIONS[gig.gigType], gig.id), {
            status: "cancelled",
            cancelledByAdmin: true,
            cancellationReason: bulkCancelReason.trim() || null,
            cancellationTicketID: bulkCancelTicketID.trim() || "N/A",
          })
        )
      );
      setGigs((prev) =>
        prev.map((g) =>
          selectedIds.has(g.id) &&
          g.status?.toLowerCase() !== "cancelled" &&
          g.status?.toLowerCase() !== "completed"
            ? {
                ...g,
                status: "cancelled",
                cancelledByAdmin: true,
                cancellationReason: bulkCancelReason.trim() || undefined,
                cancellationTicketID: bulkCancelTicketID.trim() || "N/A",
              }
            : g
        )
      );
      await Promise.all(
        cancellableSelected.map((gig) =>
          writeLog({
            actorId: user!.uid,
            actorName: user!.displayName ?? "Unknown",
            actorEmail: user!.email ?? "",
            module: "gig_management",
            action: "gig_cancelled",
            description: buildDescription.gigCancelled(gig.title || "Untitled Gig", gig.gigType),
            targetId: gig.id,
            targetName: gig.title || "Untitled Gig",
            meta: {
              other: {
                gigType: gig.gigType,
                collection: GIG_COLLECTIONS[gig.gigType],
                cancellationReason: bulkCancelReason.trim() || null,
                cancellationTicketID: bulkCancelTicketID.trim() || "N/A",
                bulkCancel: true,
              },
            },
          })
        )
      );
      setSelectionMode(false);
      setSelectedIds(new Set());
      setBulkCancelOpen(false);
    } catch (err) {
      console.error("Bulk cancel failed:", err);
      setBulkCancelError("Some gigs could not be cancelled. Please try again.");
    } finally {
      setBulkCancelling(false);
    }
  }, [bulkCancelling, cancellableSelected, bulkCancelReason, bulkCancelTicketID, selectedIds, user]);

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
        prev.map((g) =>
          g.id === gig.id
            ? {
                ...g,
                status: "cancelled",
                cancelledByAdmin: true,
                cancellationReason: cancelReason.trim() || undefined,
                cancellationTicketID: cancelTicketID.trim() || undefined,
              }
            : g
        )
      );
      if (detailGig?.id === gig.id) {
        setDetailGig((prev) =>
          prev ? { ...prev, status: "cancelled", cancelledByAdmin: true,
            cancellationReason: cancelReason.trim() || undefined,
            cancellationTicketID: cancelTicketID.trim() || undefined } : prev
        );
      }
      await writeLog({
        actorId: user!.uid,
        actorName: user!.displayName ?? "Unknown",
        actorEmail: user!.email ?? "",
        module: "gig_management",
        action: "gig_cancelled",
        description: buildDescription.gigCancelled(gig.title || "Untitled Gig", gig.gigType),
        targetId: gig.id,
        targetName: gig.title || "Untitled Gig",
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
  }, [cancelModalGig, cancellingId, cancelReason, cancelTicketID, detailGig, user]);

  const fetchLiveGigs = useCallback(async () => {
    setLoading(true);
    setFetchError(null);
    try {
      const types: GigType[] = gigTypeFilter === "all"
        ? ["offered", "open", "quick"]
        : [gigTypeFilter];
      const snaps = await Promise.all(types.map((t) => getDocs(collection(db, GIG_COLLECTIONS[t]))));
      const rawGigs = snaps.flatMap((snap, i) =>
        snap.docs.map((d) => ({ id: d.id, gigType: types[i], ...d.data() }))
      ) as Omit<Gig, "applications">[];
      setGigs(rawGigs.map((g) => ({ ...g, applications: [] as Application[] })) as Gig[]);
    } catch (err) {
      console.error("Failed to fetch gigs:", err);
      setFetchError("Failed to load gigs. Please try again.");
    } finally {
      setLoading(false);
    }
  }, [gigTypeFilter]);

  useEffect(() => { fetchLiveGigs(); }, [fetchLiveGigs]);

  // ── Derived ──────────────────────────────────────────────────────────────────

  const filtered = useMemo(() => {
    let list = gigs.slice();
    if (gigTypeFilter !== "all") {
      list = list.filter((g) => g.gigType === gigTypeFilter);
    }
    if (statusFilter === "available") {
      list = list.filter((g) => isAvailable(g.status));
    } else if (statusFilter === "unavailable") {
      list = list.filter(
        (g) =>
          !isAvailable(g.status) &&
          g.status?.toLowerCase() !== "cancelled" &&
          g.status?.toLowerCase() !== "no_worker"
      );
    } else if (statusFilter === "cancelled") {
      list = list.filter((g) => g.status?.toLowerCase() === "cancelled");
    } else if (statusFilter === "inactive") {
      const days = parseInt(inactiveDays, 10);
      const cutoff = !isNaN(days) && days > 0 ? Date.now() - days * 24 * 60 * 60 * 1000 : null;
      list = list.filter((g) => {
        if (g.status?.toLowerCase() !== "no_worker") return false;
        if (cutoff === null) return true;
        const created = g.createdAt ? g.createdAt.toDate().getTime() : null;
        return created !== null && created <= cutoff;
      });
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
  }, [gigs, search, statusFilter, gigTypeFilter, sort, inactiveDays]);

  const stats = useMemo(() => {
    const total = gigs.length;
    const available = gigs.filter((g) => isAvailable(g.status)).length;
    const noWorker = gigs.filter((g) => g.status?.toLowerCase() === "no_worker").length;
    const cancelled = gigs.filter((g) => g.status?.toLowerCase() === "cancelled").length;
    const unavailable = total - available - noWorker - cancelled;
    return { total, available, unavailable: Math.max(0, unavailable), noWorker, cancelled };
  }, [gigs]);

  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (statusFilter !== "all") count++;
    if (gigTypeFilter !== "all") count++;
    return count;
  }, [statusFilter, gigTypeFilter]);

  const hasActiveFilter = !!(search || statusFilter !== "all" || gigTypeFilter !== "all" || inactiveDays);

  useEffect(() => {
    setPage(1);
    setSelectedIds(new Set());
  }, [search, statusFilter, gigTypeFilter, sort, inactiveDays]);

  useEffect(() => {
    const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
    if (page > totalPages) setPage(totalPages);
  }, [filtered.length, page]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));

  const paginated = useMemo(
    () => filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    [filtered, page]
  );

  const clearFilters = () => {
    setSearch("");
    setStatusFilter("all");
    setGigTypeFilter("all");
    setInactiveDays("");
  };

  const exitSelectionMode = () => {
    setSelectionMode(false);
    setSelectedIds(new Set());
  };

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <AdminLayout
      title="Live Gigs"
      subtitle="Monitor and manage all active gig postings"
      actions={
        <Button variant="ghost" size="sm" icon={RefreshCw} onClick={fetchLiveGigs} disabled={loading}>
          Refresh
        </Button>
      }
    >
      <style>{`
        /* ── Layout ── */
        .lg-wrap { display: flex; flex-direction: column; gap: 20px; padding: 24px; }

        /* ── Stats ── */
        .lg-stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: 12px; }
        .lg-stat {
          padding: 14px 16px; border-radius: var(--radius-md);
          background: var(--bg-surface); border: 1px solid var(--border);
          display: flex; flex-direction: column; gap: 4px;
          cursor: pointer; transition: border-color 0.15s, box-shadow 0.15s;
        }
        .lg-stat:not(.lg-stat--static):hover { border-color: var(--blue); box-shadow: 0 0 0 1px var(--blue); }
        .lg-stat--active { border-color: var(--blue) !important; box-shadow: 0 0 0 2px rgba(59,130,246,0.2); }
        .lg-stat--static { cursor: default !important; }
        .lg-stat-val { font-size: 22px; font-weight: 700; font-family: 'Space Mono', monospace; line-height: 1.2; }
        .lg-stat-label { font-size: 11px; color: var(--text-muted); font-weight: 500; text-transform: uppercase; letter-spacing: 0.05em; }

        /* ── Search + toolbar ── */
        .lg-toolbar { display: flex; align-items: center; gap: 10px; }
        .lg-search-wrap { flex: 1; position: relative; }
        .lg-search-icon { position: absolute; left: 10px; top: 50%; transform: translateY(-50%); color: var(--text-muted); pointer-events: none; }
        .lg-search {
          width: 100%; padding: 8px 12px 8px 34px;
          background: var(--bg-surface); border: 1px solid var(--border);
          border-radius: var(--radius-sm); color: var(--text-primary);
          font-size: 13px; font-family: inherit; transition: border 0.15s;
        }
        .lg-search:focus { outline: none; border-color: var(--blue); }
        .lg-search::placeholder { color: var(--text-muted); }

        /* ── Select mode button ── */
        .lg-select-btn {
          display: flex; align-items: center; gap: 6px; padding: 7px 12px;
          border: 1px solid var(--border); border-radius: var(--radius-sm);
          background: var(--bg-surface); color: var(--text-secondary);
          font-size: 12px; font-weight: 600; font-family: inherit; cursor: pointer;
          transition: all 0.12s; white-space: nowrap; flex-shrink: 0;
        }
        .lg-select-btn:hover { border-color: var(--blue); color: var(--blue); }
        .lg-select-btn--active { border-color: var(--blue); background: rgba(59,130,246,0.08); color: var(--blue); }

        /* ── Filter toggle button ── */
        .lg-filter-toggle {
          display: flex; align-items: center; gap: 6px; padding: 7px 12px;
          border: 1px solid var(--border); border-radius: var(--radius-sm);
          background: var(--bg-surface); color: var(--text-secondary);
          font-size: 12px; font-weight: 600; font-family: inherit; cursor: pointer;
          transition: all 0.12s; white-space: nowrap; flex-shrink: 0;
        }
        .lg-filter-toggle:hover { border-color: var(--blue); color: var(--blue); }
        .lg-filter-toggle--active { border-color: var(--blue); background: rgba(59,130,246,0.08); color: var(--blue); }
        .lg-filter-badge {
          background: var(--blue); color: white; border-radius: 10px;
          font-size: 10px; font-weight: 700; padding: 1px 6px; min-width: 16px; text-align: center;
        }

        /* ── Sort select ── */
        .lg-sort {
          padding: 7px 28px 7px 10px; appearance: none; flex-shrink: 0;
          background: var(--bg-surface) url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6'%3E%3Cpath d='M0 0l5 6 5-6z' fill='%23888'/%3E%3C/svg%3E") no-repeat right 9px center;
          border: 1px solid var(--border); border-radius: var(--radius-sm);
          color: var(--text-primary); font-size: 12px; font-family: inherit;
          cursor: pointer; transition: border 0.15s;
        }
        .lg-sort:focus { outline: none; border-color: var(--blue); }

        /* ── Filter panel ── */
        .lg-filter-panel {
          background: var(--bg-surface); border: 1px solid var(--border);
          border-radius: var(--radius-md); padding: 16px 20px;
          display: flex; flex-direction: column; gap: 14px;
          animation: lg-panel-in 0.15s ease;
        }
        @keyframes lg-panel-in { from { opacity: 0; transform: translateY(-6px); } to { opacity: 1; transform: translateY(0); } }
        .lg-filter-row { display: flex; align-items: flex-start; gap: 12px; flex-wrap: wrap; }
        .lg-filter-label { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-muted); width: 68px; flex-shrink: 0; padding-top: 6px; }
        .lg-filter-pills { display: flex; gap: 4px; flex-wrap: wrap; flex: 1; }
        .lg-pill {
          padding: 4px 12px; border: 1px solid var(--border); border-radius: 20px;
          background: transparent; color: var(--text-secondary); font-size: 12px;
          font-weight: 500; font-family: inherit; cursor: pointer; transition: all 0.12s;
          white-space: nowrap;
        }
        .lg-pill:hover:not(.lg-pill--active) { border-color: var(--blue); color: var(--blue); }
        .lg-pill--active {
          background: var(--blue); border-color: var(--blue); color: white; font-weight: 600;
        }
        .lg-pill--available.lg-pill--active { background: var(--green); border-color: var(--green); }
        .lg-pill--unavailable.lg-pill--active { background: var(--red); border-color: var(--red); }
        .lg-pill--cancelled.lg-pill--active { background: rgba(239,68,68,0.8); border-color: var(--red); }
        .lg-pill--inactive.lg-pill--active { background: rgba(245,158,11,0.9); border-color: var(--amber); }

        /* ── Inactive days input ── */
        .lg-days-wrap { display: flex; align-items: center; gap: 6px; margin-top: 4px; }
        .lg-days-label { font-size: 11px; color: var(--text-muted); }
        .lg-days-input {
          width: 60px; padding: 4px 8px; border: 1px solid var(--border); border-radius: var(--radius-sm);
          background: var(--bg-elevated); color: var(--text-primary); font-size: 12px; font-family: inherit;
        }
        .lg-days-input:focus { outline: none; border-color: var(--blue); }
        .lg-days-input::placeholder { color: var(--text-muted); }

        /* ── Active filter chips ── */
        .lg-chips { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
        .lg-chip {
          display: inline-flex; align-items: center; gap: 4px;
          padding: 3px 10px 3px 10px; border-radius: 20px;
          background: rgba(59,130,246,0.1); border: 1px solid rgba(59,130,246,0.25);
          color: var(--blue); font-size: 11px; font-weight: 600;
        }
        .lg-chip-x {
          display: inline-flex; align-items: center; justify-content: center;
          width: 14px; height: 14px; border-radius: 50%; background: rgba(59,130,246,0.2);
          border: none; color: var(--blue); cursor: pointer; font-size: 10px; line-height: 1;
          padding: 0; font-family: inherit; transition: background 0.1s;
        }
        .lg-chip-x:hover { background: rgba(59,130,246,0.4); }
        .lg-chips-clear { font-size: 11px; color: var(--text-muted); cursor: pointer; border: none; background: none; padding: 2px 6px; font-family: inherit; }
        .lg-chips-clear:hover { color: var(--text-primary); }

        /* ── Bulk action bar ── */
        .lg-bulk-bar {
          display: flex; align-items: center; gap: 12px; padding: 10px 16px;
          background: rgba(59,130,246,0.08); border: 1px solid rgba(59,130,246,0.25);
          border-radius: var(--radius-sm); font-size: 13px; color: var(--text-primary);
        }
        .lg-bulk-cancel-btn {
          padding: 5px 14px; border-radius: var(--radius-sm);
          border: 1px solid rgba(239,68,68,0.35); background: rgba(239,68,68,0.08);
          color: var(--red); font-size: 12px; font-weight: 600; font-family: inherit;
          cursor: pointer; transition: all 0.12s; white-space: nowrap;
        }
        .lg-bulk-cancel-btn:hover:not(:disabled) { background: rgba(239,68,68,0.18); border-color: var(--red); }
        .lg-bulk-cancel-btn:disabled { opacity: 0.4; cursor: not-allowed; }
        .lg-bulk-clear-btn {
          padding: 5px 10px; border-radius: var(--radius-sm);
          border: 1px solid var(--border); background: transparent;
          color: var(--text-muted); font-size: 12px; font-family: inherit; cursor: pointer;
        }
        .lg-bulk-clear-btn:hover { color: var(--text-primary); }

        /* ── Table card ── */
        .lg-card { background: var(--bg-surface); border: 1px solid var(--border); border-radius: var(--radius-md); overflow: hidden; }
        .lg-card-header { padding: 12px 20px; border-bottom: 1px solid var(--border); display: flex; align-items: center; justify-content: space-between; }
        .lg-card-title { font-size: 13px; font-weight: 700; color: var(--text-primary); }
        .lg-card-count { font-size: 11px; color: var(--text-muted); }

        /* ── Table ── */
        .lg-table { width: 100%; border-collapse: collapse; }
        .lg-table th {
          padding: 9px 14px; text-align: left; font-size: 11px; font-weight: 600;
          letter-spacing: 0.05em; text-transform: uppercase; color: var(--text-muted);
          border-bottom: 1px solid var(--border); background: var(--bg-elevated);
        }
        .lg-table td { padding: 11px 14px; border-bottom: 1px solid var(--border); vertical-align: middle; }
        .lg-row:last-child > td { border-bottom: none; }
        .lg-row { cursor: pointer; }
        .lg-row:hover > td { background: var(--bg-elevated); }

        /* ── Gig title cell ── */
        .lg-gig-title { font-size: 13px; font-weight: 600; color: var(--text-primary); }
        .lg-gig-meta { font-size: 11px; color: var(--text-muted); margin-top: 2px; display: flex; align-items: center; gap: 4px; }

        /* ── Badges ── */
        .lg-badge {
          display: inline-flex; align-items: center; gap: 4px;
          padding: 3px 8px; border-radius: 20px; font-size: 11px; font-weight: 600;
        }
        .lg-badge--available { background: rgba(16,185,129,0.12); color: var(--green); }
        .lg-badge--unavailable { background: rgba(239,68,68,0.12); color: var(--red); }
        .lg-badge--cancelled { background: rgba(239,68,68,0.1); color: var(--red); }
        .lg-badge--completed { background: rgba(59,130,246,0.12); color: var(--blue); }
        .lg-badge--inactive { background: rgba(245,158,11,0.12); color: var(--amber); }
        .lg-badge--category { background: rgba(59,130,246,0.12); color: var(--blue); }
        .lg-badge--pending { background: rgba(245,158,11,0.12); color: var(--amber); }
        .lg-badge--accepted { background: rgba(16,185,129,0.12); color: var(--green); }
        .lg-badge--rejected { background: rgba(239,68,68,0.12); color: var(--red); }
        .lg-badge--type-offered { background: rgba(245,158,11,0.12); color: var(--amber); }
        .lg-badge--type-open { background: rgba(59,130,246,0.12); color: var(--blue); }
        .lg-badge--type-quick { background: rgba(139,92,246,0.12); color: var(--purple); }
        .lg-badge-dot { width: 5px; height: 5px; border-radius: 50%; background: currentColor; flex-shrink: 0; }

        /* ── Row actions ── */
        .lg-actions { display: flex; align-items: center; gap: 6px; }
        .lg-view-btn {
          padding: 4px 8px; border-radius: var(--radius-sm);
          border: 1px solid var(--border); background: transparent;
          color: var(--text-muted); font-size: 11px; font-family: inherit;
          cursor: pointer; transition: all 0.12s; display: flex; align-items: center; gap: 4px;
        }
        .lg-view-btn:hover { border-color: var(--blue); color: var(--blue); background: rgba(59,130,246,0.06); }
        .lg-cancel-btn {
          padding: 4px 10px; border-radius: var(--radius-sm);
          border: 1px solid rgba(239,68,68,0.35); background: rgba(239,68,68,0.08);
          color: var(--red); font-size: 11px; font-weight: 600; font-family: inherit;
          cursor: pointer; transition: all 0.12s; white-space: nowrap;
        }
        .lg-cancel-btn:hover:not(:disabled) { background: rgba(239,68,68,0.18); border-color: var(--red); }
        .lg-cancel-btn:disabled { opacity: 0.5; cursor: not-allowed; }

        /* ── Checkbox ── */
        .lg-checkbox { width: 15px; height: 15px; cursor: pointer; accent-color: var(--blue); }

        /* ── Number chip ── */
        .lg-num { font-family: 'Space Mono', monospace; font-size: 12px; font-weight: 700; color: var(--text-primary); }
        .lg-num-label { font-size: 11px; color: var(--text-muted); margin-left: 3px; }

        /* ── Empty / Loading ── */
        .lg-empty { padding: 60px 24px; text-align: center; color: var(--text-muted); }
        .lg-empty-icon { display: flex; justify-content: center; margin-bottom: 12px; opacity: 0.3; }
        .lg-empty-title { font-size: 14px; font-weight: 600; color: var(--text-secondary); margin-bottom: 4px; }
        .lg-empty-sub { font-size: 12px; }
        .lg-skeleton { background: var(--bg-elevated); border-radius: 6px; animation: lg-pulse 1.4s ease-in-out infinite; }
        @keyframes lg-pulse { 0%,100% { opacity: 0.4; } 50% { opacity: 0.9; } }

        /* ── Pagination ── */
        .lg-pagination {
          display: flex; align-items: center; justify-content: space-between;
          padding: 12px 20px; border-top: 1px solid var(--border); flex-wrap: wrap; gap: 10px;
        }
        .lg-page-info { font-size: 12px; color: var(--text-muted); }
        .lg-page-controls { display: flex; align-items: center; gap: 4px; }
        .lg-page-btn {
          min-width: 32px; height: 32px; padding: 0 8px;
          border: 1px solid var(--border); border-radius: var(--radius-sm);
          background: var(--bg-elevated); color: var(--text-secondary);
          font-size: 12px; font-weight: 600; font-family: inherit;
          cursor: pointer; transition: all 0.12s; display: flex; align-items: center; justify-content: center;
        }
        .lg-page-btn:hover:not(:disabled):not(.lg-page-btn--active) { background: var(--bg-hover); color: var(--text-primary); }
        .lg-page-btn:disabled { opacity: 0.35; cursor: not-allowed; }
        .lg-page-btn--active { background: var(--blue); border-color: var(--blue); color: white; }
        .lg-page-ellipsis { font-size: 12px; color: var(--text-muted); padding: 0 4px; }

        /* ── Gig detail modal ── */
        .gd-header { display: flex; align-items: flex-start; gap: 12px; margin-bottom: 20px; padding-bottom: 16px; border-bottom: 1px solid var(--border); }
        .gd-header-info { flex: 1; }
        .gd-title { font-size: 17px; font-weight: 700; color: var(--text-primary); margin-bottom: 6px; line-height: 1.3; }
        .gd-tags { display: flex; flex-wrap: wrap; gap: 6px; }
        .gd-section { margin-bottom: 20px; }
        .gd-section-title { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.07em; color: var(--text-muted); margin-bottom: 10px; }
        .gd-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 12px; }
        .gd-field { display: flex; flex-direction: column; gap: 3px; }
        .gd-field-label { font-size: 10px; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.05em; font-weight: 600; }
        .gd-field-val { font-size: 13px; color: var(--text-primary); font-weight: 500; word-break: break-word; }
        .gd-desc { font-size: 13px; color: var(--text-secondary); line-height: 1.65; }
        .gd-applicant { display: flex; align-items: center; justify-content: space-between; padding: 8px 12px; background: var(--bg-elevated); border-radius: var(--radius-sm); border: 1px solid var(--border); margin-bottom: 6px; }
        .gd-applicant-name { font-size: 13px; color: var(--text-primary); font-weight: 500; }
        .gd-applicant-date { font-size: 11px; color: var(--text-muted); margin-top: 1px; }
        .gd-cancel-info { padding: 10px 14px; background: rgba(239,68,68,0.06); border: 1px solid rgba(239,68,68,0.2); border-radius: var(--radius-sm); }
        .gd-cancel-info-row { font-size: 12px; color: var(--text-secondary); margin-bottom: 3px; }
        .gd-cancel-info-row:last-child { margin-bottom: 0; }
        .gd-cancel-info-key { font-weight: 700; color: var(--text-muted); }

        /* ── Modal form ── */
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

        {/* ── Stats bar ── */}
        <div className="lg-stats">
          <StatCard
            value={stats.total} label="Total Gigs" color="var(--blue)" loading={loading}
            active={false}
          />
          <StatCard
            value={stats.available} label="Available" color="var(--green)" loading={loading}
            active={statusFilter === "available"}
            onClick={() => setStatusFilter(statusFilter === "available" ? "all" : "available")}
          />
          <StatCard
            value={stats.unavailable} label="Unavailable" color="var(--red)" loading={loading}
            active={statusFilter === "unavailable"}
            onClick={() => setStatusFilter(statusFilter === "unavailable" ? "all" : "unavailable")}
          />
          <StatCard
            value={stats.noWorker} label="No Worker" color="var(--amber)" loading={loading}
            active={statusFilter === "inactive"}
            onClick={() => { setStatusFilter(statusFilter === "inactive" ? "all" : "inactive"); setInactiveDays(""); }}
          />
          <StatCard
            value={stats.cancelled} label="Cancelled" color="var(--text-muted)" loading={loading}
            active={statusFilter === "cancelled"}
            onClick={() => setStatusFilter(statusFilter === "cancelled" ? "all" : "cancelled")}
          />
        </div>

        {/* ── Search + toolbar ── */}
        <div className="lg-toolbar">
          <div className="lg-search-wrap">
            <Search size={13} className="lg-search-icon" />
            <input
              className="lg-search"
              placeholder="Search title, category, posted by, location…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          <button
            className={`lg-filter-toggle${filterPanelOpen || activeFilterCount > 0 ? " lg-filter-toggle--active" : ""}`}
            onClick={() => setFilterPanelOpen((o) => !o)}
          >
            <SlidersHorizontal size={13} />
            Filters
            {activeFilterCount > 0 && (
              <span className="lg-filter-badge">{activeFilterCount}</span>
            )}
          </button>

          <button
            className={`lg-select-btn${selectionMode ? " lg-select-btn--active" : ""}`}
            onClick={() => selectionMode ? exitSelectionMode() : setSelectionMode(true)}
          >
            {selectionMode ? <>✕ Cancel Select</> : <>☑ Select</>}
          </button>

          <select
            className="lg-sort"
            value={sort}
            onChange={(e) => setSort(e.target.value as SortOption)}
            title="Sort"
          >
            <option value="newest">Newest</option>
            <option value="oldest">Oldest</option>
            <option value="pay-high">Highest Pay</option>
            <option value="pay-low">Lowest Pay</option>
          </select>
        </div>

        {/* ── Filter panel ── */}
        {filterPanelOpen && (
          <div className="lg-filter-panel">
            <div className="lg-filter-row">
              <span className="lg-filter-label">Type</span>
              <div className="lg-filter-pills">
                {(["all", "open", "offered", "quick"] as GigTypeFilter[]).map((f) => (
                  <button
                    key={f}
                    className={`lg-pill${gigTypeFilter === f ? " lg-pill--active" : ""}`}
                    onClick={() => setGigTypeFilter(f)}
                  >
                    {f === "all" ? "All Types" : GIG_TYPE_LABELS[f as GigType]}
                  </button>
                ))}
              </div>
            </div>

            <div className="lg-filter-row">
              <span className="lg-filter-label">Status</span>
              <div style={{ flex: 1 }}>
                <div className="lg-filter-pills">
                  {([
                    { val: "all", label: "All" },
                    { val: "available", label: "Available" },
                    { val: "unavailable", label: "Unavailable" },
                    { val: "cancelled", label: "Cancelled" },
                    { val: "inactive", label: "No Worker" },
                  ] as { val: StatusFilter; label: string }[]).map(({ val, label }) => (
                    <button
                      key={val}
                      className={`lg-pill lg-pill--${val}${statusFilter === val ? " lg-pill--active" : ""}`}
                      onClick={() => {
                        setStatusFilter(val);
                        if (val !== "inactive") setInactiveDays("");
                      }}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                {statusFilter === "inactive" && (
                  <div className="lg-days-wrap">
                    <span className="lg-days-label">Inactive for</span>
                    <input
                      type="number"
                      min="1"
                      className="lg-days-input"
                      placeholder="any"
                      value={inactiveDays}
                      onChange={(e) => setInactiveDays(e.target.value)}
                    />
                    <span className="lg-days-label">days (blank = all)</span>
                  </div>
                )}
              </div>
            </div>

            {hasActiveFilter && (
              <div style={{ display: "flex", justifyContent: "flex-end" }}>
                <button className="lg-chips-clear" onClick={clearFilters}>
                  Clear all filters
                </button>
              </div>
            )}
          </div>
        )}

        {/* ── Active filter chips ── */}
        {hasActiveFilter && (
          <div className="lg-chips">
            {search && (
              <span className="lg-chip">
                Search: "{search.length > 20 ? search.slice(0, 20) + "…" : search}"
                <button className="lg-chip-x" onClick={() => setSearch("")}>×</button>
              </span>
            )}
            {gigTypeFilter !== "all" && (
              <span className="lg-chip">
                {GIG_TYPE_LABELS[gigTypeFilter as GigType]} Gigs
                <button className="lg-chip-x" onClick={() => setGigTypeFilter("all")}>×</button>
              </span>
            )}
            {statusFilter !== "all" && (
              <span className="lg-chip">
                {statusFilter === "inactive"
                  ? `No Worker${inactiveDays ? ` · ${inactiveDays}d+` : ""}`
                  : statusFilter.charAt(0).toUpperCase() + statusFilter.slice(1)}
                <button className="lg-chip-x" onClick={() => { setStatusFilter("all"); setInactiveDays(""); }}>×</button>
              </span>
            )}
            <button className="lg-chips-clear" onClick={clearFilters}>Clear all</button>
          </div>
        )}

        {/* ── Bulk action bar ── */}
        {selectedIds.size > 0 && (
          <div className="lg-bulk-bar">
            <span style={{ fontWeight: 600 }}>{selectedIds.size} selected</span>
            {cancellableSelected.length < selectedIds.size && (
              <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
                ({cancellableSelected.length} cancellable)
              </span>
            )}
            <button
              className="lg-bulk-cancel-btn"
              onClick={openBulkCancelModal}
              disabled={cancellableSelected.length === 0}
            >
              Cancel {cancellableSelected.length} Gig{cancellableSelected.length !== 1 ? "s" : ""}
            </button>
            <button className="lg-bulk-clear-btn" onClick={exitSelectionMode}>
              Exit selection
            </button>
          </div>
        )}

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
                  {selectionMode && (
                    <th style={{ width: 36 }}>
                      <input
                        type="checkbox"
                        className="lg-checkbox"
                        checked={paginated.length > 0 && paginated.every((g) => selectedIds.has(g.id))}
                        onChange={(e) => {
                          setSelectedIds((prev) => {
                            const next = new Set(prev);
                            if (e.target.checked) paginated.forEach((g) => next.add(g.id));
                            else paginated.forEach((g) => next.delete(g.id));
                            return next;
                          });
                        }}
                        title="Select all on this page"
                      />
                    </th>
                  )}
                  <th>Gig</th>
                  <th>Type</th>
                  <th>Status</th>
                  <th>Applications</th>
                  <th>Posted</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {paginated.map((gig) => {
                  const appCount = gig.applications?.length ?? 0;
                  const loc = formatLocation(gig.location);
                  return (
                    <tr
                      key={gig.id}
                      className="lg-row"
                      onClick={() => setDetailGig(gig)}
                    >
                      {selectionMode && (
                        <td onClick={(e) => e.stopPropagation()}>
                          <input
                            type="checkbox"
                            className="lg-checkbox"
                            checked={selectedIds.has(gig.id)}
                            onChange={(e) => {
                              setSelectedIds((prev) => {
                                const next = new Set(prev);
                                e.target.checked ? next.add(gig.id) : next.delete(gig.id);
                                return next;
                              });
                            }}
                          />
                        </td>
                      )}
                      <td>
                        <div className="lg-gig-title">{gig.title || "Untitled Gig"}</div>
                        {loc ? (
                          <div className="lg-gig-meta"><MapPin size={10} />{loc}</div>
                        ) : gig.postedBy ? (
                          <div className="lg-gig-meta">by {gig.postedBy}</div>
                        ) : null}
                      </td>
                      <td>
                        <span className={`lg-badge lg-badge--type-${gig.gigType}`}>
                          {GIG_TYPE_LABELS[gig.gigType]}
                        </span>
                      </td>
                      <td>
                        <span className={`lg-badge ${statusBadgeClass(gig.status)}`}>
                          <span className="lg-badge-dot" />
                          {statusLabel(gig.status)}
                        </span>
                      </td>
                      <td>
                        <span className="lg-num">{appCount}</span>
                        {appCount > 0 && (
                          <span className="lg-num-label">{appCount === 1 ? "app" : "apps"}</span>
                        )}
                      </td>
                      <td>
                        <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
                          {formatDateShort(gig.createdAt)}
                        </span>
                      </td>
                      <td onClick={(e) => e.stopPropagation()}>
                        <div className="lg-actions">
                          <button
                            className="lg-view-btn"
                            onClick={() => setDetailGig(gig)}
                          >
                            <Eye size={11} /> View
                          </button>
                          {gig.status?.toLowerCase() !== "cancelled" &&
                            gig.status?.toLowerCase() !== "completed" && (
                            <button
                              className="lg-cancel-btn"
                              disabled={cancellingId === gig.id}
                              onClick={() => openCancelModal(gig)}
                            >
                              {cancellingId === gig.id ? "…" : "Cancel"}
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
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
                <button className="lg-page-btn" onClick={() => setPage(1)} disabled={page === 1} title="First">«</button>
                <button className="lg-page-btn" onClick={() => setPage((p) => p - 1)} disabled={page === 1} title="Prev">‹</button>
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
                <button className="lg-page-btn" onClick={() => setPage((p) => p + 1)} disabled={page === totalPages} title="Next">›</button>
                <button className="lg-page-btn" onClick={() => setPage(totalPages)} disabled={page === totalPages} title="Last">»</button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Gig Detail Modal ── */}
      {detailGig && (
        <GigDetailModal
          gig={detailGig}
          cancellingId={cancellingId}
          cancelError={cancelError}
          onCancel={() => openCancelModal(detailGig)}
          onClose={() => { setDetailGig(null); setCancelError(null); }}
        />
      )}

      {/* ── Bulk Cancel Modal ── */}
      {bulkCancelOpen && (
        <Modal
          open
          onClose={() => { if (!bulkCancelling) { setBulkCancelOpen(false); setBulkCancelError(null); } }}
          title={`Cancel ${cancellableSelected.length} Gig${cancellableSelected.length !== 1 ? "s" : ""}`}
          description={`This will cancel ${cancellableSelected.length} selected gig${cancellableSelected.length !== 1 ? "s" : ""}. This cannot be undone.`}
          size="sm"
          footer={
            <>
              <Button variant="ghost" size="sm" onClick={() => { setBulkCancelOpen(false); setBulkCancelError(null); }} disabled={bulkCancelling}>
                Dismiss
              </Button>
              <Button variant="danger" size="sm" loading={bulkCancelling} onClick={bulkCancelGigs}>
                Confirm Cancel All
              </Button>
            </>
          }
        >
          <div className="cgm-field">
            <label className="cgm-label">Ticket ID</label>
            <input className="cgm-input" placeholder="N/A" value={bulkCancelTicketID} onChange={(e) => setBulkCancelTicketID(e.target.value)} disabled={bulkCancelling} />
          </div>
          <div className="cgm-field" style={{ marginBottom: 0 }}>
            <label className="cgm-label">Cancellation Reason</label>
            <textarea className="cgm-input cgm-textarea" placeholder="Describe why these gigs are being cancelled…" value={bulkCancelReason} onChange={(e) => setBulkCancelReason(e.target.value)} disabled={bulkCancelling} />
          </div>
          {bulkCancelError && <div className="cgm-error">{bulkCancelError}</div>}
        </Modal>
      )}

      {/* ── Single Cancel Modal ── */}
      {cancelModalGig && (
        <Modal
          open
          onClose={() => { if (!cancellingId) { setCancelModalGig(null); setCancelError(null); } }}
          title="Cancel Gig"
          description={`"${cancelModalGig.title || "Untitled Gig"}" · ${GIG_TYPE_LABELS[cancelModalGig.gigType]}`}
          size="sm"
          footer={
            <>
              <Button variant="ghost" size="sm" onClick={() => { setCancelModalGig(null); setCancelError(null); }} disabled={!!cancellingId}>
                Dismiss
              </Button>
              <Button variant="danger" size="sm" loading={!!cancellingId} onClick={cancelGig}>
                Confirm Cancel
              </Button>
            </>
          }
        >
          <div className="cgm-field">
            <label className="cgm-label">Cancellation Ticket ID</label>
            <input className="cgm-input" placeholder="e.g. TKT-00123" value={cancelTicketID} onChange={(e) => setCancelTicketId(e.target.value)} disabled={!!cancellingId} />
          </div>
          <div className="cgm-field" style={{ marginBottom: 0 }}>
            <label className="cgm-label">Cancellation Reason</label>
            <textarea className="cgm-input cgm-textarea" placeholder="Describe why this gig is being cancelled…" value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} disabled={!!cancellingId} />
          </div>
          {cancelError && <div className="cgm-error">{cancelError}</div>}
        </Modal>
      )}
    </AdminLayout>
  );
}

// ─── Stat Card ────────────────────────────────────────────────────────────────

const StatCard = memo(function StatCard({
  value, label, color, loading, active, onClick,
}: {
  value: number; label: string; color: string; loading: boolean;
  active?: boolean; onClick?: () => void;
}) {
  return (
    <div
      className={`lg-stat${active ? " lg-stat--active" : ""}${!onClick ? " lg-stat--static" : ""}`}
      style={{ borderLeft: `3px solid ${color}` }}
      onClick={onClick}
      title={onClick ? `Filter by ${label}` : undefined}
    >
      {loading ? (
        <div className="lg-skeleton" style={{ height: 24, width: "50%", marginBottom: 4 }} />
      ) : (
        <div className="lg-stat-val" style={{ color }}>{value}</div>
      )}
      <div className="lg-stat-label">{label}</div>
    </div>
  );
});

// ─── Gig Detail Modal ─────────────────────────────────────────────────────────

function GigDetailModal({
  gig, cancellingId, cancelError, onCancel, onClose,
}: {
  gig: Gig;
  cancellingId: string | null;
  cancelError: string | null;
  onCancel: () => void;
  onClose: () => void;
}) {
  const isCancelled = gig.status?.toLowerCase() === "cancelled";
  const isCompleted = gig.status?.toLowerCase() === "completed";
  const canCancel = !isCancelled && !isCompleted;

  const accepted = gig.applications?.filter((a) => a.status === "accepted").length ?? 0;
  const pending  = gig.applications?.filter((a) => a.status === "pending").length ?? 0;
  const rejected = gig.applications?.filter((a) => a.status === "rejected").length ?? 0;

  const extraFields = Object.entries(gig).filter(
    ([key, val]) =>
      !BASE_FIELDS.has(key) &&
      !["cancelledByAdmin", "cancellationReason", "cancellationTicketID"].includes(key) &&
      val !== null && val !== undefined && val !== "" && !Array.isArray(val)
  );

  return (
    <Modal
      open
      onClose={onClose}
      title="Gig Details"
      size="lg"
      footer={
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%" }}>
          <div>
            {canCancel && (
              <Button
                variant="danger"
                size="sm"
                loading={cancellingId === gig.id}
                onClick={onCancel}
              >
                Cancel Gig
              </Button>
            )}
          </div>
          <Button variant="ghost" size="sm" onClick={onClose}>Close</Button>
        </div>
      }
    >
      {/* Header */}
      <div className="gd-header">
        <div className="gd-header-info">
          <div className="gd-title">{gig.title || "Untitled Gig"}</div>
          <div className="gd-tags">
            <span className={`lg-badge lg-badge--type-${gig.gigType}`}>
              {GIG_TYPE_LABELS[gig.gigType]} Gig
            </span>
            {gig.category && (
              <span className="lg-badge lg-badge--category">{gig.category}</span>
            )}
            <span className={`lg-badge ${statusBadgeClass(gig.status)}`}>
              <span className="lg-badge-dot" />
              {statusLabel(gig.status)}
            </span>
          </div>
        </div>
      </div>

      {/* Cancellation info */}
      {isCancelled && gig.cancelledByAdmin && (
        <div className="gd-cancel-info" style={{ marginBottom: 20 }}>
          <div className="gd-cancel-info-row">
            <span className="gd-cancel-info-key">Cancelled by: </span>Admin
          </div>
          {gig.cancellationTicketID && (
            <div className="gd-cancel-info-row">
              <span className="gd-cancel-info-key">Ticket ID: </span>{gig.cancellationTicketID}
            </div>
          )}
          {gig.cancellationReason && (
            <div className="gd-cancel-info-row">
              <span className="gd-cancel-info-key">Reason: </span>{gig.cancellationReason}
            </div>
          )}
        </div>
      )}

      {/* Description */}
      {gig.description && (
        <div className="gd-section">
          <div className="gd-section-title">Description</div>
          <div className="gd-desc">{String(gig.description)}</div>
        </div>
      )}

      {/* Core details */}
      <div className="gd-section">
        <div className="gd-section-title">Details</div>
        <div className="gd-grid">
          {gig.postedBy && (
            <div className="gd-field">
              <span className="gd-field-label">Posted by</span>
              <span className="gd-field-val">{String(gig.postedBy)}</span>
            </div>
          )}
          {formatLocation(gig.location) && (
            <div className="gd-field">
              <span className="gd-field-label">Location</span>
              <span className="gd-field-val" style={{ display: "flex", alignItems: "center", gap: 4 }}>
                <MapPin size={11} style={{ color: "var(--text-muted)", flexShrink: 0 }} />
                {formatLocation(gig.location)}
              </span>
            </div>
          )}
          <div className="gd-field">
            <span className="gd-field-label">Posted</span>
            <span className="gd-field-val" style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <Calendar size={11} style={{ color: "var(--text-muted)", flexShrink: 0 }} />
              {formatDate(gig.createdAt)}
            </span>
          </div>
          {gig.salary !== undefined && gig.salary !== null && gig.salary !== "" && (
            <div className="gd-field">
              <span className="gd-field-label">Salary</span>
              <span className="gd-field-val" style={{ display: "flex", alignItems: "center", gap: 4 }}>
                <DollarSign size={11} style={{ color: "var(--text-muted)", flexShrink: 0 }} />
                {gig.salary}
              </span>
            </div>
          )}
          {gig.vacancy !== undefined && (
            <div className="gd-field">
              <span className="gd-field-label">Vacancies</span>
              <span className="gd-field-val" style={{ display: "flex", alignItems: "center", gap: 4 }}>
                <Users size={11} style={{ color: "var(--text-muted)", flexShrink: 0 }} />
                {gig.vacancy ?? "—"}
              </span>
            </div>
          )}
          {gig.slot !== undefined && (
            <div className="gd-field">
              <span className="gd-field-label">Slots</span>
              <span className="gd-field-val">{gig.slot ?? "—"}</span>
            </div>
          )}
        </div>
      </div>

      {/* Additional fields */}
      {extraFields.length > 0 && (
        <div className="gd-section">
          <div className="gd-section-title">Additional Details</div>
          <div className="gd-grid">
            {extraFields.map(([key, val]) => (
              <div key={key} className="gd-field">
                <span className="gd-field-label" style={{ display: "flex", alignItems: "center", gap: 4 }}>
                  <Tag size={9} style={{ color: "var(--text-muted)" }} />
                  {formatFieldLabel(key)}
                </span>
                <span className="gd-field-val">{formatFieldValue(val)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Applications */}
      <div className="gd-section" style={{ marginBottom: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
          <span className="gd-section-title" style={{ marginBottom: 0 }}>
            Applications ({gig.applications?.length ?? 0})
          </span>
          <div style={{ display: "flex", gap: 6 }}>
            {accepted > 0 && <span className="lg-badge lg-badge--accepted">{accepted} accepted</span>}
            {pending > 0 && <span className="lg-badge lg-badge--pending">{pending} pending</span>}
            {rejected > 0 && <span className="lg-badge lg-badge--rejected">{rejected} rejected</span>}
          </div>
        </div>
        {(gig.applications?.length ?? 0) === 0 ? (
          <div style={{ fontSize: 12, color: "var(--text-muted)", fontStyle: "italic" }}>
            No applications yet.
          </div>
        ) : (
          gig.applications.map((app) => (
            <div key={app.id} className="gd-applicant">
              <div>
                <div className="gd-applicant-name">{app.applicantName}</div>
                {app.appliedAt && (
                  <div className="gd-applicant-date">Applied {formatDate(app.appliedAt)}</div>
                )}
              </div>
              <span className={`lg-badge ${
                app.status === "accepted" ? "lg-badge--accepted"
                : app.status === "rejected" ? "lg-badge--rejected"
                : "lg-badge--pending"
              }`}>
                {app.status}
              </span>
            </div>
          ))
        )}
      </div>

      {cancelError && (
        <div className="cgm-error" style={{ marginTop: 12 }}>{cancelError}</div>
      )}
    </Modal>
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
          <div className="lg-skeleton" style={{ height: 13, width: 60 }} />
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
          ? "Try adjusting your search, status, or type filter."
          : "Gigs posted on the platform will appear here."}
      </div>
    </div>
  );
});
