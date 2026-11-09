"use client";

import { useState, useCallback, useEffect } from "react";
import { CheckCircle, XCircle, AlertTriangle, Info, Bell, X } from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

export type ToastType = "success" | "error" | "warning" | "info" | "notify";

interface Toast {
  id: string;
  type: ToastType;
  title: string;
  message?: string;
  /** Makes the whole toast clickable (notification pop-ups) */
  onOpen?: () => void;
}

// ─── Singleton store (simple module-level state for easy global use) ──────────

type Listener = (toasts: Toast[]) => void;
let _toasts: Toast[] = [];
const _listeners = new Set<Listener>();

function notify() {
  _listeners.forEach((fn) => fn([..._toasts]));
}

export const toast = {
  success: (title: string, message?: string) => add("success", title, message),
  error:   (title: string, message?: string) => add("error",   title, message),
  warning: (title: string, message?: string) => add("warning", title, message),
  info:    (title: string, message?: string) => add("info",    title, message),
  /** New admin notification / message pop-up — stays longer, click to open */
  notify:  (title: string, message?: string, onOpen?: () => void) => add("notify", title, message, onOpen, 8000),
};

function add(type: ToastType, title: string, message?: string, onOpen?: () => void, duration = 4500) {
  const id = Math.random().toString(36).slice(2);
  _toasts = [..._toasts, { id, type, title, message, onOpen }];
  notify();
  setTimeout(() => remove(id), duration);
}

function remove(id: string) {
  _toasts = _toasts.filter((t) => t.id !== id);
  notify();
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

function useToasts() {
  const [toasts, setToasts] = useState<Toast[]>([..._toasts]);

  useEffect(() => {
    _listeners.add(setToasts);
    return () => { _listeners.delete(setToasts); };
  }, []);

  return { toasts, remove };
}

// ─── UI config ────────────────────────────────────────────────────────────────

const ICONS: Record<ToastType, React.FC<{ size: number }>> = {
  success: ({ size }) => <CheckCircle size={size} style={{ color: "var(--green)" }} />,
  error:   ({ size }) => <XCircle     size={size} style={{ color: "var(--red)"   }} />,
  warning: ({ size }) => <AlertTriangle size={size} style={{ color: "var(--amber)" }} />,
  info:    ({ size }) => <Info          size={size} style={{ color: "var(--blue)"  }} />,
  notify:  ({ size }) => <Bell          size={size} style={{ color: "var(--blue)"  }} />,
};

const BORDER_COLOR: Record<ToastType, string> = {
  success: "rgba(16,185,129,0.3)",
  error:   "rgba(239,68,68,0.3)",
  warning: "rgba(245,158,11,0.3)",
  info:    "rgba(59,130,246,0.3)",
  notify:  "var(--blue)",
};

// ─── Component ────────────────────────────────────────────────────────────────

export default function Toaster() {
  const { toasts, remove } = useToasts();

  if (toasts.length === 0) return null;

  return (
    <div style={{
      position: "fixed",
      bottom: 24,
      right: 24,
      display: "flex",
      flexDirection: "column",
      gap: 10,
      zIndex: 9999,
      maxWidth: 360,
      width: "calc(100vw - 48px)",
    }}>
      <style>{`
        @keyframes toast-in {
          from { opacity: 0; transform: translateX(24px) scale(0.95); }
          to   { opacity: 1; transform: translateX(0)   scale(1);    }
        }
        .toast-item {
          background: var(--bg-surface);
          border: 1px solid var(--border);
          border-radius: var(--radius-md);
          padding: 14px 14px 14px 16px;
          display: flex;
          gap: 12px;
          align-items: flex-start;
          box-shadow: 0 12px 32px rgba(0,0,0,0.4);
          animation: toast-in 0.2s cubic-bezier(0.34, 1.56, 0.64, 1);
        }
        .toast-body { flex: 1; min-width: 0; }
        .toast-title {
          font-size: 13px;
          font-weight: 700;
          color: var(--text-primary);
          margin-bottom: 2px;
        }
        .toast-msg {
          font-size: 12px;
          color: var(--text-muted);
          line-height: 1.5;
        }
        .toast-dismiss {
          color: var(--text-muted);
          padding: 2px;
          border-radius: 4px;
          transition: all 0.12s;
          flex-shrink: 0;
          cursor: pointer;
        }
        .toast-dismiss:hover { background: var(--bg-elevated); color: var(--text-primary); }
        .toast-item.clickable { cursor: pointer; }
        .toast-item.clickable:hover { background: var(--bg-elevated); }
        .toast-msg.clamp { display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
      `}</style>

      {toasts.map((t) => {
        const Icon = ICONS[t.type];
        return (
          <div
            key={t.id}
            className={`toast-item${t.onOpen ? " clickable" : ""}`}
            style={{ borderLeftColor: BORDER_COLOR[t.type], borderLeftWidth: 3 }}
            onClick={t.onOpen ? () => { remove(t.id); t.onOpen!(); } : undefined}
            role={t.onOpen ? "button" : undefined}
          >
            <Icon size={18} />
            <div className="toast-body">
              <div className="toast-title">{t.title}</div>
              {t.message && <div className={`toast-msg${t.onOpen ? " clamp" : ""}`}>{t.message}</div>}
            </div>
            <button className="toast-dismiss" onClick={(e) => { e.stopPropagation(); remove(t.id); }} aria-label="Dismiss">
              <X size={13} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
