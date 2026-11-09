"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Bell } from "lucide-react";
import { useAdminNotifications } from "@/hooks/useAdminNotifications";
import type { AdminNotification } from "@/lib/notifications";
import { useAuth } from "@/context/AuthContext";
import { toast } from "@/components/ui/Toaster";
import { playNotifSound } from "@/lib/notifSound";

// ── Relative time, no date lib dependency in this repo ──────────────────────
function timeAgo(date: Date | null): string {
  if (!date) return "";
  const seconds = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

// Module-level (not component state): every page renders its own bell, so this
// keeps a page change from treating the existing notifications as new.
let seen: { uid: string; ids: Set<string> } | null = null;

export default function NotificationBell() {
  const { user } = useAuth();
  const { notifications, unreadCount, markAsRead, loading } = useAdminNotifications();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

  // ── Pop up + chime for new unread notifications ────────────────────────────
  useEffect(() => {
    if (!user || loading) return;
    if (seen?.uid !== user.uid) {
      // First load for this admin: what's already there isn't new
      seen = { uid: user.uid, ids: new Set(notifications.map((n) => n.id)) };
      return;
    }
    const fresh = notifications.filter((n) => !seen!.ids.has(n.id));
    fresh.forEach((n) => seen!.ids.add(n.id));
    const unread = fresh.filter((n) => !n.readBy[user.uid]);
    if (unread.length === 0) return;
    playNotifSound();
    // Oldest first so the newest ends up at the bottom, nearest the eye
    unread.slice(0, 3).reverse().forEach((n) =>
      toast.notify(n.title, n.message, () => { markAsRead(n.id); router.push(n.link); }),
    );
    if (unread.length > 3) toast.notify(`${unread.length - 3} more notifications`, "Open the bell to see them all.");
  }, [notifications, loading, user, markAsRead, router]);

  // ── Close dropdown on outside click ────────────────────────────────────────
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const handleSelect = async (n: AdminNotification) => {
    setOpen(false);
    await markAsRead(n.id);
    router.push(n.link);
  };

  return (
    <div className="notif-bell-wrap" ref={wrapRef}>
      <style>{`
        .notif-bell-wrap { position: relative; flex-shrink: 0; }
        .notif-bell-btn {
          width: 34px;
          height: 34px;
          background: var(--bg-elevated);
          border: 1px solid var(--border);
          border-radius: var(--radius-sm);
          display: flex;
          align-items: center;
          justify-content: center;
          color: var(--text-secondary);
          transition: all 0.15s;
          position: relative;
          cursor: pointer;
        }
        .notif-bell-btn:hover {
          background: var(--bg-hover);
          color: var(--text-primary);
        }
        .notif-badge {
          position: absolute;
          top: -4px;
          right: -4px;
          min-width: 16px;
          height: 16px;
          padding: 0 4px;
          background: var(--orange);
          border: 1.5px solid var(--bg-surface);
          border-radius: 999px;
          font-size: 10px;
          font-weight: 700;
          color: white;
          display: flex;
          align-items: center;
          justify-content: center;
          line-height: 1;
        }
        .notif-panel {
          position: absolute;
          top: calc(100% + 8px);
          right: 0;
          width: 340px;
          max-height: 420px;
          overflow-y: auto;
          background: var(--bg-surface);
          border: 1px solid var(--border);
          border-radius: var(--radius-sm);
          box-shadow: 0 8px 24px rgba(0,0,0,0.16);
          z-index: 50;
        }
        .notif-panel-header {
          padding: 12px 14px;
          font-size: 13px;
          font-weight: 700;
          color: var(--text-primary);
          border-bottom: 1px solid var(--border);
        }
        .notif-empty {
          padding: 24px 14px;
          font-size: 13px;
          color: var(--text-muted);
          text-align: center;
        }
        .notif-row {
          display: flex;
          align-items: flex-start;
          gap: 8px;
          width: 100%;
          padding: 10px 14px;
          background: none;
          border: none;
          border-bottom: 1px solid var(--border);
          text-align: left;
          cursor: pointer;
        }
        .notif-row:last-child { border-bottom: none; }
        .notif-row:hover { background: var(--bg-hover); }
        .notif-row-dot {
          width: 7px;
          height: 7px;
          border-radius: 50%;
          margin-top: 5px;
          flex-shrink: 0;
          background: var(--orange);
        }
        .notif-row-dot.read { background: transparent; }
        .notif-row-body { min-width: 0; }
        .notif-row-title {
          font-size: 13px;
          font-weight: 600;
          color: var(--text-primary);
        }
        .notif-row-message {
          font-size: 12px;
          color: var(--text-secondary);
          margin-top: 2px;
        }
        .notif-row-time {
          font-size: 11px;
          color: var(--text-muted);
          margin-top: 4px;
        }
      `}</style>

      <button
        className="notif-bell-btn"
        onClick={() => setOpen((o) => !o)}
        title="Notifications"
        aria-label="Notifications"
      >
        <Bell size={16} />
        {unreadCount > 0 && (
          <span className="notif-badge">{unreadCount > 99 ? "99+" : unreadCount}</span>
        )}
      </button>

      {open && (
        <div className="notif-panel">
          <div className="notif-panel-header">Notifications</div>
          {notifications.length === 0 ? (
            <div className="notif-empty">No notifications yet.</div>
          ) : (
            notifications.map((n) => {
              const isRead = !!(user && n.readBy[user.uid]);
              return (
                <button key={n.id} className="notif-row" onClick={() => handleSelect(n)}>
                  <span className={`notif-row-dot ${isRead ? "read" : ""}`} />
                  <span className="notif-row-body">
                    <span className="notif-row-title">{n.title} </span>
                    <span className="notif-row-message">{n.message}</span>
                    <span className="notif-row-time">{timeAgo(n.createdAt)}</span>
                  </span>
                </button>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
