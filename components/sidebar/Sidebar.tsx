"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  LayoutDashboard, Users, Shield,
  Settings, LogOut, ChevronLeft, ChevronRight, Activity,
  Map, MegaphoneIcon, File, BadgeCheck,
  ClipboardList, Zap, Wrench, Gift, Headphones, BarChart3, Flag,
  LucideIcon,
  Filter,
} from "lucide-react";
import { auth } from "@/lib/firebase";
import type { AdminUser } from "@/context/AuthContext";
import { useAuth } from "@/context/AuthContext";
import SidebarItem from "./SidebarItem";
import type { ModuleKey } from "@/lib/modules";

// ─── Nav config with module keys, grouped ────────────────────────────────────

interface NavItem {
  href: string;
  icon: LucideIcon;
  label: string;
  module: ModuleKey;
}

interface NavGroup {
  label: string;
  items: NavItem[];
}

const NAV_GROUPS: NavGroup[] = [
  {
    label: "Overview",
    items: [
      { href: "/dashboard", icon: LayoutDashboard, label: "Dashboard", module: "dashboard" },
      { href: "/analytics", icon: BarChart3,       label: "Analytics", module: "analytics" },
    ],
  },
  {
    label: "Monitoring",
    items: [
      { href: "/live-map",      icon: Map,      label: "Live Map",      module: "live-map" },
      { href: "/activity-logs", icon: Activity, label: "Activity Logs", module: "activity-logs" },
    ],
  },
  {
    label: "Marketplace",
    items: [
      { href: "/live-gigs",  icon: ClipboardList, label: "Gigs",                      module: "live-gigs" },
      { href: "/quick-gigs", icon: Zap,            label: "Quick Gigs Configuration",  module: "quick-gigs" },
    ],
  },
  {
    label: "Users",
    items: [
      { href: "/users",        icon: Users,      label: "Users",        module: "users" },
      { href: "/verification", icon: BadgeCheck, label: "Verification", module: "verification" },
      { href: "/user-skills",  icon: Wrench,     label: "User Skills",  module: "library-gsin" },
      { href: "/referrals",    icon: Gift,       label: "Referrals",    module: "referrals" },
      { href: "/user-reports", icon: Flag,       label: "User Reports", module: "user-reports" },
    ],
  },
  {
    label: "Communication",
    items: [
      { href: "/announcements", icon: MegaphoneIcon, label: "Announcements", module: "announcements" },
      { href: "/support",       icon: Headphones,    label: "Support",       module: "reports" },
    ],
  },
  {
    label: "Content",
    items: [
      { href: "/content-management", icon: File, label: "Content Management", module: "content-management" },
       { href: "/word-filter", icon: Filter, label: "Word Filter", module: "word-filter" },
    ],
  },
  {
    label: "Administration",
    items: [
      { href: "/admins",   icon: Shield,   label: "Admins",   module: "admins" },
      { href: "/settings", icon: Settings, label: "Settings", module: "settings" },
    ],
  },
];

const ROLE_COLOR: Record<string, string> = {
  super_admin: "var(--purple)",
  admin: "var(--blue)",
};

interface SidebarProps {
  collapsed: boolean;
  onToggle: () => void;
  user: AdminUser;
}

export default function Sidebar({ collapsed, onToggle, user }: SidebarProps) {
  const router = useRouter();
  const { hasPermission } = useAuth();

  const handleLogout = async () => {
    await auth.signOut();
    router.replace("/login");
  };

  const initials = user.displayName
    ? user.displayName.split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase()
    : "SA";

  // Filter groups/items by permission; drop groups left with no visible items
  const visibleGroups = NAV_GROUPS
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => hasPermission(item.module)),
    }))
    .filter((group) => group.items.length > 0);

  return (
    <aside className={`sidebar${collapsed ? " sidebar--collapsed" : ""}`}>
      <style>{`
        .sidebar {
          width: var(--sidebar-width);
          height: 100vh;
          background: var(--bg-surface);
          border-right: 1px solid var(--border);
          display: flex;
          flex-direction: column;
          transition: width 0.25s cubic-bezier(0.4, 0, 0.2, 1);
          overflow: hidden;
          flex-shrink: 0;
          position: relative;
        }
        .sidebar--collapsed { width: 60px; }
        .sb-header {
          padding: 18px 14px 14px;
          border-bottom: 1px solid var(--border);
          display: flex;
          align-items: center;
          gap: 10px;
          min-height: var(--topbar-height);
          flex-shrink: 0;
        }
        .sb-logo-mark {
          width: 32px; height: 32px;
          background: linear-gradient(135deg, var(--blue) 0%, var(--orange) 100%);
          border-radius: 8px;
          display: flex; align-items: center; justify-content: center;
          font-family: 'Space Mono', monospace;
          font-size: 14px; font-weight: 700; color: white; flex-shrink: 0;
        }
        .sb-logo-text { overflow: hidden; white-space: nowrap; }
        .sb-logo-text h2 {
          font-family: 'Space Mono', monospace;
          font-size: 16px; font-weight: 700; line-height: 1.2;
        }
        .sb-logo-text h2 .b { color: var(--blue); }
        .sb-logo-text h2 .o { color: var(--orange); }
        .sb-logo-text p {
          font-size: 9px; font-weight: 700; letter-spacing: 1.8px;
          text-transform: uppercase; color: var(--text-muted); margin-top: 1px;
        }
        .sb-toggle {
          position: absolute; top: 20px; right: -12px;
          width: 24px; height: 24px;
          background: var(--bg-elevated); border: 1px solid var(--border);
          border-radius: 50%;
          display: flex; align-items: center; justify-content: center;
          color: var(--text-secondary); transition: all 0.15s; z-index: 20; cursor: pointer;
        }
        .sb-toggle:hover {
          background: var(--blue); border-color: var(--blue);
          color: white; box-shadow: 0 0 0 3px rgba(59,130,246,0.2);
        }
        .sb-nav {
          flex: 1; overflow-y: auto; overflow-x: hidden;
          padding: 10px 8px;
          display: flex; flex-direction: column; gap: 1px;
        }
        .sb-section-label {
          font-size: 9px; font-weight: 800; letter-spacing: 1.8px;
          text-transform: uppercase; color: var(--text-muted);
          padding: 10px 12px 5px; white-space: nowrap;
        }
        .sb-divider { height: 1px; background: var(--border); margin: 8px 12px; }
        .sb-footer {
          padding: 10px 8px; border-top: 1px solid var(--border);
          display: flex; flex-direction: column; gap: 2px; flex-shrink: 0;
        }
        .sb-user {
          display: flex; align-items: center; gap: 10px;
          padding: 8px 10px; border-radius: var(--radius-sm);
          cursor: pointer; transition: background 0.15s;
          overflow: hidden; white-space: nowrap; text-decoration: none;
        }
        .sb-user:hover { background: var(--bg-hover); }
        .sb-avatar {
          width: 30px; height: 30px;
          background: linear-gradient(135deg, var(--blue), var(--purple));
          border-radius: 8px;
          display: flex; align-items: center; justify-content: center;
          font-size: 11px; font-weight: 700; color: white; flex-shrink: 0;
        }
        .sb-user-name {
          font-size: 13px; font-weight: 600; color: var(--text-primary);
          white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
        }
        .sb-user-role { font-size: 10px; font-weight: 700; letter-spacing: 0.4px; text-transform: uppercase; }
        .sb-logout {
          display: flex; align-items: center; gap: 10px;
          padding: 8px 10px; border-radius: var(--radius-sm);
          color: var(--text-muted); font-size: 13px; font-weight: 500;
          transition: all 0.15s; white-space: nowrap; overflow: hidden;
          width: 100%; text-align: left; cursor: pointer;
        }
        .sb-logout:hover { background: var(--red-dim); color: var(--red); }
        .sb-logout svg { flex-shrink: 0; }
      `}</style>

      <div className="sb-header">
        <div className="sb-logo-mark">G</div>
        {!collapsed && (
          <div className="sb-logo-text">
            <h2><span className="b">Gigg</span><span className="o">re</span></h2>
            <p>Admin Console</p>
          </div>
        )}
      </div>

      <button className="sb-toggle" onClick={onToggle}
        title={collapsed ? "Expand sidebar" : "Collapse sidebar"}>
        {collapsed ? <ChevronRight size={11} /> : <ChevronLeft size={11} />}
      </button>

      <nav className="sb-nav">
        {visibleGroups.map((group, i) => (
          <div key={group.label}>
            {i > 0 && <div className="sb-divider" />}
            {!collapsed && <div className="sb-section-label">{group.label}</div>}
            {group.items.map((item) => (
              <SidebarItem key={item.href} href={item.href} icon={item.icon}
                label={item.label} collapsed={collapsed} />
            ))}
          </div>
        ))}
      </nav>

      <div className="sb-footer">
        <Link href="/profile" className="sb-user">
          <div className="sb-avatar">{initials}</div>
          {!collapsed && (
            <div style={{ overflow: "hidden", flex: 1 }}>
              <div className="sb-user-name">{user.displayName ?? "Admin"}</div>
              <div className="sb-user-role"
                style={{ color: ROLE_COLOR[user.role] ?? "var(--blue)" }}>
                {user.role.replace("_", " ")}
              </div>
            </div>
          )}
        </Link>
        <button className="sb-logout" onClick={handleLogout} title="Logout">
          <LogOut size={16} />
          {!collapsed && "Logout"}
        </button>
      </div>
    </aside>
  );
}