"use client";

import { Suspense } from "react";
import { useState, useEffect, useCallback, useMemo, memo, useRef } from "react";
import { useSearchParams } from "next/navigation";
import AdminLayout from "@/components/layout/AdminLayout";
import Button from "@/components/ui/Button";
import Modal from "@/components/ui/Modal";
import {
  collection,
  collectionGroup,
  query,
  where,
  getDocs,
  getDoc,
  Timestamp,
  doc,
  updateDoc,
  deleteField,
  serverTimestamp,
  arrayUnion,
} from "firebase/firestore";
import { db, auth } from "@/lib/firebase";
import {
  Briefcase,
  Search,
  RefreshCw,
  MapPin,
  Filter,
  SlidersHorizontal,
  Users,
  Calendar,
  Tag,
  Timer,
  Tags,
  Copy,
  Check,
} from "lucide-react";
import { useAuthGuard } from "@/hooks/useAuthGuard";
import { useAuth } from "@/context/AuthContext";
import { useCurrency } from "@/context/CurrencyContext";
import { writeLog, buildDescription } from "@/lib/activitylog";
import { toast } from "@/components/ui/Toaster";
import { callableError } from "@/lib/gigPoints";
import {
  assignGigTaskType, backfillGigCodes, explainGsku, watchGsinCatalog,
  type GigCollection, type GsinCategory, type GsinSubcategory, type GsinTaskType,
} from "@/lib/gsin";

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
  cancelledByAdminId?: string;
  cancelledByAdminName?: string;
  cancellationReason?: string;
  cancellationTicketID?: string;
  cancellationRequestedAt?: Timestamp | null;
  cancelledAt?: Timestamp | null;
  cancellation_reason?: Array<{ approved: boolean | null; reason: string; requestedBy: string }>;
  // GSIN codes (admin-only; written by Cloud Functions — see functions/src/gsin.ts)
  taskTypeId?: string;
  gsins?: string;
  gsku?: string;
  gsinCandidates?: string[]; // skill is linked to several task types → admin picks
}

type Gig = GigBase & Record<string, unknown>;

type StatusFilter = "all" | "completed" | "in_progress" | "cancelled" | "inactive" | "expired";
type GigTypeFilter = "all" | GigType;
type SortOption = "newest" | "oldest" | "pay-high" | "pay-low";
type ActiveTab = "cancellation_requests" | "worker_cancellation_requests" | "all_gigs";

// Per-worker cancellation request on a multi-worker gig, stored at
// {gigCollection}/{gigId}/workers/{workerId} — resolved via a collectionGroup query.
interface WorkerCancellationRequest {
  workerId: string;
  gigId: string;
  gigType: GigType;
  workerDocPath: string;
  status: string;
  lastProgressStatus?: string;
  cancellationRequestedAt: Timestamp | null;
  cancellation_reason: Array<{ approved: boolean | null; reason: string; requestedBy: string; approvedBy?: string }>;
  workerName?: string;
  gigTitle: string;
  hostName: string;
}

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

async function applyDeclineSuspension(workerId: string): Promise<void> {
  const _d = new Date();
  const today = `${_d.getFullYear()}-${String(_d.getMonth() + 1).padStart(2, "0")}-${String(_d.getDate()).padStart(2, "0")}`;

  const userRef = doc(db, "users", workerId);
  const userSnap = await getDoc(userRef);
  const userData = userSnap.data() ?? {};
  const storedDate = userData.decline_count_date as string | undefined;
  const currentCount = storedDate === today ? ((userData.decline_count as number) ?? 0) : 0;
  const newDeclineCount = currentCount + 1;

  await updateDoc(userRef, {
    decline_count: newDeclineCount,
    decline_count_date: today,
  });

  const configSnap = await getDoc(doc(db, "quick_gig_config", "decline_suspension"));
  if (!configSnap.exists()) return;
  const config = configSnap.data();
  if (!config.suspension_enabled) return;

  const freeLimit: number = config.free_decline_limit ?? 0;
  const tierTable: Array<{ decline_count_trigger: number; suspension_duration_minutes: number }> =
    config.suspension_tier_table ?? [];

  if (newDeclineCount <= freeLimit) return;
  const declinesOverLimit = newDeclineCount - freeLimit;

  let matchedTier: { decline_count_trigger: number; suspension_duration_minutes: number } | null = null;
  for (const tier of tierTable) {
    if (
      declinesOverLimit >= tier.decline_count_trigger &&
      (!matchedTier || tier.decline_count_trigger > matchedTier.decline_count_trigger)
    ) {
      matchedTier = tier;
    }
  }
  if (!matchedTier) return;

  const newSuspendedUntil = Timestamp.fromMillis(
    Date.now() + matchedTier.suspension_duration_minutes * 60 * 1000
  );
  const existingSuspendedUntil = userData.suspended_until as Timestamp | undefined;
  if (existingSuspendedUntil && existingSuspendedUntil.toMillis() > newSuspendedUntil.toMillis()) return;

  await updateDoc(userRef, {
    suspended_until: newSuspendedUntil,
    seekingQuickGigs: false,
    slot: "AVAILABLE",
  });
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

const GIG_COLLECTIONS_INVERSE: Record<string, GigType> = Object.fromEntries(
  Object.entries(GIG_COLLECTIONS).map(([k, v]) => [v, k])
) as Record<string, GigType>;

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
  if (s === "expired") return "lg-badge--expired";
  if (s === "cancellation_requested") return "lg-badge--cancel-req";
  return "lg-badge--unavailable";
}

function statusLabel(status: string): string {
  const s = status?.toLowerCase();
  if (s === "available") return "Available";
  if (s === "no_worker") return "No Worker";
  if (s === "cancellation_requested") return "Cancel Requested";
  if (!s) return "Unknown";
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ─── Page ─────────────────────────────────────────────────────────────────────

function LiveGigsPageInner() {
  useAuthGuard({ module: "live-gigs" });
  const { user } = useAuth();
  const { symbol } = useCurrency();
  const searchParams = useSearchParams();

  const PAGE_SIZE = 20;

  const [activeTab, setActiveTab] = useState<ActiveTab>("cancellation_requests");

  useEffect(() => {
    const tabParam = searchParams.get("tab");
    if (tabParam === "cancellation_requests" || tabParam === "worker_cancellation_requests" || tabParam === "all_gigs") {
      setActiveTab(tabParam);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [gigs, setGigs] = useState<Gig[]>([]);
  const recentlyCancelledRef = useRef<Set<string>>(new Set());
  const isCancellingRef = useRef(false);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [gigTypeFilter, setGigTypeFilter] = useState<GigTypeFilter>("all");
  const [sort, setSort] = useState<SortOption>("newest");
  const [page, setPage] = useState(1);
  const [inactiveDays, setInactiveDays] = useState("");
  const [postedByFilter, setPostedByFilter] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [filterPanelOpen, setFilterPanelOpen] = useState(false);

  const [detailGig, setDetailGig] = useState<Gig | null>(null);

  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkCancelOpen, setBulkCancelOpen] = useState(false);
  const [bulkCancelReason, setBulkCancelReason] = useState("");
  const [bulkCancelTicketID, setBulkCancelTicketID] = useState("N/A");
  const [bulkCancelling, setBulkCancelling] = useState(false);
  const [bulkCancelError, setBulkCancelError] = useState<string | null>(null);

  // ── Cancellation Requests tab bulk selection ──
  const [crSelectedIds, setCrSelectedIds] = useState<Set<string>>(new Set());
  const [crBulkOpen, setCrBulkOpen] = useState(false);
  const [crBulkReason, setCrBulkReason] = useState("");
  const [crBulkTicketID, setCrBulkTicketID] = useState("N/A");
  const [crBulkCancelling, setCrBulkCancelling] = useState(false);
  const [crBulkError, setCrBulkError] = useState<string | null>(null);

  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [cancelError, setCancelError] = useState<string | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [cancelModalGig, setCancelModalGig] = useState<Gig | null>(null);
  const [cancelReason, setCancelReason] = useState("");
  const [cancelTicketID, setCancelTicketId] = useState("");

  // ── Worker (multi-worker gig) cancellation requests ──
  const [workerCancelRequests, setWorkerCancelRequests] = useState<WorkerCancellationRequest[]>([]);
  const [workerCancelLoading, setWorkerCancelLoading] = useState(false);
  const [workerCancelFetchError, setWorkerCancelFetchError] = useState<string | null>(null);
  const [workerCancelFetched, setWorkerCancelFetched] = useState(false);
  const [workerCancellingId, setWorkerCancellingId] = useState<string | null>(null);
  const [workerRejectTarget, setWorkerRejectTarget] = useState<WorkerCancellationRequest | null>(null);
  const [workerRejectNote, setWorkerRejectNote] = useState("");
  const [workerRejecting, setWorkerRejecting] = useState(false);
  const [workerRejectError, setWorkerRejectError] = useState<string | null>(null);

  type ExpiryGig = { id: string; title: string; gigType: string; collection: string; expireAfterHours: number };
  const [runningExpiry, setRunningExpiry] = useState(false);
  const [assignGig, setAssignGig] = useState<Gig | null>(null);
  const [backfilling, setBackfilling] = useState(false);
  const [expiryResult, setExpiryResult] = useState<{ expired: number; gigs: ExpiryGig[] } | null>(null);

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
        g.status?.toLowerCase() !== "completed" &&
        g.status?.toLowerCase() !== "expired"
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
    const adminId   = user!.uid;
    const adminName = user!.displayName ?? "Unknown";
    const adminEmail = user!.email ?? "";
    try {
      await Promise.all(
        cancellableSelected.map((gig) =>
          updateDoc(doc(db, GIG_COLLECTIONS[gig.gigType], gig.id), {
            status: "cancelled",
            cancelledByAdmin: true,
            cancelledByAdminId: adminId,
            cancelledByAdminName: adminName,
            cancellationReason: bulkCancelReason.trim() || null,
            cancellationTicketID: bulkCancelTicketID.trim() || "N/A",
          })
        )
      );
      cancellableSelected.forEach((gig) => recentlyCancelledRef.current.add(gig.id));
      setGigs((prev) =>
        prev.map((g) =>
          selectedIds.has(g.id) &&
          g.status?.toLowerCase() !== "cancelled" &&
          g.status?.toLowerCase() !== "completed"
            ? {
                ...g,
                status: "cancelled",
                cancelledByAdmin: true,
                cancelledByAdminId: adminId,
                cancelledByAdminName: adminName,
                cancellationReason: bulkCancelReason.trim() || undefined,
                cancellationTicketID: bulkCancelTicketID.trim() || "N/A",
              }
            : g
        )
      );
      await writeLog({
        actorId: adminId,
        actorName: adminName,
        actorEmail: adminEmail,
        module: "gig_management",
        action: "gig_bulk_cancelled",
        description: buildDescription.gigBulkCancelled(adminName, cancellableSelected.length),
        meta: {
          other: {
            totalCancelled: cancellableSelected.length,
            cancellationReason: bulkCancelReason.trim() || null,
            cancellationTicketID: bulkCancelTicketID.trim() || "N/A",
            cancelledByAdminId: adminId,
            cancelledByAdminName: adminName,
            gigs: cancellableSelected.map((g) => ({
              id: g.id,
              title: g.title || "Untitled Gig",
              gigType: g.gigType,
              collection: GIG_COLLECTIONS[g.gigType],
              previousStatus: g.status,
            })),
          },
        },
      });
      setSelectionMode(false);
      setSelectedIds(new Set());
      setBulkCancelOpen(false);
    } catch (err) {
      console.error("Bulk cancel failed:", err);
      setBulkCancelError("Some gigs could not be cancelled. Please try again.");
      toast.error(
        "Bulk cancellation failed",
        `${cancellableSelected.length} gig${cancellableSelected.length !== 1 ? "s" : ""} could not be cancelled. Changes were not saved.`
      );
      try {
        await writeLog({
          actorId: adminId,
          actorName: adminName,
          actorEmail: user!.email ?? "",
          module: "gig_management",
          action: "gig_bulk_cancel_failed",
          description: buildDescription.gigBulkCancelFailed(adminName, cancellableSelected.length),
          meta: {
            other: {
              error: err instanceof Error ? err.message : String(err),
              totalAttempted: cancellableSelected.length,
              cancellationReason: bulkCancelReason.trim() || null,
              cancellationTicketID: bulkCancelTicketID.trim() || "N/A",
              cancelledByAdminId: adminId,
              cancelledByAdminName: adminName,
              gigs: cancellableSelected.map((g) => ({
                id: g.id,
                title: g.title || "Untitled Gig",
                gigType: g.gigType,
                collection: GIG_COLLECTIONS[g.gigType],
                previousStatus: g.status,
              })),
            },
          },
        });
      } catch (logErr) {
        console.error("Failed to log bulk cancel failure:", logErr);
      }
    } finally {
      setBulkCancelling(false);
    }
  }, [bulkCancelling, cancellableSelected, bulkCancelReason, bulkCancelTicketID, selectedIds, user]);

  const cancelGig = useCallback(async () => {
    const gig = cancelModalGig;
    if (!gig || isCancellingRef.current) return;
    isCancellingRef.current = true;
    setCancellingId(gig.id);
    setCancelError(null);
    const adminId   = user!.uid;
    const adminName = user!.displayName ?? "Unknown";
    const localUpdate = {
      status: "cancelled",
      cancelledByAdmin: true,
      cancelledByAdminId: adminId,
      cancelledByAdminName: adminName,
      cancellationReason: cancelReason.trim() || undefined,
      cancellationTicketID: cancelTicketID.trim() || undefined,
    };

    // Optimistic update — prevents any concurrent fetchLiveGigs from
    // overwriting with stale Firestore data while the write is in flight.
    recentlyCancelledRef.current.add(gig.id);
    setGigs((prev) => prev.map((g) => g.id === gig.id ? { ...g, ...localUpdate } : g));
    if (detailGig?.id === gig.id) {
      setDetailGig((prev) => prev ? { ...prev, ...localUpdate } : prev);
    }

    try {
      await updateDoc(doc(db, GIG_COLLECTIONS[gig.gigType], gig.id), {
        status: "cancelled",
        cancelledByAdmin: true,
        cancelledByAdminId: adminId,
        cancelledByAdminName: adminName,
        cancellationReason: cancelReason.trim() || null,
        cancellationTicketID: cancelTicketID.trim() || null,
      });
      const cancellationRequestedBy = gig.cancellation_reason?.[0]?.requestedBy;
      const workerId = (gig.workerId ?? gig.assignedWorkerId) as string | undefined;
      if (cancellationRequestedBy?.toLowerCase() === "worker" && workerId) {
        await applyDeclineSuspension(workerId);
      } else if (cancellationRequestedBy?.toLowerCase() === "worker" && !workerId) {
        console.warn("[cancelGig] requestedBy=worker but no workerId on gig", gig.id);
      }
      await writeLog({
        actorId: adminId,
        actorName: adminName,
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
            previousStatus: gig.status,
            cancelledByAdminId: adminId,
            cancelledByAdminName: adminName,
            cancellationReason: cancelReason.trim() || null,
            cancellationTicketID: cancelTicketID.trim() || null,
          },
        },
      });
      setCancelModalGig(null);
    } catch (err) {
      // Revert optimistic update so the UI reflects the true state.
      recentlyCancelledRef.current.delete(gig.id);
      setGigs((prev) => prev.map((g) => g.id === gig.id ? { ...g, status: gig.status, cancelledByAdmin: gig.cancelledByAdmin, cancelledByAdminId: gig.cancelledByAdminId, cancelledByAdminName: gig.cancelledByAdminName, cancellationReason: gig.cancellationReason, cancellationTicketID: gig.cancellationTicketID } : g));
      if (detailGig?.id === gig.id) {
        setDetailGig((prev) => prev ? { ...prev, status: gig.status } : prev);
      }
      console.error("Failed to cancel gig:", err);
      setCancelError(`Failed to cancel "${gig.title || "gig"}". Please try again.`);
      toast.error(
        "Cancellation failed",
        `"${gig.title || "Gig"}" could not be cancelled. The status was not changed.`
      );
      try {
        await writeLog({
          actorId: adminId,
          actorName: adminName,
          actorEmail: user!.email ?? "",
          module: "gig_management",
          action: "gig_cancel_failed",
          description: buildDescription.gigCancelFailed(gig.title || "Untitled Gig", gig.gigType),
          targetId: gig.id,
          targetName: gig.title || "Untitled Gig",
          meta: {
            other: {
              error: err instanceof Error ? err.message : String(err),
              gigType: gig.gigType,
              collection: GIG_COLLECTIONS[gig.gigType],
              previousStatus: gig.status,
              cancelledByAdminId: adminId,
              cancelledByAdminName: adminName,
              cancellationReason: cancelReason.trim() || null,
              cancellationTicketID: cancelTicketID.trim() || null,
            },
          },
        });
      } catch (logErr) {
        console.error("Failed to log cancel failure:", logErr);
      }
    } finally {
      isCancellingRef.current = false;
      setCancellingId(null);
    }
  }, [cancelModalGig, cancelReason, cancelTicketID, detailGig, user]);

  const fetchLiveGigs = useCallback(async () => {
    setLoading(true);
    setFetchError(null);
    try {
      const types: GigType[] = gigTypeFilter === "all"
        ? ["offered", "open", "quick"]
        : [gigTypeFilter];
      const snaps = await Promise.all(types.map((t) => getDocs(collection(db, GIG_COLLECTIONS[t]))));
      const rawGigs = snaps.flatMap((snap, i) =>
        snap.docs.map((d) => ({ id: d.id, ...d.data(), gigType: types[i] }))
      ) as Omit<Gig, "applications">[];
      const cancelled = recentlyCancelledRef.current;
      setGigs(rawGigs.map((g) => {
        const base = { ...g, applications: [] as Application[] } as Gig;
        if (cancelled.has(base.id)) base.status = "cancelled";
        return base;
      }));
    } catch (err) {
      console.error("Failed to fetch gigs:", err);
      setFetchError("Failed to load gigs. Please try again.");
    } finally {
      setLoading(false);
    }
  }, [gigTypeFilter]);

  const fetchWorkerCancellationRequests = useCallback(async () => {
    setWorkerCancelLoading(true);
    setWorkerCancelFetchError(null);
    try {
      const q = query(collectionGroup(db, "workers"), where("status", "==", "cancellation_requested"));
      const snap = await getDocs(q);

      // Dedup gig-doc reads — several worker requests can belong to the same gig.
      const gigCache = new Map<string, Promise<{ title: string; hostName: string } | null>>();
      const getGigInfo = (gigType: GigType, gigId: string) => {
        const key = `${gigType}/${gigId}`;
        if (!gigCache.has(key)) {
          gigCache.set(
            key,
            getDoc(doc(db, GIG_COLLECTIONS[gigType], gigId)).then((s) =>
              s.exists()
                ? { title: (s.data().title as string) ?? "", hostName: (s.data().hostName as string) ?? "" }
                : null
            )
          );
        }
        return gigCache.get(key)!;
      };

      const results = await Promise.all(
        snap.docs.map(async (d) => {
          const gigRef = d.ref.parent.parent;
          if (!gigRef) return null;
          const collectionName = gigRef.parent.id;
          const gigType = GIG_COLLECTIONS_INVERSE[collectionName];
          if (!gigType) return null;

          const gigInfo = await getGigInfo(gigType, gigRef.id);
          const data = d.data();
          const req: WorkerCancellationRequest = {
            workerId: d.id,
            gigId: gigRef.id,
            gigType,
            workerDocPath: `${collectionName}/${gigRef.id}/workers/${d.id}`,
            status: (data.status as string) ?? "",
            lastProgressStatus: data.lastProgressStatus as string | undefined,
            cancellationRequestedAt: (data.cancellationRequestedAt as Timestamp) ?? null,
            cancellation_reason: (data.cancellation_reason as WorkerCancellationRequest["cancellation_reason"]) ?? [],
            workerName: data.workerName as string | undefined,
            gigTitle: gigInfo?.title || "Untitled Gig",
            hostName: gigInfo?.hostName || "—",
          };
          return req;
        })
      );
      setWorkerCancelRequests(results.filter((r): r is WorkerCancellationRequest => r !== null));
    } catch (err) {
      console.error("Failed to fetch worker cancellation requests:", err);
      const message = err instanceof Error && err.message.toLowerCase().includes("index")
        ? "This view needs a Firestore index that hasn't been deployed yet. Ask an engineer to deploy firestore.indexes.json."
        : "Failed to load worker cancellation requests. Please try again.";
      setWorkerCancelFetchError(message);
    } finally {
      setWorkerCancelLoading(false);
      setWorkerCancelFetched(true);
    }
  }, []);

  const runAutoExpiry = useCallback(async () => {
    setRunningExpiry(true);
    try {
      const token = await auth.currentUser?.getIdToken();
      const res = await fetch("/api/admin/run-expiry", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      setExpiryResult(data);
      if (data.expired > 0) fetchLiveGigs();
    } catch {
      setExpiryResult({ expired: -1, gigs: [] });
    } finally {
      setRunningExpiry(false);
    }
  }, [fetchLiveGigs]);

  // Give GSINS/GSKU codes to existing gigs whose task type can be worked out
  // from their skill. Runs in batches until nothing is left.
  const runBackfill = useCallback(async () => {
    setBackfilling(true);
    let assigned = 0, failed = 0, noTaskType = 0, needsPick = 0;
    try {
      for (let i = 0; i < 20; i++) {
        const r = await backfillGigCodes({ limit: 300 });
        assigned += r.assigned; failed += r.failed; noTaskType = r.noTaskType; needsPick = r.needsPick ?? 0;
        if (r.remaining === 0 || r.assigned === 0) break;
      }
      toast.success(
        `Codes assigned to ${assigned} gig${assigned === 1 ? "" : "s"}`,
        [needsPick ? `${needsPick} have a skill shared by several task types — use "Pick task type" on their row` : "",
          noTaskType ? `${noTaskType} have no matching task type — use Assign` : "", failed ? `${failed} failed` : ""].filter(Boolean).join(" · ") || undefined,
      );
      if (assigned > 0 || needsPick > 0) fetchLiveGigs();
    } catch (err) {
      toast.error("Backfill failed", callableError(err));
    } finally {
      setBackfilling(false);
    }
  }, [fetchLiveGigs]);

  useEffect(() => { fetchLiveGigs(); }, [fetchLiveGigs]);

  useEffect(() => {
    if (activeTab === "worker_cancellation_requests" && !workerCancelFetched) {
      fetchWorkerCancellationRequests();
    }
  }, [activeTab, workerCancelFetched, fetchWorkerCancellationRequests]);

  // ── Derived ──────────────────────────────────────────────────────────────────

  const filtered = useMemo(() => {
    let list = gigs.slice();
    if (gigTypeFilter !== "all") {
      list = list.filter((g) => g.gigType === gigTypeFilter);
    }
    if (statusFilter === "completed") {
      list = list.filter((g) => g.status?.toLowerCase() === "completed");
    } else if (statusFilter === "in_progress") {
      list = list.filter((g) => {
        const s = g.status?.toLowerCase();
        return s !== "completed" && s !== "no_worker" && s !== "expired" && s !== "cancelled";
      });
    } else if (statusFilter === "cancelled") {
      list = list.filter((g) => g.status?.toLowerCase() === "cancelled");
    } else if (statusFilter === "expired") {
      list = list.filter((g) => g.status?.toLowerCase() === "expired");
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
    if (postedByFilter) {
      list = list.filter((g) => g.hostName === postedByFilter);
    }
    if (dateFrom) {
      const from = new Date(dateFrom).getTime();
      list = list.filter((g) => g.createdAt && g.createdAt.toDate().getTime() >= from);
    }
    if (dateTo) {
      const to = new Date(dateTo);
      to.setHours(23, 59, 59, 999);
      list = list.filter((g) => g.createdAt && g.createdAt.toDate().getTime() <= to.getTime());
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (g) =>
          g.id?.toLowerCase().includes(q) ||
          g.gsins?.toLowerCase().includes(q) ||
          g.gsku?.toLowerCase().includes(q) ||
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
  }, [gigs, search, statusFilter, gigTypeFilter, sort, inactiveDays, postedByFilter, dateFrom, dateTo]);

  const cancellationRequests = useMemo(
    () => gigs
      .filter((g) => g.status?.toLowerCase() === "cancellation_requested")
      .sort((a, b) => (b.createdAt?.seconds ?? 0) - (a.createdAt?.seconds ?? 0)),
    [gigs]
  );

  const crBulkApprove = useCallback(async () => {
    const targets = cancellationRequests.filter((g) => crSelectedIds.has(g.id));
    if (crBulkCancelling || targets.length === 0) return;
    setCrBulkCancelling(true);
    setCrBulkError(null);
    const adminId    = user!.uid;
    const adminName  = user!.displayName ?? "Unknown";
    const adminEmail = user!.email ?? "";
    try {
      await Promise.all(
        targets.map((gig) =>
          updateDoc(doc(db, GIG_COLLECTIONS[gig.gigType], gig.id), {
            status: "cancelled",
            cancelledByAdmin: true,
            cancelledByAdminId: adminId,
            cancelledByAdminName: adminName,
            cancellationReason: crBulkReason.trim() || null,
            cancellationTicketID: crBulkTicketID.trim() || "N/A",
          })
        )
      );
      await Promise.all(
        targets.map((gig) => {
          const requestedBy = gig.cancellation_reason?.[0]?.requestedBy;
          const workerId = (gig.workerId ?? gig.assignedWorkerId) as string | undefined;
          if (requestedBy?.toLowerCase() === "worker" && workerId) {
            return applyDeclineSuspension(workerId);
          }
          return Promise.resolve();
        })
      );
      targets.forEach((gig) => recentlyCancelledRef.current.add(gig.id));
      setGigs((prev) =>
        prev.map((g) =>
          crSelectedIds.has(g.id)
            ? {
                ...g,
                status: "cancelled",
                cancelledByAdmin: true,
                cancelledByAdminId: adminId,
                cancelledByAdminName: adminName,
                cancellationReason: crBulkReason.trim() || undefined,
                cancellationTicketID: crBulkTicketID.trim() || "N/A",
              }
            : g
        )
      );
      await writeLog({
        actorId: adminId,
        actorName: adminName,
        actorEmail: adminEmail,
        module: "gig_management",
        action: "gig_bulk_cancelled",
        description: buildDescription.gigBulkCancelled(adminName, targets.length),
        meta: {
          other: {
            totalCancelled: targets.length,
            source: "cancellation_requests_tab",
            cancellationReason: crBulkReason.trim() || null,
            cancellationTicketID: crBulkTicketID.trim() || "N/A",
            cancelledByAdminId: adminId,
            cancelledByAdminName: adminName,
            gigs: targets.map((g) => ({
              id: g.id,
              title: g.title || "Untitled Gig",
              gigType: g.gigType,
              collection: GIG_COLLECTIONS[g.gigType],
              previousStatus: g.status,
            })),
          },
        },
      });
      setCrSelectedIds(new Set());
      setCrBulkOpen(false);
    } catch (err) {
      console.error("CR bulk approve failed:", err);
      setCrBulkError("Some gigs could not be cancelled. Please try again.");
      toast.error(
        "Bulk approval failed",
        `${targets.length} cancellation request${targets.length !== 1 ? "s" : ""} could not be approved. No statuses were changed.`
      );
      try {
        await writeLog({
          actorId: adminId,
          actorName: adminName,
          actorEmail: adminEmail,
          module: "gig_management",
          action: "gig_bulk_cancel_failed",
          description: buildDescription.gigBulkCancelFailed(adminName, targets.length),
          meta: {
            other: {
              error: err instanceof Error ? err.message : String(err),
              source: "cancellation_requests_tab",
              totalAttempted: targets.length,
              cancellationReason: crBulkReason.trim() || null,
              cancellationTicketID: crBulkTicketID.trim() || "N/A",
              cancelledByAdminId: adminId,
              cancelledByAdminName: adminName,
              gigs: targets.map((g) => ({
                id: g.id,
                title: g.title || "Untitled Gig",
                gigType: g.gigType,
                collection: GIG_COLLECTIONS[g.gigType],
                previousStatus: g.status,
              })),
            },
          },
        });
      } catch (logErr) {
        console.error("Failed to log CR bulk cancel failure:", logErr);
      }
    } finally {
      setCrBulkCancelling(false);
    }
  }, [crBulkCancelling, cancellationRequests, crSelectedIds, crBulkReason, crBulkTicketID, user]);

  function patchLastCancellationReason(
    arr: WorkerCancellationRequest["cancellation_reason"],
    approved: boolean,
    approvedBy: string
  ): WorkerCancellationRequest["cancellation_reason"] {
    if (arr.length === 0) return arr;
    const next = arr.map((e) => ({ ...e }));
    next[next.length - 1] = { ...next[next.length - 1], approved, approvedBy };
    return next;
  }

  const approveWorkerCancellation = useCallback(async (req: WorkerCancellationRequest) => {
    if (workerCancellingId) return;
    setWorkerCancellingId(req.workerDocPath);
    const adminId = user!.uid;
    const adminName = user!.displayName ?? "Unknown";
    const adminEmail = user!.email ?? "";
    const nextReasonArr = patchLastCancellationReason(req.cancellation_reason, true, adminId);

    setWorkerCancelRequests((prev) => prev.filter((r) => r.workerDocPath !== req.workerDocPath));

    try {
      await Promise.all([
        updateDoc(doc(db, req.workerDocPath), {
          status: "cancelled",
          approved: true,
          approvedBy: adminId,
          approvedByName: adminName,
          cancelledAt: serverTimestamp(),
          cancellation_reason: nextReasonArr,
        }),
        ...(req.gigType === "quick"
          ? [
              updateDoc(doc(db, GIG_COLLECTIONS[req.gigType], req.gigId), {
                exclusionList: arrayUnion(req.workerId),
              }),
            ]
          : []),
      ]);
      await writeLog({
        actorId: adminId,
        actorName: adminName,
        actorEmail: adminEmail,
        module: "gig_management",
        action: "gig_worker_cancellation_approved",
        description: buildDescription.gigWorkerCancellationApproved(req.gigTitle, req.workerName || req.workerId),
        targetId: req.workerDocPath,
        targetName: req.gigTitle,
        meta: {
          other: {
            gigId: req.gigId,
            gigType: req.gigType,
            workerId: req.workerId,
            collection: GIG_COLLECTIONS[req.gigType],
            previousStatus: req.status,
            previousLastProgressStatus: req.lastProgressStatus ?? null,
            approvedByAdminId: adminId,
            approvedByAdminName: adminName,
          },
        },
      });
    } catch (err) {
      setWorkerCancelRequests((prev) => [...prev, req]);
      console.error("Failed to approve worker cancellation:", err);
      toast.error(
        "Approval failed",
        `Could not approve cancellation for "${req.workerName || req.workerId}". No changes were saved.`
      );
      try {
        await writeLog({
          actorId: adminId,
          actorName: adminName,
          actorEmail: adminEmail,
          module: "gig_management",
          action: "gig_worker_cancellation_approve_failed",
          description: buildDescription.gigWorkerCancellationApproveFailed(req.gigTitle, req.workerName || req.workerId),
          targetId: req.workerDocPath,
          targetName: req.gigTitle,
          meta: {
            other: {
              error: err instanceof Error ? err.message : String(err),
              gigId: req.gigId,
              gigType: req.gigType,
              workerId: req.workerId,
            },
          },
        });
      } catch (logErr) {
        console.error("Failed to log worker approve failure:", logErr);
      }
    } finally {
      setWorkerCancellingId(null);
    }
  }, [workerCancellingId, user]);

  const openWorkerRejectModal = useCallback((req: WorkerCancellationRequest) => {
    setWorkerRejectTarget(req);
    setWorkerRejectNote("");
    setWorkerRejectError(null);
  }, []);

  const rejectWorkerCancellation = useCallback(async () => {
    const req = workerRejectTarget;
    if (!req || workerRejecting) return;
    setWorkerRejecting(true);
    setWorkerRejectError(null);
    const adminId = user!.uid;
    const adminName = user!.displayName ?? "Unknown";
    const adminEmail = user!.email ?? "";
    const restoredStatus = req.lastProgressStatus || "working";
    const nextReasonArr = patchLastCancellationReason(req.cancellation_reason, false, adminId);

    setWorkerCancelRequests((prev) => prev.filter((r) => r.workerDocPath !== req.workerDocPath));

    try {
      await updateDoc(doc(db, req.workerDocPath), {
        status: restoredStatus,
        approved: false,
        approvedBy: adminId,
        approvedByName: adminName,
        lastProgressStatus: deleteField(),
        cancellation_reason: nextReasonArr,
      });
      await writeLog({
        actorId: adminId,
        actorName: adminName,
        actorEmail: adminEmail,
        module: "gig_management",
        action: "gig_worker_cancellation_rejected",
        description: buildDescription.gigWorkerCancellationRejected(req.gigTitle, req.workerName || req.workerId, restoredStatus),
        targetId: req.workerDocPath,
        targetName: req.gigTitle,
        meta: {
          other: {
            gigId: req.gigId,
            gigType: req.gigType,
            workerId: req.workerId,
            collection: GIG_COLLECTIONS[req.gigType],
            restoredStatus,
            adminNote: workerRejectNote.trim() || null,
            rejectedByAdminId: adminId,
            rejectedByAdminName: adminName,
          },
        },
      });
      setWorkerRejectTarget(null);
    } catch (err) {
      setWorkerCancelRequests((prev) => [...prev, req]);
      console.error("Failed to reject worker cancellation:", err);
      setWorkerRejectError(`Failed to reject cancellation for "${req.workerName || req.workerId}". Please try again.`);
      toast.error(
        "Rejection failed",
        `Could not reject cancellation for "${req.workerName || req.workerId}".`
      );
      try {
        await writeLog({
          actorId: adminId,
          actorName: adminName,
          actorEmail: adminEmail,
          module: "gig_management",
          action: "gig_worker_cancellation_reject_failed",
          description: buildDescription.gigWorkerCancellationRejectFailed(req.gigTitle, req.workerName || req.workerId),
          targetId: req.workerDocPath,
          targetName: req.gigTitle,
          meta: {
            other: {
              error: err instanceof Error ? err.message : String(err),
              gigId: req.gigId,
              gigType: req.gigType,
              workerId: req.workerId,
            },
          },
        });
      } catch (logErr) {
        console.error("Failed to log worker reject failure:", logErr);
      }
    } finally {
      setWorkerRejecting(false);
    }
  }, [workerRejectTarget, workerRejecting, workerRejectNote, user]);

  const stats = useMemo(() => {
    const total = gigs.length;
    const completed = gigs.filter((g) => g.status?.toLowerCase() === "completed").length;
    const noWorker = gigs.filter((g) => g.status?.toLowerCase() === "no_worker").length;
    const cancelled = gigs.filter((g) => g.status?.toLowerCase() === "cancelled").length;
    const expired = gigs.filter((g) => g.status?.toLowerCase() === "expired").length;
    const inProgress = gigs.filter((g) => {
      const s = g.status?.toLowerCase();
      return s !== "completed" && s !== "no_worker" && s !== "expired" && s !== "cancelled" && s !== "cancellation_requested";
    }).length;
    return { total, completed, inProgress: Math.max(0, inProgress), noWorker, cancelled, expired };
  }, [gigs]);

  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (statusFilter !== "all") count++;
    if (gigTypeFilter !== "all") count++;
    if (postedByFilter) count++;
    if (dateFrom || dateTo) count++;
    return count;
  }, [statusFilter, gigTypeFilter, postedByFilter, dateFrom, dateTo]);

  const hasActiveFilter = !!(search || statusFilter !== "all" || gigTypeFilter !== "all" || inactiveDays || postedByFilter || dateFrom || dateTo);

  useEffect(() => {
    setPage(1);
    setSelectedIds(new Set());
  }, [search, statusFilter, gigTypeFilter, sort, inactiveDays, postedByFilter, dateFrom, dateTo]);

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
    setPostedByFilter("");
    setDateFrom("");
    setDateTo("");
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
        <div style={{ display: "flex", gap: 8 }}>
          <Button variant="ghost" size="sm" icon={Timer} onClick={runAutoExpiry} disabled={runningExpiry || loading}>
            {runningExpiry ? "Running…" : "Run Auto-Expiry"}
          </Button>
          <Button variant="ghost" size="sm" icon={Tags} onClick={runBackfill} disabled={backfilling || loading}
            title="Give GSINS/GSKU codes to gigs that don't have one yet">
            {backfilling ? "Assigning codes…" : "Backfill codes"}
          </Button>
          <Button variant="ghost" size="sm" icon={RefreshCw} onClick={fetchLiveGigs} disabled={loading}>
            Refresh
          </Button>
        </div>
      }
    >
      <style>{`
        /* ── Layout ── */
        .lg-wrap { display: flex; flex-direction: column; gap: 20px; padding: 24px; }

        /* ── Tabs ── */
        .lg-tabs { display: flex; gap: 0; border-bottom: 1px solid var(--border); margin-bottom: 4px; }
        .lg-tab {
          padding: 10px 18px; font-size: 13px; font-weight: 600; font-family: inherit;
          background: none; border: none; border-bottom: 2px solid transparent;
          color: var(--text-muted); cursor: pointer; transition: color 0.15s, border-color 0.15s;
          display: flex; align-items: center; gap: 7px; white-space: nowrap; margin-bottom: -1px;
        }
        .lg-tab:hover { color: var(--text-primary); }
        .lg-tab--active { color: var(--blue); border-bottom-color: var(--blue); }
        .lg-tab-badge {
          background: var(--blue); color: white; border-radius: 10px;
          font-size: 10px; font-weight: 700; padding: 1px 6px; min-width: 16px; text-align: center;
        }
        .lg-tab-badge--red { background: var(--red); }

        /* ── Cancellation request table ── */
        .lg-cr-card { background: var(--bg-surface); border: 1px solid var(--border); border-radius: var(--radius-md); overflow: hidden; }
        .lg-cr-reason { font-size: 12px; color: var(--text-secondary); margin-top: 2px; font-style: italic; max-width: 260px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .lg-approve-btn {
          padding: 4px 10px; border-radius: var(--radius-sm);
          border: 1px solid rgba(239,68,68,0.35); background: rgba(239,68,68,0.08);
          color: var(--red); font-size: 11px; font-weight: 600; font-family: inherit;
          cursor: pointer; transition: all 0.12s; white-space: nowrap;
        }
        .lg-approve-btn:hover:not(:disabled) { background: rgba(239,68,68,0.18); border-color: var(--red); }
        .lg-approve-btn:disabled { opacity: 0.5; cursor: not-allowed; }
        .lg-reject-btn {
          padding: 4px 10px; border-radius: var(--radius-sm);
          border: 1px solid var(--border); background: transparent;
          color: var(--text-secondary); font-size: 11px; font-weight: 600; font-family: inherit;
          cursor: pointer; transition: all 0.12s; white-space: nowrap;
        }
        .lg-reject-btn:hover:not(:disabled) { border-color: var(--text-muted); color: var(--text-primary); }
        .lg-reject-btn:disabled { opacity: 0.5; cursor: not-allowed; }

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
        .lg-pill--completed.lg-pill--active { background: var(--green); border-color: var(--green); }
        .lg-pill--in_progress.lg-pill--active { background: var(--blue); border-color: var(--blue); }
        .lg-pill--cancelled.lg-pill--active { background: rgba(239,68,68,0.8); border-color: var(--red); }
        .lg-pill--inactive.lg-pill--active { background: rgba(245,158,11,0.9); border-color: var(--amber); }
        .lg-pill--expired.lg-pill--active { background: var(--red); border-color: var(--red); }

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
        .lg-user-btn {
          background: none; border: none; padding: 2px 0; cursor: pointer;
          font-size: 12px; font-family: inherit; color: var(--text-secondary);
          text-align: left; transition: color 0.12s;
        }
        .lg-user-btn:hover { color: var(--blue); text-decoration: underline; }
        .lg-user-btn--active { color: var(--blue); font-weight: 600; }

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
        .lg-badge--expired { background: rgba(239,68,68,0.12); color: var(--red); }
        .lg-badge--type-offered { background: rgba(245,158,11,0.12); color: var(--amber); }
        .lg-badge--type-open { background: rgba(59,130,246,0.12); color: var(--blue); }
        .lg-badge--type-quick { background: rgba(139,92,246,0.12); color: var(--purple); }
        .lg-badge--cancel-req { background: rgba(239,68,68,0.12); color: var(--red); }
        .lg-badge-dot { width: 5px; height: 5px; border-radius: 50%; background: currentColor; flex-shrink: 0; }

        /* ── Cancellation request info box ── */
        .gd-cancel-req-info { padding: 10px 14px; background: rgba(239,68,68,0.06); border: 1px solid rgba(239,68,68,0.2); border-radius: var(--radius-sm); margin-bottom: 20px; }
        .gd-cancel-req-title { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.07em; color: var(--red); margin-bottom: 8px; }
        .gd-cancel-req-row { font-size: 12px; color: var(--text-secondary); margin-bottom: 4px; }
        .gd-cancel-req-row:last-child { margin-bottom: 0; }
        .gd-cancel-req-key { font-weight: 700; color: var(--text-muted); }

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
        .lg-code { font-family: monospace; font-size: 11.5px; font-weight: 600; color: var(--text-primary); white-space: nowrap; }
        .lg-code-btn { background: none; border: none; padding: 0; cursor: pointer; }
        .lg-code-btn:hover { color: var(--blue); text-decoration: underline; }
        .lg-code-none { font-size: 12px; color: var(--text-muted); }
        .lg-assign-btn { font-size: 11px; font-weight: 600; padding: 3px 9px; border-radius: 6px; border: 1px dashed var(--border); background: transparent; color: var(--text-muted); cursor: pointer; font-family: inherit; }
        .lg-assign-btn--pick { border-style: solid; border-color: var(--amber, #f59e0b); color: var(--amber, #f59e0b); }
        .lg-assign-btn:hover { border-color: var(--blue); color: var(--blue); }
        .lg-empty { padding: 60px 24px; text-align: center; color: var(--text-muted); }
        .lg-empty-icon { display: flex; justify-content: center; margin-bottom: 12px; opacity: 0.3; }
        .lg-empty-title { font-size: 14px; font-weight: 600; color: var(--text-secondary); margin-bottom: 4px; }
        .lg-empty-sub { font-size: 12px; }
        .lg-skeleton { background: var(--bg-elevated); border-radius: 6px; animation: lg-pulse 1.4s ease-in-out infinite; }
        @keyframes lg-pulse { 0%,100% { opacity: 0.4; } 50% { opacity: 0.9; } }

        /* ── Pagination ── */
        .lg-pagination {
          display: flex; align-items: center; justify-content: end;
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

        {/* ── Tabs ── */}
        <div className="lg-tabs">
          <button
            className={`lg-tab${activeTab === "cancellation_requests" ? " lg-tab--active" : ""}`}
            onClick={() => { setActiveTab("cancellation_requests"); setCrSelectedIds(new Set()); }}
          >
            Requested Cancellation
            {cancellationRequests.length > 0 && (
              <span className="lg-tab-badge lg-tab-badge--red">{cancellationRequests.length}</span>
            )}
          </button>
          <button
            className={`lg-tab${activeTab === "worker_cancellation_requests" ? " lg-tab--active" : ""}`}
            onClick={() => { setActiveTab("worker_cancellation_requests"); setCrSelectedIds(new Set()); }}
          >
            Worker Cancellations
            {workerCancelRequests.length > 0 && (
              <span className="lg-tab-badge lg-tab-badge--red">{workerCancelRequests.length}</span>
            )}
          </button>
          <button
            className={`lg-tab${activeTab === "all_gigs" ? " lg-tab--active" : ""}`}
            onClick={() => { setActiveTab("all_gigs"); setCrSelectedIds(new Set()); }}
          >
            All Gigs
            <span className="lg-tab-badge">{gigs.length}</span>
          </button>
        </div>

        {activeTab === "cancellation_requests" ? (
          <CancellationRequestsTab
            gigs={cancellationRequests}
            loading={loading}
            symbol={symbol}
            cancellingId={cancellingId}
            selectedIds={crSelectedIds}
            onSelectChange={setCrSelectedIds}
            onBulkApprove={() => { setCrBulkReason(""); setCrBulkTicketID("N/A"); setCrBulkError(null); setCrBulkOpen(true); }}
            onApprove={openCancelModal}
            onReject={(gig) => setDetailGig(gig)}
            onRowClick={(gig) => setDetailGig(gig)}
          />
        ) : activeTab === "worker_cancellation_requests" ? (
          <WorkerCancellationRequestsTab
            requests={workerCancelRequests}
            loading={workerCancelLoading}
            fetchError={workerCancelFetchError}
            cancellingId={workerCancellingId}
            onRefresh={fetchWorkerCancellationRequests}
            onApprove={approveWorkerCancellation}
            onReject={openWorkerRejectModal}
          />
        ) : (
        <>

        {/* ── Stats bar ── */}
        <div className="lg-stats">
          <StatCard
            value={stats.total} label="Total Gigs" color="var(--blue)" loading={loading}
            active={false}
          />
          <StatCard
            value={stats.completed} label="Completed" color="var(--green)" loading={loading}
            active={statusFilter === "completed"}
            onClick={() => setStatusFilter(statusFilter === "completed" ? "all" : "completed")}
          />
          <StatCard
            value={stats.inProgress} label="In Progress" color="var(--blue)" loading={loading}
            active={statusFilter === "in_progress"}
            onClick={() => setStatusFilter(statusFilter === "in_progress" ? "all" : "in_progress")}
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
          <StatCard
            value={stats.expired} label="Expired" color="var(--red)" loading={loading}
            active={statusFilter === "expired"}
            onClick={() => setStatusFilter(statusFilter === "expired" ? "all" : "expired")}
          />
        </div>

        {/* ── Search + toolbar ── */}
        <div className="lg-toolbar">
          <div className="lg-search-wrap">
            <Search size={13} className="lg-search-icon" />
            <input
              className="lg-search"
              placeholder="Search gig ID, title, category, posted by, location…"
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
                    { val: "all",           label: "All" },
                    { val: "completed",     label: "Completed" },
                    { val: "in_progress",   label: "In Progress" },
                    { val: "cancelled",     label: "Cancelled" },
                    { val: "expired",       label: "Expired" },
                    { val: "inactive",      label: "No Worker" },
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

            <div className="lg-filter-row">
              <span className="lg-filter-label">Date</span>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <input
                  type="date"
                  className="lg-days-input"
                  style={{ width: 130 }}
                  value={dateFrom}
                  onChange={(e) => setDateFrom(e.target.value)}
                  title="From"
                />
                <span className="lg-days-label">to</span>
                <input
                  type="date"
                  className="lg-days-input"
                  style={{ width: 130 }}
                  value={dateTo}
                  onChange={(e) => setDateTo(e.target.value)}
                  title="To"
                />
                {(dateFrom || dateTo) && (
                  <button className="lg-chips-clear" onClick={() => { setDateFrom(""); setDateTo(""); }}>
                    Clear
                  </button>
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
            {postedByFilter && (
              <span className="lg-chip">
                User: {postedByFilter.length > 24 ? postedByFilter.slice(0, 24) + "…" : postedByFilter}
                <button className="lg-chip-x" onClick={() => setPostedByFilter("")}>×</button>
              </span>
            )}
            {(dateFrom || dateTo) && (
              <span className="lg-chip">
                {dateFrom && dateTo ? `${dateFrom} → ${dateTo}` : dateFrom ? `From ${dateFrom}` : `Until ${dateTo}`}
                <button className="lg-chip-x" onClick={() => { setDateFrom(""); setDateTo(""); }}>×</button>
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
                  <th>Gig ID</th>
                  <th title="Task type code: G + category + number">GSINS</th>
                  <th title="Gig code: T + sub-category + task type + level + service + number">GSKU</th>
                  <th>Gig</th>
                  <th>User</th>
                  <th>Type</th>
                  <th>Status</th>
                  <th>Posted</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {paginated.map((gig) => {
                  const loc = formatLocation(gig.location);
                  const s = gig.status?.toLowerCase();
                  const isInProgress = s !== "completed" && s !== "no_worker" && s !== "expired" && s !== "cancelled";
                  return (
                    <tr
                      key={gig.id}
                      className={`lg-row${isInProgress ? " lg-row--in-progress" : ""}`}
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
                      <td onClick={(e) => e.stopPropagation()}>
                        <CopyableId id={gig.id} />
                      </td>
                      <td onClick={(e) => e.stopPropagation()}>
                        {gig.gsins ? <span className="lg-code">{gig.gsins}</span> : <span className="lg-code-none">—</span>}
                      </td>
                      <td onClick={(e) => e.stopPropagation()}>
                        {gig.gsku ? (
                          <button className="lg-code lg-code-btn" title={`${explainGsku(gig.gsku)}\nClick to change task type`} onClick={() => setAssignGig(gig)}>
                            {gig.gsku}
                          </button>
                        ) : (
                          <button
                            className={`lg-assign-btn${gig.gsinCandidates?.length ? " lg-assign-btn--pick" : ""}`}
                            onClick={() => setAssignGig(gig)}
                            title={gig.gsinCandidates?.length
                              ? `This gig's skill is linked to ${gig.gsinCandidates.length} task types (${gig.gsinCandidates.join(", ")}) — pick one`
                              : "Pick a task type to give this gig its codes"}
                          >
                            {gig.gsinCandidates?.length ? "Pick task type" : "Assign"}
                          </button>
                        )}
                      </td>
                      <td>
                        <div className="lg-gig-title">{gig.title || "Untitled Gig"}</div>
                        {loc && <div className="lg-gig-meta"><MapPin size={10} />{loc}</div>}
                      </td>
                      <td>
                        {gig.hostName ? (
                          <button
                            className={`lg-user-btn${postedByFilter === gig.hostName ? " lg-user-btn--active" : ""}`}
                            onClick={(e) => { e.stopPropagation(); setPostedByFilter(postedByFilter === gig.hostName ? "" : (gig.hostName as string)); }}
                            title={postedByFilter === gig.hostName ? "Clear user filter" : `Filter by ${gig.hostName}`}
                          >
                            {gig.hostName as string}
                          </button>
                        ) : (
                          <span style={{ fontSize: 12, color: "var(--text-muted)" }}>—</span>
                        )}
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
                        {gig.status?.toLowerCase() === "cancelled" && gig.cancelledByAdmin && (
                          <div style={{ fontSize: 10, color: "var(--red)", fontWeight: 600, marginTop: 3, opacity: 0.8 }}>
                            by admin
                          </div>
                        )}
                      </td>
                      <td>
                        <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
                          {formatDateShort(gig.createdAt)}
                        </span>
                      </td>
                      <td onClick={(e) => e.stopPropagation()}>
                        <div className="lg-actions">
                          {gig.status?.toLowerCase() !== "cancelled" &&
                            gig.status?.toLowerCase() !== "completed" &&
                            gig.status?.toLowerCase() !== "expired" && (
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

        </>
        )}
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

      {/* ── CR Bulk Approve Modal ── */}
      {crBulkOpen && (
        <Modal
          open
          onClose={() => { if (!crBulkCancelling) { setCrBulkOpen(false); setCrBulkError(null); } }}
          title={`Approve ${crSelectedIds.size} Cancellation Request${crSelectedIds.size !== 1 ? "s" : ""}`}
          description={`This will cancel ${crSelectedIds.size} gig${crSelectedIds.size !== 1 ? "s" : ""} and cannot be undone.`}
          size="sm"
          footer={
            <>
              <Button variant="ghost" size="sm" onClick={() => { setCrBulkOpen(false); setCrBulkError(null); }} disabled={crBulkCancelling}>
                Dismiss
              </Button>
              <Button variant="danger" size="sm" loading={crBulkCancelling} onClick={crBulkApprove}>
                Confirm Approve All
              </Button>
            </>
          }
        >
          <div className="cgm-field">
            <label className="cgm-label">Ticket ID</label>
            <input className="cgm-input" placeholder="N/A" value={crBulkTicketID} onChange={(e) => setCrBulkTicketID(e.target.value)} disabled={crBulkCancelling} />
          </div>
          <div className="cgm-field" style={{ marginBottom: 0 }}>
            <label className="cgm-label">Cancellation Reason</label>
            <textarea className="cgm-input cgm-textarea" placeholder="Describe why these gigs are being cancelled…" value={crBulkReason} onChange={(e) => setCrBulkReason(e.target.value)} disabled={crBulkCancelling} />
          </div>
          {crBulkError && <div className="cgm-error">{crBulkError}</div>}
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

      {/* ── Worker Cancellation Reject Modal ── */}
      {workerRejectTarget && (
        <Modal
          open
          onClose={() => { if (!workerRejecting) { setWorkerRejectTarget(null); setWorkerRejectError(null); } }}
          title="Reject Worker Cancellation"
          description={`"${workerRejectTarget.workerName || workerRejectTarget.workerId}" on "${workerRejectTarget.gigTitle}" will be restored to status "${workerRejectTarget.lastProgressStatus || "working"}".`}
          size="sm"
          footer={
            <>
              <Button variant="ghost" size="sm" onClick={() => { setWorkerRejectTarget(null); setWorkerRejectError(null); }} disabled={workerRejecting}>
                Dismiss
              </Button>
              <Button variant="danger" size="sm" loading={workerRejecting} onClick={rejectWorkerCancellation}>
                Confirm Reject
              </Button>
            </>
          }
        >
          <div className="cgm-field" style={{ marginBottom: 0 }}>
            <label className="cgm-label">Admin Note (optional)</label>
            <textarea
              className="cgm-input cgm-textarea"
              placeholder="Optional internal note about this rejection…"
              value={workerRejectNote}
              onChange={(e) => setWorkerRejectNote(e.target.value)}
              disabled={workerRejecting}
            />
          </div>
          {workerRejectError && <div className="cgm-error">{workerRejectError}</div>}
        </Modal>
      )}

      {/* ── Auto-Expiry Result Modal ── */}
      {expiryResult && (
        <Modal
          open
          onClose={() => setExpiryResult(null)}
          title="Auto-Expiry Results"
          size="md"
          footer={
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%" }}>
              <Button variant="ghost" size="sm" icon={RefreshCw} onClick={() => { fetchLiveGigs(); setExpiryResult(null); }}>
                Go to Live Gigs
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setExpiryResult(null)}>Close</Button>
            </div>
          }
        >
          {expiryResult.expired === -1 ? (
            <div style={{ fontSize: 13, color: "var(--red)" }}>Failed to run auto-expiry. Please try again.</div>
          ) : expiryResult.expired === 0 ? (
            <div style={{ fontSize: 13, color: "var(--text-secondary)" }}>
              No gigs were eligible for expiry based on the current configuration.
            </div>
          ) : (
            <>
              <div style={{ fontSize: 13, color: "var(--text-secondary)", marginBottom: 14 }}>
                <strong style={{ color: "var(--text-primary)" }}>{expiryResult.expired}</strong> gig{expiryResult.expired !== 1 ? "s" : ""} were marked as expired.
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {expiryResult.gigs.map((g) => (
                  <div key={g.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 12px", background: "var(--bg-elevated)", borderRadius: "var(--radius-sm)", border: "1px solid var(--border)" }}>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)" }}>{g.title}</div>
                      <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>ID: {g.id}</div>
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
                      <span className={`lg-badge lg-badge--type-${g.gigType}`}>{g.gigType}</span>
                      <span style={{ fontSize: 10, color: "var(--text-muted)" }}>{g.expireAfterHours}h threshold</span>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </Modal>
      )}
      {assignGig && (
        <AssignCodesModal
          gig={assignGig}
          onClose={() => setAssignGig(null)}
          onAssigned={(codes) => {
            setGigs((prev) => prev.map((g) => (g.id === assignGig.id && g.gigType === assignGig.gigType ? { ...g, ...codes } : g)));
            setAssignGig(null);
          }}
        />
      )}
    </AdminLayout>
  );
}

export default function LiveGigsPage() {
  return (
    <Suspense>
      <LiveGigsPageInner />
    </Suspense>
  );
}

// ─── Cancellation Requests Tab ───────────────────────────────────────────────

function CancellationRequestsTab({
  gigs, loading, symbol, cancellingId, selectedIds, onSelectChange, onBulkApprove, onApprove, onReject, onRowClick,
}: {
  gigs: Gig[];
  loading: boolean;
  symbol: string;
  cancellingId: string | null;
  selectedIds: Set<string>;
  onSelectChange: (ids: Set<string>) => void;
  onBulkApprove: () => void;
  onApprove: (gig: Gig) => void;
  onReject: (gig: Gig) => void;
  onRowClick: (gig: Gig) => void;
}) {
  const CR_PAGE_SIZE = 20;
  const [crPage, setCrPage] = useState(1);

  useEffect(() => { setCrPage(1); }, [gigs.length]);

  const crTotalPages = Math.max(1, Math.ceil(gigs.length / CR_PAGE_SIZE));
  const paginatedGigs = gigs.slice((crPage - 1) * CR_PAGE_SIZE, crPage * CR_PAGE_SIZE);

  const allSelected = paginatedGigs.length > 0 && paginatedGigs.every((g) => selectedIds.has(g.id));

  const toggleAll = () => {
    const next = new Set(selectedIds);
    if (allSelected) {
      paginatedGigs.forEach((g) => next.delete(g.id));
    } else {
      paginatedGigs.forEach((g) => next.add(g.id));
    }
    onSelectChange(next);
  };

  const toggleOne = (id: string) => {
    const next = new Set(selectedIds);
    next.has(id) ? next.delete(id) : next.add(id);
    onSelectChange(next);
  };
  if (loading) return (
    <div className="lg-cr-card"><LoadingSkeleton /></div>
  );

  if (gigs.length === 0) return (
    <div className="lg-cr-card">
      <div className="lg-empty">
        <div className="lg-empty-icon"><Briefcase size={36} /></div>
        <div className="lg-empty-title">No cancellation requests</div>
        <div className="lg-empty-sub">Gigs with a pending cancellation request will appear here.</div>
      </div>
    </div>
  );

  return (
    <div className="lg-cr-card">
      <div className="lg-card-header">
        <span className="lg-card-title">Requested Cancellations</span>
        <span className="lg-card-count">{gigs.length} request{gigs.length !== 1 ? "s" : ""}</span>
      </div>
      {crTotalPages > 1 && (
        <div style={{ fontSize: 12, color: "var(--text-muted)", padding: "6px 16px 0" }}>
          Showing {(crPage - 1) * CR_PAGE_SIZE + 1}–{Math.min(crPage * CR_PAGE_SIZE, gigs.length)} of {gigs.length}
        </div>
      )}

      {selectedIds.size > 0 && (
        <div className="lg-bulk-bar" style={{ margin: "0 0 0 0", borderRadius: 0, borderLeft: "none", borderRight: "none" }}>
          <span style={{ fontWeight: 600 }}>{selectedIds.size} selected</span>
          <button className="lg-approve-btn" onClick={onBulkApprove}>
            Approve {selectedIds.size} Cancellation{selectedIds.size !== 1 ? "s" : ""}
          </button>
          <button className="lg-bulk-clear-btn" onClick={() => onSelectChange(new Set())}>
            Clear selection
          </button>
        </div>
      )}

      <table className="lg-table">
        <thead>
          <tr>
            <th style={{ width: 36 }}>
              <input type="checkbox" className="lg-checkbox" checked={allSelected} onChange={toggleAll} title="Select all" />
            </th>
            <th>Gig ID</th>
            <th>Gig</th>
            <th>Host</th>
            <th>Type</th>
            <th>Requested By</th>
            <th>Reason</th>
            <th>Requested</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {paginatedGigs.map((gig) => (
            <tr key={gig.id} className="lg-row" onClick={() => onRowClick(gig)}>
              <td onClick={(e) => e.stopPropagation()}>
                <input
                  type="checkbox"
                  className="lg-checkbox"
                  checked={selectedIds.has(gig.id)}
                  onChange={() => toggleOne(gig.id)}
                />
              </td>
              <td onClick={(e) => e.stopPropagation()}>
                <CopyableId id={gig.id} />
              </td>
              <td>
                <div className="lg-gig-title">{gig.title || "Untitled Gig"}</div>
                {gig.salary !== undefined && gig.salary !== null && gig.salary !== "" && (
                  <div className="lg-gig-meta">{symbol}{gig.salary}</div>
                )}
              </td>
              <td>
                <span style={{ fontSize: 13, color: "var(--text-primary)" }}>
                  {(gig.hostName as string) || "—"}
                </span>
              </td>
              <td>
                <span className={`lg-badge lg-badge--type-${gig.gigType}`}>
                  {GIG_TYPE_LABELS[gig.gigType]}
                </span>
              </td>
              <td>
                {(() => {
                  const requestedBy = gig.cancellation_reason?.[0]?.requestedBy;
                  return requestedBy ? (
                    <span style={{ fontSize: 13, color: "var(--text-primary)", fontWeight: 500, textTransform: "capitalize" }}>
                      {requestedBy}
                    </span>
                  ) : (
                    <span style={{ fontSize: 12, color: "var(--text-muted)" }}>—</span>
                  );
                })()}
              </td>
              <td>
                {(() => {
                  const reason = gig.cancellation_reason?.[0]?.reason;
                  return reason ? (
                    <div className="lg-cr-reason" title={reason}>{reason}</div>
                  ) : (
                    <span style={{ fontSize: 12, color: "var(--text-muted)" }}>—</span>
                  );
                })()}
              </td>
              <td>
                <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
                  {formatDateShort(gig.cancellationRequestedAt ?? gig.createdAt)}
                </span>
              </td>
              <td onClick={(e) => e.stopPropagation()}>
                <div className="lg-actions">
                  <button
                    className="lg-approve-btn"
                    disabled={cancellingId === gig.id}
                    onClick={() => onApprove(gig)}
                    title="Approve cancellation"
                  >
                    {cancellingId === gig.id ? "…" : "Approve"}
                  </button>
                  <button
                    className="lg-reject-btn"
                    disabled={cancellingId === gig.id}
                    onClick={() => onReject(gig)}
                    title="View & reject"
                  >
                    View
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {(
        <div className="lg-pagination">
          <div className="lg-page-controls">
            <button className="lg-page-btn" onClick={() => setCrPage(1)} disabled={crPage === 1} title="First">«</button>
            <button className="lg-page-btn" onClick={() => setCrPage((p) => p - 1)} disabled={crPage === 1} title="Prev">‹</button>
            {Array.from({ length: crTotalPages }, (_, i) => i + 1)
              .filter((p) => p === 1 || p === crTotalPages || Math.abs(p - crPage) <= 1)
              .reduce<(number | string)[]>((acc, p, i, arr) => {
                if (i > 0 && (p as number) - (arr[i - 1] as number) > 1) acc.push("…");
                acc.push(p);
                return acc;
              }, [])
              .map((p, i) =>
                typeof p === "string"
                  ? <span key={`e-${i}`} className="lg-page-ellipsis">…</span>
                  : <button
                      key={p}
                      className={`lg-page-btn${crPage === p ? " lg-page-btn--active" : ""}`}
                      onClick={() => setCrPage(p as number)}
                    >{p}</button>
              )}
            <button className="lg-page-btn" onClick={() => setCrPage((p) => p + 1)} disabled={crPage === crTotalPages} title="Next">›</button>
            <button className="lg-page-btn" onClick={() => setCrPage(crTotalPages)} disabled={crPage === crTotalPages} title="Last">»</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Worker Cancellation Requests Tab ────────────────────────────────────────

function WorkerCancellationRequestsTab({
  requests, loading, fetchError, cancellingId, onRefresh, onApprove, onReject,
}: {
  requests: WorkerCancellationRequest[];
  loading: boolean;
  fetchError: string | null;
  cancellingId: string | null;
  onRefresh: () => void;
  onApprove: (req: WorkerCancellationRequest) => void;
  onReject: (req: WorkerCancellationRequest) => void;
}) {
  const WC_PAGE_SIZE = 20;
  const [wcPage, setWcPage] = useState(1);

  useEffect(() => { setWcPage(1); }, [requests.length]);

  const wcTotalPages = Math.max(1, Math.ceil(requests.length / WC_PAGE_SIZE));
  const paginated = requests.slice((wcPage - 1) * WC_PAGE_SIZE, wcPage * WC_PAGE_SIZE);

  if (loading) return (
    <div className="lg-cr-card"><LoadingSkeleton /></div>
  );

  if (fetchError) return (
    <div className="lg-cr-card">
      <div className="lg-empty">
        <div className="lg-empty-title" style={{ color: "var(--red)" }}>{fetchError}</div>
        <button className="lg-approve-btn" style={{ marginTop: 12 }} onClick={onRefresh}>Retry</button>
      </div>
    </div>
  );

  if (requests.length === 0) return (
    <div className="lg-cr-card">
      <div className="lg-empty">
        <div className="lg-empty-icon"><Users size={36} /></div>
        <div className="lg-empty-title">No worker cancellation requests</div>
        <div className="lg-empty-sub">Per-worker cancellation requests on multi-worker gigs will appear here.</div>
      </div>
    </div>
  );

  return (
    <div className="lg-cr-card">
      <div className="lg-card-header">
        <span className="lg-card-title">Worker Cancellation Requests</span>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span className="lg-card-count">{requests.length} request{requests.length !== 1 ? "s" : ""}</span>
          <button className="lg-view-btn" onClick={onRefresh} title="Refresh">
            <RefreshCw size={12} />
          </button>
        </div>
      </div>
      {wcTotalPages > 1 && (
        <div style={{ fontSize: 12, color: "var(--text-muted)", padding: "6px 16px 0" }}>
          Showing {(wcPage - 1) * WC_PAGE_SIZE + 1}–{Math.min(wcPage * WC_PAGE_SIZE, requests.length)} of {requests.length}
        </div>
      )}

      <table className="lg-table">
        <thead>
          <tr>
            <th>Gig</th>
            <th>Worker</th>
            <th>Host</th>
            <th>Requested By</th>
            <th>Reason</th>
            <th>Requested</th>
            <th>Previous Status</th>
            <th>Current Status</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {paginated.map((req) => {
            const lastEntry = req.cancellation_reason[req.cancellation_reason.length - 1];
            return (
              <tr key={req.workerDocPath} className="lg-row">
                <td>
                  <div className="lg-gig-title">{req.gigTitle}</div>
                  <CopyableId id={req.gigId} />
                </td>
                <td>
                  <div className="lg-gig-title">{req.workerName || req.workerId}</div>
                  <CopyableId id={req.workerId} />
                </td>
                <td>
                  <span style={{ fontSize: 13, color: "var(--text-primary)" }}>{req.hostName}</span>
                </td>
                <td>
                  {lastEntry?.requestedBy ? (
                    <span style={{ fontSize: 13, color: "var(--text-primary)", fontWeight: 500, textTransform: "capitalize" }}>
                      {lastEntry.requestedBy}
                    </span>
                  ) : (
                    <span style={{ fontSize: 12, color: "var(--text-muted)" }}>—</span>
                  )}
                </td>
                <td>
                  {lastEntry?.reason ? (
                    <div className="lg-cr-reason" title={lastEntry.reason}>{lastEntry.reason}</div>
                  ) : (
                    <span style={{ fontSize: 12, color: "var(--text-muted)" }}>—</span>
                  )}
                </td>
                <td>
                  <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
                    {formatDateShort(req.cancellationRequestedAt)}
                  </span>
                </td>
                <td>
                  <span className={`lg-badge ${statusBadgeClass(req.lastProgressStatus || "")}`}>
                    <span className="lg-badge-dot" />
                    {statusLabel(req.lastProgressStatus || "")}
                  </span>
                </td>
                <td>
                  <span className={`lg-badge ${statusBadgeClass(req.status)}`}>
                    <span className="lg-badge-dot" />
                    {statusLabel(req.status)}
                  </span>
                </td>
                <td>
                  <div className="lg-actions">
                    <button
                      className="lg-approve-btn"
                      disabled={cancellingId === req.workerDocPath}
                      onClick={() => onApprove(req)}
                      title="Approve cancellation"
                    >
                      {cancellingId === req.workerDocPath ? "…" : "Approve"}
                    </button>
                    <button
                      className="lg-reject-btn"
                      disabled={cancellingId === req.workerDocPath}
                      onClick={() => onReject(req)}
                      title="Reject cancellation"
                    >
                      Reject
                    </button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <div className="lg-pagination">
        <div className="lg-page-controls">
          <button className="lg-page-btn" onClick={() => setWcPage(1)} disabled={wcPage === 1} title="First">«</button>
          <button className="lg-page-btn" onClick={() => setWcPage((p) => p - 1)} disabled={wcPage === 1} title="Prev">‹</button>
          {Array.from({ length: wcTotalPages }, (_, i) => i + 1)
            .filter((p) => p === 1 || p === wcTotalPages || Math.abs(p - wcPage) <= 1)
            .reduce<(number | string)[]>((acc, p, i, arr) => {
              if (i > 0 && (p as number) - (arr[i - 1] as number) > 1) acc.push("…");
              acc.push(p);
              return acc;
            }, [])
            .map((p, i) =>
              typeof p === "string"
                ? <span key={`e-${i}`} className="lg-page-ellipsis">…</span>
                : <button
                    key={p}
                    className={`lg-page-btn${wcPage === p ? " lg-page-btn--active" : ""}`}
                    onClick={() => setWcPage(p as number)}
                  >{p}</button>
            )}
          <button className="lg-page-btn" onClick={() => setWcPage((p) => p + 1)} disabled={wcPage === wcTotalPages} title="Next">›</button>
          <button className="lg-page-btn" onClick={() => setWcPage(wcTotalPages)} disabled={wcPage === wcTotalPages} title="Last">»</button>
        </div>
      </div>
    </div>
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
  const { symbol } = useCurrency();
  const isCancelled = gig.status?.toLowerCase() === "cancelled";
  const isCompleted = gig.status?.toLowerCase() === "completed";
  const isExpired   = gig.status?.toLowerCase() === "expired";
  const canCancel   = !isCancelled && !isCompleted && !isExpired;

  const accepted = gig.applications?.filter((a) => a.status === "accepted").length ?? 0;
  const pending  = gig.applications?.filter((a) => a.status === "pending").length ?? 0;
  const rejected = gig.applications?.filter((a) => a.status === "rejected").length ?? 0;

  const isCancelRequested = gig.status?.toLowerCase() === "cancellation_requested";

  const extraFields = Object.entries(gig).filter(
    ([key, val]) =>
      !BASE_FIELDS.has(key) &&
      !["cancelledByAdmin", "cancelledByAdminId", "cancelledByAdminName", "cancellationReason", "cancellationTicketID", "cancellationRequestedAt", "cancelledAt", "cancellation_reason"].includes(key) &&
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
          <div style={{ display: "flex", alignItems: "center", gap: 4, marginBottom: 8 }}>
            <span style={{ fontSize: 11, color: "var(--text-muted)", fontFamily: "'Space Mono', monospace" }}>ID</span>
            <CopyableId id={gig.id} showFull />
          </div>
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

      {/* Cancellation request info */}
      {(isCancelRequested || (isCancelled && gig.cancellation_reason?.[0])) && (() => {
        const req = gig.cancellation_reason?.[0];
        return (
          <div className="gd-cancel-req-info">
            <div className="gd-cancel-req-title">Cancellation Request Info</div>
            {req?.requestedBy && (
              <div className="gd-cancel-req-row">
                <span className="gd-cancel-req-key">Requested by: </span>
                <span style={{ textTransform: "capitalize" }}>{req.requestedBy}</span>
              </div>
            )}
            {req?.reason && (
              <div className="gd-cancel-req-row">
                <span className="gd-cancel-req-key">Reason: </span>{req.reason}
              </div>
            )}
            {gig.cancellationRequestedAt && (
              <div className="gd-cancel-req-row">
                <span className="gd-cancel-req-key">Requested at: </span>{formatDate(gig.cancellationRequestedAt)}
              </div>
            )}
          </div>
        );
      })()}

      {/* Cancellation info (admin-cancelled) */}
      {isCancelled && (gig.cancelledByAdmin || gig.cancelledByAdminName || gig.cancelledByAdminId) && (
        <div className="gd-cancel-info" style={{ marginBottom: 20 }}>
          <div className="gd-cancel-info-row">
            <span className="gd-cancel-info-key">Cancelled by admin: </span>
            {gig.cancelledByAdminName ?? "Admin"}
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
          {gig.cancelledAt && (
            <div className="gd-cancel-info-row">
              <span className="gd-cancel-info-key">Cancelled at: </span>{formatDate(gig.cancelledAt)}
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
              <span className="gd-field-val">{symbol}{gig.salary}</span>
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

// ─── Copyable ID ──────────────────────────────────────────────────────────────

function CopyableId({ id, showFull }: { id: string; showFull?: boolean }) {
  const [copied, setCopied] = useState(false);
  return (
    <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
      <span style={{ fontFamily: "'Space Mono', monospace", fontSize: 11, color: "var(--text-muted)" }}>
        {showFull ? id : `${id.slice(0, 8)}…`}
      </span>
      <button
        onClick={() => {
          navigator.clipboard.writeText(id);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
        title={copied ? "Copied!" : "Copy full ID"}
        style={{
          display: "flex", alignItems: "center",
          color: copied ? "var(--green)" : "var(--text-muted)",
          background: "none", border: "none", cursor: "pointer",
          padding: 2, transition: "color 0.15s", flexShrink: 0,
        }}
      >
        {copied ? <Check size={11} /> : <Copy size={11} />}
      </button>
    </span>
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

// ── GSIN: assign a task type (→ GSINS + GSKU) to one gig ─────────────────────

const GIG_CODE_COLLECTION: Record<GigType, GigCollection> = { quick: "quick_gigs", open: "open_gigs", offered: "offered_gigs" };

function AssignCodesModal({ gig, onClose, onAssigned }: {
  gig: Gig;
  onClose: () => void;
  onAssigned: (codes: { taskTypeId: string; gsins?: string; gsku?: string }) => void;
}) {
  const [cats, setCats] = useState<GsinCategory[]>([]);
  const [subs, setSubs] = useState<GsinSubcategory[]>([]);
  const [tasks, setTasks] = useState<GsinTaskType[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState<string>(gig.taskTypeId ?? "");
  const [saving, setSaving] = useState(false);

  useEffect(() => watchGsinCatalog(
    (c) => { setCats(c.categories); setSubs(c.subcategories); setTasks(c.taskTypes); },
    () => setLoadError("Couldn't load the GSIN Library."),
  ), []);

  const label = (t: GsinTaskType) => {
    const sub = subs.find((s) => s.id === t.subcategoryId);
    const cat = cats.find((c) => c.id === t.categoryId);
    return `${cat?.name ?? t.categoryId} › ${sub?.name ?? t.subcategoryId}`;
  };
  // Task types linked to this gig's skill come first ("Suggested").
  const gigSkill = String(
    (Array.isArray(gig.requiredSkills) ? (gig.requiredSkills as unknown[])[0] : undefined) ?? gig.skillRequired ?? gig.requiredSkill ?? "",
  );
  const suggested = new Set(gig.gsinCandidates ?? []);
  const list = (tasks ?? []).filter((t) => {
    const needle = q.trim().toLowerCase();
    return !needle || `${t.name} ${t.gsins} ${label(t)}`.toLowerCase().includes(needle);
  }).sort((a, b) => Number(suggested.has(b.id)) - Number(suggested.has(a.id)));

  const save = async () => {
    if (!picked) return;
    setSaving(true);
    try {
      const r = await assignGigTaskType({ collection: GIG_CODE_COLLECTION[gig.gigType], gigId: gig.id, taskTypeId: picked });
      toast.success("Codes assigned", r.gsku ? `${r.gsins} · ${r.gsku}` : undefined);
      onAssigned({ taskTypeId: picked, gsins: r.gsins, gsku: r.gsku });
    } catch (err) {
      toast.error("Couldn't assign", callableError(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open onClose={saving ? () => {} : onClose} size="md" title={gig.gsku ? "Change task type" : "Assign task type"}
      footer={<>
        <Button variant="ghost" onClick={onClose} disabled={saving}>Cancel</Button>
        <Button onClick={save} loading={saving} disabled={!picked || picked === gig.taskTypeId || saving}>
          {gig.gsku ? "Re-assign codes" : "Assign codes"}
        </Button>
      </>}>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ fontSize: 13, color: "var(--text-secondary)" }}>
          <b style={{ color: "var(--text-primary)" }}>{gig.title || "Untitled Gig"}</b> · {GIG_TYPE_LABELS[gig.gigType]}
          {gigSkill && <div style={{ marginTop: 4, fontSize: 12 }}>Skill: <b>{gigSkill}</b>{suggested.size > 1 ? ` — linked to ${suggested.size} task types, suggested below` : ""}</div>}
          {gig.gsku && <div style={{ marginTop: 4, fontSize: 12 }}>Current: <span className="lg-code">{gig.gsins} · {gig.gsku}</span> — re-assigning gives it a new GSKU (the old one is kept in its history).</div>}
        </div>
        <input
          placeholder="Search task types…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          style={{ padding: "8px 10px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg-elevated)", color: "var(--text-primary)", fontFamily: "inherit", fontSize: 13 }}
        />
        <div style={{ maxHeight: 300, overflowY: "auto", border: "1px solid var(--border)", borderRadius: 8 }}>
          {loadError ? <div style={{ padding: 12, fontSize: 12, color: "var(--red)" }}>{loadError}</div>
            : tasks == null ? <div style={{ padding: 12, fontSize: 12, color: "var(--text-muted)" }}>Loading…</div>
            : list.length === 0 ? (
              <div style={{ padding: 12, fontSize: 12, color: "var(--text-muted)" }}>
                {tasks.length === 0 ? <>No task types yet — add them in <a href="/library-gsin" style={{ color: "var(--blue)" }}>GSIN Library</a>.</> : "No match."}
              </div>
            ) : list.map((t) => (
              <label key={t.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", cursor: "pointer", borderBottom: "1px solid var(--border)", background: picked === t.id ? "var(--blue-dim)" : "transparent" }}>
                <input type="radio" name="gsin-task" checked={picked === t.id} onChange={() => setPicked(t.id)} />
                <span className="lg-code" style={{ minWidth: 92 }}>{t.gsins}</span>
                <span style={{ flex: 1, fontSize: 13, color: "var(--text-primary)" }}>
                  {t.name}
                  {suggested.has(t.id) && <span style={{ marginLeft: 6, fontSize: 10, fontWeight: 700, color: "var(--blue)" }}>SUGGESTED</span>}
                  <span style={{ display: "block", fontSize: 11, color: "var(--text-muted)" }}>{label(t)}</span>
                </span>
              </label>
            ))}
        </div>
      </div>
    </Modal>
  );
}
