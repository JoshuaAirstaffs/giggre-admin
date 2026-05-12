"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import JSZip from "jszip";
import AdminLayout from "@/components/layout/AdminLayout";
import Modal from "@/components/ui/Modal";
import Button from "@/components/ui/Button";
import { useAuthGuard } from "@/hooks/useAuthGuard";
import {
  collection,
  onSnapshot,
  doc,
  updateDoc,
  addDoc,
  getDocs,
  serverTimestamp,
  Timestamp,
  query,
  orderBy,
  where,
} from "firebase/firestore";
import { db, storage } from "@/lib/firebase";
import { ref, getBlob, getMetadata } from "firebase/storage";
import { writeLog } from "@/lib/activitylog";
import {
  Search, RefreshCw, BadgeCheck, XCircle, Clock, X,
  User, Phone, Mail, Hash, Image as ImageIcon, AlertTriangle,
  CheckCircle, Plus, UserSearch, Send, FileText,
  ChevronLeft, ChevronRight, Bell, MessageSquare, Copy,
  ZoomIn, ZoomOut, RotateCcw, RotateCw, Maximize2,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface PickedUser {
  id: string;
  name: string;
  email: string;
  phone: string;
  photoUrl: string;
}

interface VerificationDocument {
  category: string;
  name: string;
  storagePath: string;
  url: string;
  uploadedAt: Timestamp | null;
}

interface VerificationRequest {
  id: string;
  userId: string;
  name: string;
  email: string;
  phone: string;
  photoUrl: string;
  documents: VerificationDocument[];
  status: "pending" | "verified" | "rejected" | "cancelled";
  attemptCount: number;
  submittedAt: Timestamp | null;
  reviewedAt: Timestamp | null;
  reviewedBy: string | null;
  rejectReason: string | null;
  updatedAt: Timestamp | null;
}

interface TimelineEntry {
  action: string;
  actorName: string;
  date: Date | null;
  description?: string;
  lastViewedAt?: Date | null;
  viewCount?: number;
  lastDownloadedAt?: Date | null;
  downloadCount?: number;
  documentName?: string;
  storagePath?: string;
}

type StatusFilter = "all" | "pending" | "verified" | "rejected" | "cancelled";

interface NotificationDoc {
  id: string;
  userId: string;
  userName: string;
  userEmail: string;
  message: string;
  category: string;
  verification_status: string;
  read: boolean;
  createdAt: Timestamp | null;
  createdBy: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const PAGE_SIZE = 15;

const TIMELINE_CONFIG: Record<string, { label: string; color: string; glow: string }> = {
  verification_created: { label: "Submitted", color: "var(--blue)", glow: "rgba(59,130,246,0.18)" },
  verification_verified: { label: "Verified", color: "var(--green)", glow: "rgba(34,197,94,0.18)" },
  verification_rejected: { label: "Rejected", color: "var(--red)", glow: "rgba(239,68,68,0.18)" },
  verification_note: { label: "Verification Notification", color: "var(--text-secondary)", glow: "rgba(100,116,139,0.18)" },
  verification_document_viewed: { label: "Viewed Document", color: "var(--text-muted)", glow: "rgba(100,116,139,0.12)" },
  // verification_document_downloaded: hidden for now
};

const NOTIF_PRESETS = [
  {
    id: "verified",
    label: "Account Verified",
    message: "Your account has been successfully verified. You now have full access to all features.",
    preview: null,
  },
  {
    id: "in_progress",
    label: "Verification In Progress",
    message: "We've received your documents. Verification is currently in progress.",
    preview: null,
  },
  {
    id: "not_approved",
    label: "Not Approved (with reason)",
    message: null,
    preview: "Your verification request was not approved. Reason: [user input]. You may submit a new request anytime.",
  },
  {
    id: "more_info",
    label: "Additional Info Required",
    message: "Additional information is required to complete your verification. Please upload the requested documents.",
    preview: null,
  },
  {
    id: "custom",
    label: "Custom message",
    message: null,
    preview: null,
  },
] as const;

type NotifPresetId = (typeof NOTIF_PRESETS)[number]["id"];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDate(ts: Timestamp | null): string {
  if (!ts) return "—";
  return ts.toDate().toLocaleString("en-US", {
    month: "short", day: "numeric", year: "numeric",
    hour: "numeric", minute: "2-digit",
  });
}

function getAgeDays(ts: Timestamp | null): number | null {
  if (!ts) return null;
  return Math.floor((Date.now() - ts.toDate().getTime()) / 86_400_000);
}

function AgeBadge({ days, inline = false }: { days: number | null; inline?: boolean }) {
  if (days === null) return null;
  const color = days >= 7 ? "var(--red)" : days >= 3 ? "var(--yellow)" : "var(--text-muted)";
  const label = days === 0 ? "Today" : `${days}d waiting`;
  return (
    <span style={{
      fontSize: 10, fontWeight: 700, color,
      display: inline ? "inline-flex" : "block",
      alignItems: "center", gap: 3,
      marginTop: inline ? 0 : 2,
      marginLeft: inline ? 8 : 0,
    }}>
      {days >= 3 && <span style={{ fontSize: 9 }}>⚠</span>}
      {label}
    </span>
  );
}

const STATUS_BADGE: Record<string, { icon: React.ReactNode }> = {
  pending: { icon: <Clock size={12} /> },
  verified: { icon: <CheckCircle size={12} /> },
  rejected: { icon: <XCircle size={12} /> },
};

// ─── Doc Viewer Modal ─────────────────────────────────────────────────────────

function getDocType(filename: string): "image" | "pdf" | "other" {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  if (["jpg", "jpeg", "png", "gif", "webp", "bmp"].includes(ext)) return "image";
  if (ext === "pdf") return "pdf";
  return "other";
}

function DocViewerModal({ doc, onClose }: { doc: VerificationDocument | null; onClose: () => void }) {
  const [zoom, setZoom] = useState(1);
  const [rotate, setRotate] = useState(0);

  // Reset transform whenever a new doc is opened
  useEffect(() => { setZoom(1); setRotate(0); }, [doc]);

  if (!doc) return null;
  const type = getDocType(doc.name);
  const displayName = doc.name.replace(/[<>"'&]/g, "");
  const categoryLabel = doc.category.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

  const zoomIn  = () => setZoom((z) => Math.min(+(z + 0.25).toFixed(2), 4));
  const zoomOut = () => setZoom((z) => Math.max(+(z - 0.25).toFixed(2), 0.25));
  const reset   = () => { setZoom(1); setRotate(0); };

  const onWheel = (e: React.WheelEvent) => {
    if (type !== "image") return;
    e.preventDefault();
    e.deltaY < 0 ? zoomIn() : zoomOut();
  };

  const ctrlBtn = (onClick: () => void, title: string, children: React.ReactNode, disabled = false) => (
    <button
      onClick={onClick}
      title={title}
      disabled={disabled}
      style={{
        width: 28, height: 28, display: "flex", alignItems: "center", justifyContent: "center",
        borderRadius: 6, border: "1px solid var(--border)", background: "transparent",
        color: disabled ? "var(--text-muted)" : "var(--text-secondary)",
        cursor: disabled ? "not-allowed" : "pointer", transition: "all 0.15s", opacity: disabled ? 0.4 : 1,
      }}
    >
      {children}
    </button>
  );

  return (
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 2000,
        background: "rgba(0,0,0,0.82)", backdropFilter: "blur(6px)",
        display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
        padding: 24,
      }}
      onClick={onClose}
    >
      <style>{`
        .dv-box { background: var(--bg-surface); border: 1px solid var(--border); border-radius: 14px;
          display: flex; flex-direction: column; max-height: 92vh; width: 100%; max-width: 820px;
          overflow: hidden; }
        .dv-header { display: flex; align-items: center; justify-content: space-between; gap: 12px;
          padding: 14px 18px; border-bottom: 1px solid var(--border); flex-shrink: 0; }
        .dv-title { font-size: 14px; font-weight: 600; color: var(--text-primary); }
        .dv-category { font-size: 11px; color: var(--text-muted); margin-top: 2px; }
        .dv-actions { display: flex; gap: 8px; align-items: center; }
        .dv-toolbar { display: flex; align-items: center; gap: 6px; padding: 8px 18px;
          border-bottom: 1px solid var(--border); flex-shrink: 0; background: var(--bg-elevated); }
        .dv-zoom-label { font-size: 12px; color: var(--text-muted); min-width: 38px; text-align: center; }
        .dv-divider { width: 1px; height: 18px; background: var(--border); margin: 0 4px; }
        .dv-body { flex: 1; overflow: auto; display: flex; align-items: center; justify-content: center;
          background: var(--bg-base); min-height: 320px; }
        .dv-other { display: flex; flex-direction: column; align-items: center; justify-content: center;
          gap: 12px; padding: 48px; text-align: center; }
        .dv-other-icon { color: var(--text-muted); opacity: 0.5; }
        .dv-other-name { font-size: 14px; color: var(--text-secondary); word-break: break-all; }
        .dv-other-note { font-size: 12px; color: var(--text-muted); }
        .dv-close { width: 28px; height: 28px; display: flex; align-items: center; justify-content: center;
          border-radius: 6px; color: var(--text-muted); cursor: pointer; transition: all 0.15s; border: none;
          background: transparent; }
        .dv-close:hover { background: var(--bg-elevated); color: var(--text-primary); }
        .dv-open-btn { font-size: 12px; color: var(--text-muted); text-decoration: none; padding: 4px 8px;
          border-radius: 5px; border: 1px solid var(--border); transition: all 0.15s; }
        .dv-open-btn:hover { background: var(--bg-elevated); color: var(--text-primary); }
      `}</style>
      <div className="dv-box" onClick={(e) => e.stopPropagation()}>

        {/* Header */}
        <div className="dv-header">
          <div>
            <div className="dv-title">{displayName}</div>
            <div className="dv-category">{categoryLabel}</div>
          </div>
          <div className="dv-actions">
            <a href={doc.url} target="_blank" rel="noreferrer noopener" className="dv-open-btn">
              Open in new tab ↗
            </a>
            <button className="dv-close" onClick={onClose} aria-label="Close">
              <X size={15} />
            </button>
          </div>
        </div>

        {/* Zoom / Rotate toolbar — images only */}
        {type === "image" && (
          <div className="dv-toolbar">
            {ctrlBtn(zoomOut, "Zoom out", <ZoomOut size={13} />, zoom <= 0.25)}
            <span className="dv-zoom-label">{Math.round(zoom * 100)}%</span>
            {ctrlBtn(zoomIn,  "Zoom in",  <ZoomIn  size={13} />, zoom >= 4)}
            <div className="dv-divider" />
            {ctrlBtn(() => setRotate((r) => (r - 90 + 360) % 360), "Rotate left",  <RotateCcw size={13} />)}
            {ctrlBtn(() => setRotate((r) => (r + 90) % 360),       "Rotate right", <RotateCw  size={13} />)}
            <div className="dv-divider" />
            {ctrlBtn(reset, "Reset", <Maximize2 size={13} />, zoom === 1 && rotate === 0)}
          </div>
        )}

        {/* Body */}
        <div className="dv-body" onWheel={onWheel}>
          {type === "image" && (
            <div style={{ padding: 16, display: "flex", alignItems: "center", justifyContent: "center", minWidth: "100%", minHeight: "100%" }}>
              <img
                src={doc.url}
                alt={displayName}
                style={{
                  maxWidth: zoom <= 1 ? "100%" : "none",
                  maxHeight: zoom <= 1 ? "70vh" : "none",
                  transform: `rotate(${rotate}deg) scale(${zoom})`,
                  transformOrigin: "center center",
                  transition: "transform 0.15s ease",
                  borderRadius: 6,
                  display: "block",
                }}
              />
            </div>
          )}
          {type === "pdf" && (
            <iframe
              src={doc.url}
              title={displayName}
              sandbox="allow-scripts allow-same-origin"
              style={{ width: "100%", height: "75vh", border: "none" }}
            />
          )}
          {type === "other" && (
            <div className="dv-other">
              <FileText size={48} className="dv-other-icon" />
              <div className="dv-other-name">{displayName}</div>
              <div className="dv-other-note">This file type cannot be previewed in the browser.</div>
              <a
                href={doc.url}
                download={displayName}
                rel="noreferrer noopener"
                style={{
                  fontSize: 13, padding: "7px 16px", borderRadius: 7,
                  background: "var(--blue)", color: "#fff", textDecoration: "none",
                }}
              >
                Download file
              </a>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function VerificationPage() {
  const { user } = useAuthGuard({ module: "verification" });

  // ── Data ──────────────────────────────────────────────────────────────────
  const [requests, setRequests] = useState<VerificationRequest[]>([]);
  const [loading, setLoading] = useState(true);

  // ── Filters & pagination ──────────────────────────────────────────────────
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("pending");
  const [sortOrder, setSortOrder] = useState<"newest" | "oldest">("newest");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [page, setPage] = useState(1);

  // ── Detail / review modal ─────────────────────────────────────────────────
  const [selected, setSelected] = useState<VerificationRequest | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [actionMode, setActionMode] = useState<"approve" | "reject" | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // ── History / notes ───────────────────────────────────────────────────────
  const [timeline, setTimeline] = useState<TimelineEntry[]>([]);
  const [timelineLoading, setTimelineLoading] = useState(false);
  const [timelineKey, setTimelineKey] = useState(0);
  const [noteText, setNoteText] = useState("");
  const [addingNote, setAddingNote] = useState(false);

  // ── Create request modal ──────────────────────────────────────────────────
  const [createOpen, setCreateOpen] = useState(false);
  const [allUsers, setAllUsers] = useState<PickedUser[]>([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [userSearch, setUserSearch] = useState("");
  const [pickedUser, setPickedUser] = useState<PickedUser | null>(null);
  const [creating, setCreating] = useState(false);

  // ── Document viewer ───────────────────────────────────────────────────────
  const [docViewer, setDocViewer] = useState<VerificationDocument | null>(null);
  const [missingDocs, setMissingDocs] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!selected?.documents?.length) { setMissingDocs(new Set()); return; }
    setMissingDocs(new Set());
    Promise.all(
      selected.documents.map(async (d) => {
        try {
          await getMetadata(ref(storage, d.storagePath));
        } catch {
          setMissingDocs((prev) => new Set(prev).add(d.storagePath));
        }
      })
    );
  }, [selected]);
  const [downloadingAll, setDownloadingAll] = useState(false);
  const [downloadResult, setDownloadResult] = useState<{
    success: string[];
    failed: string[];
  } | null>(null);

  const handleDownloadAll = useCallback(async (docs: VerificationDocument[], req: VerificationRequest) => {
    if (!docs.length) return;
    setDownloadingAll(true);
    const success: string[] = [];
    const failed: string[] = [];
    const successDocs: VerificationDocument[] = [];
    try {
      const zip = new JSZip();
      await Promise.all(
        docs.map(async (d) => {
          try {
            const blob = await getBlob(ref(storage, d.storagePath));
            zip.file(d.name, blob);
            success.push(d.name);
            successDocs.push(d);
          } catch {
            failed.push(d.name);
          }
        })
      );
      if (success.length > 0) {
        const content = await zip.generateAsync({ type: "blob" });
        const a = document.createElement("a");
        a.href = URL.createObjectURL(content);
        a.download = `${req.name.replace(/\s+/g, "_")}_documents.zip`;
        a.click();
        URL.revokeObjectURL(a.href);
      }
      setDownloadResult({ success, failed });
      if (user && successDocs.length > 0) {
        await Promise.all(successDocs.map((d) => logDocumentDownload(d, req)));
        setTimelineKey((k) => k + 1);
      }
    } finally {
      setDownloadingAll(false);
    }
  }, [user]);

  // ── Scroll persistence ────────────────────────────────────────────────────
  const scrollPositions = useRef<Map<string, number>>(new Map());
  const timelineRef = useRef<HTMLDivElement>(null);

  // ── Doc log cache (avoid full query on repeat view/download) ─────────────
  const docLogCache = useRef<Map<string, { viewId?: string; downloadId?: string }>>(new Map());
  useEffect(() => { docLogCache.current.clear(); }, [selected?.id]);

  // ── Scroll restore when same request is reopened ──────────────────────────
  useEffect(() => {
    if (!selected || !timelineRef.current) return;
    const saved = scrollPositions.current.get(selected.id) ?? 0;
    timelineRef.current.scrollTop = saved;
  }, [selected?.id, timelineLoading]);

  // ── Jump-to-request userId (set after approve/reject) ─────────────────────
  const [jumpToReqUserId, setJumpToReqUserId] = useState<string | null>(null);

  // ── Copy feedback ─────────────────────────────────────────────────────────
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const copyToClipboard = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 1500);
  };

  // ── Page-level tab ────────────────────────────────────────────────────────
  const [activePageTab, setActivePageTab] = useState<"notifications" | "requests" | "send_notification">("requests");

  // ── Notifications list ────────────────────────────────────────────────────
  const [notifDocs, setNotifDocs] = useState<NotificationDoc[]>([]);
  const [notifDocsLoading, setNotifDocsLoading] = useState(true);
  const [notifStatusFilter, setNotifStatusFilter] = useState<"all" | "pending" | "verified" | "unverified">("all");
  const [notifSearch, setNotifSearch] = useState("");
  const [notifSortOrder, setNotifSortOrder] = useState<"newest" | "oldest">("newest");
  const [notifDateFrom, setNotifDateFrom] = useState("");
  const [notifDateTo, setNotifDateTo] = useState("");
  const [notifPage, setNotifPage] = useState(1);

  // ── Send notification form ────────────────────────────────────────────────
  const [notifUserSearch, setNotifUserSearch] = useState("");
  const [notifUser, setNotifUser] = useState<PickedUser | null>(null);
  const [notifPreset, setNotifPreset] = useState<NotifPresetId | "">("");
  const [notifRejectReason, setNotifRejectReason] = useState("");
  const [notifCustomMessage, setNotifCustomMessage] = useState("");
  const [notifVerificationStatus, setNotifVerificationStatus] = useState<"pending" | "verified" | "unverified" | "">("");
  const [sendingNotif, setSendingNotif] = useState(false);
  const [notifSent, setNotifSent] = useState(false);

  // ─── Firestore listener ───────────────────────────────────────────────────

  useEffect(() => {
    const q = query(
      collection(db, "verification_requests"),
      orderBy("submittedAt", "desc")
    );
    const unsub = onSnapshot(q, (snap) => {
      const data: VerificationRequest[] = snap.docs.map((d) => ({
        id: d.id,
        userId: d.data().userId ?? "",
        name: d.data().name ?? "",
        email: d.data().email ?? "",
        phone: d.data().phone ?? "",
        photoUrl: d.data().photoUrl ?? "",
        documents: d.data().documents ?? [],
        status: d.data().status ?? "pending",
        attemptCount: d.data().attemptCount ?? 1,
        submittedAt: d.data().submittedAt ?? null,
        reviewedAt: d.data().reviewedAt ?? null,
        reviewedBy: d.data().reviewedBy ?? null,
        rejectReason: d.data().rejectReason ?? null,
        updatedAt: d.data().updatedAt ?? null,
      }));
      setRequests(data);
      setLoading(false);
    });
    return () => unsub();
  }, []);

  // ─── Notifications listener ───────────────────────────────────────────────

  useEffect(() => {
    const q = query(
      collection(db, "notifications"),
      where("category", "==", "account_verification")
    );
    const unsub = onSnapshot(q, (snap) => {
      setNotifDocs(snap.docs.map((d) => ({
        id: d.id,
        userId: d.data().userId ?? "",
        userName: d.data().userName ?? "",
        userEmail: d.data().userEmail ?? "",
        message: d.data().message ?? "",
        category: d.data().category ?? "",
        verification_status: d.data().verification_status ?? "",
        read: d.data().read ?? false,
        createdAt: d.data().createdAt ?? null,
        createdBy: d.data().createdBy ?? "",
      })).sort((a, b) => (b.createdAt?.toMillis() ?? 0) - (a.createdAt?.toMillis() ?? 0)));
      setNotifDocsLoading(false);
    });
    return () => unsub();
  }, []);

  // ─── Timeline fetch ───────────────────────────────────────────────────────

  useEffect(() => {
    if (!selected) { setTimeline([]); return; }
    setTimelineLoading(true);
    getDocs(
      query(
        collection(db, "activityLogs"),
        where("targetId", "==", selected.userId),
        where("module", "==", "verification"),
      )
    ).then((snap) => {
      const rawEntries = snap.docs
        .map((d) => {
          const data = d.data();
          return {
            action: data.action ?? "",
            actorName: data.actorName ?? "Unknown",
            date: data.createdAt?.toDate?.() ?? null,
            description: data.description ?? undefined,
            lastViewedAt: data.meta?.other?.lastViewedAt?.toDate?.() ?? null,
            viewCount: data.meta?.other?.viewCount ?? 1,
            lastDownloadedAt: data.meta?.other?.lastDownloadedAt?.toDate?.() ?? null,
            downloadCount: data.meta?.other?.downloadCount ?? 1,
            documentName: data.meta?.other?.documentName ?? undefined,
            storagePath: data.meta?.other?.storagePath ?? undefined,
          };
        })
        .filter((e) => e.action in TIMELINE_CONFIG);

      // Merge view/download entries for the same document into one timeline entry each
      const viewMap = new Map<string, TimelineEntry>();
      const downloadMap = new Map<string, TimelineEntry>();
      const nonGroupedEntries: TimelineEntry[] = [];

      for (const e of rawEntries) {
        if (e.action === "verification_document_viewed") {
          const key = e.storagePath ?? e.documentName ?? e.description ?? "unknown";
          const existing = viewMap.get(key);
          if (!existing) {
            viewMap.set(key, { ...e });
          } else {
            if (e.date && (!existing.date || e.date < existing.date)) existing.date = e.date;
            const eLatest = e.lastViewedAt ?? e.date;
            const exLatest = existing.lastViewedAt ?? existing.date;
            if (eLatest && (!exLatest || eLatest > exLatest)) existing.lastViewedAt = eLatest;
            existing.viewCount = (existing.viewCount ?? 1) + (e.viewCount ?? 1);
          }
        } else if (e.action === "verification_document_downloaded") {
          const key = e.storagePath ?? e.documentName ?? e.description ?? "unknown";
          const existing = downloadMap.get(key);
          if (!existing) {
            downloadMap.set(key, { ...e });
          } else {
            if (e.date && (!existing.date || e.date < existing.date)) existing.date = e.date;
            const eLatest = e.lastDownloadedAt ?? e.date;
            const exLatest = existing.lastDownloadedAt ?? existing.date;
            if (eLatest && (!exLatest || eLatest > exLatest)) existing.lastDownloadedAt = eLatest;
            existing.downloadCount = (existing.downloadCount ?? 1) + (e.downloadCount ?? 1);
          }
        } else {
          nonGroupedEntries.push(e);
        }
      }

      const entries: TimelineEntry[] = [
        ...nonGroupedEntries,
        ...Array.from(viewMap.values()),
        ...Array.from(downloadMap.values()),
      ].sort((a, b) => (b.date?.getTime() ?? 0) - (a.date?.getTime() ?? 0));

      setTimeline(entries);
    })
      .catch(() => setTimeline([]))
      .finally(() => setTimelineLoading(false));
  }, [selected?.id, timelineKey]);

  // ─── Add note ─────────────────────────────────────────────────────────────

  const handleAddNote = useCallback(async () => {
    if (!selected || !user || !noteText.trim()) return;
    setAddingNote(true);
    try {
      await Promise.all([
        writeLog({
          actorId: user.uid,
          actorName: user.displayName ?? "Admin",
          actorEmail: user.email ?? undefined,
          module: "verification",
          action: "verification_note",
          description: noteText.trim(),
          targetId: selected.userId,
          targetName: selected.name,
        }),
        updateDoc(doc(db, "verification_requests", selected.id), {
          updatedAt: serverTimestamp(),
        }),
      ]);
      setNoteText("");
      setTimelineKey((k) => k + 1);
      if (selected) scrollPositions.current.delete(selected.id);
      setTimeout(() => { if (timelineRef.current) timelineRef.current.scrollTop = 0; }, 120);
    } finally {
      setAddingNote(false);
    }
  }, [selected, user, noteText]);

  // ─── Log document view (upsert — one entry per admin per document) ───────

  const logDocumentView = useCallback(async (viewedDoc: VerificationDocument, req: VerificationRequest) => {
    if (!user) return;
    try {
      const cacheKey = viewedDoc.storagePath;
      const cached = docLogCache.current.get(cacheKey);
      const cachedViewId = cached?.viewId;

      if (cachedViewId) {
        // Fast path: we already know the doc ID, skip the query
        const snap = await getDocs(query(
          collection(db, "activityLogs"),
          where("targetId", "==", req.userId),
          where("module", "==", "verification"),
        ));
        const existing = snap.docs.find((d) => d.id === cachedViewId);
        const prev = existing?.data().meta?.other?.viewCount ?? 1;
        await updateDoc(doc(db, "activityLogs", cachedViewId), {
          "meta.other.lastViewedAt": serverTimestamp(),
          "meta.other.viewCount": prev + 1,
        });
      } else {
        const snap = await getDocs(query(
          collection(db, "activityLogs"),
          where("targetId", "==", req.userId),
          where("module", "==", "verification"),
        ));
        const existing = snap.docs.find(
          (d) =>
            d.data().action === "verification_document_viewed" &&
            d.data().actorId === user.uid &&
            d.data().meta?.other?.storagePath === viewedDoc.storagePath
        );
        if (existing) {
          docLogCache.current.set(cacheKey, { ...cached, viewId: existing.id });
          const prev = existing.data().meta?.other?.viewCount ?? 1;
          await updateDoc(doc(db, "activityLogs", existing.id), {
            "meta.other.lastViewedAt": serverTimestamp(),
            "meta.other.viewCount": prev + 1,
          });
        } else {
          const newDoc = await addDoc(collection(db, "activityLogs"), {
            actorId: user.uid,
            actorName: user.displayName ?? "Admin",
            actorEmail: user.email ?? null,
            module: "verification",
            action: "verification_document_viewed",
            description: `Viewed document "${viewedDoc.name}" (${viewedDoc.category})`,
            targetId: req.userId,
            targetName: req.name,
            affectedFiles: [],
            meta: {
              from: null, to: null,
              other: {
                documentName: viewedDoc.name,
                storagePath: viewedDoc.storagePath,
                viewCount: 1,
                lastViewedAt: null,
              },
            },
            createdAt: serverTimestamp(),
          });
          docLogCache.current.set(cacheKey, { ...cached, viewId: newDoc.id });
        }
      }
      setTimelineKey((k) => k + 1);
    } catch (err) {
      console.warn("[logDocumentView] failed:", err);
    }
  }, [user]);

  // ─── Log document download (upsert — one entry per admin per document) ──

  const logDocumentDownload = useCallback(async (downloadedDoc: VerificationDocument, req: VerificationRequest) => {
    if (!user) return;
    try {
      const cacheKey = downloadedDoc.storagePath;
      const cached = docLogCache.current.get(cacheKey);
      const cachedDownloadId = cached?.downloadId;

      if (cachedDownloadId) {
        const snap = await getDocs(query(
          collection(db, "activityLogs"),
          where("targetId", "==", req.userId),
          where("module", "==", "verification"),
        ));
        const existing = snap.docs.find((d) => d.id === cachedDownloadId);
        const prev = existing?.data().meta?.other?.downloadCount ?? 1;
        await updateDoc(doc(db, "activityLogs", cachedDownloadId), {
          "meta.other.lastDownloadedAt": serverTimestamp(),
          "meta.other.downloadCount": prev + 1,
        });
      } else {
        const snap = await getDocs(query(
          collection(db, "activityLogs"),
          where("targetId", "==", req.userId),
          where("module", "==", "verification"),
        ));
        const existing = snap.docs.find(
          (d) =>
            d.data().action === "verification_document_downloaded" &&
            d.data().actorId === user.uid &&
            d.data().meta?.other?.storagePath === downloadedDoc.storagePath
        );
        if (existing) {
          docLogCache.current.set(cacheKey, { ...cached, downloadId: existing.id });
          const prev = existing.data().meta?.other?.downloadCount ?? 1;
          await updateDoc(doc(db, "activityLogs", existing.id), {
            "meta.other.lastDownloadedAt": serverTimestamp(),
            "meta.other.downloadCount": prev + 1,
          });
        } else {
          const newDoc = await addDoc(collection(db, "activityLogs"), {
            actorId: user.uid,
            actorName: user.displayName ?? "Admin",
            actorEmail: user.email ?? null,
            module: "verification",
            action: "verification_document_downloaded",
            description: `Downloaded "${downloadedDoc.name}" (${downloadedDoc.category})`,
            targetId: req.userId,
            targetName: req.name,
            affectedFiles: [],
            meta: {
              from: null, to: null,
              other: {
                documentName: downloadedDoc.name,
                storagePath: downloadedDoc.storagePath,
                downloadCount: 1,
                lastDownloadedAt: null,
              },
            },
            createdAt: serverTimestamp(),
          });
          docLogCache.current.set(cacheKey, { ...cached, downloadId: newDoc.id });
        }
      }
    } catch (err) {
      console.warn("[logDocumentDownload] failed:", err);
    }
  }, [user]);

  // ─── Shared user loader ───────────────────────────────────────────────────

  const loadAllUsers = useCallback(async () => {
    if (allUsers.length > 0) return;
    setUsersLoading(true);
    try {
      const snap = await getDocs(query(collection(db, "users"), orderBy("name")));
      setAllUsers(snap.docs.map((d) => ({
        id: d.id,
        name: d.data().name ?? "No Name",
        email: d.data().email ?? "",
        phone: d.data().phone ?? "",
        photoUrl: d.data().photoUrl ?? d.data().photoURL ?? "",
      })));
    } finally {
      setUsersLoading(false);
    }
  }, [allUsers.length]);

  // ─── Load users when create modal opens ──────────────────────────────────

  const openCreateModal = useCallback(async () => {
    setCreateOpen(true);
    setPickedUser(null);
    setUserSearch("");
    await loadAllUsers();
  }, [loadAllUsers]);

  const filteredUsers = useMemo(() => {
    const q = userSearch.toLowerCase().trim();
    if (!q) return allUsers;
    return allUsers.filter(
      (u) =>
        u.name.toLowerCase().includes(q) ||
        u.email.toLowerCase().includes(q) ||
        u.phone.includes(q) ||
        u.id.toLowerCase().includes(q)
    );
  }, [allUsers, userSearch]);

  const existingUserIds = useMemo(
    () => new Set(requests.map((r) => r.userId)),
    [requests]
  );

  // ─── Create handler ───────────────────────────────────────────────────────

  const handleCreate = useCallback(async () => {
    if (!pickedUser || !user) return;
    setCreating(true);
    try {
      const existing = requests.find((r) => r.userId === pickedUser.id);
      const attemptCount = existing ? existing.attemptCount + 1 : 1;
      await addDoc(collection(db, "verification_requests"), {
        userId: pickedUser.id,
        name: pickedUser.name,
        email: pickedUser.email,
        phone: pickedUser.phone,
        photoUrl: pickedUser.photoUrl,
        status: "pending",
        attemptCount,
        submittedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        reviewedAt: null,
        reviewedBy: null,
        rejectReason: null,
      });
      await writeLog({
        actorId: user.uid,
        actorName: user.displayName ?? "Admin",
        actorEmail: user.email ?? undefined,
        module: "verification",
        action: "verification_created",
        description: `Created verification request for ${pickedUser.name} (${pickedUser.email})`,
        targetId: pickedUser.id,
        targetName: pickedUser.name,
      });
      setCreateOpen(false);
      setPickedUser(null);
      setUserSearch("");
    } finally {
      setCreating(false);
    }
  }, [pickedUser, user, requests]);

  // ─── Notification form helpers ────────────────────────────────────────────

  const filteredNotifUsers = useMemo(() => {
    const q = notifUserSearch.toLowerCase().trim();
    if (!q) return allUsers;
    return allUsers.filter(
      (u) =>
        u.name.toLowerCase().includes(q) ||
        u.email.toLowerCase().includes(q) ||
        u.phone.includes(q) ||
        u.id.toLowerCase().includes(q)
    );
  }, [allUsers, notifUserSearch]);

  const openNotifTab = useCallback(async () => {
    setActivePageTab("send_notification");
    await loadAllUsers();
  }, [loadAllUsers]);

  const notifFinalMessage = useMemo(() => {
    if (!notifPreset) return "";
    if (notifPreset === "not_approved")
      return `Your verification request was not approved. Reason: ${notifRejectReason.trim() || "[reason]"}. You may submit a new request anytime.`;
    if (notifPreset === "custom") return notifCustomMessage.trim();
    return NOTIF_PRESETS.find((p) => p.id === notifPreset)?.message ?? "";
  }, [notifPreset, notifRejectReason, notifCustomMessage]);

  const handleSendNotification = useCallback(async () => {
    if (!notifUser || !notifFinalMessage || !user) return;
    if (notifPreset === "not_approved" && !notifRejectReason.trim()) return;
    if (notifPreset === "custom" && !notifCustomMessage.trim()) return;
    setSendingNotif(true);
    try {
      await addDoc(collection(db, "notifications"), {
        userId: notifUser.id,
        userName: notifUser.name,
        userEmail: notifUser.email,
        message: notifFinalMessage,
        category: "account_verification",
        verification_status: notifVerificationStatus,
        read: false,
        createdAt: serverTimestamp(),
        createdBy: user.displayName ?? user.email ?? user.uid,
        createdById: user.uid,
      });
      await writeLog({
        actorId: user.uid,
        actorName: user.displayName ?? "Admin",
        actorEmail: user.email ?? undefined,
        module: "verification",
        action: "verification_note",
        description: `Sent notification to ${notifUser.name}: "${notifFinalMessage}"`,
        targetId: notifUser.id,
        targetName: notifUser.name,
      });
      setNotifSent(true);
      setNotifUser(null);
      setNotifUserSearch("");
      setNotifPreset("");
      setNotifRejectReason("");
      setNotifCustomMessage("");
      setNotifVerificationStatus("");
      setTimeout(() => setNotifSent(false), 3000);
    } finally {
      setSendingNotif(false);
    }
  }, [notifUser, notifFinalMessage, notifPreset, notifRejectReason, notifCustomMessage, notifVerificationStatus, user]);

  // ─── Review actions ───────────────────────────────────────────────────────

  const handleApprove = useCallback(async () => {
    if (!selected || !user) return;
    setSubmitting(true);
    const approvedUser = selected;
    try {
      await Promise.all([
        updateDoc(doc(db, "verification_requests", selected.id), {
          status: "verified",
          reviewedAt: serverTimestamp(),
          reviewedBy: user.displayName ?? user.email ?? user.uid,
          rejectReason: null,
          updatedAt: serverTimestamp(),
        }),
        updateDoc(doc(db, "users", selected.userId), {
          isVerified: "verified",
        }),
      ]);
      await writeLog({
        actorId: user.uid,
        actorName: user.displayName ?? "Admin",
        actorEmail: user.email ?? undefined,
        module: "verification",
        action: "verification_verified",
        description: `Verified ${selected.name} (${selected.email})`,
        targetId: selected.userId,
        targetName: selected.name,
      });
      setSelected(null);
      setActionMode(null);
      setJumpToReqUserId(approvedUser.userId);
      setNotifUser({ id: approvedUser.userId, name: approvedUser.name, email: approvedUser.email, phone: approvedUser.phone, photoUrl: approvedUser.photoUrl });
      setNotifUserSearch(approvedUser.name);
      setNotifPreset("verified");
      setNotifVerificationStatus("verified");
      setNotifRejectReason("");
      setNotifSent(false);
      setActivePageTab("send_notification");
    } finally {
      setSubmitting(false);
    }
  }, [selected, user]);

  const handleReject = useCallback(async () => {
    if (!selected || !user || !rejectReason.trim()) return;
    setSubmitting(true);
    const rejectedUser = selected;
    const reason = rejectReason.trim();
    try {
      await Promise.all([
        updateDoc(doc(db, "verification_requests", selected.id), {
          status: "rejected",
          reviewedAt: serverTimestamp(),
          reviewedBy: user.displayName ?? user.email ?? user.uid,
          rejectReason: reason,
          updatedAt: serverTimestamp(),
        }),
        updateDoc(doc(db, "users", selected.userId), {
          isVerified: "unverified",
        }),
      ]);
      await writeLog({
        actorId: user.uid,
        actorName: user.displayName ?? "Admin",
        actorEmail: user.email ?? undefined,
        module: "verification",
        action: "verification_rejected",
        description: `Rejected verification for ${selected.name}: ${reason}`,
        targetId: selected.userId,
        targetName: selected.name,
      });
      setSelected(null);
      setActionMode(null);
      setRejectReason("");
      setJumpToReqUserId(rejectedUser.userId);
      setNotifUser({ id: rejectedUser.userId, name: rejectedUser.name, email: rejectedUser.email, phone: rejectedUser.phone, photoUrl: rejectedUser.photoUrl });
      setNotifUserSearch(rejectedUser.name);
      setNotifPreset("not_approved");
      setNotifVerificationStatus("unverified");
      setNotifRejectReason(reason);
      setNotifSent(false);
      setActivePageTab("send_notification");
    } finally {
      setSubmitting(false);
    }
  }, [selected, user, rejectReason]);

  // ─── Stats ────────────────────────────────────────────────────────────────

  const stats = useMemo(() => ({
    total: requests.length,
    pending: requests.filter((r) => r.status === "pending").length,
    verified: requests.filter((r) => r.status === "verified").length,
    rejected: requests.filter((r) => r.status === "rejected").length,
    cancelled: requests.filter((r) => r.status === "cancelled").length,
  }), [requests]);

  const notifLinkedRequest = useMemo(
    () => (notifUser ? requests.find((r) => r.userId === notifUser.id) ?? null : null),
    [notifUser, requests]
  );

  const notifStats = useMemo(() => ({
    total: notifDocs.length,
    pending: notifDocs.filter((n) => n.verification_status === "pending").length,
    verified: notifDocs.filter((n) => n.verification_status === "verified").length,
    unverified: notifDocs.filter((n) => n.verification_status === "unverified").length,
  }), [notifDocs]);

  const filteredNotifDocs = useMemo(() => {
    const nq = notifSearch.toLowerCase();
    const fromMs = notifDateFrom ? new Date(notifDateFrom).getTime() : null;
    const toMs = notifDateTo ? new Date(notifDateTo + "T23:59:59").getTime() : null;
    const result = notifDocs.filter((n) => {
      if (notifStatusFilter !== "all" && n.verification_status !== notifStatusFilter) return false;
      if (nq && !n.userName.toLowerCase().includes(nq) && !n.userEmail.toLowerCase().includes(nq) && !n.message.toLowerCase().includes(nq)) return false;
      if (fromMs || toMs) {
        const ms = n.createdAt ? n.createdAt.toDate().getTime() : null;
        if (!ms) return false;
        if (fromMs && ms < fromMs) return false;
        if (toMs && ms > toMs) return false;
      }
      return true;
    });
    result.sort((a, b) => {
      const aMs = a.createdAt?.toDate().getTime() ?? 0;
      const bMs = b.createdAt?.toDate().getTime() ?? 0;
      return notifSortOrder === "newest" ? bMs - aMs : aMs - bMs;
    });
    return result;
  }, [notifDocs, notifStatusFilter, notifSearch, notifSortOrder, notifDateFrom, notifDateTo]);

  useEffect(() => { setNotifPage(1); }, [notifSearch, notifStatusFilter, notifSortOrder, notifDateFrom, notifDateTo]);

  const notifTotalPages = Math.max(1, Math.ceil(filteredNotifDocs.length / PAGE_SIZE));
  const notifPaginated = filteredNotifDocs.slice((notifPage - 1) * PAGE_SIZE, notifPage * PAGE_SIZE);
  const notifPageNums = Array.from({ length: notifTotalPages }, (_, i) => i + 1)
    .filter((p) => p === 1 || p === notifTotalPages || Math.abs(p - notifPage) <= 1)
    .reduce<(number | "…")[]>((acc, p, i, arr) => {
      if (i > 0 && (p as number) - (arr[i - 1] as number) > 1) acc.push("…");
      acc.push(p);
      return acc;
    }, []);

  // ─── Filtered + paginated ─────────────────────────────────────────────────

  const filtered = useMemo(() => {
    const fromMs = dateFrom ? new Date(dateFrom).getTime() : null;
    const toMs = dateTo ? new Date(dateTo + "T23:59:59").getTime() : null;
    const result = requests.filter((r) => {
      if (statusFilter !== "all" && r.status !== statusFilter) return false;
      const q = search.toLowerCase();
      if (q && !r.name.toLowerCase().includes(q) && !r.email.toLowerCase().includes(q) && !r.phone.includes(q) && !r.userId.toLowerCase().includes(q)) return false;
      if (fromMs || toMs) {
        const ms = r.submittedAt ? r.submittedAt.toDate().getTime() : null;
        if (!ms) return false;
        if (fromMs && ms < fromMs) return false;
        if (toMs && ms > toMs) return false;
      }
      return true;
    });
    result.sort((a, b) => {
      const aMs = a.submittedAt?.toDate().getTime() ?? 0;
      const bMs = b.submittedAt?.toDate().getTime() ?? 0;
      return sortOrder === "newest" ? bMs - aMs : aMs - bMs;
    });
    return result;
  }, [requests, search, statusFilter, sortOrder, dateFrom, dateTo]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const paginated = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  useEffect(() => { setPage(1); }, [search, statusFilter, sortOrder, dateFrom, dateTo]);

  if (!user) return null;

  // ─── Page number list (with ellipsis) ────────────────────────────────────

  const pageNums = Array.from({ length: totalPages }, (_, i) => i + 1)
    .filter((p) => p === 1 || p === totalPages || Math.abs(p - page) <= 1)
    .reduce<(number | "…")[]>((acc, p, i, arr) => {
      if (i > 0 && (p as number) - (arr[i - 1] as number) > 1) acc.push("…");
      acc.push(p);
      return acc;
    }, []);

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <AdminLayout
      title="Verification Requests"
      subtitle={stats.pending > 0 ? `${stats.pending} pending review` : "Account identity verification"}
    >
      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }

        /* ── Stats Bar ── */
.vr-stats {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 12px;
  margin-bottom: 20px;
}

.vr-stat-card {
  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  padding: 16px 20px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  transition: all 0.15s ease;
}

.vr-stat-card[data-clickable="true"] {
  cursor: pointer;
}

.vr-stat-card[data-clickable="true"]:hover {
  border-color: var(--border-strong);
  transform: translateY(-2px);
  box-shadow: 0 6px 16px rgba(0,0,0,0.08);
}

.vr-stat-label {
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.7px;
  color: var(--text-muted);
}

.vr-stat-value {
  font-size: 28px;
  font-weight: 700;
  color: var(--text-primary);
  line-height: 1;
}

/* Accent Top Border */
.vr-stat-card--total    { border-top: 3px solid var(--blue); }
.vr-stat-card--pending  { border-top: 3px solid var(--orange); }
.vr-stat-card--verified { border-top: 3px solid var(--green); }
.vr-stat-card--rejected { border-top: 3px solid var(--red); }

/* Value Colors */
.vr-stat-card--pending  .vr-stat-value { color: var(--yellow); }
.vr-stat-card--verified .vr-stat-value { color: var(--green); }
.vr-stat-card--rejected .vr-stat-value { color: var(--red); }

/* Optional: Responsive */
@media (max-width: 768px) {
  .vr-stats {
    grid-template-columns: repeat(2, 1fr);
  }
}
        /* ── Toolbar ── */
        .vr-toolbar {
          display: flex; align-items: center; gap: 10px;
          margin-bottom: 16px; flex-wrap: wrap;
        }
        .vr-search {
          display: flex; align-items: center; gap: 8px;
          background: var(--bg-surface); border: 1px solid var(--border);
          border-radius: var(--radius-sm); padding: 8px 12px;
          flex: 1; min-width: 200px;
        }
        .vr-search input {
          background: none; border: none; outline: none;
          font-size: 13px; color: var(--text-primary); width: 100%;
        }
        .vr-search input::placeholder { color: var(--text-muted); }
        .vr-tabs {
          display: flex; gap: 4px;
          background: var(--bg-elevated); border-radius: var(--radius-sm); padding: 3px;
        }
        .vr-tab {
          padding: 6px 14px; border-radius: 6px;
          font-size: 12px; font-weight: 600; cursor: pointer;
          transition: all 0.15s; color: var(--text-muted);
          border: none; background: none;
          display: flex; align-items: center; gap: 6px;
        }
        .vr-tab.active {
          background: var(--bg-surface); color: var(--text-primary);
          box-shadow: 0 1px 3px rgba(0,0,0,0.15);
        }
        .vr-badge-count {
          background: var(--red); color: white;
          font-size: 10px; font-weight: 700; border-radius: 999px;
          padding: 1px 5px; line-height: 1.4;
        }

        /* ── Table ── */
        .vr-table-wrap {
          background: var(--bg-surface); border: 1px solid var(--border);
          border-radius: var(--radius); overflow: hidden;
        }
        .vr-table { width: 100%; border-collapse: collapse; }
        .vr-table th {
          font-size: 11px; font-weight: 700; text-transform: uppercase;
          letter-spacing: 0.8px; color: var(--text-muted);
          padding: 10px 16px; text-align: left;
          border-bottom: 1px solid var(--border);
          background: var(--bg-elevated);
        }
        .vr-table td {
          padding: 12px 16px; font-size: 13px; color: var(--text-primary);
          border-bottom: 1px solid var(--border); vertical-align: middle;
        }
        .vr-table tr:last-child td { border-bottom: none; }
        .vr-table tr:hover td { background: var(--bg-hover); cursor: pointer; }
        .vr-copy-btn { opacity: 0; transition: opacity 0.15s; }
        .vr-table tr:hover .vr-copy-btn { opacity: 1; }
        .vr-name { font-weight: 600; }
        .vr-sub { font-size: 11px; color: var(--text-muted); margin-top: 2px; }
        .vr-attempts { display: inline-flex; align-items: center; gap: 4px; font-size: 12px; color: var(--text-muted); }
        .vr-empty { text-align: center; padding: 48px 24px; color: var(--text-muted); font-size: 14px; }
        .vr-empty svg { opacity: 0.3; margin-bottom: 8px; }

        /* ── Pagination ── */
        .vr-pagination {
          display: flex; align-items: center; justify-content: space-between;
          padding: 10px 16px; border-top: 1px solid var(--border);
          background: var(--bg-elevated);
        }
        .vr-pagination-info { font-size: 12px; color: var(--text-muted); }
        .vr-pagination-btns { display: flex; align-items: center; gap: 4px; }
        .vr-page-btn {
          display: flex; align-items: center; justify-content: center;
          min-width: 28px; height: 28px; padding: 0 6px;
          border-radius: 6px; border: 1px solid var(--border);
          background: var(--bg-surface); color: var(--text-primary);
          cursor: pointer; font-size: 12px; transition: all 0.15s;
        }
        .vr-page-btn:hover:not(:disabled) { background: var(--bg-hover); border-color: var(--border-strong); }
        .vr-page-btn:disabled { opacity: 0.4; cursor: not-allowed; }
        .vr-page-btn.active { background: var(--blue); border-color: var(--blue); color: white; font-weight: 700; }

        /* ── Detail modal ── */
        .vr-detail { display: flex; flex-direction: column; gap: 0; }
        .vr-detail-header {
          display: flex; align-items: center; gap: 14px;
          padding-bottom: 16px; border-bottom: 1px solid var(--border); margin-bottom: 16px;
        }
        .vr-avatar {
          width: 56px; height: 56px; border-radius: 50%;
          background: var(--bg-elevated); overflow: hidden;
          border: 2px solid var(--border);
          display: flex; align-items: center; justify-content: center;
          color: var(--text-muted); flex-shrink: 0;
        }
        .vr-avatar img { width: 100%; height: 100%; object-fit: cover; }
        .vr-detail-name { font-size: 17px; font-weight: 700; }
        .vr-detail-uid { font-size: 11px; color: var(--text-muted); font-family: monospace; margin-top: 3px; }
        .vr-fields { display: flex; flex-direction: column; gap: 10px; margin-bottom: 16px; }
        .vr-field { display: flex; align-items: flex-start; gap: 10px; font-size: 13px; }
        .vr-field-icon { color: var(--text-muted); margin-top: 1px; flex-shrink: 0; }
        .vr-field-label { font-weight: 600; min-width: 90px; color: var(--text-secondary); }
        .vr-field-val { color: var(--text-primary); word-break: break-all; }
        .vr-reject-reason {
          background: var(--red-dim); border: 1px solid var(--red);
          border-radius: var(--radius-sm); padding: 10px 12px;
          font-size: 13px; color: var(--red);
          display: flex; gap: 8px; align-items: flex-start; margin-bottom: 16px;
        }
        .vr-actions { display: flex; gap: 10px; padding-top: 4px; }
        .vr-textarea {
          width: 100%; border: 1px solid var(--border);
          background: var(--bg-elevated); border-radius: var(--radius-sm);
          padding: 10px 12px; font-size: 13px; color: var(--text-primary);
          resize: vertical; min-height: 80px; outline: none; font-family: inherit;
          box-sizing: border-box;
        }
        .vr-textarea:focus { border-color: var(--blue); }
        .vr-confirm-box { display: flex; flex-direction: column; gap: 14px; }
        .vr-confirm-text { font-size: 14px; color: var(--text-secondary); line-height: 1.5; }

        /* ── Resubmission flag ── */
        .vr-resubmit-badge {
          display: inline-flex; align-items: center; gap: 4px;
          font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px;
          color: var(--orange); background: color-mix(in srgb, var(--orange) 12%, transparent);
          border: 1px solid color-mix(in srgb, var(--orange) 35%, transparent);
          border-radius: 999px; padding: 2px 7px; white-space: nowrap;
        }
        .vr-resubmit-row td { background: color-mix(in srgb, var(--orange) 4%, transparent); }
        .vr-resubmit-row:hover td { background: color-mix(in srgb, var(--orange) 8%, transparent) !important; }
        .vr-resubmit-banner {
          display: flex; align-items: flex-start; gap: 10px;
          background: color-mix(in srgb, var(--orange) 10%, transparent);
          border: 1px solid color-mix(in srgb, var(--orange) 35%, transparent);
          border-radius: var(--radius-sm); padding: 10px 13px;
          font-size: 13px; color: var(--orange); margin-bottom: 14px;
        }

        /* ── Section label ── */
        .vr-section-label {
          display: flex; align-items: center; gap: 6px;
          font-size: 11px; font-weight: 700; text-transform: uppercase;
          letter-spacing: 0.8px; color: var(--text-muted);
          padding: 14px 0 10px;
          border-top: 1px solid var(--border);
          margin-top: 2px;
        }

        /* ── Photo viewer ── */
        .vr-photo-box {
          border: 1px solid var(--border); border-radius: var(--radius-sm);
          overflow: hidden; background: var(--bg-elevated); margin-bottom: 4px;
        }
        .vr-photo-box img {
          width: 100%; display: block;
          max-height: 260px; object-fit: contain;
          background: var(--bg-elevated);
        }
        .vr-photo-footer {
          display: flex; justify-content: flex-end;
          padding: 8px 12px; border-top: 1px solid var(--border);
        }
        .vr-photo-footer a { font-size: 12px; color: var(--blue); text-decoration: none; }
        .vr-photo-footer a:hover { text-decoration: underline; }
        .vr-no-photo {
          display: flex; align-items: center; gap: 8px;
          padding: 14px 0; font-size: 13px; color: var(--text-muted);
        }

        /* ── Timeline ── */
        .vr-timeline { display: flex; flex-direction: column; margin-bottom: 4px; }
        .vr-timeline-row { display: flex; gap: 12px; }
        .vr-timeline-track {
          display: flex; flex-direction: column;
          align-items: center; flex-shrink: 0; width: 20px;
        }
        .vr-timeline-dot {
          width: 20px; height: 20px; border-radius: 50%;
          flex-shrink: 0; z-index: 1;
        }
        .vr-timeline-line {
          width: 1px; flex: 1; min-height: 10px;
          background: var(--border); margin: 3px 0;
        }
        .vr-timeline-content {
          padding: 0 0 14px; display: flex;
          flex-direction: column; gap: 2px; flex: 1;
        }
        .vr-timeline-action { font-size: 12px; font-weight: 700; }
        .vr-timeline-actor { font-size: 12px; color: var(--text-primary); }
        .vr-timeline-date { font-size: 11px; color: var(--text-muted); }
        .vr-timeline-note-text {
          font-size: 12px; color: var(--text-secondary);
          background: var(--bg-elevated); border: 1px solid var(--border);
          border-radius: var(--radius-sm); padding: 8px 10px;
          margin-top: 4px; line-height: 1.5;
        }
        .vr-timeline-empty { font-size: 13px; color: var(--text-muted); padding: 4px 0 14px; }
        .vr-timeline-loading { font-size: 13px; color: var(--text-muted); padding: 4px 0 14px; }

        /* ── Note box ── */
        .vr-note-box { display: flex; flex-direction: column; gap: 8px; margin-bottom: 14px; }
        .vr-note-submit {
          display: flex; align-items: center; gap: 6px;
          padding: 7px 14px; border-radius: var(--radius-sm);
          background: var(--blue); color: white;
          border: none; cursor: pointer; font-size: 13px; font-weight: 600;
          align-self: flex-end; transition: opacity 0.15s;
        }
        .vr-note-submit:disabled { opacity: 0.5; cursor: not-allowed; }
        .vr-note-submit:not(:disabled):hover { opacity: 0.88; }

        /* ── Create modal ── */
        .vr-user-search {
          display: flex; align-items: center; gap: 8px;
          background: var(--bg-elevated); border: 1px solid var(--border);
          border-radius: var(--radius-sm); padding: 8px 12px; margin-bottom: 10px;
        }
        .vr-user-search input {
          background: none; border: none; outline: none;
          font-size: 13px; color: var(--text-primary); width: 100%;
        }
        .vr-user-search input::placeholder { color: var(--text-muted); }
        .vr-user-list {
          border: 1px solid var(--border); border-radius: var(--radius-sm);
          max-height: 320px; overflow-y: auto;
        }
        .vr-user-row {
          display: flex; align-items: center; gap: 12px;
          padding: 10px 14px; cursor: pointer;
          border-bottom: 1px solid var(--border); transition: background 0.1s;
        }
        .vr-user-row:last-child { border-bottom: none; }
        .vr-user-row:hover { background: var(--bg-hover); }
        .vr-user-row.selected { background: color-mix(in srgb, var(--blue) 10%, transparent); }
        .vr-user-row.has-request { opacity: 0.5; pointer-events: none; }
        .vr-user-avatar {
          width: 34px; height: 34px; border-radius: 50%;
          background: var(--bg-elevated); border: 1px solid var(--border);
          display: flex; align-items: center; justify-content: center;
          color: var(--text-muted); flex-shrink: 0; overflow: hidden;
        }
        .vr-user-avatar img { width: 100%; height: 100%; object-fit: cover; }
        .vr-user-info { flex: 1; min-width: 0; }
        .vr-user-name { font-size: 13px; font-weight: 600; }
        .vr-user-meta { font-size: 11px; color: var(--text-muted); margin-top: 1px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .vr-has-badge {
          font-size: 10px; font-weight: 700; color: var(--text-muted);
          background: var(--bg-elevated); border: 1px solid var(--border);
          border-radius: 999px; padding: 2px 7px; flex-shrink: 0;
        }
        .vr-picked-preview {
          display: flex; align-items: center; gap: 12px;
          background: color-mix(in srgb, var(--blue) 8%, transparent);
          border: 1px solid color-mix(in srgb, var(--blue) 30%, transparent);
          border-radius: var(--radius-sm); padding: 12px 14px; margin-top: 4px;
        }
        .vr-picked-info { flex: 1; min-width: 0; }
        .vr-picked-name { font-size: 14px; font-weight: 700; }
        .vr-picked-meta { font-size: 12px; color: var(--text-muted); margin-top: 2px; }

        /* ── Page-level tabs ── */
        .vr-page-tabs {
          display: flex; gap: 2px; margin-bottom: 20px;
          border-bottom: 1px solid var(--border); padding-bottom: 0;
        }
        .vr-page-tab {
          display: flex; align-items: center; gap: 7px;
          padding: 9px 18px; font-size: 13px; font-weight: 600;
          cursor: pointer; border: none; background: none;
          color: var(--text-muted); border-bottom: 2px solid transparent;
          margin-bottom: -1px; transition: all 0.15s;
        }
        .vr-page-tab:hover { color: var(--text-primary); }
        .vr-page-tab.active { color: var(--blue); border-bottom-color: var(--blue); }

        /* ── Notification form ── */
        .vr-notif-wrap {
          max-width: 640px; display: flex; flex-direction: column; gap: 22px;
        }
        .vr-notif-section { display: flex; flex-direction: column; gap: 8px; }
        .vr-notif-section-title {
          font-size: 11px; font-weight: 700; text-transform: uppercase;
          letter-spacing: 0.8px; color: var(--text-muted);
          display: flex; align-items: center; gap: 6px;
        }
        .vr-preset-list { display: flex; flex-direction: column; gap: 6px; }
        .vr-preset-option {
          display: flex; align-items: flex-start; gap: 10px;
          padding: 11px 14px; border: 1px solid var(--border);
          border-radius: var(--radius-sm); cursor: pointer;
          transition: all 0.13s; background: var(--bg-surface);
        }
        .vr-preset-option:hover { border-color: var(--border-strong); background: var(--bg-hover); }
        .vr-preset-option.selected {
          border-color: var(--blue);
          background: color-mix(in srgb, var(--blue) 7%, transparent);
        }
        .vr-preset-option input[type="radio"] { margin-top: 2px; flex-shrink: 0; accent-color: var(--blue); }
        .vr-preset-label { font-size: 13px; font-weight: 600; color: var(--text-primary); }
        .vr-preset-preview { font-size: 12px; color: var(--text-muted); margin-top: 3px; line-height: 1.5; }
        .vr-notif-message-preview {
          padding: 12px 14px; background: var(--bg-elevated);
          border: 1px solid var(--border); border-radius: var(--radius-sm);
          font-size: 13px; color: var(--text-secondary); line-height: 1.6;
          white-space: pre-wrap;
        }
        .vr-notif-success {
          display: flex; align-items: center; gap: 8px;
          padding: 12px 16px; background: color-mix(in srgb, var(--green) 10%, transparent);
          border: 1px solid color-mix(in srgb, var(--green) 35%, transparent);
          border-radius: var(--radius-sm); font-size: 13px; font-weight: 600;
          color: var(--green);
        }
      `}</style>

      {/* ── Page-level Tabs ───────────────────────────────────────────────── */}
      <div className="vr-page-tabs">
        <button
          className={`vr-page-tab${activePageTab === "requests" ? " active" : ""}`}
          onClick={() => setActivePageTab("requests")}
        >
          <BadgeCheck size={14} />
          Verification Requests
        </button>
        <button
          className={`vr-page-tab${activePageTab === "send_notification" ? " active" : ""}`}
          onClick={openNotifTab}
        >
          <Send size={14} />
          Create Notification
        </button>
        <button
          className={`vr-page-tab${activePageTab === "notifications" ? " active" : ""}`}
          onClick={() => setActivePageTab("notifications")}
        >
          <Bell size={14} />
          Notifications
          {/* {notifDocs.length > 0 && (
            <span className="vr-badge-count" style={{ background: "var(--blue)" }}>{notifDocs.length}</span>
          )} */}
        </button>
      </div>

      {/* ── Notifications Tab ─────────────────────────────────────────────── */}
      {activePageTab === "notifications" && (
        <>
          {/* Stats cards */}
          <div className="vr-stats">
            {([
              { key: "total",      label: "Total",      color: "var(--blue)" },
              { key: "pending",    label: "Pending",    color: "var(--orange)" },
              { key: "verified",   label: "Verified",   color: "var(--green)" },
              { key: "unverified", label: "Unverified", color: "var(--red)" },
            ] as const).map(({ key, label, color }) => (
              <div
                key={key}
                className={`vr-stat-card vr-stat-card--${key === "unverified" ? "rejected" : key}`}
                data-clickable={key !== "total"}
                onClick={() => key !== "total" && setNotifStatusFilter(notifStatusFilter === key ? "all" : key)}
                title={key !== "total" ? `Filter by ${label}` : undefined}
                style={notifStatusFilter === key ? { borderColor: color, boxShadow: `0 0 0 2px ${color}33` } : undefined}
              >
                <span className="vr-stat-label">{label}</span>
                <span className="vr-stat-value" style={key !== "total" ? { color } : undefined}>
                  {notifStats[key]}
                </span>
              </div>
            ))}
          </div>

          {/* Filter toolbar */}
          <div className="vr-toolbar" style={{ marginBottom: 16, flexWrap: "wrap", gap: 8 }}>
            <div className="vr-search">
              <Search size={14} style={{ color: "var(--text-muted)", flexShrink: 0 }} />
              <input
                placeholder="Search by name, email, or message…"
                value={notifSearch}
                onChange={(e) => setNotifSearch(e.target.value)}
              />
              {notifSearch && (
                <button onClick={() => setNotifSearch("")} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", display: "flex" }}>×</button>
              )}
            </div>
            <div className="vr-tabs">
              {(["all", "pending", "verified", "unverified"] as const).map((s) => (
                <button
                  key={s}
                  className={`vr-tab${notifStatusFilter === s ? " active" : ""}`}
                  onClick={() => setNotifStatusFilter(s)}
                >
                  {s.charAt(0).toUpperCase() + s.slice(1)}
                  {s === "pending" && notifStats.pending > 0 && (
                    <span className="vr-badge-count">{notifStats.pending}</span>
                  )}
                </button>
              ))}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <button
                onClick={() => setNotifSortOrder(o => o === "newest" ? "oldest" : "newest")}
                style={{
                  display: "flex", alignItems: "center", gap: 5, padding: "5px 10px",
                  fontSize: 12, fontWeight: 600, borderRadius: "var(--radius-sm)",
                  border: "1px solid var(--border)", background: "var(--surface)",
                  color: "var(--text-secondary)", cursor: "pointer", whiteSpace: "nowrap",
                }}
              >
                {notifSortOrder === "newest" ? "↓ Newest" : "↑ Oldest"}
              </button>
              <input
                type="date"
                value={notifDateFrom}
                onChange={(e) => setNotifDateFrom(e.target.value)}
                title="From date"
                style={{ fontSize: 12, padding: "5px 8px", borderRadius: "var(--radius-sm)", border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text-secondary)" }}
              />
              <span style={{ fontSize: 12, color: "var(--text-muted)" }}>–</span>
              <input
                type="date"
                value={notifDateTo}
                onChange={(e) => setNotifDateTo(e.target.value)}
                title="To date"
                style={{ fontSize: 12, padding: "5px 8px", borderRadius: "var(--radius-sm)", border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text-secondary)" }}
              />
              {(notifDateFrom || notifDateTo) && (
                <button onClick={() => { setNotifDateFrom(""); setNotifDateTo(""); }} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", fontSize: 14 }}>×</button>
              )}
            </div>
          </div>

          {/* Table */}
          <div className="vr-table-wrap">
            {notifDocsLoading ? (
              <div className="vr-empty">
                <RefreshCw size={32} style={{ animation: "spin 1s linear infinite", display: "block", margin: "0 auto 8px" }} />
                Loading…
              </div>
            ) : filteredNotifDocs.length === 0 ? (
              <div className="vr-empty">
                <Bell size={36} style={{ display: "block", margin: "0 auto 8px" }} />
                No {notifStatusFilter !== "all" ? notifStatusFilter : ""} notifications
              </div>
            ) : (
              <table className="vr-table">
                <thead>
                  <tr>
                    <th>User</th>
                    <th>Message</th>
                    <th>Verification Status</th>
                    <th>Read</th>
                    <th>Sent At</th>
                    <th>Sent By</th>
                  </tr>
                </thead>
                <tbody>
                  {notifPaginated.map((n) => (
                    <tr key={n.id}>
                      <td>
                        <div className="vr-name" style={{ display: "flex", alignItems: "center", gap: 4 }}>
                          {n.userName || "—"}
                          {n.userName && (
                            <button
                              onClick={(e) => { e.stopPropagation(); copyToClipboard(n.userName, `${n.id}-name`); }}
                              title="Copy name"
                              className="vr-copy-btn"
                              style={{
                                background: "none", border: "none", cursor: "pointer", padding: "1px 3px",
                                color: copiedKey === `${n.id}-name` ? "var(--green)" : "var(--text-muted)",
                                display: "flex", alignItems: "center", borderRadius: 3,
                                transition: "color 0.15s, opacity 0.15s",
                              }}
                            >
                              <Copy size={10} />
                            </button>
                          )}
                        </div>
                        <div className="vr-sub">{n.userEmail}</div>
                        <div className="vr-sub" style={{ fontFamily: "monospace", display: "flex", alignItems: "center", gap: 4 }}>
                          {n.userId}
                          <button
                            onClick={(e) => { e.stopPropagation(); copyToClipboard(n.userId, `${n.id}-uid`); }}
                            title="Copy user ID"
                            className="vr-copy-btn"
                            style={{
                              background: "none", border: "none", cursor: "pointer", padding: "1px 3px",
                              color: copiedKey === `${n.id}-uid` ? "var(--green)" : "var(--text-muted)",
                              display: "flex", alignItems: "center", borderRadius: 3,
                              transition: "color 0.15s, opacity 0.15s",
                            }}
                          >
                            <Copy size={10} />
                          </button>
                        </div>
                      </td>
                      <td style={{ maxWidth: 320 }}>
                        <span style={{ fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.5, display: "block" }}>
                          {n.message}
                        </span>
                      </td>
                      <td>
                        {n.verification_status ? (
                          <span style={{
                            display: "inline-flex", alignItems: "center", gap: 5,
                            fontSize: 12, fontWeight: 600, textTransform: "capitalize",
                            color: n.verification_status === "verified" ? "var(--green)"
                              : n.verification_status === "pending" ? "var(--yellow)"
                              : "var(--red)",
                          }}>
                            {n.verification_status === "verified" ? <CheckCircle size={12} />
                              : n.verification_status === "pending" ? <Clock size={12} />
                              : <XCircle size={12} />}
                            {n.verification_status}
                          </span>
                        ) : "—"}
                      </td>
                      <td>
                        <span style={{
                          fontSize: 12, fontWeight: 600,
                          color: n.read ? "var(--green)" : "var(--text-muted)",
                        }}>
                          {n.read ? "Read" : "Unread"}
                        </span>
                      </td>
                      <td style={{ fontSize: 12, color: "var(--text-muted)" }}>
                        {n.createdAt ? fmtDate(n.createdAt) : "—"}
                      </td>
                      <td style={{ fontSize: 12, color: "var(--text-muted)" }}>
                        {n.createdBy || "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* Pagination */}
            <div className="vr-pagination">
              <span className="vr-pagination-info">
                {(notifPage - 1) * PAGE_SIZE + 1}–{Math.min(notifPage * PAGE_SIZE, filteredNotifDocs.length)} of {filteredNotifDocs.length}
              </span>
              <div className="vr-pagination-btns">
                <button className="vr-page-btn" onClick={() => setNotifPage(1)} disabled={notifPage === 1}>«</button>
                <button className="vr-page-btn" onClick={() => setNotifPage((p) => Math.max(1, p - 1))} disabled={notifPage === 1}>
                  <ChevronLeft size={13} />
                </button>
                {notifPageNums.map((p, i) =>
                  p === "…" ? (
                    <span key={`e-${i}`} style={{ fontSize: 12, color: "var(--text-muted)", padding: "0 2px" }}>…</span>
                  ) : (
                    <button
                      key={p}
                      className={`vr-page-btn${notifPage === p ? " active" : ""}`}
                      onClick={() => setNotifPage(p as number)}
                    >{p}</button>
                  )
                )}
                <button className="vr-page-btn" onClick={() => setNotifPage((p) => Math.min(notifTotalPages, p + 1))} disabled={notifPage === notifTotalPages}>
                  <ChevronRight size={13} />
                </button>
                <button className="vr-page-btn" onClick={() => setNotifPage(notifTotalPages)} disabled={notifPage === notifTotalPages}>»</button>
              </div>
            </div>
        </>
      )}

      {activePageTab === "requests" && (<>

      {/* ── Stats Bar ─────────────────────────────────────────────────────── */}
      <div className="vr-stats">
        {([
          { key: "total", label: "Total", clickable: false },
          { key: "pending", label: "Pending", clickable: true },
          { key: "verified", label: "Verified", clickable: true },
          { key: "rejected", label: "Rejected", clickable: true },
        ] as const).map(({ key, label, clickable }) => (
          <div
            key={key}
            className={`vr-stat-card vr-stat-card--${key}`}
            data-clickable={clickable}
            onClick={() => clickable && setStatusFilter(key as StatusFilter)}
            title={clickable ? `Filter by ${label}` : undefined}
          >
            <span className="vr-stat-label">{label}</span>
            <span className="vr-stat-value">{stats[key]}</span>
          </div>
        ))}
      </div>

      {/* ── Toolbar ───────────────────────────────────────────────────────── */}
      <div className="vr-toolbar">
        <div className="vr-search">
          <Search size={14} style={{ color: "var(--text-muted)", flexShrink: 0 }} />
          <input
            placeholder="Search by name, email, phone, or user ID…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {search && (
            <button
              onClick={() => setSearch("")}
              style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", display: "flex" }}
            >×</button>
          )}
        </div>

        <div className="vr-tabs">
          {(["pending", "verified", "rejected", "cancelled", "all"] as StatusFilter[]).map((s) => (
            <button
              key={s}
              className={`vr-tab${statusFilter === s ? " active" : ""}`}
              onClick={() => setStatusFilter(s)}
            >
              {s.charAt(0).toUpperCase() + s.slice(1)}
              {s === "pending" && stats.pending > 0 && (
                <span className="vr-badge-count">{stats.pending}</span>
              )}
            </button>
          ))}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <button
            onClick={() => setSortOrder(o => o === "newest" ? "oldest" : "newest")}
            style={{
              display: "flex", alignItems: "center", gap: 5, padding: "5px 10px",
              fontSize: 12, fontWeight: 600, borderRadius: "var(--radius-sm)",
              border: "1px solid var(--border)", background: "var(--surface)",
              color: "var(--text-secondary)", cursor: "pointer", whiteSpace: "nowrap",
            }}
            title="Toggle sort order"
          >
            {sortOrder === "newest" ? "↓ Newest" : "↑ Oldest"}
          </button>
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            title="From date"
            style={{ fontSize: 12, padding: "5px 8px", borderRadius: "var(--radius-sm)", border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text-secondary)" }}
          />
          <span style={{ fontSize: 12, color: "var(--text-muted)" }}>–</span>
          <input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            title="To date"
            style={{ fontSize: 12, padding: "5px 8px", borderRadius: "var(--radius-sm)", border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text-secondary)" }}
          />
          {(dateFrom || dateTo) && (
            <button onClick={() => { setDateFrom(""); setDateTo(""); }} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", fontSize: 14 }}>×</button>
          )}
        </div>

        {/* <Button variant="primary" size="sm" onClick={openCreateModal}>
          <Plus size={14} style={{ marginRight: 6 }} />
          Create Request
        </Button> */}
      </div>

      {/* ── Table ─────────────────────────────────────────────────────────── */}
      <div className="vr-table-wrap">
        {loading ? (
          <div className="vr-empty">
            <RefreshCw size={32} style={{ animation: "spin 1s linear infinite", display: "block", margin: "0 auto 8px" }} />
            Loading…
          </div>
        ) : filtered.length === 0 ? (
          <div className="vr-empty">
            <BadgeCheck size={36} style={{ display: "block", margin: "0 auto 8px" }} />
            No {statusFilter !== "all" ? statusFilter : ""} verification requests
          </div>
        ) : (
          <>
            <table className="vr-table">
              <thead>
                <tr>
                  <th>User</th>
                  <th>Contact</th>
                  <th>Attempts</th>
                  <th>Submitted</th>
                  <th>Status</th>
                  <th>Last Updated</th>
                </tr>
              </thead>
              <tbody>
                {paginated.map((r) => {
                  const isResubmission = r.attemptCount > 1 && r.status === "pending";
                  return (
                  <tr
                    key={r.id}
                    className={isResubmission ? "vr-resubmit-row" : undefined}
                    onClick={() => {
                      setSelected(r);
                      setActionMode(null);
                      setRejectReason("");
                      setNoteText("");
                    }}
                  >
                    <td>
                      <div className="vr-name" style={{ display: "flex", alignItems: "center", gap: 4 }}>
                        {r.name || "—"}
                        {r.name && (
                          <button
                            onClick={(e) => { e.stopPropagation(); copyToClipboard(r.name, `${r.id}-name`); }}
                            title="Copy name"
                            className="vr-copy-btn"
                            style={{
                              background: "none", border: "none", cursor: "pointer", padding: "1px 3px",
                              color: copiedKey === `${r.id}-name` ? "var(--green)" : "var(--text-muted)",
                              display: "flex", alignItems: "center", borderRadius: 3,
                              transition: "color 0.15s, opacity 0.15s",
                            }}
                          >
                            <Copy size={10} />
                          </button>
                        )}
                      </div>
                      <div className="vr-sub" style={{ fontFamily: "monospace", display: "flex", alignItems: "center", gap: 4 }}>
                        {r.userId}
                        <button
                          onClick={(e) => { e.stopPropagation(); copyToClipboard(r.userId, `${r.id}-uid`); }}
                          title="Copy user ID"
                          className="vr-copy-btn"
                          style={{
                            background: "none", border: "none", cursor: "pointer", padding: "1px 3px",
                            color: copiedKey === `${r.id}-uid` ? "var(--green)" : "var(--text-muted)",
                            display: "flex", alignItems: "center", borderRadius: 3,
                            transition: "color 0.15s, opacity 0.15s",
                          }}
                        >
                          <Copy size={10} />
                        </button>
                      </div>
                    </td>
                    <td>
                      <div>{r.email}</div>
                      <div className="vr-sub">{r.phone}</div>
                    </td>
                    <td>
                      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                        <span className="vr-attempts">{r.attemptCount}×</span>
                        {isResubmission && (
                          <span className="vr-resubmit-badge">Re-review</span>
                        )}
                      </div>
                    </td>
                    <td style={{ fontSize: 12, color: "var(--text-muted)" }}>
                      {fmtDate(r.submittedAt)}
                      {r.status === "pending" && (
                        <AgeBadge days={getAgeDays(r.submittedAt)} />
                      )}
                    </td>
                    <td>
                      <span style={{
                        display: "inline-flex", alignItems: "center", gap: 5,
                        fontSize: 12, fontWeight: 600, textTransform: "capitalize",
                        color: r.status === "pending" ? "var(--yellow)" :
                          r.status === "verified" ? "var(--green)" : "var(--red)",
                      }}>
                        {STATUS_BADGE[r.status]?.icon}
                        {r.status}
                      </span>
                    </td>
                    <td style={{ fontSize: 12, color: "var(--text-muted)" }}>
                      {fmtDate(r.updatedAt ?? r.reviewedAt ?? r.submittedAt)}
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>

            {/* ── Pagination ── */}
            {(
              <div className="vr-pagination">
                <span className="vr-pagination-info">
                  {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, filtered.length)} of {filtered.length}
                </span>
                <div className="vr-pagination-btns">
                  <button className="vr-page-btn" onClick={() => setPage(1)} disabled={page === 1}>«</button>
                  <button className="vr-page-btn" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1}>
                    <ChevronLeft size={13} />
                  </button>
                  {pageNums.map((p, i) =>
                    p === "…" ? (
                      <span key={`e-${i}`} style={{ fontSize: 12, color: "var(--text-muted)", padding: "0 2px" }}>…</span>
                    ) : (
                      <button
                        key={p}
                        className={`vr-page-btn${page === p ? " active" : ""}`}
                        onClick={() => setPage(p as number)}
                      >{p}</button>
                    )
                  )}
                  <button className="vr-page-btn" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page === totalPages}>
                    <ChevronRight size={13} />
                  </button>
                  <button className="vr-page-btn" onClick={() => setPage(totalPages)} disabled={page === totalPages}>»</button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* ── Create Request Modal ───────────────────────────────────────────── */}
      <Modal
        open={createOpen}
        title="Create Verification Request"
        onClose={() => { setCreateOpen(false); setPickedUser(null); setUserSearch(""); }}
        size="md"
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <p style={{ fontSize: 13, color: "var(--text-muted)", margin: 0 }}>
            Select a user from the list to create a pending verification request on their behalf.
          </p>
          <div className="vr-user-search">
            <UserSearch size={14} style={{ color: "var(--text-muted)", flexShrink: 0 }} />
            <input
              placeholder="Search by name, email, phone, or ID…"
              value={userSearch}
              onChange={(e) => setUserSearch(e.target.value)}
              autoFocus
            />
            {userSearch && (
              <button onClick={() => setUserSearch("")}
                style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", display: "flex" }}>×</button>
            )}
          </div>
          <div className="vr-user-list">
            {usersLoading ? (
              <div style={{ padding: "24px", textAlign: "center", color: "var(--text-muted)", fontSize: 13 }}>
                <RefreshCw size={18} style={{ animation: "spin 1s linear infinite", display: "block", margin: "0 auto 8px" }} />
                Loading users…
              </div>
            ) : filteredUsers.length === 0 ? (
              <div style={{ padding: "24px", textAlign: "center", color: "var(--text-muted)", fontSize: 13 }}>No users found</div>
            ) : (
              filteredUsers.map((u) => {
                const hasExisting = existingUserIds.has(u.id);
                const isPicked = pickedUser?.id === u.id;
                return (
                  <div
                    key={u.id}
                    className={`vr-user-row${isPicked ? " selected" : ""}${hasExisting ? " has-request" : ""}`}
                    onClick={() => !hasExisting && setPickedUser(isPicked ? null : u)}
                  >
                    <div className="vr-user-avatar">
                      {u.photoUrl ? <img src={u.photoUrl} alt={u.name} /> : <User size={16} />}
                    </div>
                    <div className="vr-user-info">
                      <div className="vr-user-name">{u.name}</div>
                      <div className="vr-user-meta">{u.email}{u.phone ? ` · ${u.phone}` : ""}</div>
                    </div>
                    {hasExisting && <span className="vr-has-badge">has request</span>}
                    {isPicked && !hasExisting && <CheckCircle size={16} style={{ color: "var(--blue)", flexShrink: 0 }} />}
                  </div>
                );
              })
            )}
          </div>
          {pickedUser && (
            <div className="vr-picked-preview">
              <div className="vr-user-avatar">
                {pickedUser.photoUrl ? <img src={pickedUser.photoUrl} alt={pickedUser.name} /> : <User size={16} />}
              </div>
              <div className="vr-picked-info">
                <div className="vr-picked-name">{pickedUser.name}</div>
                <div className="vr-picked-meta">{pickedUser.email} · {pickedUser.phone || "no phone"}</div>
              </div>
            </div>
          )}
          <div className="vr-actions">
            <Button variant="ghost" onClick={() => { setCreateOpen(false); setPickedUser(null); setUserSearch(""); }} disabled={creating}>
              Cancel
            </Button>
            <Button variant="primary" onClick={handleCreate} disabled={!pickedUser || creating} style={{ flex: 1 }}>
              {creating ? "Creating…" : "Create Request"}
            </Button>
          </div>
        </div>
      </Modal>

      {/* ── Detail / Review Modal ──────────────────────────────────────────── */}
      {selected && (
        <Modal
          open={!!selected}
          title="Verification Request"
          onClose={() => { setSelected(null); setActionMode(null); setRejectReason(""); setNoteText(""); }}
          size="md"
        >
          <div className="vr-detail">

            {/* Header */}
            <div className="vr-detail-header">
              <div className="vr-avatar">
                {selected.photoUrl ? <img src={selected.photoUrl} alt={selected.name} /> : <User size={24} />}
              </div>
              <div>
                <div className="vr-detail-name">{selected.name}</div>
                <div className="vr-detail-uid">{selected.userId}</div>
                <div style={{ marginTop: 6, display: "flex", alignItems: "center", flexWrap: "wrap", gap: 6 }}>
                  <span style={{
                    display: "inline-flex", alignItems: "center", gap: 5,
                    fontSize: 12, fontWeight: 600, textTransform: "capitalize",
                    color: selected.status === "pending" ? "var(--yellow)" :
                      selected.status === "verified" ? "var(--green)" : "var(--red)",
                  }}>
                    {STATUS_BADGE[selected.status]?.icon}
                    {selected.status}
                  </span>
                  {selected.status === "pending" && (
                    <AgeBadge days={getAgeDays(selected.submittedAt)} inline />
                  )}
                </div>
              </div>
            </div>

            {/* Fields */}
            <div className="vr-fields">
              <div className="vr-field">
                <Mail size={14} className="vr-field-icon" />
                <span className="vr-field-label">Email</span>
                <span className="vr-field-val">{selected.email || "—"}</span>
              </div>
              <div className="vr-field">
                <Phone size={14} className="vr-field-icon" />
                <span className="vr-field-label">Phone</span>
                <span className="vr-field-val">{selected.phone || "—"}</span>
              </div>
              <div className="vr-field">
                <Hash size={14} className="vr-field-icon" />
                <span className="vr-field-label">Attempts</span>
                <span className="vr-field-val">{selected.attemptCount}</span>
              </div>
              <div className="vr-field">
                <Clock size={14} className="vr-field-icon" />
                <span className="vr-field-label">Submitted</span>
                <span className="vr-field-val">{fmtDate(selected.submittedAt)}</span>
              </div>
              {selected.reviewedAt && (
                <div className="vr-field">
                  <CheckCircle size={14} className="vr-field-icon" />
                  <span className="vr-field-label">Reviewed</span>
                  <span className="vr-field-val">
                    {fmtDate(selected.reviewedAt)}
                    {selected.reviewedBy && <span style={{ color: "var(--text-muted)", marginLeft: 6 }}>by {selected.reviewedBy}</span>}
                  </span>
                </div>
              )}
            </div>

            {/* Resubmission banner */}
            {selected.attemptCount > 1 && selected.status === "pending" && (
              <div className="vr-resubmit-banner">
                <AlertTriangle size={14} style={{ flexShrink: 0, marginTop: 1 }} />
                <span>
                  <strong>Re-review — attempt {selected.attemptCount}.</strong> This user previously had a verification request that was rejected. Review carefully before approving.
                </span>
              </div>
            )}

            {/* Rejection reason */}
            {selected.status === "rejected" && selected.rejectReason && (
              <div className="vr-reject-reason">
                <AlertTriangle size={14} style={{ flexShrink: 0, marginTop: 1 }} />
                <span><strong>Rejection reason:</strong> {selected.rejectReason}</span>
              </div>
            )}

            {/* ── Submitted Documents ── */}
            <div className="vr-section-label" style={{ justifyContent: "space-between" }}>
              <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
                <ImageIcon size={11} />
                Submitted Documents
              </span>
              {selected.documents && selected.documents.length > 1 && (
                <button
                  onClick={() => handleDownloadAll(selected.documents, selected)}
                  disabled={downloadingAll}
                  style={{
                    fontSize: 11, padding: "3px 9px", borderRadius: 5,
                    border: "1px solid var(--border)", background: "transparent",
                    color: "var(--text-muted)", cursor: "pointer", transition: "all 0.15s",
                  }}
                >
                  {downloadingAll ? "Zipping…" : "Download all"}
                </button>
              )}
            </div>
            {selected.documents && selected.documents.length > 0 ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {selected.documents.map((doc, i) => {
                  const type = getDocType(doc.name);
                  const displayName = doc.name.replace(/[<>"'&]/g, "");
                  const categoryLabel = doc.category.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
                  const isMissing = missingDocs.has(doc.storagePath);
                  return (
                    <div
                      key={i}
                      style={{
                        display: "flex", alignItems: "center", gap: 10,
                        padding: "9px 12px", borderRadius: 8,
                        border: `1px solid ${isMissing ? "color-mix(in srgb, var(--red) 30%, transparent)" : "var(--border)"}`,
                        background: isMissing ? "color-mix(in srgb, var(--red) 6%, transparent)" : "var(--bg-elevated)",
                      }}
                    >
                      {type === "image"
                        ? <ImageIcon size={14} style={{ flexShrink: 0, color: isMissing ? "var(--red)" : "var(--text-muted)" }} />
                        : <FileText  size={14} style={{ flexShrink: 0, color: isMissing ? "var(--red)" : "var(--text-muted)" }} />}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 500, color: isMissing ? "var(--text-muted)" : "var(--text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", textDecoration: isMissing ? "line-through" : "none" }}>{displayName}</div>
                        <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 1, display: "flex", alignItems: "center", gap: 5 }}>
                          {categoryLabel}
                          {isMissing && (
                            <span style={{ fontSize: 10, fontWeight: 600, color: "var(--red)", background: "color-mix(in srgb, var(--red) 12%, transparent)", padding: "1px 5px", borderRadius: 4 }}>
                              not found in storage
                            </span>
                          )}
                        </div>
                      </div>
                      <button
                        onClick={() => {
                          setDocViewer(doc);
                          logDocumentView(doc, selected);
                        }}
                        disabled={isMissing}
                        style={{
                          fontSize: 12, padding: "4px 10px", borderRadius: 6, border: "1px solid var(--border)",
                          background: "transparent", color: isMissing ? "var(--text-muted)" : "var(--text-secondary)",
                          cursor: isMissing ? "not-allowed" : "pointer",
                          whiteSpace: "nowrap", transition: "all 0.15s", opacity: isMissing ? 0.4 : 1,
                        }}
                        onMouseEnter={(e) => { if (!isMissing) { (e.currentTarget as HTMLButtonElement).style.background = "var(--bg-surface)"; (e.currentTarget as HTMLButtonElement).style.color = "var(--text-primary)"; }}}
                        onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "transparent"; (e.currentTarget as HTMLButtonElement).style.color = isMissing ? "var(--text-muted)" : "var(--text-secondary)"; }}
                      >
                        {type === "other" ? "Download" : "View"}
                      </button>
                    </div>
                  );
                })}
              </div>
            ) : selected.photoUrl ? (
              <div className="vr-photo-box">
                <img src={selected.photoUrl} alt="ID document" />
                <div className="vr-photo-footer">
                  <a href={selected.photoUrl} target="_blank" rel="noreferrer noopener">Open full image ↗</a>
                </div>
              </div>
            ) : (
              <div className="vr-no-photo">
                <ImageIcon size={14} style={{ opacity: 0.4 }} />
                No documents provided.
              </div>
            )}

            {/* ── History / Timeline ── */}
            <div className="vr-section-label">
              <FileText size={11} />
              History
            </div>

            <div
              ref={timelineRef}
              onScroll={() => {
                if (selected && timelineRef.current)
                  scrollPositions.current.set(selected.id, timelineRef.current.scrollTop);
              }}
              style={{
                background: "var(--bg-elevated)",
                border: "1px solid var(--border)",
                borderRadius: 10,
                padding: "14px 14px 4px",
                marginBottom: 16,
                maxHeight: "27vh",
                overflowY: "auto",
              }}
            >
              {timelineLoading ? (
                <div className="vr-timeline-loading">Loading history…</div>
              ) : timeline.length === 0 ? (
                <div className="vr-timeline-empty">No history yet.</div>
              ) : (
                <div className="vr-timeline">
                  {timeline.map((entry, i) => {
                    const isLast = i === timeline.length - 1;
                    const cfg = TIMELINE_CONFIG[entry.action] ?? TIMELINE_CONFIG.verification_created;
                    return (
                      <div key={i} className="vr-timeline-row">
                        <div className="vr-timeline-track">
                          <div
                            className="vr-timeline-dot"
                            style={{ background: cfg.color, boxShadow: `0 0 0 3px ${cfg.glow}` }}
                          />
                          {!isLast && <div className="vr-timeline-line" />}
                        </div>
                        <div className="vr-timeline-content">
                          <span className="vr-timeline-action" style={{ color: cfg.color }}>{cfg.label}</span>
                          <span className="vr-timeline-actor">{entry.actorName}</span>
                          {entry.action === "verification_document_viewed" ? (
                            <span className="vr-timeline-date" style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                              <span>First viewed: {entry.date ? entry.date.toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—"}</span>
                              {entry.lastViewedAt && (
                                <span>Last viewed: {entry.lastViewedAt.toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" })}{entry.viewCount && entry.viewCount > 1 ? ` (${entry.viewCount}×)` : ""}</span>
                              )}
                            </span>
                          ) : entry.action === "verification_document_downloaded" ? (
                            <span className="vr-timeline-date" style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                              <span>First downloaded: {entry.date ? entry.date.toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—"}</span>
                              {entry.lastDownloadedAt && (
                                <span>Last downloaded: {entry.lastDownloadedAt.toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" })}{entry.downloadCount && entry.downloadCount > 1 ? ` (${entry.downloadCount}×)` : ""}</span>
                              )}
                            </span>
                          ) : (
                            <span className="vr-timeline-date">
                              {entry.date
                                ? entry.date.toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" })
                                : "—"}
                            </span>
                          )}
                          {entry.action === "verification_note" && entry.description && (
                            <span className="vr-timeline-note-text">{entry.description}</span>
                          )}
                          {(entry.action === "verification_document_viewed" || entry.action === "verification_document_downloaded") && entry.description && (
                            <span className="vr-timeline-note-text" style={{ color: "var(--text-muted)", fontStyle: "italic" }}>{entry.description}</span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* ── Add note (pending only) ── */}
            {selected.status === "pending" && (
              <div className="vr-note-box">
                <textarea
                  className="vr-textarea"
                  placeholder="Add a progress note… (Ctrl+Enter to submit)"
                  rows={2}
                  value={noteText}
                  onChange={(e) => setNoteText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handleAddNote();
                  }}
                  style={{ minHeight: 60 }}
                />
                <button
                  className="vr-note-submit"
                  onClick={handleAddNote}
                  disabled={!noteText.trim() || addingNote}
                >
                  <Send size={12} />
                  {addingNote ? "Saving…" : "Add Note"}
                </button>
              </div>
            )}

            {/* ── Review actions ── */}
            {selected.status === "pending" && (
              <>
                {!actionMode && (
                  <div className="vr-actions">
                    <Button variant="primary" onClick={() => setActionMode("approve")} style={{ flex: 1 }}>
                      <CheckCircle size={14} style={{ marginRight: 6 }} />
                      Approve
                    </Button>
                    <Button variant="danger" onClick={() => setActionMode("reject")} style={{ flex: 1 }}>
                      <XCircle size={14} style={{ marginRight: 6 }} />
                      Reject
                    </Button>
                  </div>
                )}
                {actionMode === "approve" && (
                  <div className="vr-confirm-box">
                    <p className="vr-confirm-text">
                      Approve identity verification for <strong>{selected.name}</strong>?
                      Their account will be marked as verified.
                    </p>
                    <div className="vr-actions">
                      <Button variant="ghost" onClick={() => setActionMode(null)} disabled={submitting}>Cancel</Button>
                      <Button variant="primary" onClick={handleApprove} disabled={submitting}>
                        {submitting ? "Approving…" : "Confirm Approve"}
                      </Button>
                    </div>
                  </div>
                )}
                {actionMode === "reject" && (
                  <div className="vr-confirm-box">
                    <p className="vr-confirm-text">
                      Reject verification for <strong>{selected.name}</strong>.
                      Please provide a reason (shown to the user):
                    </p>
                    <textarea
                      className="vr-textarea"
                      placeholder="e.g. Photo ID is blurry or doesn't match profile…"
                      value={rejectReason}
                      onChange={(e) => setRejectReason(e.target.value)}
                    />
                    <div className="vr-actions">
                      <Button variant="ghost" onClick={() => setActionMode(null)} disabled={submitting}>Cancel</Button>
                      <Button variant="danger" onClick={handleReject} disabled={submitting || !rejectReason.trim()}>
                        {submitting ? "Rejecting…" : "Confirm Reject"}
                      </Button>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </Modal>
      )}

      </>)}

      {/* ── Create Notification Tab ────────────────────────────────────────── */}
      {activePageTab === "send_notification" && (
        <div className="vr-notif-wrap">

          {notifSent && (
            <div className="vr-notif-success">
              <CheckCircle size={15} />
              Notification sent successfully.
            </div>
          )}

          {/* Jump-to-request link (shown after approve/reject redirect) */}
          {notifLinkedRequest && (
            <div style={{
              display: "flex", alignItems: "center", justifyContent: "space-between",
              padding: "9px 14px", borderRadius: 8,
              background: "var(--bg-elevated)", border: "1px solid var(--border)",
              fontSize: 13,
            }}>
              <span style={{ color: "var(--text-secondary)" }}>
                Sending notification for <strong>{notifLinkedRequest.name}</strong>
              </span>
              <button
                onClick={() => {
                  setSelected(notifLinkedRequest);
                  setActionMode(null);
                  setRejectReason("");
                  setNoteText("");
                }}
                style={{
                  fontSize: 12, fontWeight: 600, color: "var(--blue)",
                  background: "none", border: "none", cursor: "pointer",
                  padding: "2px 6px", borderRadius: 4, whiteSpace: "nowrap",
                  transition: "opacity 0.15s",
                }}
              >
                View request →
              </button>
            </div>
          )}

          {/* Step 1: pick user */}
          <div className="vr-notif-section">
            <div className="vr-notif-section-title">
              <User size={12} />
              Select User
            </div>
            <div className="vr-user-search">
              <UserSearch size={14} style={{ color: "var(--text-muted)", flexShrink: 0 }} />
              <input
                placeholder="Search by name, email, or ID…"
                value={notifUserSearch}
                onChange={(e) => { setNotifUserSearch(e.target.value); setNotifUser(null); }}
              />
              {notifUserSearch && (
                <button onClick={() => { setNotifUserSearch(""); setNotifUser(null); }}
                  style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", display: "flex" }}>×</button>
              )}
            </div>
            {notifUserSearch && (
              <div className="vr-user-list" style={{ maxHeight: 220 }}>
                {usersLoading ? (
                  <div style={{ padding: "20px", textAlign: "center", color: "var(--text-muted)", fontSize: 13 }}>
                    <RefreshCw size={16} style={{ animation: "spin 1s linear infinite", display: "block", margin: "0 auto 8px" }} />
                    Loading…
                  </div>
                ) : filteredNotifUsers.length === 0 ? (
                  <div style={{ padding: "20px", textAlign: "center", color: "var(--text-muted)", fontSize: 13 }}>No users found</div>
                ) : (
                  filteredNotifUsers.slice(0, 40).map((u) => (
                    <div
                      key={u.id}
                      className={`vr-user-row${notifUser?.id === u.id ? " selected" : ""}`}
                      onClick={() => { setNotifUser(notifUser?.id === u.id ? null : u); setNotifUserSearch(u.name); }}
                    >
                      <div className="vr-user-avatar">
                        {u.photoUrl ? <img src={u.photoUrl} alt={u.name} /> : <User size={16} />}
                      </div>
                      <div className="vr-user-info">
                        <div className="vr-user-name">{u.name}</div>
                        <div className="vr-user-meta">{u.email}{u.phone ? ` · ${u.phone}` : ""}</div>
                      </div>
                      {notifUser?.id === u.id && <CheckCircle size={16} style={{ color: "var(--blue)", flexShrink: 0 }} />}
                    </div>
                  ))
                )}
              </div>
            )}
            {/* {notifUser && (
              <div className="vr-picked-preview">
                <div className="vr-user-avatar">
                  {notifUser.photoUrl ? <img src={notifUser.photoUrl} alt={notifUser.name} /> : <User size={16} />}
                </div>
                <div className="vr-picked-info">
                  <div className="vr-picked-name">{notifUser.name}</div>
                  <div className="vr-picked-meta">{notifUser.email}{notifUser.phone ? ` · ${notifUser.phone}` : ""}</div>
                </div>
              </div>
            )} */}
          </div>

          {/* Step 2: pick message */}
          <div className="vr-notif-section">
            <div className="vr-notif-section-title">
              <MessageSquare size={12} />
              Notification Message
            </div>
            <div className="vr-preset-list">
              {NOTIF_PRESETS.map((preset) => (
                <label
                  key={preset.id}
                  className={`vr-preset-option${notifPreset === preset.id ? " selected" : ""}`}
                >
                  <input
                    type="radio"
                    name="notif_preset"
                    value={preset.id}
                    checked={notifPreset === preset.id}
                    onChange={() => { setNotifPreset(preset.id); setNotifRejectReason(""); setNotifCustomMessage(""); }}
                  />
                  <div>
                    <div className="vr-preset-label">{preset.label}</div>
                    {(preset.message ?? preset.preview) && (
                      <div className="vr-preset-preview">{preset.message ?? preset.preview}</div>
                    )}
                  </div>
                </label>
              ))}
            </div>

            {/* Reason input for "not_approved" */}
            {notifPreset === "not_approved" && (
              <div style={{ marginTop: 6, display: "flex", flexDirection: "column", gap: 6 }}>
                <label style={{ fontSize: 12, fontWeight: 600, color: "var(--text-secondary)" }}>
                  Rejection reason <span style={{ color: "var(--red)" }}>*</span>
                </label>
                <textarea
                  className="vr-textarea"
                  placeholder="e.g. Photo ID is blurry or doesn't match profile…"
                  rows={2}
                  style={{ minHeight: 60 }}
                  value={notifRejectReason}
                  onChange={(e) => setNotifRejectReason(e.target.value)}
                />
              </div>
            )}

            {/* Custom message input */}
            {notifPreset === "custom" && (
              <div style={{ marginTop: 6, display: "flex", flexDirection: "column", gap: 6 }}>
                <label style={{ fontSize: 12, fontWeight: 600, color: "var(--text-secondary)" }}>
                  Message <span style={{ color: "var(--red)" }}>*</span>
                </label>
                <textarea
                  className="vr-textarea"
                  placeholder="Type your custom notification message…"
                  rows={3}
                  style={{ minHeight: 72 }}
                  value={notifCustomMessage}
                  onChange={(e) => setNotifCustomMessage(e.target.value)}
                />
              </div>
            )}

            {/* Live preview */}
            {notifFinalMessage && notifFinalMessage !== "[reason]" && !notifFinalMessage.includes("[reason]") && (
              <div style={{ marginTop: 6 }}>
                <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.7px", color: "var(--text-muted)", marginBottom: 6 }}>Preview</div>
                <div className="vr-notif-message-preview">{notifFinalMessage}</div>
              </div>
            )}
          </div>

          {/* Verification status */}
          <div className="vr-notif-section">
            <div className="vr-notif-section-title">
              <BadgeCheck size={12} />
              Verification Status
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              {(["pending", "verified", "unverified"] as const).map((s) => (
                <button
                  key={s}
                  onClick={() => setNotifVerificationStatus(s)}
                  style={{
                    padding: "7px 16px", borderRadius: "var(--radius-sm)",
                    border: `1px solid ${notifVerificationStatus === s
                      ? s === "verified" ? "var(--green)" : s === "pending" ? "var(--yellow)" : "var(--red)"
                      : "var(--border)"}`,
                    background: notifVerificationStatus === s
                      ? s === "verified" ? "color-mix(in srgb, var(--green) 12%, transparent)"
                        : s === "pending" ? "color-mix(in srgb, var(--yellow) 12%, transparent)"
                        : "color-mix(in srgb, var(--red) 12%, transparent)"
                      : "var(--bg-surface)",
                    color: notifVerificationStatus === s
                      ? s === "verified" ? "var(--green)" : s === "pending" ? "var(--yellow)" : "var(--red)"
                      : "var(--text-muted)",
                    fontSize: 12, fontWeight: 600, cursor: "pointer",
                    textTransform: "capitalize", transition: "all 0.13s",
                  }}
                >
                  {s}
                </button>
              ))}
            </div>
            <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>
              Required — sets the <code style={{ fontSize: 11 }}>verification_status</code> field on the notification document.
            </div>
          </div>

          {/* Send button */}
          <div style={{ display: "flex", gap: 10 }}>
            <Button
              variant="primary"
              onClick={handleSendNotification}
              disabled={
                !notifUser ||
                !notifPreset ||
                !notifVerificationStatus ||
                sendingNotif ||
                (notifPreset === "not_approved" && !notifRejectReason.trim()) ||
                (notifPreset === "custom" && !notifCustomMessage.trim())
              }
            >
              <Send size={13} style={{ marginRight: 6 }} />
              {sendingNotif ? "Sending…" : "Send Notification"}
            </Button>
          </div>

        </div>
      )}

      {docViewer && (
        <DocViewerModal doc={docViewer} onClose={() => setDocViewer(null)} />
      )}

      {downloadResult && (
        <Modal
          open={!!downloadResult}
          title="Download Result"
          onClose={() => setDownloadResult(null)}
          size="sm"
          footer={
            <Button variant="primary" size="sm" onClick={() => setDownloadResult(null)}>
              Done
            </Button>
          }
        >
          {downloadResult.success.length > 0 && (
            <div style={{ marginBottom: downloadResult.failed.length ? 16 : 0 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: "var(--green)", marginBottom: 8, display: "flex", alignItems: "center", gap: 5 }}>
                <CheckCircle size={13} /> {downloadResult.success.length} file{downloadResult.success.length !== 1 ? "s" : ""} downloaded
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                {downloadResult.success.map((name, i) => (
                  <div key={`ok-${i}`} style={{ fontSize: 12, color: "var(--text-secondary)", padding: "5px 10px", borderRadius: 6, background: "var(--bg-elevated)", border: "1px solid var(--border)" }}>
                    {name}
                  </div>
                ))}
              </div>
            </div>
          )}
          {downloadResult.failed.length > 0 && (
            <div>
              <div style={{ fontSize: 12, fontWeight: 700, color: "var(--red)", marginBottom: 8, display: "flex", alignItems: "center", gap: 5 }}>
                <AlertTriangle size={13} /> {downloadResult.failed.length} file{downloadResult.failed.length !== 1 ? "s" : ""} not found in storage
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                {downloadResult.failed.map((name, i) => (
                  <div key={`fail-${i}`} style={{ fontSize: 12, color: "var(--text-muted)", padding: "5px 10px", borderRadius: 6, background: "var(--bg-elevated)", border: "1px solid var(--border)" }}>
                    {name}
                  </div>
                ))}
              </div>
            </div>
          )}
          {downloadResult.success.length === 0 && downloadResult.failed.length === 0 && (
            <p style={{ fontSize: 13, color: "var(--text-muted)" }}>No documents were found.</p>
          )}
        </Modal>
      )}
    </AdminLayout>
  );
}