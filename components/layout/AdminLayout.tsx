"use client";

import { useState } from "react";
import Link from "next/link";
import Sidebar from "@/components/sidebar/Sidebar";
import { useAuthGuard } from "@/hooks/useAuthGuard";
import ThemeToggle from "../ui/ThemeToggle";

interface AdminLayoutProps {
  children: React.ReactNode;
  title?: string;
  subtitle?: string;
  actions?: React.ReactNode;
}

export default function AdminLayout({
  children,
  title,
  subtitle,
  actions,
}: AdminLayoutProps) {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const { user, loading } = useAuthGuard();

  if (loading) {
    return (
      <div style={{
        height: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "var(--bg-base)",
        flexDirection: "column",
        gap: 16,
      }}>
        <style>{`
          @keyframes auth-spin {
            to { transform: rotate(360deg); }
          }
        `}</style>
        <div style={{
          width: 34,
          height: 34,
          border: "3px solid var(--border)",
          borderTopColor: "var(--blue)",
          borderRadius: "50%",
          animation: "auth-spin 0.75s linear infinite",
        }} />
        <span style={{ fontSize: 13, color: "var(--text-muted)" }}>Verifying session…</span>
      </div>
    );
  }

  if (!user) return null;

  const initials = user.displayName
    ? user.displayName.split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase()
    : "SA";

  return (
    <div className="admin-shell">
      <style>{`
        .admin-shell {
          display: flex;
          height: 100vh;
          overflow: hidden;
          background: var(--bg-base);
        }
        .admin-main {
          flex: 1;
          display: flex;
          flex-direction: column;
          overflow: hidden;
          min-width: 0;
        }
        .admin-topbar {
          height: var(--topbar-height);
          background: var(--bg-surface);
          border-bottom: 1px solid var(--border);
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 0 24px;
          flex-shrink: 0;
          gap: 16px;
        }
        .topbar-left {
          display: flex;
          flex-direction: column;
          justify-content: center;
          min-width: 0;
        }
        .topbar-title {
          font-size: 17px;
          font-weight: 700;
          color: var(--text-primary);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .topbar-subtitle {
          font-size: 12px;
          color: var(--text-muted);
          margin-top: 1px;
          white-space: nowrap;
        }
        .topbar-right {
          display: flex;
          align-items: center;
          gap: 10px;
          flex-shrink: 0;
        }
        .topbar-search {
          display: flex;
          align-items: center;
          gap: 8px;
          background: var(--bg-elevated);
          border: 1px solid var(--border);
          border-radius: var(--radius-sm);
          padding: 7px 12px;
          width: 200px;
          transition: border-color 0.2s, box-shadow 0.2s;
        }
        .topbar-search:focus-within {
          border-color: var(--blue);
          box-shadow: 0 0 0 3px rgba(59,130,246,0.12);
        }
        .topbar-search input {
          background: none;
          border: none;
          outline: none;
          color: var(--text-primary);
          font-size: 13px;
          width: 100%;
        }
        .topbar-search input::placeholder { color: var(--text-muted); }
        .topbar-icon-btn {
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
          flex-shrink: 0;
        }
        .topbar-icon-btn:hover {
          background: var(--bg-hover);
          color: var(--text-primary);
        }
        .notif-dot {
          position: absolute;
          top: 6px;
          right: 6px;
          width: 7px;
          height: 7px;
          background: var(--orange);
          border-radius: 50%;
          border: 1.5px solid var(--bg-surface);
        }
        .topbar-avatar {
          width: 32px;
          height: 32px;
          background: linear-gradient(135deg, var(--blue), var(--purple));
          border-radius: 8px;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 12px;
          font-weight: 700;
          color: white;
          cursor: pointer;
          flex-shrink: 0;
          text-decoration: none;
          transition: opacity 0.15s;
        }
        .topbar-avatar:hover { opacity: 0.8; }
        .topbar-actions { display: flex; align-items: center; gap: 8px; }
        .admin-content {
          flex: 1;
          overflow-y: auto;
          padding: 28px 28px 40px;
          background: var(--bg-base);
        }
        @media (max-width: 768px) {
          .topbar-search { display: none; }
          .admin-content { padding: 20px 16px; }
        }
      `}</style>

      <Sidebar
        collapsed={sidebarCollapsed}
        onToggle={() => setSidebarCollapsed(!sidebarCollapsed)}
        user={user}
      />

      <div className="admin-main">
        <header className="admin-topbar">
          <div className="topbar-left">
            {title && <h1 className="topbar-title">{title}</h1>}
            {subtitle && <p className="topbar-subtitle">{subtitle}</p>}
          </div>

          <div className="topbar-right">
            {actions && <div className="topbar-actions">{actions}</div>}
            <ThemeToggle/>

            <Link href="/profile" className="topbar-avatar" title={user.displayName ?? "My Profile"}>
              {initials}
            </Link>
          </div>
        </header>

        <main className="admin-content">{children}</main>
      </div>
    </div>
  );
}
