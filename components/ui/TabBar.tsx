"use client";

import React from "react";
import type { ContentSectionKey } from "@/lib/activitylog";

interface TabConfig {
  key:         ContentSectionKey;
  label:       string;
  icon:        React.ElementType;
  color:       string;
  count?:      number;
  loading?:    boolean;
}

interface TabBarProps {
  tabs:      TabConfig[];
  activeTab: ContentSectionKey;
  onChange:  (key: ContentSectionKey) => void;
}

export function TabBar({ tabs, activeTab, onChange }: TabBarProps) {
  return (
    <>
      <style>{`
        .tab-bar { display: flex; gap: 2px; padding: 4px; background: var(--bg-elevated); border: 1px solid var(--border); border-radius: var(--radius-lg); overflow-x: auto; scrollbar-width: none; -ms-overflow-style: none; position: sticky; top: 0; z-index: 10; }
        .tab-bar::-webkit-scrollbar { display: none; }
        .tab-btn { display: flex; align-items: center; gap: 6px; padding: 7px 14px; border: 1px solid transparent; border-radius: 8px; background: transparent; color: var(--text-muted); font-size: 12px; font-weight: 500; font-family: inherit; cursor: pointer; white-space: nowrap; flex-shrink: 0; transition: background 0.12s, color 0.12s; }
        .tab-btn:hover:not(.tab-btn--active) { background: var(--bg-surface); color: var(--text-secondary); }
        .tab-btn--active { background: var(--bg-surface); border-color: var(--border); color: var(--text-primary); box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
        .tab-count { display: inline-flex; align-items: center; justify-content: center; min-width: 18px; height: 18px; padding: 0 5px; border-radius: 20px; font-size: 10px; font-weight: 700; line-height: 1; }
        .tab-count--active { color: #fff; }
        .tab-count--inactive { background: var(--bg-hover); color: var(--text-muted); }
        .tab-dot { width: 5px; height: 5px; border-radius: 50%; background: var(--text-muted); animation: tab-pulse 1.2s ease-in-out infinite; flex-shrink: 0; }
        @keyframes tab-pulse { 0%,100% { opacity: 0.3; } 50% { opacity: 1; } }
      `}</style>

      <nav className="tab-bar" role="tablist" aria-label="Content sections">
        {tabs.map(({ key, label, icon: Icon, color, count, loading }) => {
          const isActive = activeTab === key;
          return (
            <button
              key={key}
              role="tab"
              aria-selected={isActive}
              aria-controls={`tabpanel-${key}`}
              className={`tab-btn${isActive ? " tab-btn--active" : ""}`}
              onClick={() => onChange(key)}
            >
              <Icon size={13} style={{ color: isActive ? color : "currentColor", flexShrink: 0 }} />
              {label}
              {loading && !count && (
                <span className="tab-dot" />
              )}
              {/* {count !== undefined && (
                <span
                  className={`tab-count ${isActive ? "tab-count--active" : "tab-count--inactive"}`}
                  style={isActive ? { background: color } : undefined}
                >
                  {count}
                </span>
              )} */}
            </button>
          );
        })}
      </nav>
    </>
  );
}