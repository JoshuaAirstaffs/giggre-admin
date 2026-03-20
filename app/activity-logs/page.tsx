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
import {
  ACTION_CONFIG,
  MODULE_CONFIG,
  getActionConfig,
  getModuleConfig,
} from "@/lib/activityLogConfig";

// ─── Types ────────────────────────────────────────────────────────────────────

interface LogEntry {
  id: string;
  actorId: string;
  actorName: string;
  actorEmail?: string;
  module?: string;
  action: LogAction;
  description: string;
  targetSection?: string;
  targetId?: string;
  targetName?: string;
  affectedFiles?: string[];
  meta?: {
    from?: unknown;
    to?: unknown;
    other?: Record<string, unknown>;
    [key: string]: unknown;
  };
  createdAt: Date | null;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const ALL_MODULE_KEYS = Object.keys(MODULE_CONFIG);
const ALL_ACTION_KEYS = Object.keys(ACTION_CONFIG);
const PAGE_SIZE = 20;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(d: Date | null): string {
  if (!d) return "—";
  return d.toLocaleDateString("en-PH", {
    month: "short", day: "numeric", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

/**
 * Renders a compact preview of the meta diff shown below the description.
 * Only shown for specific actions where the diff is meaningful and brief.
 */
function buildMetaPreview(log: LogEntry): string | null {
  const { action, meta } = log;
  if (!meta) return null;

  switch (action) {
    case "updated_permissions": {
      const perms = meta.to as string[] | null;
      return perms?.length
        ? `Modules: ${perms.join(", ")}`
        : "All permissions removed";
    }
    case "toggled_admin_status":
      return null; // already captured in description
    case "changed_role": {
      const from = meta.from as string | null;
      const to   = meta.to   as string | null;
      return from && to ? `${from} → ${to}` : null;
    }
    case "content_settings_updated": {
      const from = meta.from as Record<string, unknown> | null;
      const to   = meta.to   as Record<string, unknown> | null;
      if (!from || !to) return null;
      const changed = Object.keys(to).filter(
        (k) => JSON.stringify(to[k]) !== JSON.stringify(from[k]),
      );
      return changed.length ? `Changed: ${changed.join(", ")}` : null;
    }
    default:
      return null;
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
  const [actionFilter, setActionFilter] = useState("");
  const [moduleFilter, setModuleFilter] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [showFilters, setShowFilters] = useState(false);

  // Pagination
  const [page, setPage] = useState(1);
  const [cursors, setCursors] = useState<QueryDocumentSnapshot<DocumentData>[]>([]);
  const [hasMore, setHasMore] = useState(false);

  const activeFilterCount = [actionFilter, moduleFilter, dateFrom, dateTo].filter(Boolean).length;

  // ── Fetch ─────────────────────────────────────────────────────────────────
  const fetchLogs = useCallback(
    async (
      cursor?: QueryDocumentSnapshot<DocumentData>,
      direction: "next" | "prev" | "reset" = "reset",
    ) => {
      setLoading(true);
      try {
        const constraints: any[] = [orderBy("createdAt", "desc"), limit(PAGE_SIZE + 1)];

        if (actionFilter) constraints.unshift(where("action", "==", actionFilter));
        if (moduleFilter) constraints.unshift(where("module", "==", moduleFilter));
        if (dateFrom) {
          constraints.push(where("createdAt", ">=", Timestamp.fromDate(new Date(dateFrom))));
        }
        if (dateTo) {
          const end = new Date(dateTo);
          end.setDate(end.getDate() + 1);
          constraints.push(where("createdAt", "<", Timestamp.fromDate(end)));
        }
        if (cursor) constraints.push(startAfter(cursor));

        const snap = await getDocs(
          query(collection(db, "activityLogs"), ...constraints),
        );
        const docs = snap.docs;
        const hasNextPage = docs.length > PAGE_SIZE;
        const pageDocs = hasNextPage ? docs.slice(0, PAGE_SIZE) : docs;

        const list: LogEntry[] = pageDocs.map((d) => {
          const data = d.data();
          return {
            id:            d.id,
            actorId:       data.actorId       ?? "",
            actorName:     data.actorName     ?? "Unknown",
            actorEmail:    data.actorEmail    ?? undefined,
            module:        data.module        ?? undefined,
            action:        data.action        ?? "admin_login",
            description:   data.description   ?? "",
            targetSection: data.targetSection ?? undefined,
            targetId:      data.targetId      ?? undefined,
            targetName:    data.targetName    ?? undefined,
            affectedFiles: data.affectedFiles ?? undefined,
            meta:          data.meta          ?? undefined,
            createdAt:     data.createdAt?.toDate?.() ?? null,
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
    [actionFilter, moduleFilter, dateFrom, dateTo],
  );

  useEffect(() => {
    setPage(1);
    setCursors([]);
    fetchLogs(undefined, "reset");
  }, [fetchLogs]);

  // ── Pagination handlers ───────────────────────────────────────────────────
  const handleNextPage = () => {
    if (!hasMore || logs.length === 0) return;
    setPage((p) => p + 1);
    fetchLogs(cursors[cursors.length - 1], "next");
  };

  const handlePrevPage = () => {
    if (page <= 1) return;
    const prevCursor = cursors[cursors.length - 3];
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
    setModuleFilter("");
    setDateFrom("");
    setDateTo("");
    setSearch("");
  };

  // ── Client-side search (across already-fetched page) ──────────────────────
  const filtered = logs.filter((log) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      log.actorName.toLowerCase().includes(q) ||
      (log.actorEmail ?? "").toLowerCase().includes(q) ||
      (log.targetName ?? "").toLowerCase().includes(q) ||
      (log.targetSection ?? "").toLowerCase().includes(q) ||
      log.description.toLowerCase().includes(q) ||
      getActionConfig(log.action).label.toLowerCase().includes(q)
    );
  });

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <AdminLayout title="Activity Logs" subtitle="Audit trail of all admin actions">
      <style>{`
        /* ── Toolbar ── */
        .logs-toolbar { display: flex; align-items: center; gap: 10px; margin-bottom: 16px; flex-wrap: wrap; }
        .logs-search { display: flex; align-items: center; gap: 8px; background: var(--bg-surface); border: 1px solid var(--border); border-radius: var(--radius-sm); padding: 7px 12px; flex: 1; min-width: 200px; max-width: 320px; transition: border-color 0.2s; }
        .logs-search:focus-within { border-color: var(--blue); }
        .logs-search input { background: none; border: none; outline: none; color: var(--text-primary); font-size: 13px; width: 100%; font-family: inherit; }
        .logs-search input::placeholder { color: var(--text-muted); }
        .logs-toolbar-right { display: flex; align-items: center; gap: 8px; margin-left: auto; }
        .filter-btn { display: flex; align-items: center; gap: 6px; background: var(--bg-surface); border: 1px solid var(--border); border-radius: var(--radius-sm); padding: 7px 12px; font-size: 12px; font-weight: 600; color: var(--text-secondary); cursor: pointer; transition: all 0.15s; white-space: nowrap; }
        .filter-btn:hover { background: var(--bg-elevated); color: var(--text-primary); }
        .filter-btn.active { border-color: var(--blue); color: var(--blue); background: var(--blue-dim); }
        .filter-badge { background: var(--blue); color: #fff; font-size: 10px; font-weight: 700; width: 16px; height: 16px; border-radius: 50%; display: flex; align-items: center; justify-content: center; }
        .refresh-btn { display: flex; align-items: center; gap: 6px; background: var(--bg-surface); border: 1px solid var(--border); border-radius: var(--radius-sm); padding: 7px 10px; font-size: 12px; color: var(--text-secondary); cursor: pointer; transition: all 0.15s; }
        .refresh-btn:hover { background: var(--bg-elevated); color: var(--text-primary); }
        .refresh-btn svg { transition: transform 0.3s; }
        .refresh-btn:hover svg { transform: rotate(180deg); }

        /* ── Filter panel ── */
        .filters-panel { background: var(--bg-surface); border: 1px solid var(--border); border-radius: var(--radius-md); padding: 16px 20px; margin-bottom: 16px; display: flex; gap: 16px; flex-wrap: wrap; align-items: flex-end; }
        .filter-group { display: flex; flex-direction: column; gap: 6px; flex: 1; min-width: 160px; }
        .filter-label { font-size: 10px; font-weight: 700; letter-spacing: 0.8px; text-transform: uppercase; color: var(--text-muted); }
        .filter-select, .filter-date { background: var(--bg-elevated); border: 1px solid var(--border); border-radius: var(--radius-sm); padding: 7px 10px; color: var(--text-primary); font-size: 13px; font-family: inherit; outline: none; cursor: pointer; transition: border-color 0.2s; width: 100%; }
        .filter-select:focus, .filter-date:focus { border-color: var(--blue); }
        .filter-date::-webkit-calendar-picker-indicator { filter: invert(0.5); cursor: pointer; }
        .clear-filters-btn { display: flex; align-items: center; gap: 5px; background: var(--red-dim); border: 1px solid rgba(239,68,68,0.2); border-radius: var(--radius-sm); padding: 7px 12px; font-size: 12px; font-weight: 600; color: var(--red); cursor: pointer; transition: all 0.15s; white-space: nowrap; }
        .clear-filters-btn:hover { background: rgba(239,68,68,0.2); }

        /* ── Table ── */
        .logs-table-wrap { background: var(--bg-surface); border: 1px solid var(--border); border-radius: var(--radius-lg); overflow: hidden; }
        .logs-table { width: 100%; border-collapse: collapse; }
        .logs-table thead tr { background: var(--bg-elevated); border-bottom: 1px solid var(--border); }
        .logs-table th { padding: 10px 16px; text-align: left; font-size: 10px; font-weight: 700; letter-spacing: 0.8px; text-transform: uppercase; color: var(--text-muted); white-space: nowrap; }
        .logs-table tbody tr { border-bottom: 1px solid var(--border-muted); transition: background 0.12s; }
        .logs-table tbody tr:last-child { border-bottom: none; }
        .logs-table tbody tr:hover { background: var(--bg-elevated); }
        .logs-table td { padding: 12px 16px; font-size: 13px; color: var(--text-secondary); vertical-align: top; }

        /* ── Row accent stripe (left border keyed to module color) ── */
        .log-row-accent { border-left: 3px solid transparent; }

        /* ── Cell contents ── */
        .log-time { font-size: 12px; color: var(--text-muted); white-space: nowrap; }
        .log-actor-name { font-weight: 600; color: var(--text-primary); font-size: 13px; }
        .log-actor-email { font-size: 11px; color: var(--text-muted); margin-top: 1px; }
        .log-actor-id { font-size: 11px; color: var(--text-muted); margin-top: 1px; font-family: 'Space Mono', monospace; }
        .log-badges { display: flex; flex-direction: column; gap: 4px; }
        .log-description { font-size: 12px; color: var(--text-primary); line-height: 1.55; font-weight: 500; }
        .log-meta-preview { font-size: 11px; color: var(--text-muted); margin-top: 4px; font-family: 'Space Mono', monospace; line-height: 1.5; }
        .log-target-name { font-size: 12px; font-weight: 600; color: var(--text-primary); }
        .log-target-section { font-size: 11px; color: var(--text-muted); margin-top: 2px; }
        .log-target-id { font-size: 11px; color: var(--text-muted); margin-top: 2px; font-family: 'Space Mono', monospace; }

        /* ── Empty / loading ── */
        .logs-empty { padding: 56px 24px; text-align: center; color: var(--text-muted); font-size: 13px; }
        .logs-empty-icon { width: 40px; height: 40px; margin: 0 auto 12px; background: var(--bg-elevated); border-radius: 10px; display: flex; align-items: center; justify-content: center; color: var(--text-muted); }

        /* ── Footer / pagination ── */
        .logs-footer { display: flex; align-items: center; justify-content: space-between; padding: 12px 20px; border-top: 1px solid var(--border); background: var(--bg-elevated); }
        .logs-count { font-size: 12px; color: var(--text-muted); }
        .pagination { display: flex; align-items: center; gap: 6px; }
        .page-btn { width: 30px; height: 30px; border-radius: var(--radius-sm); display: flex; align-items: center; justify-content: center; border: 1px solid var(--border); background: var(--bg-surface); color: var(--text-secondary); cursor: pointer; transition: all 0.15s; }
        .page-btn:hover:not(:disabled) { background: var(--bg-hover); color: var(--text-primary); }
        .page-btn:disabled { opacity: 0.4; cursor: not-allowed; }
        .page-info { font-size: 12px; color: var(--text-secondary); padding: 0 4px; }

        /* ── Spinner ── */
        .spin-slow { animation: al-spin 1s linear infinite; }
        @keyframes al-spin { to { transform: rotate(360deg); } }

        /* ── Responsive ── */
        @media (max-width: 768px) {
          .logs-table-wrap { overflow-x: auto; }
          .logs-toolbar { flex-direction: column; align-items: stretch; }
          .logs-search { max-width: 100%; }
          .logs-toolbar-right { margin-left: 0; }
          .logs-table th:nth-child(5),
          .logs-table td:nth-child(5) { display: none; }
        }
      `}</style>

      {/* ── Toolbar ── */}
      <div className="logs-toolbar">
        <div className="logs-search">
          <Search size={13} color="var(--text-muted)" />
          <input
            placeholder="Search actor, target, description…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {search && (
            <button
              style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", display: "flex" }}
              onClick={() => setSearch("")}
            >
              <X size={12} />
            </button>
          )}
        </div>

        {/* <div className="logs-toolbar-right">
          <button
            className={`filter-btn ${showFilters ? "active" : ""}`}
            onClick={() => setShowFilters((s) => !s)}
          >
            <Filter size={13} />
            Filters
            {activeFilterCount > 0 && (
              <span className="filter-badge">{activeFilterCount}</span>
            )}
          </button>
          <button className="refresh-btn" onClick={handleRefresh} disabled={refreshing}>
            <RefreshCw size={13} className={refreshing ? "spin-slow" : ""} />
          </button>
        </div> */}
      </div>

      {/* ── Filter Panel — data-driven from config, zero hardcoding ── */}
      {showFilters && (
        <div className="filters-panel">
          <div className="filter-group">
            <label className="filter-label">Module</label>
            <select
              className="filter-select"
              value={moduleFilter}
              onChange={(e) => setModuleFilter(e.target.value)}
            >
              <option value="">All modules</option>
              {ALL_MODULE_KEYS.map((key) => (
                <option key={key} value={key}>
                  {MODULE_CONFIG[key].label}
                </option>
              ))}
            </select>
          </div>

          <div className="filter-group">
            <label className="filter-label">Action Type</label>
            <select
              className="filter-select"
              value={actionFilter}
              onChange={(e) => setActionFilter(e.target.value)}
            >
              <option value="">All actions</option>
              {ALL_ACTION_KEYS.map((key) => (
                <option key={key} value={key}>
                  {ACTION_CONFIG[key].label}
                </option>
              ))}
            </select>
          </div>

          <div className="filter-group">
            <label className="filter-label">Date From</label>
            <input
              className="filter-date"
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
            />
          </div>

          <div className="filter-group">
            <label className="filter-label">Date To</label>
            <input
              className="filter-date"
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
            />
          </div>

          {activeFilterCount > 0 && (
            <button className="clear-filters-btn" onClick={handleClearFilters}>
              <X size={12} /> Clear filters
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
              <th>Module / Action</th>
              <th>Description</th>
              <th>Target</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={5} className="logs-empty">
                  <div className="logs-empty-icon">
                    <RefreshCw size={18} className="spin-slow" />
                  </div>
                  Loading activity logs…
                </td>
              </tr>
            ) : filtered.length === 0 ? (
              <tr>
                <td colSpan={5} className="logs-empty">
                  <div className="logs-empty-icon">
                    <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                  </div>
                  No activity logs found.
                  {activeFilterCount > 0 && (
                    <div style={{ marginTop: 8 }}>
                      <button className="clear-filters-btn" onClick={handleClearFilters} style={{ margin: "0 auto" }}>
                        <X size={12} /> Clear filters
                      </button>
                    </div>
                  )}
                </td>
              </tr>
            ) : (
              filtered.map((log) => {
                const moduleCfg = getModuleConfig(log.module);
                const actionCfg = getActionConfig(log.action);
                const metaPreview = buildMetaPreview(log);

                return (
                  <tr
                    key={log.id}
                    className="log-row-accent"
                    style={{ borderLeftColor: moduleCfg.accentColor }}
                  >
                    {/* Date / Time */}
                    <td>
                      <div className="log-time">{formatDate(log.createdAt)}</div>
                    </td>

                    {/* Actor */}
                    <td>
                      <div className="log-actor-name">{log.actorName}</div>
                      {log.actorEmail
                        ? <div className="log-actor-email">{log.actorEmail}</div>
                        : log.actorId
                          ? <div className="log-actor-id">{log.actorId.slice(0, 12)}…</div>
                          : null
                      }
                    </td>

                    {/* Module / Action — both badges share the module color family */}
                    <td>
                      <div className="log-badges">
                        {log.module && (
                          <Badge variant={moduleCfg.variant as any}>
                            {moduleCfg.label}
                          </Badge>
                        )}
                        <Badge variant={actionCfg.variant as any}>
                          {actionCfg.label}
                        </Badge>
                      </div>
                    </td>

                    {/* Description — stored verbatim from buildDescription, displayed as-is */}
                    <td>
                      <div className="log-description">
                        {log.description || "—"}
                      </div>
                      {metaPreview && (
                        <div className="log-meta-preview">{metaPreview}</div>
                      )}
                    </td>

                    {/* Target */}
                    <td>
                      {log.targetName && (
                        <div className="log-target-name">{log.targetName}</div>
                      )}
                      {log.targetSection && (
                        <div className="log-target-section">{log.targetSection}</div>
                      )}
                      {log.targetId && !log.targetSection && (
                        <div className="log-target-id">{log.targetId.slice(0, 14)}…</div>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>

        {/* {!loading && filtered.length > 0 && (
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
        )} */}
      </div>
    </AdminLayout>
  );
}