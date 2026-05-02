"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
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
import { db } from "@/lib/firebase";
import { writeLog } from "@/lib/activitylog";
import {
  Search, RefreshCw, BadgeCheck, XCircle, Clock,
  User, Phone, Mail, Hash, Image as ImageIcon, AlertTriangle,
  CheckCircle, Plus, UserSearch, Send, FileText,
  ChevronLeft, ChevronRight, Bell, MessageSquare, Copy,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface PickedUser {
  id: string;
  name: string;
  email: string;
  phone: string;
  photoUrl: string;
}

interface VerificationRequest {
  id: string;
  userId: string;
  name: string;
  email: string;
  phone: string;
  photoUrl: string;
  status: "pending" | "verified" | "rejected";
  attemptCount: number;
  submittedAt: Timestamp | null;
  reviewedAt: Timestamp | null;
  reviewedBy: string | null;
  rejectReason: string | null;
}

interface TimelineEntry {
  action: string;
  actorName: string;
  date: Date | null;
  description?: string;
}

type StatusFilter = "all" | "pending" | "verified" | "rejected";

// ─── Constants ────────────────────────────────────────────────────────────────

const PAGE_SIZE = 15;

const TIMELINE_CONFIG: Record<string, { label: string; color: string; glow: string }> = {
  verification_created: { label: "Submitted", color: "var(--blue)", glow: "rgba(59,130,246,0.18)" },
  verification_verified: { label: "Verified", color: "var(--green)", glow: "rgba(34,197,94,0.18)" },
  verification_rejected: { label: "Rejected", color: "var(--red)", glow: "rgba(239,68,68,0.18)" },
  verification_note: { label: "Note", color: "var(--text-secondary)", glow: "rgba(100,116,139,0.18)" },
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

const STATUS_BADGE: Record<string, { icon: React.ReactNode }> = {
  pending: { icon: <Clock size={12} /> },
  verified: { icon: <CheckCircle size={12} /> },
  rejected: { icon: <XCircle size={12} /> },
};

// ─── Component ────────────────────────────────────────────────────────────────

export default function VerificationPage() {
  const { user } = useAuthGuard({ module: "verification" });

  // ── Data ──────────────────────────────────────────────────────────────────
  const [requests, setRequests] = useState<VerificationRequest[]>([]);
  const [loading, setLoading] = useState(true);

  // ── Filters & pagination ──────────────────────────────────────────────────
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("pending");
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

  // ── Copy feedback ─────────────────────────────────────────────────────────
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const copyToClipboard = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 1500);
  };

  // ── Page-level tab ────────────────────────────────────────────────────────
  const [activePageTab, setActivePageTab] = useState<"requests" | "send_notification">("requests");

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
        status: d.data().status ?? "pending",
        attemptCount: d.data().attemptCount ?? 1,
        submittedAt: d.data().submittedAt ?? null,
        reviewedAt: d.data().reviewedAt ?? null,
        reviewedBy: d.data().reviewedBy ?? null,
        rejectReason: d.data().rejectReason ?? null,
      }));
      setRequests(data);
      setLoading(false);
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
      const entries: TimelineEntry[] = snap.docs
        .map((d) => {
          const data = d.data();
          return {
            action: data.action ?? "",
            actorName: data.actorName ?? "Unknown",
            date: data.createdAt?.toDate?.() ?? null,
            description: data.description ?? undefined,
          };
        })
        .filter((e) => e.action in TIMELINE_CONFIG)
        .sort((a, b) => (a.date?.getTime() ?? 0) - (b.date?.getTime() ?? 0));
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
      await writeLog({
        actorId: user.uid,
        actorName: user.displayName ?? "Admin",
        actorEmail: user.email ?? undefined,
        module: "verification",
        action: "verification_note",
        description: noteText.trim(),
        targetId: selected.userId,
        targetName: selected.name,
      });
      setNoteText("");
      setTimelineKey((k) => k + 1);
    } finally {
      setAddingNote(false);
    }
  }, [selected, user, noteText]);

  // ─── Load users when create modal opens ──────────────────────────────────

  const openCreateModal = useCallback(async () => {
    setCreateOpen(true);
    setPickedUser(null);
    setUserSearch("");
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
        ...(notifVerificationStatus ? { verification_status: notifVerificationStatus } : {}),
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
    try {
      await updateDoc(doc(db, "verification_requests", selected.id), {
        status: "verified",
        reviewedAt: serverTimestamp(),
        reviewedBy: user.displayName ?? user.email ?? user.uid,
        rejectReason: null,
      });
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
    } finally {
      setSubmitting(false);
    }
  }, [selected, user]);

  const handleReject = useCallback(async () => {
    if (!selected || !user || !rejectReason.trim()) return;
    setSubmitting(true);
    try {
      await updateDoc(doc(db, "verification_requests", selected.id), {
        status: "rejected",
        reviewedAt: serverTimestamp(),
        reviewedBy: user.displayName ?? user.email ?? user.uid,
        rejectReason: rejectReason.trim(),
      });
      await writeLog({
        actorId: user.uid,
        actorName: user.displayName ?? "Admin",
        actorEmail: user.email ?? undefined,
        module: "verification",
        action: "verification_rejected",
        description: `Rejected verification for ${selected.name}: ${rejectReason.trim()}`,
        targetId: selected.userId,
        targetName: selected.name,
      });
      setSelected(null);
      setActionMode(null);
      setRejectReason("");
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
  }), [requests]);

  // ─── Filtered + paginated ─────────────────────────────────────────────────

  const filtered = useMemo(() => requests.filter((r) => {
    const matchStatus = statusFilter === "all" || r.status === statusFilter;
    const q = search.toLowerCase();
    const matchSearch = !q || r.name.toLowerCase().includes(q) ||
      r.email.toLowerCase().includes(q) || r.phone.includes(q) ||
      r.userId.toLowerCase().includes(q);
    return matchStatus && matchSearch;
  }), [requests, search, statusFilter]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const paginated = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  useEffect(() => { setPage(1); }, [search, statusFilter]);

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

        /* ── Stats bar ── */
        // .vr-stats {
        //   display: grid; grid-template-columns: repeat(4, 1fr);
        //   gap: 10px; margin-bottom: 16px;
        // }
        // .vr-stat {
        //   background: var(--bg-surface); border: 1px solid var(--border);
        //   border-radius: var(--radius); padding: 14px 16px;
        //   display: flex; flex-direction: column; gap: 4px;
        //   transition: border-color 0.15s;
        // }
        // .vr-stat[data-clickable="true"] { cursor: pointer; }
        // .vr-stat[data-clickable="true"]:hover { border-color: var(--border-strong); }
        // .vr-stat-label {
        //   font-size: 11px; font-weight: 700; text-transform: uppercase;
        //   letter-spacing: 0.7px; color: var(--text-muted);
        // }
        // .vr-stat-value {
        //   font-size: 26px; font-weight: 700; color: var(--text-primary); line-height: 1;
        // }
        // .vr-stat--pending  .vr-stat-value { color: var(--yellow); }
        // .vr-stat--verified .vr-stat-value { color: var(--green); }
        // .vr-stat--rejected .vr-stat-value { color: var(--red); }

        /* ── Stats Bar (Updated UI) ── */
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
          <Bell size={14} />
          Create Notification
        </button>
      </div>

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
          {(["pending", "verified", "rejected", "all"] as StatusFilter[]).map((s) => (
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
                  <th>Reviewed</th>
                </tr>
              </thead>
              <tbody>
                {paginated.map((r) => (
                  <tr
                    key={r.id}
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
                            style={{
                              background: "none", border: "none", cursor: "pointer", padding: "1px 3px",
                              color: copiedKey === `${r.id}-name` ? "var(--green)" : "var(--text-muted)",
                              display: "flex", alignItems: "center", borderRadius: 3,
                              transition: "color 0.15s",
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
                          style={{
                            background: "none", border: "none", cursor: "pointer", padding: "1px 3px",
                            color: copiedKey === `${r.id}-uid` ? "var(--green)" : "var(--text-muted)",
                            display: "flex", alignItems: "center", borderRadius: 3,
                            transition: "color 0.15s",
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
                      <span className="vr-attempts">{r.attemptCount}</span>
                    </td>
                    <td style={{ fontSize: 12, color: "var(--text-muted)" }}>{fmtDate(r.submittedAt)}</td>
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
                      {r.reviewedAt ? fmtDate(r.reviewedAt) : "—"}
                      {r.reviewedBy && <div className="vr-sub">{r.reviewedBy}</div>}
                    </td>
                  </tr>
                ))}
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
                <div style={{ marginTop: 6 }}>
                  <span style={{
                    display: "inline-flex", alignItems: "center", gap: 5,
                    fontSize: 12, fontWeight: 600, textTransform: "capitalize",
                    color: selected.status === "pending" ? "var(--yellow)" :
                      selected.status === "verified" ? "var(--green)" : "var(--red)",
                  }}>
                    {STATUS_BADGE[selected.status]?.icon}
                    {selected.status}
                  </span>
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

            {/* Rejection reason */}
            {selected.status === "rejected" && selected.rejectReason && (
              <div className="vr-reject-reason">
                <AlertTriangle size={14} style={{ flexShrink: 0, marginTop: 1 }} />
                <span><strong>Rejection reason:</strong> {selected.rejectReason}</span>
              </div>
            )}

            {/* ── ID Document photo ── */}
            <div className="vr-section-label">
              <ImageIcon size={11} />
              ID Document
            </div>
            {selected.photoUrl ? (
              <div className="vr-photo-box">
                <img src={selected.photoUrl} alt="ID document" />
                <div className="vr-photo-footer">
                  <a href={selected.photoUrl} target="_blank" rel="noreferrer">Open full image ↗</a>
                </div>
              </div>
            ) : (
              <div className="vr-no-photo">
                <ImageIcon size={14} style={{ opacity: 0.4 }} />
                No photo provided.
              </div>
            )}

            {/* ── History / Timeline ── */}
            <div className="vr-section-label">
              <FileText size={11} />
              History
            </div>

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
                        <span className="vr-timeline-date">
                          {entry.date
                            ? entry.date.toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" })
                            : "—"}
                        </span>
                        {entry.action === "verification_note" && entry.description && (
                          <span className="vr-timeline-note-text">{entry.description}</span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

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
                  onClick={() => setNotifVerificationStatus(notifVerificationStatus === s ? "" : s)}
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
              Optional — sets the <code style={{ fontSize: 11 }}>verification_status</code> field on the notification document.
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

    </AdminLayout>
  );
}