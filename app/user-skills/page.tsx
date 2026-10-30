"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { Plus, Pencil, Trash2, RefreshCw, Search, BookOpen, ClipboardList, Bell, Send, MessageSquare, User, UserSearch, CheckCircle, ChevronLeft, ChevronRight, Copy, XCircle, Clock } from "lucide-react";
import AdminLayout from "@/components/layout/AdminLayout";
import Button from "@/components/ui/Button";
import Modal, { ConfirmDialog } from "@/components/ui/Modal";
import { useAuthGuard } from "@/hooks/useAuthGuard";
import { useAuth } from "@/context/AuthContext";
import { useDevMode } from "@/context/DevModeContext";
import { db } from "@/lib/firebase";
import {
  collection,
  getDocs,
  doc,
  setDoc,
  updateDoc,
  deleteDoc,
  addDoc,
  query,
  where,
  orderBy,
  onSnapshot,
  Timestamp,
  serverTimestamp,
} from "firebase/firestore";
import { writeLog, buildDescription } from "@/lib/activitylog";
import { toast } from "sonner";
import UserRequests from "@/app/user-requests/userRequests";
import { usePendingSkillRequests } from "@/hooks/usePendingSkillRequests";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Skill {
  id: string;
  skillId: string;
  name: string;
  createdAt: Timestamp | null;
}

interface NotifUser {
  id: string;
  name: string;
  email: string;
  photoUrl: string;
}

interface SkillNotificationDoc {
  id: string;
  userId: string;
  userName: string;
  userEmail: string;
  message: string;
  category: string;
  request_status: string;
  read: boolean;
  createdAt: Timestamp | null;
  createdBy: string;
}

// ─── Notification Presets ─────────────────────────────────────────────────────

const SKILL_NOTIF_PRESETS = [
  {
    id: "approved",
    label: "Request Approved",
    preview: 'Your skill request for "[skillName]" has been approved.',
  },
  {
    id: "approved_mapped",
    label: "Request Approved (mapped to official skill)",
    preview: 'Your skill verification request for "[prevSkillName]" has been approved and mapped to the official skill "[skillName]".',
  },
  {
    id: "rejected",
    label: "Request Rejected (with reason)",
    preview: 'Your skill request for "[skillName]" was not approved. Reason: [reason]. You may submit a new request anytime.',
  },
  {
    id: "custom",
    label: "Custom message",
    preview: null,
  },
] as const;

type NotifPresetId = (typeof SKILL_NOTIF_PRESETS)[number]["id"];

const PAGE_SIZE = 15;

// ─── ID Helpers ───────────────────────────────────────────────────────────────

function generateLibraryId(): string {
  const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const l1 = letters[Math.floor(Math.random() * 26)];
  const l2 = letters[Math.floor(Math.random() * 26)];
  const digits = String(Math.floor(Math.random() * 10_000_000)).padStart(7, "0");
  return `${l1}${l2}${digits}`;
}

async function generateUniqueLibraryId(): Promise<string> {
  for (let attempt = 0; attempt < 10; attempt++) {
    const id = generateLibraryId();
    const snap = await getDocs(query(collection(db, "skills"), where("skillId", "==", id)));
    if (snap.empty) return id;
  }
  throw new Error("Could not generate a unique Library ID after 10 attempts.");
}

// ─── Main Page ────────────────────────────────────────────────────────────────

type Tab = "skills" | "requests" | "notifications" | "send_notification";

export default function UserSkillsPage() {
  useAuthGuard({ module: "library-gsin" });
  const { user } = useAuth();

  const [activeTab, setActiveTab] = useState<Tab>("skills");
  const pendingRequests = usePendingSkillRequests(true);

  // Admin notifications link to /user-skills?tab=requests
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("tab") === "requests") setActiveTab("requests");
  }, []);
  const { devMode: notifFeaturesEnabled } = useDevMode();

  const [skills, setSkills]         = useState<Skill[]>([]);
  const [loading, setLoading]       = useState(false);
  const [search, setSearch]         = useState("");

  // Add modal
  const [addOpen, setAddOpen]       = useState(false);
  const [addName, setAddName]       = useState("");
  const [addError, setAddError]     = useState("");
  const [addSaving, setAddSaving]   = useState(false);

  // Edit modal
  const [editSkill, setEditSkill]   = useState<Skill | null>(null);
  const [editName, setEditName]     = useState("");
  const [editError, setEditError]   = useState("");
  const [editSaving, setEditSaving] = useState(false);

  // Delete confirm
  const [deleteSkill, setDeleteSkill] = useState<Skill | null>(null);
  const [deleting, setDeleting]       = useState(false);

  // Send notification tab
  const [allNotifUsers, setAllNotifUsers]         = useState<NotifUser[]>([]);
  const [notifUsersLoading, setNotifUsersLoading] = useState(false);
  const [notifUserSearch, setNotifUserSearch]     = useState("");
  const [notifUser, setNotifUser]                 = useState<NotifUser | null>(null);
  const [notifSkillName, setNotifSkillName]       = useState("");
  const [notifPrevSkillName, setNotifPrevSkillName] = useState("");
  const [notifPreset, setNotifPreset]             = useState<NotifPresetId | "">("");
  const [notifRejectedReason, setNotifRejectedReason] = useState("");
  const [notifCustomMessage, setNotifCustomMessage]   = useState("");
  const [notifRequestStatus, setNotifRequestStatus]   = useState<"approved" | "rejected" | "pending" | "">("");
  const [sendingNotif, setSendingNotif]           = useState(false);
  const [notifSent, setNotifSent]                 = useState(false);

  // Notifications log tab
  const [notifDocs, setNotifDocs]           = useState<SkillNotificationDoc[]>([]);
  const [notifDocsLoading, setNotifDocsLoading] = useState(true);
  const [notifStatusFilter, setNotifStatusFilter] = useState<"all" | "approved" | "rejected" | "pending">("all");
  const [notifSearch, setNotifSearch]       = useState("");
  const [notifSortOrder, setNotifSortOrder] = useState<"newest" | "oldest">("newest");
  const [notifDateFrom, setNotifDateFrom]   = useState("");
  const [notifDateTo, setNotifDateTo]       = useState("");
  const [notifPage, setNotifPage]           = useState(1);
  const [copiedKey, setCopiedKey]           = useState("");

  // ─── Fetch ──────────────────────────────────────────────────────────────────

  const fetchSkills = useCallback(async () => {
    setLoading(true);
    try {
      const snap = await getDocs(
        query(collection(db, "skills"), orderBy("createdAt", "asc"))
      );
      const list: Skill[] = [];
      snap.forEach((d) => {
        if (d.id.startsWith("_")) return;
        const data = d.data();
        list.push({
          id:        d.id,
          skillId:   data.skillId as string,
          name:      data.name as string,
          createdAt: data.createdAt ?? null,
        });
      });
      setSkills(list);
    } catch (err) {
      console.error("Failed to fetch skills:", err);
      toast.error("Failed to load skills.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSkills();
  }, [fetchSkills]);

  // ─── Notifications listener ──────────────────────────────────────────────

  useEffect(() => {
    const q = query(
      collection(db, "notifications"),
      where("category", "==", "skill_request")
    );
    const unsub = onSnapshot(q, (snap) => {
      setNotifDocs(
        snap.docs.map((d) => ({
          id:             d.id,
          userId:         d.data().userId ?? "",
          userName:       d.data().userName ?? "",
          userEmail:      d.data().userEmail ?? "",
          message:        d.data().message ?? "",
          category:       d.data().category ?? "",
          request_status: d.data().request_status ?? "",
          read:           d.data().read ?? false,
          createdAt:      d.data().createdAt ?? null,
          createdBy:      d.data().createdBy ?? "",
        })).sort((a, b) => (b.createdAt?.toMillis() ?? 0) - (a.createdAt?.toMillis() ?? 0))
      );
      setNotifDocsLoading(false);
    });
    return () => unsub();
  }, []);

  // ─── Filtered list ──────────────────────────────────────────────────────────

  const filtered = useMemo(() => {
    if (!search.trim()) return skills;
    const q = search.toLowerCase();
    return skills.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        s.skillId.toLowerCase().includes(q)
    );
  }, [skills, search]);

  // ─── Notification log computed ───────────────────────────────────────────

  const notifStats = useMemo(() => ({
    total:    notifDocs.length,
    approved: notifDocs.filter((n) => n.request_status === "approved").length,
    rejected: notifDocs.filter((n) => n.request_status === "rejected").length,
    pending:  notifDocs.filter((n) => n.request_status === "pending").length,
  }), [notifDocs]);

  const filteredNotifDocs = useMemo(() => {
    const nq = notifSearch.toLowerCase();
    const fromMs = notifDateFrom ? new Date(notifDateFrom).getTime() : null;
    const toMs   = notifDateTo   ? new Date(notifDateTo + "T23:59:59").getTime() : null;
    const result = notifDocs.filter((n) => {
      if (notifStatusFilter !== "all" && n.request_status !== notifStatusFilter) return false;
      if (nq && !n.userName.toLowerCase().includes(nq) && !n.userEmail.toLowerCase().includes(nq) && !n.message.toLowerCase().includes(nq)) return false;
      const ms = n.createdAt?.toMillis() ?? 0;
      if (fromMs && ms < fromMs) return false;
      if (toMs   && ms > toMs)   return false;
      return true;
    });
    return result.sort((a, b) => {
      const aMs = a.createdAt?.toMillis() ?? 0;
      const bMs = b.createdAt?.toMillis() ?? 0;
      return notifSortOrder === "newest" ? bMs - aMs : aMs - bMs;
    });
  }, [notifDocs, notifStatusFilter, notifSearch, notifSortOrder, notifDateFrom, notifDateTo]);

  useEffect(() => { setNotifPage(1); }, [notifSearch, notifStatusFilter, notifSortOrder, notifDateFrom, notifDateTo]);

  const notifTotalPages = Math.max(1, Math.ceil(filteredNotifDocs.length / PAGE_SIZE));
  const notifPaginated  = filteredNotifDocs.slice((notifPage - 1) * PAGE_SIZE, notifPage * PAGE_SIZE);
  const notifPageNums   = Array.from({ length: notifTotalPages }, (_, i) => i + 1)
    .filter((p) => p === 1 || p === notifTotalPages || Math.abs(p - notifPage) <= 1)
    .reduce<(number | "…")[]>((acc, p, i, arr) => {
      if (i > 0 && (p as number) - (arr[i - 1] as number) > 1) acc.push("…");
      acc.push(p);
      return acc;
    }, []);

  const copyToClipboard = (text: string, key: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(""), 2000);
    });
  };

  // ─── Add ────────────────────────────────────────────────────────────────────

  const openAdd = () => {
    setAddName("");
    setAddError("");
    setAddOpen(true);
  };

  const handleAdd = async () => {
    const trimmed = addName.trim();
    if (!trimmed) { setAddError("Skill name cannot be empty."); return; }
    if (skills.some((s) => s.name.toLowerCase() === trimmed.toLowerCase())) {
      setAddError("A skill with this name already exists.");
      return;
    }

    setAddSaving(true);
    try {
      const libraryId = await generateUniqueLibraryId();
      const newSkillRef = doc(collection(db, "skills"));

      await setDoc(newSkillRef, {
        skillId:   libraryId,
        name:      trimmed,
        createdAt: Timestamp.now(),
      });

      await writeLog({
        actorId:    user!.uid,
        actorName:  user!.displayName ?? "Unknown",
        actorEmail: user!.email ?? "",
        module:     "library",
        action:     "skill_created",
        description: buildDescription.skillCreated(libraryId, trimmed),
        targetId:   newSkillRef.id,
        targetName: trimmed,
        meta:       { to: { skillId: libraryId, name: trimmed } },
      });

      toast.success(`Skill "${trimmed}" added.`);
      setAddOpen(false);
      await fetchSkills();
    } catch (err) {
      console.error("Failed to add skill:", err);
      toast.error("Failed to add skill. Please try again.");
    } finally {
      setAddSaving(false);
    }
  };

  // ─── Edit ───────────────────────────────────────────────────────────────────

  const openEdit = (skill: Skill) => {
    setEditSkill(skill);
    setEditName(skill.name);
    setEditError("");
  };

  const handleEdit = async () => {
    if (!editSkill) return;
    const trimmed = editName.trim();
    if (!trimmed) { setEditError("Skill name cannot be empty."); return; }
    if (
      skills.some(
        (s) => s.id !== editSkill.id && s.name.toLowerCase() === trimmed.toLowerCase()
      )
    ) {
      setEditError("A skill with this name already exists.");
      return;
    }
    if (trimmed === editSkill.name) {
      setEditSkill(null);
      return;
    }

    setEditSaving(true);
    try {
      await updateDoc(doc(db, "skills", editSkill.id), { name: trimmed });

      // sync skillName on all linked skill_requests
      const linkedReqs = await getDocs(
        query(collection(db, "skill_requests"), where("skillId", "==", editSkill.skillId))
      );
      await Promise.all(
        linkedReqs.docs.map((d) =>
          updateDoc(doc(db, "skill_requests", d.id), { skillName: trimmed, updatedAt: Timestamp.now() })
        )
      );

      await writeLog({
        actorId:    user!.uid,
        actorName:  user!.displayName ?? "Unknown",
        actorEmail: user!.email ?? "",
        module:     "library",
        action:     "skill_updated",
        description: buildDescription.skillUpdated(editSkill.skillId, editSkill.name, trimmed),
        targetId:   editSkill.id,
        targetName: trimmed,
        meta:       { from: { name: editSkill.name }, to: { name: trimmed } },
      });

      toast.success(`Skill renamed to "${trimmed}".`);
      setEditSkill(null);
      await fetchSkills();
    } catch (err) {
      console.error("Failed to update skill:", err);
      toast.error("Failed to update skill. Please try again.");
    } finally {
      setEditSaving(false);
    }
  };

  // ─── Delete ─────────────────────────────────────────────────────────────────

  const handleDelete = async () => {
    if (!deleteSkill) return;
    setDeleting(true);
    try {
      await deleteDoc(doc(db, "skills", deleteSkill.id));

      await writeLog({
        actorId:    user!.uid,
        actorName:  user!.displayName ?? "Unknown",
        actorEmail: user!.email ?? "",
        module:     "library",
        action:     "skill_deleted",
        description: buildDescription.skillDeleted(deleteSkill.skillId, deleteSkill.name),
        targetId:   deleteSkill.id,
        targetName: deleteSkill.name,
        meta:       { from: { skillId: deleteSkill.skillId, name: deleteSkill.name } },
      });

      toast.success(`Skill "${deleteSkill.name}" deleted.`);
      setDeleteSkill(null);
      await fetchSkills();
    } catch (err) {
      console.error("Failed to delete skill:", err);
      toast.error("Failed to delete skill. Please try again.");
    } finally {
      setDeleting(false);
    }
  };

  // ─── Notification helpers ────────────────────────────────────────────────────

  const loadNotifUsers = useCallback(async () => {
    if (allNotifUsers.length > 0) return;
    setNotifUsersLoading(true);
    try {
      const snap = await getDocs(collection(db, "users"));
      const list: NotifUser[] = snap.docs
        .map((d) => ({
          id:       d.id,
          name:     d.data().name ?? d.data().displayName ?? "",
          email:    d.data().email ?? "",
          photoUrl: d.data().photoUrl ?? d.data().photoURL ?? "",
        }))
        .filter((u) => u.name || u.email)
        .sort((a, b) => a.name.localeCompare(b.name));
      setAllNotifUsers(list);
    } catch (err) {
      console.error("Failed to load users:", err);
    } finally {
      setNotifUsersLoading(false);
    }
  }, [allNotifUsers.length]);

  const filteredNotifUsers = useMemo(() => {
    const q = notifUserSearch.toLowerCase().trim();
    if (!q) return allNotifUsers;
    return allNotifUsers.filter(
      (u) =>
        u.name.toLowerCase().includes(q) ||
        u.email.toLowerCase().includes(q) ||
        u.id.toLowerCase().includes(q),
    );
  }, [allNotifUsers, notifUserSearch]);

  const notifFinalMessage = useMemo(() => {
    if (!notifPreset) return "";
    const skillLabel    = notifSkillName     || "[skill]";
    const prevSkillLabel = notifPrevSkillName || "[requested skill]";
    if (notifPreset === "approved")
      return `Your skill request for "${skillLabel}" has been approved.`;
    if (notifPreset === "approved_mapped")
      return `Your skill verification request for "${prevSkillLabel}" has been approved and mapped to the official skill "${skillLabel}".`;
    if (notifPreset === "rejected")
      return `Your skill request for "${skillLabel}" was not approved. Reason: ${notifRejectedReason.trim() || "[reason]"}. You may submit a new request anytime.`;
    if (notifPreset === "custom") return notifCustomMessage.trim();
    return "";
  }, [notifPreset, notifSkillName, notifPrevSkillName, notifRejectedReason, notifCustomMessage]);

  const handleSendNotification = useCallback(async () => {
    if (!notifUser || !notifFinalMessage || !user) return;
    if ((notifPreset === "approved" || notifPreset === "approved_mapped" || notifPreset === "rejected") && !notifSkillName.trim()) return;
    if (notifPreset === "approved_mapped" && !notifPrevSkillName.trim()) return;
    if (notifPreset === "rejected" && !notifRejectedReason.trim()) return;
    if (notifPreset === "custom" && !notifCustomMessage.trim()) return;
    setSendingNotif(true);
    try {
      await addDoc(collection(db, "notifications"), {
        userId:          notifUser.id,
        userName:        notifUser.name,
        userEmail:       notifUser.email,
        message:         notifFinalMessage,
        category:        "skill_request",
        request_status:  notifRequestStatus || "pending",
        read:            false,
        createdAt:       serverTimestamp(),
        createdBy:       user.uid,
      });
      await writeLog({
        actorId:     user.uid,
        actorName:   user.displayName ?? "Unknown",
        actorEmail:  user.email ?? "",
        module:      "library",
        action:      "skill_notification_sent",
        description: `Sent skill request notification to ${notifUser.name}: "${notifFinalMessage}"`,
        targetId:    notifUser.id,
        targetName:  notifUser.name,
        meta:        { other: { skillName: notifSkillName } },
      });
      setNotifSent(true);
      setTimeout(() => setNotifSent(false), 4000);
      setNotifUser(null);
      setNotifUserSearch("");
      setNotifSkillName("");
      setNotifPrevSkillName("");
      setNotifPreset("");
      setNotifRejectedReason("");
      setNotifCustomMessage("");
      setNotifRequestStatus("");
      toast.success("Notification sent.");
    } catch (err) {
      console.error("Failed to send notification:", err);
      toast.error("Failed to send notification.");
    } finally {
      setSendingNotif(false);
    }
  }, [notifUser, notifFinalMessage, notifPreset, notifRejectedReason, notifCustomMessage, notifRequestStatus, notifSkillName, user]);

  const handleRequestDecision = useCallback((
    userId: string,
    userName: string,
    userEmail: string,
    skillName: string,
    decision: "approved" | "rejected",
    adminRemarks?: string,
    mappedFromLibrary?: boolean,
    prevSkillRequestedName?: string,
  ) => {
    if (!notifFeaturesEnabled) return;
    setNotifUser({ id: userId, name: userName, email: userEmail, photoUrl: "" });
    setNotifUserSearch(userName);
    setNotifSkillName(skillName);
    setNotifPrevSkillName(mappedFromLibrary ? (prevSkillRequestedName ?? "") : "");
    setNotifPreset(decision === "approved" && mappedFromLibrary ? "approved_mapped" : decision);
    setNotifRejectedReason(decision === "rejected" ? (adminRemarks ?? "") : "");
    setNotifRequestStatus(decision);
    setNotifCustomMessage("");
    setNotifSent(false);
    setActiveTab("send_notification");
    loadNotifUsers();
  }, [loadNotifUsers, notifFeaturesEnabled]);

  useEffect(() => {
    if (!notifFeaturesEnabled && (activeTab === "notifications" || activeTab === "send_notification")) {
      setActiveTab("skills");
    }
  }, [notifFeaturesEnabled, activeTab]);

  // ─── Render ─────────────────────────────────────────────────────────────────

  return (
    <AdminLayout
      title="User Skills"
      subtitle="Manage User Skills"
      actions={
        activeTab === "skills" ? (
          <>
            <Button variant="ghost" size="sm" icon={RefreshCw} onClick={fetchSkills} disabled={loading}>
              Refresh
            </Button>
            <Button variant="primary" size="sm" icon={Plus} onClick={openAdd}>
              Add Skill
            </Button>
          </>
        ) : null
      }
    >
      <style>{`
        .sl-tabs {
          display: flex; gap: 4px;
          border-bottom: 1px solid var(--border);
          margin-bottom: 24px;
        }
        .sl-tab {
          display: flex; align-items: center; gap: 7px;
          padding: 9px 16px;
          font-size: 13px; font-weight: 600;
          color: var(--text-muted);
          border: none; background: none; cursor: pointer;
          border-bottom: 2px solid transparent;
          margin-bottom: -1px;
          transition: color 0.15s, border-color 0.15s;
        }
        .sl-tab:hover { color: var(--text-primary); }
        .sl-tab.sl-tab--active {
          color: var(--blue);
          border-bottom-color: var(--blue);
        }
        .sl-tab-badge {
          background: var(--blue); color: #fff; font-size: 10px; font-weight: 700;
          padding: 1px 6px; border-radius: 20px; line-height: 1.4;
        }

        .sl-wrap { display: flex; flex-direction: column; gap: 20px; }

        /* Stats row */
        .sl-stats { display: flex; gap: 14px; flex-wrap: wrap; }
        .sl-stat {
          flex: 1; min-width: 140px;
          background: var(--bg-surface);
          border: 1px solid var(--border);
          border-radius: var(--radius-md);
          padding: 16px 20px;
          display: flex; align-items: center; gap: 14px;
        }
        .sl-stat-icon {
          width: 40px; height: 40px; border-radius: var(--radius-sm);
          display: flex; align-items: center; justify-content: center; flex-shrink: 0;
        }
        .sl-stat-val {
          font-size: 22px; font-weight: 700; color: var(--text-primary);
          font-family: 'Space Mono', monospace; line-height: 1;
        }
        .sl-stat-label { font-size: 11px; font-weight: 600; color: var(--text-muted);
          text-transform: uppercase; letter-spacing: 0.8px; margin-top: 3px; }

        /* Controls */
        .sl-controls {
          display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
        }
        .sl-search {
          flex: 1; min-width: 200px; max-width: 340px;
          display: flex; align-items: center; gap: 8px;
          background: var(--bg-surface); border: 1px solid var(--border);
          border-radius: var(--radius-sm); padding: 0 12px; height: 36px;
          transition: border-color 0.15s;
        }
        .sl-search:focus-within { border-color: var(--blue); }
        .sl-search svg { color: var(--text-muted); flex-shrink: 0; }
        .sl-search input {
          flex: 1; background: none; border: none; outline: none;
          font-size: 13px; color: var(--text-primary); font-family: 'DM Sans', sans-serif;
        }
        .sl-search input::placeholder { color: var(--text-muted); }
        .sl-count {
          font-size: 12px; color: var(--text-muted); font-weight: 500; white-space: nowrap;
        }

        /* Table card */
        .sl-card {
          background: var(--bg-surface);
          border: 1px solid var(--border);
          border-radius: var(--radius-md);
          overflow: hidden;
        }
        .sl-table { width: 100%; border-collapse: collapse; }
        .sl-table thead tr {
          border-bottom: 1px solid var(--border);
          background: var(--bg-elevated);
        }
        .sl-table th {
          padding: 10px 16px;
          font-size: 10px; font-weight: 800; letter-spacing: 1.2px;
          text-transform: uppercase; color: var(--text-muted);
          text-align: left; white-space: nowrap;
        }
        .sl-table th.sl-th-center { text-align: center; }
        .sl-table th.sl-th-right  { text-align: right; }
        .sl-table tbody tr {
          border-bottom: 1px solid var(--border-muted);
          transition: background 0.12s;
        }
        .sl-table tbody tr:last-child { border-bottom: none; }
        .sl-table tbody tr:hover { background: var(--bg-hover); }
        .sl-table td { padding: 13px 16px; vertical-align: middle; }

        .sl-id {
          font-family: 'Space Mono', monospace;
          font-size: 12px; font-weight: 700;
          color: var(--text-muted);
          background: var(--bg-elevated);
          border: 1px solid var(--border);
          border-radius: 6px;
          padding: 2px 8px;
          display: inline-block;
        }
        .sl-name { font-size: 14px; font-weight: 500; color: var(--text-primary); }
        .sl-date { font-size: 12px; color: var(--text-muted); }
        .sl-actions { display: flex; align-items: center; gap: 6px; justify-content: flex-end; }

        /* Empty / loading */
        .sl-empty {
          padding: 60px 20px; text-align: center;
          display: flex; flex-direction: column; align-items: center; gap: 10px;
        }
        .sl-empty-icon {
          width: 48px; height: 48px; border-radius: var(--radius-md);
          background: var(--bg-elevated); border: 1px solid var(--border);
          display: flex; align-items: center; justify-content: center;
          color: var(--text-muted);
        }
        .sl-empty-title { font-size: 14px; font-weight: 600; color: var(--text-primary); }
        .sl-empty-sub   { font-size: 13px; color: var(--text-muted); }

        .sl-skeleton-row td { padding: 13px 16px; }
        .sl-skel {
          height: 14px; border-radius: 6px;
          background: linear-gradient(90deg, var(--bg-elevated) 25%, var(--bg-hover) 50%, var(--bg-elevated) 75%);
          background-size: 200% 100%;
          animation: sl-shimmer 1.4s infinite;
        }
        @keyframes sl-shimmer { to { background-position: -200% 0; } }

        /* Form field */
        .sl-field { display: flex; flex-direction: column; gap: 6px; }
        .sl-label { font-size: 12px; font-weight: 600; color: var(--text-secondary); letter-spacing: 0.3px; }
        .sl-input {
          width: 100%; padding: 9px 12px;
          background: var(--bg-elevated); border: 1px solid var(--border);
          border-radius: var(--radius-sm);
          font-size: 14px; color: var(--text-primary);
          font-family: 'DM Sans', sans-serif; outline: none;
          transition: border-color 0.15s; box-sizing: border-box;
        }
        .sl-input:focus { border-color: var(--blue); }
        .sl-input.sl-input-err { border-color: var(--red); }
        .sl-err { font-size: 12px; color: var(--red); }
        .sl-hint { font-size: 12px; color: var(--text-muted); }

        /* Send notification tab */
        .sl-notif-wrap { display: flex; flex-direction: column; gap: 16px; max-width: 620px; }
        .sl-notif-success {
          display: flex; align-items: center; gap: 8px;
          padding: 10px 14px; border-radius: var(--radius-sm);
          background: color-mix(in srgb, var(--green) 12%, transparent);
          border: 1px solid color-mix(in srgb, var(--green) 30%, transparent);
          color: var(--green); font-size: 13px; font-weight: 600;
        }
        .sl-notif-context {
          display: flex; align-items: center; justify-content: space-between;
          padding: 9px 14px; border-radius: var(--radius-sm);
          background: var(--bg-elevated); border: 1px solid var(--border);
          font-size: 13px;
        }
        .sl-notif-section {
          background: var(--bg-surface); border: 1px solid var(--border);
          border-radius: var(--radius-md); padding: 16px;
          display: flex; flex-direction: column; gap: 10px;
        }
        .sl-notif-section-title {
          display: flex; align-items: center; gap: 6px;
          font-size: 11px; font-weight: 800; text-transform: uppercase;
          letter-spacing: 0.9px; color: var(--text-muted);
        }
        .sl-user-search {
          display: flex; align-items: center; gap: 8px;
          background: var(--bg-elevated); border: 1px solid var(--border);
          border-radius: var(--radius-sm); padding: 0 12px; height: 36px;
          transition: border-color 0.15s;
        }
        .sl-user-search:focus-within { border-color: var(--blue); }
        .sl-user-search input {
          flex: 1; background: none; border: none; outline: none;
          font-size: 13px; color: var(--text-primary); font-family: 'DM Sans', sans-serif;
        }
        .sl-user-search input::placeholder { color: var(--text-muted); }
        .sl-user-list {
          border: 1px solid var(--border); border-radius: var(--radius-sm);
          overflow-y: auto; background: var(--bg-elevated);
        }
        .sl-user-row {
          display: flex; align-items: center; gap: 10px;
          padding: 9px 12px; cursor: pointer; transition: background 0.12s;
        }
        .sl-user-row:hover { background: var(--bg-hover); }
        .sl-user-row.selected { background: color-mix(in srgb, var(--blue) 8%, transparent); }
        .sl-user-avatar {
          width: 30px; height: 30px; border-radius: 50%; flex-shrink: 0;
          background: var(--bg-base); border: 1px solid var(--border);
          display: flex; align-items: center; justify-content: center;
          color: var(--text-muted); overflow: hidden;
        }
        .sl-user-avatar img { width: 100%; height: 100%; object-fit: cover; }
        .sl-user-info { flex: 1; min-width: 0; }
        .sl-user-name { font-size: 13px; font-weight: 600; color: var(--text-primary); }
        .sl-user-meta { font-size: 11px; color: var(--text-muted); }
        .sl-preset-list { display: flex; flex-direction: column; gap: 6px; }
        .sl-preset-option {
          display: flex; align-items: flex-start; gap: 10px;
          padding: 10px 12px; border-radius: var(--radius-sm);
          border: 1px solid var(--border); cursor: pointer;
          background: var(--bg-elevated); transition: border-color 0.13s, background 0.13s;
        }
        .sl-preset-option input[type=radio] { margin-top: 2px; flex-shrink: 0; accent-color: var(--blue); }
        .sl-preset-option.selected {
          border-color: var(--blue);
          background: color-mix(in srgb, var(--blue) 6%, transparent);
        }
        .sl-preset-label { font-size: 13px; font-weight: 600; color: var(--text-primary); }
        .sl-preset-preview { font-size: 11px; color: var(--text-muted); margin-top: 2px; line-height: 1.4; }
        .sl-notif-msg-preview {
          padding: 10px 14px; border-radius: var(--radius-sm);
          background: var(--bg-elevated); border: 1px solid var(--border);
          font-size: 13px; color: var(--text-primary); line-height: 1.5;
        }
        .sl-textarea {
          width: 100%; padding: 9px 12px;
          background: var(--bg-elevated); border: 1px solid var(--border);
          border-radius: var(--radius-sm);
          font-size: 13px; color: var(--text-primary);
          font-family: 'DM Sans', sans-serif; outline: none; resize: vertical;
          transition: border-color 0.15s; box-sizing: border-box;
        }
        .sl-textarea:focus { border-color: var(--blue); }
        .sl-status-btn {
          padding: 7px 16px; border-radius: var(--radius-sm);
          border: 1px solid var(--border); background: var(--bg-surface);
          color: var(--text-muted); font-size: 12px; font-weight: 600;
          cursor: pointer; text-transform: capitalize; transition: all 0.13s;
        }

        /* Notifications log tab */
        .sl-notif-stats {
          display: flex; gap: 12px; flex-wrap: wrap; margin-bottom: 16px;
        }
        .sl-notif-stat-card {
          flex: 1; min-width: 110px;
          background: var(--bg-surface); border: 1px solid var(--border);
          border-radius: var(--radius-md); padding: 14px 18px;
          cursor: default; transition: border-color 0.15s, box-shadow 0.15s;
        }
        .sl-notif-stat-card[data-clickable=true] { cursor: pointer; }
        .sl-notif-stat-card[data-clickable=true]:hover { border-color: var(--border-hover); }
        .sl-notif-stat-label { font-size: 11px; font-weight: 600; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.8px; margin-bottom: 4px; }
        .sl-notif-stat-val   { font-size: 22px; font-weight: 700; color: var(--text-primary); font-family: 'Space Mono', monospace; }

        .sl-notif-toolbar {
          display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 16px;
        }
        .sl-notif-search {
          flex: 1; min-width: 200px; max-width: 320px;
          display: flex; align-items: center; gap: 8px;
          background: var(--bg-surface); border: 1px solid var(--border);
          border-radius: var(--radius-sm); padding: 0 12px; height: 34px;
          transition: border-color 0.15s;
        }
        .sl-notif-search:focus-within { border-color: var(--blue); }
        .sl-notif-search input {
          flex: 1; background: none; border: none; outline: none;
          font-size: 13px; color: var(--text-primary); font-family: 'DM Sans', sans-serif;
        }
        .sl-notif-search input::placeholder { color: var(--text-muted); }
        .sl-notif-filter-tabs { display: flex; gap: 4px; }
        .sl-notif-filter-tab {
          display: flex; align-items: center; gap: 5px;
          padding: 5px 12px; border-radius: var(--radius-sm);
          font-size: 12px; font-weight: 600; border: 1px solid var(--border);
          background: var(--bg-surface); color: var(--text-muted);
          cursor: pointer; transition: all 0.13s;
        }
        .sl-notif-filter-tab.active {
          background: color-mix(in srgb, var(--blue) 10%, transparent);
          border-color: var(--blue); color: var(--blue);
        }
        .sl-notif-badge {
          display: inline-flex; align-items: center; justify-content: center;
          min-width: 17px; height: 17px; border-radius: 9px;
          background: var(--orange); color: #fff;
          font-size: 10px; font-weight: 700; padding: 0 4px;
        }
        .sl-notif-table-wrap {
          background: var(--bg-surface); border: 1px solid var(--border);
          border-radius: var(--radius-md); overflow: hidden;
        }
        .sl-notif-table { width: 100%; border-collapse: collapse; }
        .sl-notif-table thead tr {
          border-bottom: 1px solid var(--border); background: var(--bg-elevated);
        }
        .sl-notif-table th {
          padding: 10px 14px; font-size: 10px; font-weight: 800;
          letter-spacing: 1.2px; text-transform: uppercase; color: var(--text-muted);
          text-align: left; white-space: nowrap;
        }
        .sl-notif-table tbody tr {
          border-bottom: 1px solid var(--border-muted); transition: background 0.12s;
        }
        .sl-notif-table tbody tr:last-child { border-bottom: none; }
        .sl-notif-table tbody tr:hover { background: var(--bg-hover); }
        .sl-notif-table td { padding: 12px 14px; vertical-align: middle; }
        .sl-notif-user-name { font-size: 13px; font-weight: 600; color: var(--text-primary); display: flex; align-items: center; gap: 4px; }
        .sl-notif-user-sub  { font-size: 11px; color: var(--text-muted); margin-top: 1px; }
        .sl-copy-btn {
          background: none; border: none; cursor: pointer; padding: 1px 3px;
          color: var(--text-muted); display: flex; align-items: center;
          border-radius: 3px; transition: color 0.15s, opacity 0.15s;
          opacity: 0.6;
        }
        .sl-copy-btn:hover { opacity: 1; }

        .sl-notif-pagination {
          display: flex; align-items: center; justify-content: space-between;
          padding: 12px 16px; border-top: 1px solid var(--border);
          background: var(--bg-surface); flex-wrap: wrap; gap: 8px;
        }
        .sl-notif-pagination-info { font-size: 12px; color: var(--text-muted); }
        .sl-notif-pagination-btns { display: flex; gap: 4px; align-items: center; }
        .sl-page-btn {
          display: flex; align-items: center; justify-content: center;
          min-width: 28px; height: 28px; padding: 0 6px;
          border: 1px solid var(--border); border-radius: var(--radius-sm);
          background: var(--bg-surface); color: var(--text-secondary);
          font-size: 12px; font-weight: 600; cursor: pointer;
          transition: all 0.12s;
        }
        .sl-page-btn:hover:not(:disabled) { border-color: var(--blue); color: var(--blue); }
        .sl-page-btn.active { background: var(--blue); border-color: var(--blue); color: #fff; }
        .sl-page-btn:disabled { opacity: 0.4; cursor: not-allowed; }

        .sl-notif-empty {
          padding: 48px 20px; text-align: center; color: var(--text-muted); font-size: 13px;
        }
      `}</style>

      {/* Tab bar */}
      <div className="sl-tabs">
        <button
          className={`sl-tab${activeTab === "skills" ? " sl-tab--active" : ""}`}
          onClick={() => setActiveTab("skills")}
        >
          <BookOpen size={14} />
          Skills Library
        </button>
        <button
          className={`sl-tab${activeTab === "requests" ? " sl-tab--active" : ""}`}
          onClick={() => setActiveTab("requests")}
        >
          <ClipboardList size={14} />
          Skill Requests
          {pendingRequests > 0 && (
            <span className="sl-tab-badge" title={`${pendingRequests} pending`}>{pendingRequests > 99 ? "99+" : pendingRequests}</span>
          )}
        </button>
        {notifFeaturesEnabled && (
          <button
            className={`sl-tab${activeTab === "send_notification" ? " sl-tab--active" : ""}`}
            onClick={() => { setActiveTab("send_notification"); loadNotifUsers(); }}
          >
            <Send size={14} />
            Create Notification
          </button>
        )}
        {notifFeaturesEnabled && (
          <button
            className={`sl-tab${activeTab === "notifications" ? " sl-tab--active" : ""}`}
            onClick={() => setActiveTab("notifications")}
          >
            <Bell size={14} />
            Notifications
          </button>
        )}
      </div>

      {activeTab === "requests" && <UserRequests onRequestDecision={handleRequestDecision} />}

      {/* ── Notifications Log Tab ────────────────────────────────────────────── */}
      {notifFeaturesEnabled && activeTab === "notifications" && (
        <>
          {/* Stats */}
          <div className="sl-notif-stats">
            {([
              { key: "total",    label: "Total",    color: "var(--blue)" },
              { key: "pending",  label: "Pending",  color: "var(--yellow)" },
              { key: "approved", label: "Approved", color: "var(--green)" },
              { key: "rejected", label: "Rejected", color: "var(--red)" },
            ] as const).map(({ key, label, color }) => (
              <div
                key={key}
                className="sl-notif-stat-card"
                data-clickable={key !== "total"}
                onClick={() => key !== "total" && setNotifStatusFilter(notifStatusFilter === key ? "all" : key)}
                title={key !== "total" ? `Filter by ${label}` : undefined}
                style={notifStatusFilter === key ? { borderColor: color, boxShadow: `0 0 0 2px ${color}33` } : undefined}
              >
                <div className="sl-notif-stat-label">{label}</div>
                <div className="sl-notif-stat-val" style={key !== "total" ? { color } : undefined}>
                  {notifStats[key]}
                </div>
              </div>
            ))}
          </div>

          {/* Toolbar */}
          <div className="sl-notif-toolbar">
            <div className="sl-notif-search">
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
            <div className="sl-notif-filter-tabs">
              {(["all", "pending", "approved", "rejected"] as const).map((s) => (
                <button
                  key={s}
                  className={`sl-notif-filter-tab${notifStatusFilter === s ? " active" : ""}`}
                  onClick={() => setNotifStatusFilter(s)}
                >
                  {s.charAt(0).toUpperCase() + s.slice(1)}
                  {s === "pending" && notifStats.pending > 0 && (
                    <span className="sl-notif-badge">{notifStats.pending}</span>
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
                  border: "1px solid var(--border)", background: "var(--bg-surface)",
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
                style={{ fontSize: 12, padding: "5px 8px", borderRadius: "var(--radius-sm)", border: "1px solid var(--border)", background: "var(--bg-surface)", color: "var(--text-secondary)" }}
              />
              <span style={{ fontSize: 12, color: "var(--text-muted)" }}>–</span>
              <input
                type="date"
                value={notifDateTo}
                onChange={(e) => setNotifDateTo(e.target.value)}
                title="To date"
                style={{ fontSize: 12, padding: "5px 8px", borderRadius: "var(--radius-sm)", border: "1px solid var(--border)", background: "var(--bg-surface)", color: "var(--text-secondary)" }}
              />
              {(notifDateFrom || notifDateTo) && (
                <button onClick={() => { setNotifDateFrom(""); setNotifDateTo(""); }} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", fontSize: 14 }}>×</button>
              )}
            </div>
          </div>

          {/* Table */}
          <div className="sl-notif-table-wrap">
            {notifDocsLoading ? (
              <div className="sl-notif-empty">
                <RefreshCw size={28} style={{ animation: "sl-shimmer 1s linear infinite", display: "block", margin: "0 auto 8px" }} />
                Loading…
              </div>
            ) : filteredNotifDocs.length === 0 ? (
              <div className="sl-notif-empty">
                <Bell size={32} style={{ display: "block", margin: "0 auto 8px", opacity: 0.4 }} />
                No {notifStatusFilter !== "all" ? notifStatusFilter : ""} notifications found
              </div>
            ) : (
              <table className="sl-notif-table">
                <thead>
                  <tr>
                    <th>User</th>
                    <th>Message</th>
                    <th>Request Status</th>
                    <th>Read</th>
                    <th>Sent At</th>
                    <th>Sent By</th>
                  </tr>
                </thead>
                <tbody>
                  {notifPaginated.map((n) => (
                    <tr key={n.id}>
                      <td>
                        <div className="sl-notif-user-name">
                          {n.userName || "—"}
                          {n.userName && (
                            <button
                              onClick={(e) => { e.stopPropagation(); copyToClipboard(n.userName, `${n.id}-name`); }}
                              title="Copy name"
                              className="sl-copy-btn"
                              style={{ color: copiedKey === `${n.id}-name` ? "var(--green)" : undefined }}
                            >
                              <Copy size={10} />
                            </button>
                          )}
                        </div>
                        <div className="sl-notif-user-sub">{n.userEmail}</div>
                        <div className="sl-notif-user-sub" style={{ fontFamily: "monospace", display: "flex", alignItems: "center", gap: 4 }}>
                          {n.userId}
                          <button
                            onClick={(e) => { e.stopPropagation(); copyToClipboard(n.userId, `${n.id}-uid`); }}
                            title="Copy user ID"
                            className="sl-copy-btn"
                            style={{ color: copiedKey === `${n.id}-uid` ? "var(--green)" : undefined }}
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
                        {n.request_status ? (
                          <span style={{
                            display: "inline-flex", alignItems: "center", gap: 5,
                            fontSize: 12, fontWeight: 600, textTransform: "capitalize",
                            color: n.request_status === "approved" ? "var(--green)"
                              : n.request_status === "pending"  ? "var(--yellow)"
                              : "var(--red)",
                          }}>
                            {n.request_status === "approved" ? <CheckCircle size={12} />
                              : n.request_status === "pending" ? <Clock size={12} />
                              : <XCircle size={12} />}
                            {n.request_status}
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
                        {n.createdAt
                          ? n.createdAt.toDate().toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" })
                          : "—"}
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
          {filteredNotifDocs.length > PAGE_SIZE && (
            <div className="sl-notif-pagination">
              <span className="sl-notif-pagination-info">
                {(notifPage - 1) * PAGE_SIZE + 1}–{Math.min(notifPage * PAGE_SIZE, filteredNotifDocs.length)} of {filteredNotifDocs.length}
              </span>
              <div className="sl-notif-pagination-btns">
                <button className="sl-page-btn" onClick={() => setNotifPage(1)} disabled={notifPage === 1}>«</button>
                <button className="sl-page-btn" onClick={() => setNotifPage((p) => Math.max(1, p - 1))} disabled={notifPage === 1}>
                  <ChevronLeft size={13} />
                </button>
                {notifPageNums.map((p, i) =>
                  p === "…" ? (
                    <span key={`e-${i}`} style={{ fontSize: 12, color: "var(--text-muted)", padding: "0 2px" }}>…</span>
                  ) : (
                    <button
                      key={p}
                      className={`sl-page-btn${notifPage === p ? " active" : ""}`}
                      onClick={() => setNotifPage(p as number)}
                    >{p}</button>
                  )
                )}
                <button className="sl-page-btn" onClick={() => setNotifPage((p) => Math.min(notifTotalPages, p + 1))} disabled={notifPage === notifTotalPages}>
                  <ChevronRight size={13} />
                </button>
                <button className="sl-page-btn" onClick={() => setNotifPage(notifTotalPages)} disabled={notifPage === notifTotalPages}>»</button>
              </div>
            </div>
          )}
        </>
      )}

      {/* ── Create Notification Tab ──────────────────────────────────────────── */}
      {notifFeaturesEnabled && activeTab === "send_notification" && (
        <div className="sl-notif-wrap">

          {notifSent && (
            <div className="sl-notif-success">
              <CheckCircle size={15} />
              Notification sent successfully.
            </div>
          )}

          {/* Context banner — shown after auto-fill from approve/reject */}
          {notifUser && notifSkillName && (
            <div className="sl-notif-context">
              <span style={{ color: "var(--text-secondary)" }}>
                Sending notification for <strong>{notifUser.name}</strong> — {notifSkillName}
              </span>
              <button
                onClick={() => { setNotifUser(null); setNotifUserSearch(""); setNotifSkillName(""); setNotifPrevSkillName(""); setNotifPreset(""); setNotifRejectedReason(""); setNotifRequestStatus(""); }}
                style={{ fontSize: 12, fontWeight: 600, color: "var(--text-muted)", background: "none", border: "none", cursor: "pointer" }}
              >
                Clear ×
              </button>
            </div>
          )}

          {/* Step 1: Select user */}
          <div className="sl-notif-section">
            <div className="sl-notif-section-title"><User size={12} />Select User</div>
            <div className="sl-user-search">
              <UserSearch size={14} style={{ color: "var(--text-muted)", flexShrink: 0 }} />
              <input
                placeholder="Search by name, email, or ID…"
                value={notifUserSearch}
                onChange={(e) => { setNotifUserSearch(e.target.value); if (!notifUser) return; if (e.target.value !== notifUser.name) setNotifUser(null); }}
              />
              {notifUserSearch && (
                <button onClick={() => { setNotifUserSearch(""); setNotifUser(null); }}
                  style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", display: "flex" }}>×</button>
              )}
            </div>
            {notifUserSearch && (
              <div className="sl-user-list" style={{ maxHeight: 220 }}>
                {notifUsersLoading ? (
                  <div style={{ padding: "20px", textAlign: "center", color: "var(--text-muted)", fontSize: 13 }}>Loading…</div>
                ) : filteredNotifUsers.length === 0 ? (
                  <div style={{ padding: "20px", textAlign: "center", color: "var(--text-muted)", fontSize: 13 }}>No users found</div>
                ) : (
                  filteredNotifUsers.slice(0, 40).map((u) => (
                    <div
                      key={u.id}
                      className={`sl-user-row${notifUser?.id === u.id ? " selected" : ""}`}
                      onClick={() => { setNotifUser(notifUser?.id === u.id ? null : u); setNotifUserSearch(u.name); }}
                    >
                      <div className="sl-user-avatar">
                        {u.photoUrl ? <img src={u.photoUrl} alt={u.name} /> : <User size={14} />}
                      </div>
                      <div className="sl-user-info">
                        <div className="sl-user-name">{u.name}</div>
                        <div className="sl-user-meta">{u.email}</div>
                      </div>
                      {notifUser?.id === u.id && <CheckCircle size={15} style={{ color: "var(--blue)", flexShrink: 0 }} />}
                    </div>
                  ))
                )}
              </div>
            )}
          </div>

          {/* Step 2: Message preset */}
          <div className="sl-notif-section">
            <div className="sl-notif-section-title"><MessageSquare size={12} />Notification Message</div>

            <div className="sl-preset-list">
              {SKILL_NOTIF_PRESETS.map((preset) => (
                <label
                  key={preset.id}
                  className={`sl-preset-option${notifPreset === preset.id ? " selected" : ""}`}
                >
                  <input
                    type="radio"
                    name="sl_notif_preset"
                    value={preset.id}
                    checked={notifPreset === preset.id}
                    onChange={() => { setNotifPreset(preset.id); setNotifCustomMessage(""); }}
                  />
                  <div>
                    <div className="sl-preset-label">{preset.label}</div>
                    {preset.preview && <div className="sl-preset-preview">{preset.preview}</div>}
                  </div>
                </label>
              ))}
            </div>

            {(notifPreset === "approved" || notifPreset === "rejected") && (
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <label className="sl-label">Skill Name <span style={{ color: "var(--red)" }}>*</span></label>
                <input
                  className={`sl-input${!notifSkillName.trim() && notifPreset ? " sl-input-err" : ""}`}
                  placeholder="e.g. Electrical Wiring"
                  value={notifSkillName}
                  onChange={(e) => setNotifSkillName(e.target.value)}
                />
              </div>
            )}

            {notifPreset === "approved_mapped" && (
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <label className="sl-label">Requested Skill Name <span style={{ color: "var(--red)" }}>*</span></label>
                  <input
                    className={`sl-input${!notifPrevSkillName.trim() ? " sl-input-err" : ""}`}
                    placeholder="What the user originally requested"
                    value={notifPrevSkillName}
                    onChange={(e) => setNotifPrevSkillName(e.target.value)}
                  />
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <label className="sl-label">Official Skill Name (Library) <span style={{ color: "var(--red)" }}>*</span></label>
                  <input
                    className={`sl-input${!notifSkillName.trim() ? " sl-input-err" : ""}`}
                    placeholder="The mapped skill from the library"
                    value={notifSkillName}
                    onChange={(e) => setNotifSkillName(e.target.value)}
                  />
                </div>
              </div>
            )}

            {notifPreset === "rejected" && (
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <label className="sl-label">Rejection Reason <span style={{ color: "var(--red)" }}>*</span></label>
                <textarea
                  className="sl-textarea"
                  placeholder="Explain why the request was rejected…"
                  rows={2}
                  value={notifRejectedReason}
                  onChange={(e) => setNotifRejectedReason(e.target.value)}
                />
              </div>
            )}

            {notifPreset === "custom" && (
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <label className="sl-label">Message <span style={{ color: "var(--red)" }}>*</span></label>
                <textarea
                  className="sl-textarea"
                  placeholder="Type your custom notification message…"
                  rows={3}
                  value={notifCustomMessage}
                  onChange={(e) => setNotifCustomMessage(e.target.value)}
                />
              </div>
            )}

            {notifFinalMessage && !notifFinalMessage.includes("[reason]") && !notifFinalMessage.includes("[skill]") && (
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.7px", color: "var(--text-muted)", marginBottom: 6 }}>Preview</div>
                <div className="sl-notif-msg-preview">{notifFinalMessage}</div>
              </div>
            )}
          </div>

          {/* Step 3: Request status */}
          <div className="sl-notif-section">
            <div className="sl-notif-section-title"><Bell size={12} />Request Status</div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {(["approved", "rejected", "pending"] as const).map((s) => (
                <button
                  key={s}
                  className="sl-status-btn"
                  onClick={() => setNotifRequestStatus(s)}
                  style={{
                    borderColor: notifRequestStatus === s
                      ? s === "approved" ? "var(--green)" : s === "rejected" ? "var(--red)" : "var(--yellow)"
                      : undefined,
                    background: notifRequestStatus === s
                      ? s === "approved" ? "color-mix(in srgb, var(--green) 12%, transparent)"
                        : s === "rejected" ? "color-mix(in srgb, var(--red) 12%, transparent)"
                        : "color-mix(in srgb, var(--yellow) 12%, transparent)"
                      : undefined,
                    color: notifRequestStatus === s
                      ? s === "approved" ? "var(--green)" : s === "rejected" ? "var(--red)" : "var(--yellow)"
                      : undefined,
                  }}
                >
                  {s}
                </button>
              ))}
            </div>
            <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
              Sets the <code style={{ fontSize: 11 }}>request_status</code> field on the notification document.
            </div>
          </div>

          {/* Send */}
          <div>
            <Button
              variant="primary"
              onClick={handleSendNotification}
              loading={sendingNotif}
              disabled={
                !notifUser ||
                !notifPreset ||
                !notifRequestStatus ||
                sendingNotif ||
                ((notifPreset === "approved" || notifPreset === "approved_mapped" || notifPreset === "rejected") && !notifSkillName.trim()) ||
                (notifPreset === "approved_mapped" && !notifPrevSkillName.trim()) ||
                (notifPreset === "rejected" && !notifRejectedReason.trim()) ||
                (notifPreset === "custom" && !notifCustomMessage.trim())
              }
            >
              <Send size={13} style={{ marginRight: 6 }} />
              Send Notification
            </Button>
          </div>

        </div>
      )}

      {activeTab === "skills" && <div className="sl-wrap">

        {/* Stats */}
        <div className="sl-stats">
          <div className="sl-stat">
            <div className="sl-stat-icon" style={{ background: "rgba(99,102,241,0.12)" }}>
              <BookOpen size={18} color="var(--indigo, #6366f1)" />
            </div>
            <div>
              <div className="sl-stat-val">
                {loading ? "—" : skills.length}
              </div>
              <div className="sl-stat-label">Total Skills</div>
            </div>
          </div>
        </div>

        {/* Controls */}
        <div className="sl-controls">
          <div className="sl-search">
            <Search size={14} />
            <input
              placeholder="Search by name or ID…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          {search.trim() && (
            <span className="sl-count">
              {filtered.length} of {skills.length} result{filtered.length !== 1 ? "s" : ""}
            </span>
          )}
        </div>

        {/* Table */}
        <div className="sl-card">
          {loading ? (
            <table className="sl-table">
              <thead>
                <tr>
                  <th>Skill ID</th>
                  <th>Skill Name</th>
                  <th>Added On</th>
                  <th className="sl-th-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i} className="sl-skeleton-row">
                    <td><div className="sl-skel" style={{ width: 50 }} /></td>
                    <td><div className="sl-skel" style={{ width: 180 }} /></td>
                    <td><div className="sl-skel" style={{ width: 100 }} /></td>
                    <td><div className="sl-skel" style={{ width: 80, marginLeft: "auto" }} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : filtered.length === 0 ? (
            <div className="sl-empty">
              <div className="sl-empty-icon"><BookOpen size={22} /></div>
              <div className="sl-empty-title">
                {search.trim() ? "No matching skills" : "No skills yet"}
              </div>
              <div className="sl-empty-sub">
                {search.trim()
                  ? `No skills match "${search}". Try a different search.`
                  : `Click "Add Skill" to create the first skill in the library.`}
              </div>
            </div>
          ) : (
            <table className="sl-table">
              <thead>
                <tr>
                  <th>Skill ID</th>
                  <th>Skill Name</th>
                  <th>Added On</th>
                  <th className="sl-th-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((skill) => (
                  <tr key={skill.id}>
                    <td>
                      <span className="sl-id">{skill.skillId}</span>
                    </td>
                    <td>
                      <span className="sl-name">{skill.name}</span>
                    </td>
                    <td>
                      <span className="sl-date">
                        {skill.createdAt
                          ? skill.createdAt.toDate().toLocaleDateString("en-US", {
                              month: "short", day: "numeric", year: "numeric",
                            })
                          : "—"}
                      </span>
                    </td>
                    <td>
                      <div className="sl-actions">
                        <Button
                          variant="ghost"
                          size="sm"
                          icon={Pencil}
                          onClick={() => openEdit(skill)}
                        >
                          Edit
                        </Button>
                        <Button
                          variant="danger"
                          size="sm"
                          icon={Trash2}
                          onClick={() => setDeleteSkill(skill)}
                        >
                          Delete
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>}

      {/* ── Add Modal ─────────────────────────────────────────────────────────── */}
      <Modal
        open={addOpen}
        onClose={() => { if (!addSaving) setAddOpen(false); }}
        title="Add Skill"
        description="A unique ID will be generated automatically."
        size="sm"
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setAddOpen(false)} disabled={addSaving}>
              Cancel
            </Button>
            <Button variant="primary" size="sm" onClick={handleAdd} loading={addSaving}>
              Add Skill
            </Button>
          </>
        }
      >
        <div className="sl-field">
          <label className="sl-label">Skill Name</label>
          <input
            className={`sl-input${addError ? " sl-input-err" : ""}`}
            placeholder="e.g. Electrical Wiring"
            value={addName}
            onChange={(e) => { setAddName(e.target.value); setAddError(""); }}
            onKeyDown={(e) => { if (e.key === "Enter") handleAdd(); }}
            autoFocus
          />
          {addError
            ? <span className="sl-err">{addError}</span>
            : <span className="sl-hint">Name must be unique within the library.</span>
          }
        </div>
      </Modal>

      {/* ── Edit Modal ────────────────────────────────────────────────────────── */}
      <Modal
        open={!!editSkill}
        onClose={() => { if (!editSaving) setEditSkill(null); }}
        title="Edit Skill"
        description={editSkill ? `Skill ID ${editSkill.skillId} — the ID cannot be changed.` : ""}
        size="sm"
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setEditSkill(null)} disabled={editSaving}>
              Cancel
            </Button>
            <Button variant="primary" size="sm" onClick={handleEdit} loading={editSaving}>
              Save Changes
            </Button>
          </>
        }
      >
        <div className="sl-field">
          <label className="sl-label">Skill Name</label>
          <input
            className={`sl-input${editError ? " sl-input-err" : ""}`}
            placeholder="Skill name"
            value={editName}
            onChange={(e) => { setEditName(e.target.value); setEditError(""); }}
            onKeyDown={(e) => { if (e.key === "Enter") handleEdit(); }}
            autoFocus
          />
          {editError && <span className="sl-err">{editError}</span>}
        </div>
      </Modal>

      {/* ── Delete Confirm ────────────────────────────────────────────────────── */}
      <ConfirmDialog
        open={!!deleteSkill}
        onClose={() => { if (!deleting) setDeleteSkill(null); }}
        onConfirm={handleDelete}
        title="Delete Skill"
        message={
          deleteSkill
            ? `Are you sure you want to delete skill ${deleteSkill.skillId} — "${deleteSkill.name}"? This action cannot be undone.`
            : ""
        }
        confirmLabel="Delete"
        danger
        loading={deleting}
      />
    </AdminLayout>
  );
}
