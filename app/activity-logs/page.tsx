"use client";

import { useState, useEffect, useCallback } from "react";
import AdminLayout from "@/components/layout/AdminLayout";
import { useAuthGuard } from "@/hooks/useAuthGuard";
import {
  collection,
  getDocs,
  query,
  orderBy,
  limit,
  startAfter,
  where,
  Timestamp,
  QueryDocumentSnapshot,
  DocumentData,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { Search, Filter, RefreshCw, ChevronLeft, ChevronRight, X } from "lucide-react";
import type { LogAction } from "@/lib/activitylog";
import Badge from "@/components/ui/Badge";

// ─── Types ────────────────────────────────────────────────────────────────────

interface LogEntry {
  id: string;
  actorId: string;
  actorName: string;
  action: LogAction;
  targetId?: string;
  targetName?: string;
  meta?: Record<string, unknown>;
  createdAt: Date | null;
}

const ACTION_LABELS: Record<LogAction, string> = {
  created_admin: "Created Admin",
  updated_admin: "Updated Admin",
  deleted_admin: "Deleted Admin",
  updated_permissions: "Updated Permissions",
  toggled_admin_status: "Toggled Status",
  changed_role: "Changed Role",
  admin_login: "Admin Login",
};

const ACTION_VARIANTS: Record<LogAction, "blue" | "green" | "red" | "amber" | "purple" | "orange"> = {
  created_admin: "green",
  updated_admin: "blue",
  deleted_admin: "red",
  updated_permissions: "purple",
  toggled_admin_status: "amber",
  changed_role: "orange",
  admin_login: "blue",
};

const ALL_ACTIONS: LogAction[] = [
  "created_admin",
  "updated_admin",
  "deleted_admin",
  "updated_permissions",
  "toggled_admin_status",
  "changed_role",
  "admin_login",
];

const PAGE_SIZE = 20;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(d: Date | null): string {
  if (!d) return "—";
  return d.toLocaleDateString("en-PH", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatMeta(meta?: Record<string, unknown>): string {
  if (!meta || Object.keys(meta).length === 0) return "";
  return Object.entries(meta)
    .map(([k, v]) => {
      if (typeof v === "object" && v !== null) return `${k}: ${JSON.stringify(v)}`;
      return `${k}: ${v}`;
    })
    .join(" · ");
}

function getActionDescription(log: LogEntry): string {
  switch (log.action) {
    case "created_admin":
      return `Created admin account for ${log.targetName ?? "unknown"}${log.meta?.email ? ` (${log.meta.email})` : ""}`;
    case "updated_admin":
      return `Updated admin ${log.targetName ?? "unknown"}`;
    case "deleted_admin":
      return `Permanently deleted ${log.targetName ?? "unknown"}`;
    case "updated_permissions":
      return `Updated module permissions for ${log.targetName ?? "unknown"}`;
    case "toggled_admin_status": {
      const to = log.meta?.to;
      return `${to ? "Activated" : "Deactivated"} ${log.targetName ?? "unknown"}`;
    }
    case "changed_role":
      return `Changed role of ${log.targetName ?? "unknown"}`;
    case "admin_login":
      return `Signed in`;
    default:
      return formatMeta(log.meta);
  }
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function ActivityLogsPage() {
  useAuthGuard({ module: "activity-logs" });

  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Filters
  const [search, setSearch] = useState("");
  const [actionFilter, setActionFilter] = useState<LogAction | "">("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [showFilters, setShowFilters] = useState(false);

  // Pagination
  const [page, setPage] = useState(1);
  const [cursors, setCursors] = useState<QueryDocumentSnapshot<DocumentData>[]>([]);
  const [hasMore, setHasMore] = useState(false);

  const activeFilterCount = [actionFilter, dateFrom, dateTo].filter(Boolean).length;

  // ── Fetch ──────────────────────────────────────────────────────────────────
  const fetchLogs = useCallback(
    async (cursor?: QueryDocumentSnapshot<DocumentData>, direction: "next" | "prev" | "reset" = "reset") => {
      setLoading(true);
      try {
        const constraints: any[] = [orderBy("createdAt", "desc"), limit(PAGE_SIZE + 1)];

        if (actionFilter) {
          constraints.unshift(where("action", "==", actionFilter));
        }
        if (dateFrom) {
          constraints.push(where("createdAt", ">=", Timestamp.fromDate(new Date(dateFrom))));
        }
        if (dateTo) {
          const end = new Date(dateTo);
          end.setDate(end.getDate() + 1);
          constraints.push(where("createdAt", "<", Timestamp.fromDate(end)));
        }
        if (cursor) {
          constraints.push(startAfter(cursor));
        }

        const q = query(collection(db, "activityLogs"), ...constraints);
        const snap = await getDocs(q);
        const docs = snap.docs;

        const hasNextPage = docs.length > PAGE_SIZE;
        const pageDocs = hasNextPage ? docs.slice(0, PAGE_SIZE) : docs;

        const list: LogEntry[] = pageDocs.map((d) => {
          const data = d.data();
          return {
            id: d.id,
            actorId: data.actorId ?? "",
            actorName: data.actorName ?? "Unknown",
            action: data.action ?? "admin_login",
            targetId: data.targetId,
            targetName: data.targetName,
            meta: data.meta,
            createdAt: data.createdAt?.toDate?.() ?? null,
          };
        });

        setLogs(list);
        setHasMore(hasNextPage);

        if (direction === "next" && pageDocs.length > 0) {
          setCursors((prev) => [...prev, pageDocs[pageDocs.length - 1]]);
        }
      } catch (err) {
        console.error("Failed to fetch activity logs:", err);
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [actionFilter, dateFrom, dateTo]
  );

  useEffect(() => {
    setPage(1);
    setCursors([]);
    fetchLogs(undefined, "reset");
  }, [fetchLogs]);

  const handleNextPage = () => {
    if (!hasMore || logs.length === 0) return;
    const lastDoc = cursors[cursors.length - 1];
    // We need the actual Firestore doc snapshot — refetch with cursor
    setPage((p) => p + 1);
    fetchLogs(lastDoc, "next");
  };

  const handlePrevPage = () => {
    if (page <= 1) return;
    const prevCursor = cursors[cursors.length - 3]; // go back one page
    setCursors((prev) => prev.slice(0, -1));
    setPage((p) => p - 1);
    fetchLogs(prevCursor, "prev");
  };

  const handleRefresh = () => {
    setRefreshing(true);
    setPage(1);
    setCursors([]);
    fetchLogs(undefined, "reset");
  };

  const handleClearFilters = () => {
    setActionFilter("");
    setDateFrom("");
    setDateTo("");
    setSearch("");
  };

  // Client-side search (name / email search on already-fetched page)
  const filtered = logs.filter((log) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      log.actorName.toLowerCase().includes(q) ||
      (log.targetName ?? "").toLowerCase().includes(q) ||
      ACTION_LABELS[log.action].toLowerCase().includes(q)
    );
  });

  return (
    <AdminLayout
      title="Activity Logs"
      subtitle="Audit trail of all admin actions"
    >
      <style>{`
        .logs-toolbar {
          display: flex; align-items: center; gap: 10px;
          margin-bottom: 16px; flex-wrap: wrap;
        }
        .logs-search {
          display: flex; align-items: center; gap: 8px;
          background: var(--bg-surface); border: 1px solid var(--border);
          border-radius: var(--radius-sm); padding: 7px 12px;
          flex: 1; min-width: 200px; max-width: 320px;
          transition: border-color 0.2s;
        }
        .logs-search:focus-within { border-color: var(--blue); }
        .logs-search input {
          background: none; border: none; outline: none;
          color: var(--text-primary); font-size: 13px; width: 100%;
          font-family: inherit;
        }
        .logs-search input::placeholder { color: var(--text-muted); }
        .logs-toolbar-right { display: flex; align-items: center; gap: 8px; margin-left: auto; }

        .filter-btn {
          display: flex; align-items: center; gap: 6px;
          background: var(--bg-surface); border: 1px solid var(--border);
          border-radius: var(--radius-sm); padding: 7px 12px;
          font-size: 12px; font-weight: 600; color: var(--text-secondary);
          cursor: pointer; transition: all 0.15s; white-space: nowrap;
        }
        .filter-btn:hover { background: var(--bg-elevated); color: var(--text-primary); }
        .filter-btn.active { border-color: var(--blue); color: var(--blue); background: var(--blue-dim); }
        .filter-badge {
          background: var(--blue); color: #fff;
          font-size: 10px; font-weight: 700;
          width: 16px; height: 16px; border-radius: 50%;
          display: flex; align-items: center; justify-content: center;
        }

        .refresh-btn {
          display: flex; align-items: center; gap: 6px;
          background: var(--bg-surface); border: 1px solid var(--border);
          border-radius: var(--radius-sm); padding: 7px 10px;
          font-size: 12px; color: var(--text-secondary);
          cursor: pointer; transition: all 0.15s;
        }
        .refresh-btn:hover { background: var(--bg-elevated); color: var(--text-primary); }
        .refresh-btn svg { transition: transform 0.3s; }
        .refresh-btn:hover svg { transform: rotate(180deg); }

        .filters-panel {
          background: var(--bg-surface); border: 1px solid var(--border);
          border-radius: var(--radius-md); padding: 16px 20px;
          margin-bottom: 16px; display: flex; gap: 16px; flex-wrap: wrap;
          align-items: flex-end;
        }
        .filter-group { display: flex; flex-direction: column; gap: 6px; flex: 1; min-width: 160px; }
        .filter-label {
          font-size: 10px; font-weight: 700; letter-spacing: 0.8px;
          text-transform: uppercase; color: var(--text-muted);
        }
        .filter-select, .filter-date {
          background: var(--bg-elevated); border: 1px solid var(--border);
          border-radius: var(--radius-sm); padding: 7px 10px;
          color: var(--text-primary); font-size: 13px; font-family: inherit;
          outline: none; cursor: pointer; transition: border-color 0.2s;
          width: 100%;
        }
        .filter-select:focus, .filter-date:focus { border-color: var(--blue); }
        .filter-date::-webkit-calendar-picker-indicator { filter: invert(0.5); cursor: pointer; }
        .clear-filters-btn {
          display: flex; align-items: center; gap: 5px;
          background: var(--red-dim); border: 1px solid rgba(239,68,68,0.2);
          border-radius: var(--radius-sm); padding: 7px 12px;
          font-size: 12px; font-weight: 600; color: var(--red);
          cursor: pointer; transition: all 0.15s; white-space: nowrap;
        }
        .clear-filters-btn:hover { background: rgba(239,68,68,0.2); }

        .logs-table-wrap {
          background: var(--bg-surface); border: 1px solid var(--border);
          border-radius: var(--radius-lg); overflow: hidden;
        }
        .logs-table { width: 100%; border-collapse: collapse; }
        .logs-table thead tr {
          background: var(--bg-elevated); border-bottom: 1px solid var(--border);
        }
        .logs-table th {
          padding: 10px 16px; text-align: left; font-size: 10px; font-weight: 700;
          letter-spacing: 0.8px; text-transform: uppercase; color: var(--text-muted);
          white-space: nowrap;
        }
        .logs-table tbody tr {
          border-bottom: 1px solid var(--border-muted);
          transition: background 0.12s;
        }
        .logs-table tbody tr:last-child { border-bottom: none; }
        .logs-table tbody tr:hover { background: var(--bg-elevated); }
        .logs-table td { padding: 12px 16px; font-size: 13px; color: var(--text-secondary); vertical-align: top; }

        .log-actor { font-weight: 600; color: var(--text-primary); font-size: 13px; }
        .log-description { font-size: 12px; color: var(--text-secondary); margin-top: 2px; line-height: 1.5; }
        .log-meta { font-size: 11px; color: var(--text-muted); margin-top: 3px; font-family: 'Space Mono', monospace; }
        .log-time { font-size: 12px; color: var(--text-muted); white-space: nowrap; }

        .logs-empty {
          padding: 56px 24px; text-align: center; color: var(--text-muted); font-size: 13px;
        }
        .logs-empty-icon {
          width: 40px; height: 40px; margin: 0 auto 12px;
          background: var(--bg-elevated); border-radius: 10px;
          display: flex; align-items: center; justify-content: center;
          color: var(--text-muted);
        }

        .logs-footer {
          display: flex; align-items: center; justify-content: space-between;
          padding: 12px 20px; border-top: 1px solid var(--border);
          background: var(--bg-elevated);
        }
        .logs-count { font-size: 12px; color: var(--text-muted); }
        .pagination { display: flex; align-items: center; gap: 6px; }
        .page-btn {
          width: 30px; height: 30px; border-radius: var(--radius-sm);
          display: flex; align-items: center; justify-content: center;
          border: 1px solid var(--border); background: var(--bg-surface);
          color: var(--text-secondary); cursor: pointer; transition: all 0.15s;
        }
        .page-btn:hover:not(:disabled) { background: var(--bg-hover); color: var(--text-primary); }
        .page-btn:disabled { opacity: 0.4; cursor: not-allowed; }
        .page-info { font-size: 12px; color: var(--text-secondary); padding: 0 4px; }

        .spin-slow { animation: spin 1s linear infinite; }
        @keyframes spin { to { transform: rotate(360deg); } }

        @media (max-width: 768px) {
          .logs-table-wrap { overflow-x: auto; }
          .logs-toolbar { flex-direction: column; align-items: stretch; }
          .logs-search { max-width: 100%; }
          .logs-toolbar-right { margin-left: 0; }
          .filters-panel { gap: 12px; }
          .logs-table th:nth-child(4),
          .logs-table td:nth-child(4) { display: none; }
        }
      `}</style>

      {/* ── Toolbar ── */}
      <div className="logs-toolbar">
        <div className="logs-search">
          <Search size={13} color="var(--text-muted)" />
          <input
            placeholder="Search by actor, target, or action…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {search && (
            <button style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", display: "flex" }} onClick={() => setSearch("")}>
              <X size={12} />
            </button>
          )}
        </div>

        <div className="logs-toolbar-right">
          <button className={`filter-btn ${showFilters ? "active" : ""}`} onClick={() => setShowFilters((s) => !s)}>
            <Filter size={13} />
            Filters
            {activeFilterCount > 0 && <span className="filter-badge">{activeFilterCount}</span>}
          </button>

          <button className="refresh-btn" onClick={handleRefresh} disabled={refreshing}>
            <RefreshCw size={13} className={refreshing ? "spin-slow" : ""} />
          </button>
        </div>
      </div>

      {/* ── Filter Panel ── */}
      {showFilters && (
        <div className="filters-panel">
          <div className="filter-group">
            <label className="filter-label">Action Type</label>
            <select className="filter-select" value={actionFilter} onChange={(e) => setActionFilter(e.target.value as LogAction | "")}>
              <option value="">All actions</option>
              {ALL_ACTIONS.map((a) => (
                <option key={a} value={a}>{ACTION_LABELS[a]}</option>
              ))}
            </select>
          </div>

          <div className="filter-group">
            <label className="filter-label">Date From</label>
            <input className="filter-date" type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
          </div>

          <div className="filter-group">
            <label className="filter-label">Date To</label>
            <input className="filter-date" type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
          </div>

          {activeFilterCount > 0 && (
            <button className="clear-filters-btn" onClick={handleClearFilters}>
              <X size={12} />
              Clear filters
            </button>
          )}
        </div>
      )}

      {/* ── Table ── */}
      <div className="logs-table-wrap">
        <table className="logs-table">
          <thead>
            <tr>
              <th>Date / Time</th>
              <th>Actor</th>
              <th>Action</th>
              <th>Description</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={4} className="logs-empty">
                  <div className="logs-empty-icon">
                    <RefreshCw size={18} className="spin-slow" />
                  </div>
                  Loading activity logs…
                </td>
              </tr>
            ) : filtered.length === 0 ? (
              <tr>
                <td colSpan={4} className="logs-empty">
                  <div className="logs-empty-icon">
                    <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                  </div>
                  No activity logs found.
                  {activeFilterCount > 0 && (
                    <div style={{ marginTop: 8 }}>
                      <button className="clear-filters-btn" onClick={handleClearFilters} style={{ margin: "0 auto" }}>
                        <X size={12} />Clear filters
                      </button>
                    </div>
                  )}
                </td>
              </tr>
            ) : (
              filtered.map((log) => {
                const metaStr = formatMeta(log.meta);
                return (
                  <tr key={log.id}>
                    <td>
                      <div className="log-time">{formatDate(log.createdAt)}</div>
                    </td>
                    <td>
                      <div className="log-actor">{log.actorName}</div>
                      {log.actorId && (
                        <div className="log-meta" style={{ marginTop: 2 }}>{log.actorId.slice(0, 12)}…</div>
                      )}
                    </td>
                    <td>
                      <Badge variant={ACTION_VARIANTS[log.action] ?? "blue"}>
                        {ACTION_LABELS[log.action] ?? log.action}
                      </Badge>
                    </td>
                    <td>
                      <div className="log-description">{getActionDescription(log)}</div>
                      {metaStr && log.action === "updated_permissions" && (
                        <div className="log-meta">{metaStr.slice(0, 120)}{metaStr.length > 120 ? "…" : ""}</div>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>

        {/* ── Pagination Footer ── */}
        {!loading && filtered.length > 0 && (
          <div className="logs-footer">
            <span className="logs-count">
              Page {page} · {filtered.length} entr{filtered.length !== 1 ? "ies" : "y"}
            </span>
            <div className="pagination">
              <button className="page-btn" onClick={handlePrevPage} disabled={page <= 1}>
                <ChevronLeft size={14} />
              </button>
              <span className="page-info">{page}</span>
              <button className="page-btn" onClick={handleNextPage} disabled={!hasMore}>
                <ChevronRight size={14} />
              </button>
            </div>
          </div>
        )}
      </div>
    </AdminLayout>
  );
}