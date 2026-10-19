"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LucideIcon } from "lucide-react";

interface SidebarItemProps {
  href: string;
  icon: LucideIcon;
  label: string;
  badge?: number;
  collapsed?: boolean;
}

export default function SidebarItem({
  href,
  icon: Icon,
  label,
  badge,
  collapsed = false,
}: SidebarItemProps) {
  const pathname = usePathname();
  const isActive = pathname === href || pathname.startsWith(href + "/");

  return (
    <Link
      href={href}
      className="sidebar-item-link"
      title={collapsed ? (badge ? `${label} (${badge})` : label) : undefined}
    >
      <style>{`
        .sidebar-item-link {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 9px 12px;
          border-radius: var(--radius-sm);
          color: var(--text-secondary);
          font-size: 13.5px;
          font-weight: 500;
          transition: all 0.15s;
          position: relative;
          text-decoration: none;
          white-space: nowrap;
          overflow: hidden;
        }
        .sidebar-item-link:hover {
          background: var(--bg-hover);
          color: var(--text-primary);
        }
        .sidebar-item-link.active {
          background: var(--blue-dim);
          color: var(--blue);
        }
        .sidebar-item-link.active .s-icon {
          color: var(--blue);
        }
        .s-icon {
          flex-shrink: 0;
          width: 18px;
          height: 18px;
          opacity: 0.85;
        }
        .sidebar-item-link:hover .s-icon,
        .sidebar-item-link.active .s-icon {
          opacity: 1;
        }
        .s-label {
          flex: 1;
          transition: opacity 0.2s;
        }
        .s-badge {
          background: var(--blue);
          color: white;
          font-size: 10px;
          font-weight: 700;
          padding: 1px 6px;
          border-radius: 20px;
          flex-shrink: 0;
          transition: opacity 0.2s;
        }
        .s-dot {
          position: absolute;
          top: 6px;
          left: 26px;
          width: 8px;
          height: 8px;
          border-radius: 50%;
          background: var(--blue);
          border: 2px solid var(--bg-surface);
        }
        .s-active-bar {
          position: absolute;
          left: 0;
          top: 6px;
          bottom: 6px;
          width: 3px;
          background: var(--blue);
          border-radius: 0 3px 3px 0;
        }
      `}</style>
      {isActive && <span className="s-active-bar" />}
      <Icon className="s-icon" size={18} />
      {collapsed && badge !== undefined && badge > 0 && <span className="s-dot" />}
      {!collapsed && (
        <>
          <span className="s-label">{label}</span>
          {badge !== undefined && badge > 0 && (
            <span className="s-badge">{badge > 99 ? "99+" : badge}</span>
          )}
        </>
      )}
    </Link>
  );
}
