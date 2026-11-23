"use client";

import { SkeletonRows } from "@/components/ui/Skeleton";
import { useState, useEffect, useMemo, Fragment } from "react";
import { useRouter } from "next/navigation";
import AdminLayout from "@/components/layout/AdminLayout";
import { useAuthGuard } from "@/hooks/useAuthGuard";
import { collection, onSnapshot, query, orderBy, Timestamp } from "firebase/firestore";
import { db } from "@/lib/firebase";
import {
  Search, Flag, ChevronLeft, ChevronRight, ChevronDown, ChevronUp,
  AlertTriangle, UserX, ExternalLink,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Report {
  id: string;
  createdAt: Timestamp | null;
  details: string;
  reason: string;
  reportedUserId: string;
  reportedUserName: string;
  reporterId: string;
  roomId: string;
}

interface UserLite {
  uid: string;
  name: string;
  email: string;
}

interface BlockedEntry {
  uid: string;
  name: string;
  email: string;
  blockers: UserLite[];
}

// ─── Constants ────────────────────────────────────────────────────────────────

const PAGE_SIZE = 15;
const BU_PAGE_SIZE = 10;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function toReport(id: string, data: Record<string, unknown>): Report {
  return {
    id,
    createdAt: data.createdAt instanceof Timestamp ? data.createdAt : null,
    details: (data.details as string) ?? "",
    reason: (data.reason as string) ?? "",
    reportedUserId: (data.reportedUserId as string) ?? "",
    reportedUserName: (data.reportedUserName as string) ?? "",
    reporterId: (data.reporterId as string) ?? "",
    roomId: (data.roomId as string) ?? "",
  };
}

function fmtDate(ts: Timestamp | null): string {
  if (!ts) return "—";
  return ts.toDate().toLocaleString("en-US", {
    month: "short", day: "numeric", year: "numeric",
    hour: "numeric", minute: "2-digit",
  });
}

// ─── Page ─────────────────────────────────────────────────────────────────────

function ReportsPageInner() {
  const { user } = useAuthGuard({ module: "user-reports" });
  const router = useRouter();

  const [reports, setReports] = useState<Report[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);

  const [pageTab, setPageTab] = useState<"reports" | "blocked">("reports");

  // ── Blocked users state ─────────────────────────────────────────────────
  const [usersMap, setUsersMap] = useState<Record<string, UserLite>>({});
  const [blockedByMap, setBlockedByMap] = useState<Record<string, string[]>>({});
  const [blockedLoading, setBlockedLoading] = useState(true);
  const [blockedError, setBlockedError] = useState<string | null>(null);
  const [buSearch, setBuSearch] = useState("");
  const [buPage, setBuPage] = useState(1);
  const [buExpandedId, setBuExpandedId] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    const q = query(collection(db, "reports"), orderBy("createdAt", "desc"));
    const unsub = onSnapshot(
      q,
      (snap) => {
        setReports(snap.docs.map((d) => toReport(d.id, d.data())));
        setLoading(false);
      },
      (err) => {
        console.error("[ReportsPage] fetch error:", err);
        setError("Failed to load reports.");
        setLoading(false);
      }
    );
    return () => unsub();
  }, []);

  useEffect(() => {
    setBlockedLoading(true);
    setBlockedError(null);
    const unsub = onSnapshot(
      collection(db, "users"),
      (snap) => {
        const map: Record<string, UserLite> = {};
        const byMap: Record<string, string[]> = {};
        snap.docs.forEach((d) => {
          const data = d.data() as Record<string, unknown>;
          map[d.id] = {
            uid: d.id,
            name: typeof data.name === "string" ? data.name : d.id,
            email: typeof data.email === "string" ? data.email : "",
          };
          const blocked = Array.isArray(data.blockedUsers) ? (data.blockedUsers as string[]) : [];
          blocked.forEach((blockedUid) => {
            if (!byMap[blockedUid]) byMap[blockedUid] = [];
            byMap[blockedUid].push(d.id);
          });
        });
        setUsersMap(map);
        setBlockedByMap(byMap);
        setBlockedLoading(false);
      },
      (err) => {
        console.error("[ReportsPage] blocked users fetch error:", err);
        setBlockedError("Failed to load blocked users.");
        setBlockedLoading(false);
      }
    );
    return () => unsub();
  }, []);

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    return reports.filter((r) => {
      return !q
        || r.reportedUserName.toLowerCase().includes(q)
        || r.reportedUserId.toLowerCase().includes(q)
        || r.reporterId.toLowerCase().includes(q)
        || r.reason.toLowerCase().includes(q);
    });
  }, [reports, search]);

  useEffect(() => { setPage(1); }, [search]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const paginated = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  const pageNums = Array.from({ length: totalPages }, (_, i) => i + 1)
    .filter((p) => p === 1 || p === totalPages || Math.abs(p - safePage) <= 1)
    .reduce<(number | "…")[]>((acc, p, i, arr) => {
      if (i > 0 && (p as number) - (arr[i - 1] as number) > 1) acc.push("…");
      acc.push(p);
      return acc;
    }, []);

  // ── Blocked users derived data ──────────────────────────────────────────
  const blockedList: BlockedEntry[] = useMemo(() => {
    return Object.entries(blockedByMap).map(([uid, blockerIds]) => ({
      uid,
      name: usersMap[uid]?.name ?? uid,
      email: usersMap[uid]?.email ?? "",
      blockers: blockerIds.map((bid) => usersMap[bid] ?? { uid: bid, name: bid, email: "" }),
    })).sort((a, b) => b.blockers.length - a.blockers.length);
  }, [blockedByMap, usersMap]);

  const filteredBlocked = useMemo(() => {
    const q = buSearch.toLowerCase().trim();
    return blockedList.filter((b) => {
      return !q
        || b.name.toLowerCase().includes(q)
        || b.email.toLowerCase().includes(q)
        || b.uid.toLowerCase().includes(q)
        || b.blockers.some((k) => k.name.toLowerCase().includes(q) || k.email.toLowerCase().includes(q));
    });
  }, [blockedList, buSearch]);

  useEffect(() => { setBuPage(1); }, [buSearch]);

  const buTotalPages = Math.max(1, Math.ceil(filteredBlocked.length / BU_PAGE_SIZE));
  const buSafePage = Math.min(buPage, buTotalPages);
  const buPaginated = filteredBlocked.slice((buSafePage - 1) * BU_PAGE_SIZE, buSafePage * BU_PAGE_SIZE);

  if (!user) return null;

  return (
    <AdminLayout
      title="User Reports"
      subtitle={`${reports.length} report${reports.length === 1 ? "" : "s"} · ${blockedList.length} blocked user${blockedList.length === 1 ? "" : "s"}`}
    >
      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }

        .rp-toolbar {
          display: flex; align-items: center; gap: 10px;
          margin-bottom: 16px; flex-wrap: wrap;
        }
        .rp-search {
          display: flex; align-items: center; gap: 8px;
          background: var(--bg-surface); border: 1px solid var(--border);
          border-radius: var(--radius-sm); padding: 8px 12px;
          flex: 1; min-width: 200px;
        }
        .rp-search input {
          background: none; border: none; outline: none;
          font-size: 13px; color: var(--text-primary); width: 100%;
        }
        .rp-search input::placeholder { color: var(--text-muted); }

        .rp-section-title {
          display: flex; align-items: center; gap: 8px;
          font-size: 15px; font-weight: 700; color: var(--text-primary);
          margin: 0 0 12px;
        }
        .rp-section + .rp-section { margin-top: 32px; }

        .rp-page-tabs {
          display: flex; gap: 4px;
          background: var(--bg-elevated); border-radius: var(--radius-sm); padding: 3px;
          margin-bottom: 20px; width: fit-content;
        }
        .rp-page-tab {
          padding: 8px 18px; border-radius: 6px;
          font-size: 13px; font-weight: 600; cursor: pointer;
          transition: all 0.15s; color: var(--text-muted);
          border: none; background: none;
          display: flex; align-items: center; gap: 7px;
        }
        .rp-page-tab.active {
          background: var(--bg-surface); color: var(--text-primary);
          box-shadow: 0 1px 3px rgba(0,0,0,0.15);
        }
        .rp-page-tab-count {
          background: var(--bg-base); color: var(--text-muted);
          font-size: 11px; font-weight: 700; border-radius: 999px;
          padding: 1px 7px; line-height: 1.5;
        }
        .rp-page-tab.active .rp-page-tab-count { color: var(--text-secondary); }

        .rp-table-wrap {
          background: var(--bg-surface); border: 1px solid var(--border);
          border-radius: var(--radius); overflow: hidden;
        }
        .rp-table { width: 100%; border-collapse: collapse; }
        .rp-table th {
          font-size: 11px; font-weight: 700; text-transform: uppercase;
          letter-spacing: 0.8px; color: var(--text-muted);
          padding: 10px 16px; text-align: left;
          border-bottom: 1px solid var(--border);
          background: var(--bg-elevated);
        }
        .rp-table td {
          padding: 12px 16px; font-size: 13px; color: var(--text-primary);
          border-bottom: 1px solid var(--border); vertical-align: top;
        }
        .rp-table tr:last-child td { border-bottom: none; }
        .rp-name { font-weight: 600; }
        .rp-sub { font-size: 11px; color: var(--text-muted); margin-top: 2px; font-family: monospace; }
        .rp-details { max-width: 280px; color: var(--text-secondary); }
        .rp-empty { text-align: center; padding: 48px 24px; color: var(--text-muted); font-size: 14px; }
        .rp-empty svg { opacity: 0.3; margin-bottom: 8px; }

        .rp-pagination {
          display: flex; align-items: center; justify-content: space-between;
          padding: 10px 16px; border-top: 1px solid var(--border);
          background: var(--bg-elevated);
        }
        .rp-pagination-info { font-size: 12px; color: var(--text-muted); }
        .rp-pagination-btns { display: flex; align-items: center; gap: 4px; }
        .rp-page-btn {
          display: flex; align-items: center; justify-content: center;
          min-width: 28px; height: 28px; padding: 0 6px;
          border-radius: 6px; border: 1px solid var(--border);
          background: var(--bg-surface); color: var(--text-primary);
          cursor: pointer; font-size: 12px; transition: all 0.15s;
        }
        .rp-page-btn:hover:not(:disabled) { background: var(--bg-hover); border-color: var(--border-strong); }
        .rp-page-btn:disabled { opacity: 0.4; cursor: not-allowed; }
        .rp-page-btn.active { background: var(--blue); border-color: var(--blue); color: white; font-weight: 700; }

        .rp-row-clickable { cursor: pointer; transition: background 0.1s; }
        .rp-row-clickable:hover { background: var(--bg-elevated); }
        .rp-expand-btn {
          display: flex; align-items: center; justify-content: center;
          width: 26px; height: 26px; border-radius: 6px; border: 1px solid var(--border);
          background: var(--bg-elevated); color: var(--text-secondary); cursor: pointer;
        }
        .rp-expand-btn:hover { border-color: var(--border-strong); color: var(--text-primary); }
        .rp-blocker-chip {
          display: inline-flex; align-items: center; gap: 5px;
          background: var(--bg-elevated); border: 1px solid var(--border);
          border-radius: 999px; padding: 3px 10px; font-size: 12px;
          color: var(--text-primary); cursor: pointer;
        }
        .rp-blocker-chip:hover { border-color: var(--border-strong); }
        .rp-blocker-list-item {
          display: flex; align-items: center; justify-content: space-between; gap: 10px;
          background: var(--bg-surface); border: 1px solid var(--border);
          border-radius: var(--radius-sm); padding: 8px 12px; cursor: pointer;
        }
        .rp-blocker-list-item:hover { border-color: var(--border-strong); }
      `}</style>

      <div className="rp-page-tabs">
        <button
          className={`rp-page-tab${pageTab === "reports" ? " active" : ""}`}
          onClick={() => setPageTab("reports")}
        >
          <Flag size={14} />
          Reports
          <span className="rp-page-tab-count">{reports.length}</span>
        </button>
        <button
          className={`rp-page-tab${pageTab === "blocked" ? " active" : ""}`}
          onClick={() => setPageTab("blocked")}
        >
          <UserX size={14} />
          Blocked Users
          <span className="rp-page-tab-count">{blockedList.length}</span>
        </button>
      </div>

      {pageTab === "blocked" && (
      <div className="rp-section">
        <div className="rp-toolbar">
          <div className="rp-search">
            <Search size={14} style={{ color: "var(--text-muted)", flexShrink: 0 }} />
            <input
              placeholder="Search by blocked user or blocker…"
              value={buSearch}
              onChange={(e) => setBuSearch(e.target.value)}
            />
            {buSearch && (
              <button
                onClick={() => setBuSearch("")}
                style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", display: "flex" }}
              >×</button>
            )}
          </div>
        </div>

        <div className="rp-table-wrap">
          {blockedLoading ? (
            <SkeletonRows />
          ) : blockedError ? (
            <div className="rp-empty">
              <AlertTriangle size={36} style={{ display: "block", margin: "0 auto 8px", color: "var(--red)" }} />
              {blockedError}
            </div>
          ) : filteredBlocked.length === 0 ? (
            <div className="rp-empty">
              <UserX size={36} style={{ display: "block", margin: "0 auto 8px" }} />
              No blocked users found
            </div>
          ) : (
            <>
              <table className="rp-table">
                <thead>
                  <tr>
                    <th>Blocked User</th>
                    <th>Blocked By</th>
                    <th style={{ width: 40 }} />
                  </tr>
                </thead>
                <tbody>
                  {buPaginated.map((b) => {
                    const isExpanded = buExpandedId === b.uid;
                    const preview = b.blockers.slice(0, 3);
                    const extra = b.blockers.length - preview.length;
                    return (
                      <Fragment key={b.uid}>
                        <tr className="rp-row-clickable" onClick={() => setBuExpandedId(isExpanded ? null : b.uid)}>
                          <td>
                            <div className="rp-name" style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                              {b.name}
                              <ExternalLink
                                size={11}
                                style={{ opacity: 0.4 }}
                                onClick={(e) => { e.stopPropagation(); router.push(`/users/${b.uid}`); }}
                              />
                            </div>
                            <div className="rp-sub">{b.uid}</div>
                          </td>
                          <td>
                            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
                              {preview.map((k) => (
                                <span
                                  key={k.uid}
                                  className="rp-blocker-chip"
                                  onClick={(e) => { e.stopPropagation(); router.push(`/users/${k.uid}`); }}
                                >
                                  {k.name}
                                </span>
                              ))}
                              {extra > 0 && (
                                <span style={{ fontSize: 12, color: "var(--text-muted)" }}>+{extra} more</span>
                              )}
                            </div>
                          </td>
                          <td onClick={(e) => e.stopPropagation()}>
                            <button
                              className="rp-expand-btn"
                              onClick={() => setBuExpandedId(isExpanded ? null : b.uid)}
                              title={isExpanded ? "Hide blockers" : "Show all blockers"}
                            >
                              {isExpanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                            </button>
                          </td>
                        </tr>
                        {isExpanded && (
                          <tr>
                            <td colSpan={3} style={{ padding: 0, background: "var(--bg-elevated)" }}>
                              <div style={{ padding: "14px 20px" }}>
                                <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.5px", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: 10 }}>
                                  Blocked by {b.blockers.length} user{b.blockers.length === 1 ? "" : "s"}
                                </div>
                                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                                  {b.blockers.map((k) => (
                                    <div
                                      key={k.uid}
                                      className="rp-blocker-list-item"
                                      onClick={() => router.push(`/users/${k.uid}`)}
                                    >
                                      <div>
                                        <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)" }}>{k.name}</div>
                                        <div className="rp-sub">{k.email || k.uid}</div>
                                      </div>
                                      <ExternalLink size={13} style={{ opacity: 0.5, flexShrink: 0 }} />
                                    </div>
                                  ))}
                                </div>
                              </div>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>

              <div className="rp-pagination">
                <span className="rp-pagination-info">
                  {(buSafePage - 1) * BU_PAGE_SIZE + 1}–{Math.min(buSafePage * BU_PAGE_SIZE, filteredBlocked.length)} of {filteredBlocked.length}
                </span>
                <div className="rp-pagination-btns">
                  <button className="rp-page-btn" onClick={() => setBuPage((p) => Math.max(1, p - 1))} disabled={buSafePage === 1}>
                    <ChevronLeft size={13} />
                  </button>
                  <button className="rp-page-btn" onClick={() => setBuPage((p) => Math.min(buTotalPages, p + 1))} disabled={buSafePage === buTotalPages}>
                    <ChevronRight size={13} />
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
      )}

      {pageTab === "reports" && (
      <div className="rp-section">
        <div className="rp-toolbar">
          <div className="rp-search">
            <Search size={14} style={{ color: "var(--text-muted)", flexShrink: 0 }} />
            <input
              placeholder="Search by reported user, reporter, or reason…"
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
        </div>

        <div className="rp-table-wrap">
          {loading ? (
            <SkeletonRows />
          ) : error ? (
            <div className="rp-empty">
              <AlertTriangle size={36} style={{ display: "block", margin: "0 auto 8px", color: "var(--red)" }} />
              {error}
            </div>
          ) : filtered.length === 0 ? (
            <div className="rp-empty">
              <Flag size={36} style={{ display: "block", margin: "0 auto 8px" }} />
              No reports found
            </div>
          ) : (
            <>
              <table className="rp-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Reporter</th>
                    <th>Reported User</th>
                    <th>Reason</th>
                    <th>Details</th>
                  </tr>
                </thead>
                <tbody>
                  {paginated.map((r) => (
                    <tr key={r.id}>
                      <td style={{ whiteSpace: "nowrap", color: "var(--text-muted)", fontSize: 12 }}>
                        {fmtDate(r.createdAt)}
                      </td>
                      <td>
                        <div className="rp-sub">{r.reporterId}</div>
                      </td>
                      <td>
                        <div className="rp-name">{r.reportedUserName || "—"}</div>
                        <div className="rp-sub">{r.reportedUserId}</div>
                      </td>
                      <td>{r.reason || "—"}</td>
                      <td className="rp-details">{r.details || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <div className="rp-pagination">
                <span className="rp-pagination-info">
                  {(safePage - 1) * PAGE_SIZE + 1}–{Math.min(safePage * PAGE_SIZE, filtered.length)} of {filtered.length}
                </span>
                <div className="rp-pagination-btns">
                  <button className="rp-page-btn" onClick={() => setPage(1)} disabled={safePage === 1}>«</button>
                  <button className="rp-page-btn" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={safePage === 1}>
                    <ChevronLeft size={13} />
                  </button>
                  {pageNums.map((p, i) =>
                    p === "…" ? (
                      <span key={`e-${i}`} style={{ fontSize: 12, color: "var(--text-muted)", padding: "0 2px" }}>…</span>
                    ) : (
                      <button
                        key={p}
                        className={`rp-page-btn${safePage === p ? " active" : ""}`}
                        onClick={() => setPage(p as number)}
                      >{p}</button>
                    )
                  )}
                  <button className="rp-page-btn" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={safePage === totalPages}>
                    <ChevronRight size={13} />
                  </button>
                  <button className="rp-page-btn" onClick={() => setPage(totalPages)} disabled={safePage === totalPages}>»</button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
      )}
    </AdminLayout>
  );
}

export default function ReportsPage() {
  return <ReportsPageInner />;
}
