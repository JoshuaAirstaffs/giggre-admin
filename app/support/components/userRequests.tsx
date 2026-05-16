'use client'

import React, { useEffect, useState, useMemo, useRef } from "react"
import {
  collection, getDocs, onSnapshot, orderBy, query, doc, updateDoc,
  serverTimestamp, Timestamp, where, limit,
} from "firebase/firestore"
import { db } from "@/lib/firebase"
import "./userRequestsStyle.css"
import Modal from "@/components/ui/Modal"
import { Eye, Check, X, RefreshCw, Search, User, ChevronUp, ChevronDown, RotateCcw, Calendar, FileText, CheckCircle2, XCircle, MessageSquare, Send } from "lucide-react"
import { toast } from "@/components/ui/Toaster"
import { writeLog, buildDescription } from "@/lib/activitylog"
import { useAuth } from "@/context/AuthContext"

// ── Types ────────────────────────────────────────────────────────────────────

type RequestStatus = "pending" | "approved" | "rejected"

interface SkillRequest {
  id: string
  skillId: string
  skillName: string
  skillCategory: string
  skill_req_Id: string
  status: RequestStatus
  userId: string
  gigWorkerId: string
  userName: string
  userEmail: string
  reason: string
  relatedExperience: string
  experienceLevel: string
  experienceDuration: string
  contactAvailability: string
  proofNames: string[]
  proofPaths: string[]
  proofUrls: string[]
  adminRemarks: string
  suggestedRequirement: string
  createdAt: Timestamp
  updatedAt: Timestamp
}

interface FoundUser {
  id: string
  name: string
  email: string
}

interface TimelineEntry {
  action: "submitted" | "user_request_approved" | "user_request_rejected" | "user_request_reopened" | "user_request_note"
  actorName: string
  date: Date | null
  description?: string
}

const TIMELINE_CONFIG: Record<TimelineEntry["action"], { label: string; color: string; glow: string; icon: React.ElementType }> = {
  submitted:              { label: "Submitted",    color: "var(--blue)",           glow: "rgba(59,130,246,0.18)",  icon: FileText },
  user_request_approved:  { label: "Approved",     color: "var(--green)",          glow: "rgba(34,197,94,0.18)",   icon: CheckCircle2 },
  user_request_rejected:  { label: "Rejected",     color: "var(--red)",            glow: "rgba(239,68,68,0.18)",   icon: XCircle },
  user_request_reopened:  { label: "Reopened",     color: "var(--amber)",          glow: "rgba(245,158,11,0.18)",  icon: RotateCcw },
  user_request_note:      { label: "Note",         color: "var(--text-secondary)", glow: "rgba(100,116,139,0.18)", icon: MessageSquare },
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const formatDate = (ts: Timestamp) =>
  ts?.toDate?.().toLocaleString("en-US", {
    year: "numeric", month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit",
  }) ?? "—"

const initials = (name: string) =>
  name.split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase()

const daysSince = (ts: Timestamp): number => {
  const ms = ts?.toMillis?.()
  if (!ms) return 0
  return Math.floor((Date.now() - ms) / 86_400_000)
}

// ── Component ────────────────────────────────────────────────────────────────

const UserRequests = () => {
  const [requests, setRequests]   = useState<SkillRequest[]>([])
  const [loading, setLoading]     = useState(true)
  const [error, setError]         = useState<string | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)

  // filters
  const [search, setSearch]             = useState("")
  const [filterStatus, setFilterStatus] = useState<RequestStatus | "">("")
  const [filterCategory, setFilterCategory] = useState("")
  const [dateFrom, setDateFrom]         = useState("")
  const [dateTo, setDateTo]             = useState("")
  const [filterUserId, setFilterUserId] = useState<string | null>(null)
  const [filterUserName, setFilterUserName] = useState<string>("")

  // view modal
  const [viewItem, setViewItem]               = useState<SkillRequest | null>(null)
  const [timeline, setTimeline]               = useState<TimelineEntry[]>([])
  const [timelineLoading, setTimelineLoading] = useState(false)
  const [timelineKey, setTimelineKey]         = useState(0)
  const [noteText, setNoteText]               = useState("")
  const [addingNote, setAddingNote]           = useState(false)

  // reject modal
  const [rejectTarget, setRejectTarget]       = useState<SkillRequest | null>(null)
  const [rejectionReason, setRejectionReason] = useState("")
  const [rejecting, setRejecting]             = useState(false)

  // single loading tracker for approve / reopen
  const [mutatingId, setMutatingId] = useState<string | null>(null)

  // sort & pagination
  const [sortDir, setSortDir]   = useState<"desc" | "asc">("desc")
  const [page, setPage]         = useState(1)
  const PAGE_SIZE               = 20

  // auth
  const { user } = useAuth()

  // ── Init ─────────────────────────────────────────────────────────────────

  // Real-time listener — re-subscribes when refreshKey bumps
  useEffect(() => {
    setLoading(true)
    setError(null)
    const q = query(collection(db, "skill_requests"), orderBy("createdAt", "desc"))
    const unsub = onSnapshot(
      q,
      snap => {
        setRequests(snap.docs.map(d => ({ id: d.id, ...d.data() })) as SkillRequest[])
        setLoading(false)
      },
      err => {
        console.error("Failed to listen to skill requests:", err)
        setError("Failed to load skill requests.")
        setLoading(false)
      },
    )
    return unsub
  }, [refreshKey])

  // ── Timeline fetch (fires when view modal opens) ─────────────────────────

  useEffect(() => {
    if (!viewItem) { setTimeline([]); return }

    setTimelineLoading(true)
    getDocs(
      query(
        collection(db, "activityLogs"),
        where("targetId", "==", viewItem.id),
      )
    ).then(snap => {
      const logEntries: TimelineEntry[] = snap.docs
        .map(d => {
          const data = d.data()
          return {
            action:      data.action,
            actorName:   data.actorName ?? "Unknown",
            date:        data.createdAt?.toDate?.() ?? null,
            description: data.description ?? undefined,
          }
        })
        .filter(e => e.action in TIMELINE_CONFIG && e.action !== "submitted")
        .sort((a, b) => (a.date?.getTime() ?? 0) - (b.date?.getTime() ?? 0))

      const submitted: TimelineEntry = {
        action:    "submitted",
        actorName: viewItem.userName || "User",
        date:      viewItem.createdAt?.toDate?.() ?? null,
      }

      setTimeline([submitted, ...logEntries])
    }).catch((err: unknown) => {
      console.error("Failed to fetch timeline:", err)
      setTimeline([])
    }).finally(() => setTimelineLoading(false))
  }, [viewItem?.id, timelineKey])

  // ── Filtered list ────────────────────────────────────────────────────────

  const filteredRequests = useMemo(() => {
    const q = search.toLowerCase().trim()
    const fromMs = dateFrom ? new Date(dateFrom).setHours(0, 0, 0, 0)    : null
    const toMs   = dateTo   ? new Date(dateTo).setHours(23, 59, 59, 999) : null
    const filtered = requests.filter(r => {
      const matchesSearch = !q
        || r.skill_req_Id?.toLowerCase().includes(q)
        || r.skillId?.toLowerCase().includes(q)
        || r.userName?.toLowerCase().includes(q)
        || r.userEmail?.toLowerCase().includes(q)
        || r.skillName?.toLowerCase().includes(q)
        || r.skillCategory?.toLowerCase().includes(q)
      const matchesStatus   = !filterStatus   || r.status === filterStatus
      const matchesCategory = !filterCategory || r.skillCategory?.toLowerCase() === filterCategory.toLowerCase()
      const matchesUser     = !filterUserId   || r.userId === filterUserId
      const rMs = r.createdAt?.toMillis?.() ?? 0
      const matchesFrom = fromMs === null || rMs >= fromMs
      const matchesTo   = toMs   === null || rMs <= toMs
      return matchesSearch && matchesStatus && matchesCategory && matchesUser && matchesFrom && matchesTo
    })
    filtered.sort((a, b) => {
      const aMs = a.createdAt?.toMillis?.() ?? 0
      const bMs = b.createdAt?.toMillis?.() ?? 0
      return sortDir === "desc" ? bMs - aMs : aMs - bMs
    })
    return filtered
  }, [requests, search, filterStatus, filterCategory, sortDir, dateFrom, dateTo, filterUserId])

  const hasActiveFilters = search || filterStatus || filterCategory || dateFrom || dateTo || filterUserId

  const clearFilters = () => {
    setSearch("")
    setFilterStatus("")
    setFilterCategory("")
    setDateFrom("")
    setDateTo("")
    setFilterUserId(null)
    setFilterUserName("")
  }

  const focusUser = (userId: string, userName: string) => {
    setFilterUserId(userId)
    setFilterUserName(userName)
  }

  // reset to page 1 whenever filters/sort change
  useEffect(() => { setPage(1) }, [search, filterStatus, filterCategory, sortDir, dateFrom, dateTo, filterUserId])

  const totalPages        = Math.max(1, Math.ceil(filteredRequests.length / PAGE_SIZE))
  const paginatedRequests = filteredRequests.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  // ── Counts ───────────────────────────────────────────────────────────────

  const counts = useMemo(() =>
    requests.reduce(
      (acc, r) => { acc.total++; acc[r.status ?? "pending"]++; return acc },
      { total: 0, pending: 0, approved: 0, rejected: 0 } as Record<string, number>,
    )
  , [requests])

  // distinct skill categories derived from data
  const skillCategories = useMemo(() => {
    const cats = new Set<string>()
    requests.forEach(r => { if (r.skillCategory) cats.add(r.skillCategory) })
    return Array.from(cats).sort()
  }, [requests])

  // request count per user
  const userRequestCount = useMemo(() => {
    const map = new Map<string, number>()
    requests.forEach(r => map.set(r.userId, (map.get(r.userId) ?? 0) + 1))
    return map
  }, [requests])

  // duplicate detection: userId + skillName combos that appear more than once
  const duplicateKeys = useMemo(() => {
    const seen = new Map<string, number>()
    requests.forEach(r => {
      const key = `${r.userId}::${r.skillName?.toLowerCase()}::${r.skillCategory}`
      seen.set(key, (seen.get(key) ?? 0) + 1)
    })
    const dupes = new Set<string>()
    seen.forEach((count, key) => { if (count > 1) dupes.add(key) })
    return dupes
  }, [requests])

  // ── Approve ──────────────────────────────────────────────────────────────

  const handleApprove = async (request: SkillRequest) => {
    try {
      setMutatingId(request.id)
      await updateDoc(doc(db, "skill_requests", request.id), {
        status: "approved",
        adminRemarks: "",
        updatedAt: serverTimestamp(),
      })
      toast.success("Request approved")
      writeLog({
        actorId:    user?.uid ?? "",
        actorName:  user?.displayName ?? "Unknown",
        actorEmail: user?.email ?? "",
        module:     "user_requests",
        action:     "user_request_approved",
        description: buildDescription.userRequestApproved(request.skill_req_Id, request.skillName, request.userName),
        targetId:   request.id,
        targetName: request.skill_req_Id,
        meta: { other: { skillName: request.skillName, userId: request.userId } },
      })
    } catch (err) {
      console.error("Approve failed:", err)
      toast.error("Failed to approve request")
    } finally {
      setMutatingId(null)
    }
  }

  // ── Reject ───────────────────────────────────────────────────────────────

  const openRejectModal = (request: SkillRequest) => {
    setRejectTarget(request)
    setRejectionReason(request.adminRemarks ?? "")
  }

  const handleReject = async () => {
    if (!rejectTarget || !rejectionReason.trim()) return
    try {
      setRejecting(true)
      const reason = rejectionReason.trim()
      await updateDoc(doc(db, "skill_requests", rejectTarget.id), {
        status: "rejected",
        adminRemarks: reason,
        updatedAt: serverTimestamp(),
      })
      toast.success("Request rejected")
      writeLog({
        actorId:    user?.uid ?? "",
        actorName:  user?.displayName ?? "Unknown",
        actorEmail: user?.email ?? "",
        module:     "user_requests",
        action:     "user_request_rejected",
        description: buildDescription.userRequestRejected(rejectTarget.skill_req_Id, rejectTarget.skillName, rejectTarget.userName, reason),
        targetId:   rejectTarget.id,
        targetName: rejectTarget.skill_req_Id,
        meta: { other: { skillName: rejectTarget.skillName, userId: rejectTarget.userId, reason } },
      })
      setRejectTarget(null)
      setRejectionReason("")
    } catch (err) {
      console.error("Reject failed:", err)
      toast.error("Failed to reject request")
    } finally {
      setRejecting(false)
    }
  }

  // ── Reopen ───────────────────────────────────────────────────────────────

  const handleReopen = async (request: SkillRequest) => {
    try {
      setMutatingId(request.id)
      await updateDoc(doc(db, "skill_requests", request.id), {
        status: "pending",
        adminRemarks: "",
        updatedAt: serverTimestamp(),
      })
      toast.success("Request reopened")
      writeLog({
        actorId:    user?.uid ?? "",
        actorName:  user?.displayName ?? "Unknown",
        actorEmail: user?.email ?? "",
        module:     "user_requests",
        action:     "user_request_reopened",
        description: buildDescription.userRequestReopened(request.skill_req_Id, request.skillName, request.userName),
        targetId:   request.id,
        targetName: request.skill_req_Id,
        meta: { other: { skillName: request.skillName, userId: request.userId } },
      })
    } catch (err) {
      console.error("Reopen failed:", err)
      toast.error("Failed to reopen request")
    } finally {
      setMutatingId(null)
    }
  }

  // ── Progress note ────────────────────────────────────────────────────────

  const handleAddNote = async () => {
    if (!viewItem || !noteText.trim()) return
    try {
      setAddingNote(true)
      const note = noteText.trim()
      await writeLog({
        actorId:     user?.uid ?? "",
        actorName:   user?.displayName ?? "Unknown",
        actorEmail:  user?.email ?? "",
        module:      "user_requests",
        action:      "user_request_note",
        description: note,
        targetId:    viewItem.id,
        targetName:  viewItem.skill_req_Id,
        meta: { other: { skillName: viewItem.skillName, userId: viewItem.userId } },
      })
      setNoteText("")
      setTimelineKey(k => k + 1)
    } catch (err) {
      console.error("Add note failed:", err)
      toast.error("Failed to save note")
    } finally {
      setAddingNote(false)
    }
  }

  // ── Status badge helper ───────────────────────────────────────────────────

  const statusBadge = (status: RequestStatus | undefined) => {
    const s = status ?? "pending"
    const cls: Record<RequestStatus, string> = {
      pending:  "ur-badge ur-badge--pending",
      approved: "ur-badge ur-badge--approved",
      rejected: "ur-badge ur-badge--rejected",
    }
    return <span className={cls[s]}>{s}</span>
  }

  // ── Render ───────────────────────────────────────────────────────────────

  if (loading) return <p style={{ color: "var(--text-secondary)" }}>Loading requests...</p>
  if (error)   return <p style={{ color: "var(--red)" }}>{error}</p>

  return (
    <div>

      {/* Stat cards */}
      <div className="ur-stats">
        {(["total", "pending", "approved", "rejected"] as const).map(k => (
          <div key={k} className={`ur-stat-card ur-stat-card--${k}`}>
            <span className="ur-stat-label">{k.charAt(0).toUpperCase() + k.slice(1)}</span>
            <span className="ur-stat-value">{counts[k] ?? 0}</span>
          </div>
        ))}
      </div>

      {/* Toolbar */}
      <div className="ur-toolbar">
        <div className="ur-search-wrap">
          <Search size={14} className="ur-search-icon" />
          <input
            className="ur-search-input"
            placeholder="Search by ID, name, email, or skill..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          {search && (
            <button className="ur-search-clear" onClick={() => setSearch("")}>
              <X size={12} />
            </button>
          )}
        </div>

        {filterUserId && (
          <div className="ur-user-chip">
            <User size={11} />
            <span>{filterUserName || filterUserId}</span>
            <button
              className="ur-user-chip-x"
              onClick={() => { setFilterUserId(null); setFilterUserName(""); setPage(1) }}
              title="Clear user filter"
            >
              <X size={11} />
            </button>
          </div>
        )}

        <select
          className="ur-filter-select"
          value={filterStatus}
          onChange={e => setFilterStatus(e.target.value as RequestStatus | "")}
        >
          <option value="">All Statuses</option>
          <option value="pending">Pending</option>
          <option value="approved">Approved</option>
          <option value="rejected">Rejected</option>
        </select>

        <select
          className="ur-filter-select"
          value={filterCategory}
          onChange={e => setFilterCategory(e.target.value)}
        >
          <option value="">All Categories</option>
          {skillCategories.map(cat => (
            <option key={cat} value={cat}>{cat}</option>
          ))}
        </select>

        <div className="ur-date-range">
          <Calendar size={13} className="ur-date-icon" />
          <input
            type="date"
            className="ur-date-input"
            value={dateFrom}
            onChange={e => setDateFrom(e.target.value)}
            title="From date"
          />
          <span className="ur-date-sep">—</span>
          <input
            type="date"
            className="ur-date-input"
            value={dateTo}
            onChange={e => setDateTo(e.target.value)}
            title="To date"
          />
        </div>

        {hasActiveFilters && (
          <button className="ur-clear-btn" onClick={clearFilters}>
            <X size={12} /> Clear
          </button>
        )}

        <span className="ur-count">{filteredRequests.length} of {requests.length}</span>

        <button className="ur-refresh-btn" onClick={() => setRefreshKey(k => k + 1)} title="Refresh">
          <RefreshCw size={14} />
        </button>
      </div>

      {/* Table */}
      <div className="admins-table-wrap">
        <table className="admins-table">
          <thead>
            <tr>
              <th>Skill ID</th>
              <th>Skill</th>
              <th>Level / Duration</th>
              <th>User</th>
              <th>Status</th>
              <th>
                <button
                  className="ur-sort-btn"
                  onClick={() => setSortDir(d => d === "desc" ? "asc" : "desc")}
                  title={sortDir === "desc" ? "Oldest first" : "Newest first"}
                >
                  Submitted
                  {sortDir === "desc" ? <ChevronDown size={12} /> : <ChevronUp size={12} />}
                </button>
              </th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {filteredRequests.length === 0 ? (
              <tr>
                <td colSpan={7} className="ur-empty-row">
                  {requests.length === 0 ? "No requests found." : "No requests match your filters."}
                </td>
              </tr>
            ) : (
              paginatedRequests.map(r => (
                <tr key={r.id}>
                  <td>
                    {r.skillId
                      ? <span className="ur-ticket">{r.skillId}</span>
                      : <span className="ur-badge ur-badge--rejected">not added</span>
                    }
                  </td>
                  <td><div className="admin-name">{r.skillName || "—"}</div></td>
                  <td style={{ fontSize: 12, color: "var(--text-secondary)" }}>
                    <div>{r.experienceLevel || "—"}</div>
                    {r.experienceDuration && (
                      <div style={{ color: "var(--text-muted)" }}>{r.experienceDuration} yr{r.experienceDuration !== "1" ? "s" : ""}</div>
                    )}
                  </td>
                  <td>
                    <div className="ur-user-cell">
                      <button
                        className="ur-user-link"
                        onClick={() => focusUser(r.userId, r.userName)}
                        title={`Show all requests for ${r.userName}`}
                      >
                        {r.userName || "—"}
                      </button>
                      {(userRequestCount.get(r.userId) ?? 0) > 1 && (
                        <span className="ur-req-count" title={`${userRequestCount.get(r.userId)} total requests`}>
                          {userRequestCount.get(r.userId)}
                        </span>
                      )}
                    </div>
                    {r.userEmail && <div className="admin-email">{r.userEmail}</div>}
                    {duplicateKeys.has(`${r.userId}::${r.skillName?.toLowerCase()}::${r.skillCategory}`) && (
                      <span className="ur-dup-badge" title="Another request exists for this user + skill">duplicate</span>
                    )}
                  </td>
                  <td>
                    <div className="ur-status-cell">
                      {statusBadge(r.status)}
                      {(r.status ?? "pending") === "pending" && r.createdAt && (() => {
                        const days = daysSince(r.createdAt)
                        return days > 0 ? (
                          <span className={`ur-overdue-badge${days >= 7 ? " ur-overdue-badge--warn" : ""}`}>
                            {days}d
                          </span>
                        ) : null
                      })()}
                    </div>
                  </td>
                  <td style={{ color: "var(--text-muted)", fontSize: 12 }}>
                    {r.createdAt ? formatDate(r.createdAt) : "—"}
                  </td>
                  <td className="action-row">
                    <button className="icon-btn" title="View details" onClick={() => setViewItem(r)}>
                      <Eye size={13} />
                    </button>
                    {(r.status ?? "pending") !== "approved" && (
                      <button
                        className="icon-btn ur-approve-btn"
                        title="Approve"
                        onClick={() => handleApprove(r)}
                        disabled={mutatingId === r.id}
                      >
                        <Check size={13} />
                      </button>
                    )}
                    {(r.status ?? "pending") !== "rejected" && (
                      <button
                        className="icon-btn danger"
                        title="Reject"
                        onClick={() => openRejectModal(r)}
                      >
                        <X size={13} />
                      </button>
                    )}
                    {(r.status ?? "pending") !== "pending" && (
                      <button
                        className="icon-btn ur-reopen-btn"
                        title="Reopen (set back to pending)"
                        onClick={() => handleReopen(r)}
                        disabled={mutatingId === r.id}
                      >
                        <RotateCcw size={13} />
                      </button>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div className="ur-pagination">
        <button className="ur-page-btn" onClick={() => setPage(1)} disabled={page === 1}>«</button>
        <button className="ur-page-btn" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}>‹</button>
        <span className="ur-page-info">
          Page {page} of {totalPages} &nbsp;·&nbsp; {filteredRequests.length} results
        </span>
        <button className="ur-page-btn" onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}>›</button>
        <button className="ur-page-btn" onClick={() => setPage(totalPages)} disabled={page === totalPages}>»</button>
      </div>

      {/* ── View modal ── */}
      <Modal open={!!viewItem} onClose={() => { setViewItem(null); setNoteText("") }} title="Skill Request Details" size="lg">
        {viewItem && (
          <div className="ticket-modal">
            <div className="ticket-modal-meta">
              <div className="ticket-modal-author">
                <span className="ticket-modal-label">Submitted by</span>
                <span className="ticket-modal-name">{viewItem.userName || "—"}</span>
                <span className="ticket-modal-email">{viewItem.userEmail || "—"}</span>
              </div>
              <div className="ticket-modal-status">
                <span className="ticket-modal-label">Status</span>
                {statusBadge(viewItem.status)}
              </div>
            </div>

            <hr className="ticket-modal-divider" />

            <div className="ur-detail-grid">
              <div className="ticket-modal-section">
                <span className="ticket-modal-label">Skill ID</span>
                <p className="ticket-modal-subject" style={{ fontSize: 14 }}>{viewItem.skillId || "—"}</p>
              </div>
              <div className="ticket-modal-section">
                <span className="ticket-modal-label">Skill Name</span>
                <p className="ticket-modal-subject" style={{ fontSize: 14 }}>{viewItem.skillName || "—"}</p>
              </div>
              <div className="ticket-modal-section">
                <span className="ticket-modal-label">Category</span>
                <p className="ticket-modal-subject" style={{ fontSize: 14 }}>{viewItem.skillCategory || "—"}</p>
              </div>
              <div className="ticket-modal-section">
                <span className="ticket-modal-label">Experience Level</span>
                <p className="ticket-modal-subject" style={{ fontSize: 14 }}>{viewItem.experienceLevel || "—"}</p>
              </div>
              <div className="ticket-modal-section">
                <span className="ticket-modal-label">Experience Duration</span>
                <p className="ticket-modal-subject" style={{ fontSize: 14 }}>
                  {viewItem.experienceDuration ? `${viewItem.experienceDuration} year${viewItem.experienceDuration !== "1" ? "s" : ""}` : "—"}
                </p>
              </div>
            </div>

            {viewItem.reason && (
              <>
                <hr className="ticket-modal-divider" />
                <div className="ticket-modal-section">
                  <span className="ticket-modal-label">Reason</span>
                  <p className="ticket-modal-message">{viewItem.reason}</p>
                </div>
              </>
            )}

            {viewItem.relatedExperience && (
              <div className="ticket-modal-section" style={{ marginTop: 10 }}>
                <span className="ticket-modal-label">Related Experience</span>
                <p className="ticket-modal-message">{viewItem.relatedExperience}</p>
              </div>
            )}

            {viewItem.contactAvailability && (
              <div className="ticket-modal-section" style={{ marginTop: 10 }}>
                <span className="ticket-modal-label">Contact Availability</span>
                <p className="ticket-modal-message">{viewItem.contactAvailability}</p>
              </div>
            )}

            {viewItem.suggestedRequirement && (
              <div className="ticket-modal-section" style={{ marginTop: 10 }}>
                <span className="ticket-modal-label">Suggested Requirement</span>
                <p className="ticket-modal-message">{viewItem.suggestedRequirement}</p>
              </div>
            )}

            {viewItem.adminRemarks && (
              <>
                <hr className="ticket-modal-divider" />
                <div className="ticket-modal-section">
                  <span className="ticket-modal-label">Admin Remarks</span>
                  <p className="ticket-modal-message ur-rejection-text">{viewItem.adminRemarks}</p>
                </div>
              </>
            )}

            {/* Submitted certificates / proof files */}
            <>
              <hr className="ticket-modal-divider" />
              <div className="ticket-modal-section">
                <span className="ticket-modal-label">Submitted Documents</span>
                {viewItem.proofUrls && viewItem.proofUrls.length > 0 ? (
                  <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 8 }}>
                    {viewItem.proofUrls.map((url, i) => {
                      const name = viewItem.proofNames?.[i] ?? `File ${i + 1}`
                      const ext  = name.split(".").pop()?.toLowerCase() ?? ""
                      const isImage = ["jpg", "jpeg", "png", "webp", "gif", "bmp"].includes(ext)
                      const isPdf   = ext === "pdf"
                      return (
                        <div key={i} className="ur-cert-wrap" style={{ flexDirection: "column", alignItems: "flex-start" }}>
                          {isImage ? (
                            <img src={url} alt={name} className="ur-cert-img" style={{ maxWidth: 260 }} />
                          ) : isPdf ? (
                            <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 14px", background: "var(--surface-2, #f5f5f5)", borderRadius: 8, border: "1px solid var(--border)" }}>
                              <FileText size={20} style={{ color: "var(--red)", flexShrink: 0 }} />
                              <span style={{ fontSize: 13, fontWeight: 500 }}>{name}</span>
                            </div>
                          ) : (
                            <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 14px", background: "var(--surface-2, #f5f5f5)", borderRadius: 8, border: "1px solid var(--border)" }}>
                              <FileText size={20} style={{ color: "var(--text-muted)", flexShrink: 0 }} />
                              <span style={{ fontSize: 13, fontWeight: 500 }}>{name}</span>
                            </div>
                          )}
                          <a href={url} target="_blank" rel="noopener noreferrer" className="ur-cert-link" style={{ marginTop: 4 }}>
                            View / Download
                          </a>
                        </div>
                      )
                    })}
                  </div>
                ) : (
                  <p className="ticket-modal-message" style={{ marginTop: 6 }}>No documents submitted.</p>
                )}
              </div>
            </>

            <hr className="ticket-modal-divider" />

            <div className="ticket-modal-footer">
              <span>{viewItem.createdAt ? formatDate(viewItem.createdAt) : "—"}</span>
            </div>

            {/* ── Timeline ── */}
            <hr className="ticket-modal-divider" />
            <span className="ticket-modal-label">History</span>

            {timelineLoading ? (
              <div className="ur-timeline-loading">Loading history…</div>
            ) : (
              <div className="ur-timeline">
                {timeline.map((entry, i) => {
                  const isLast = i === timeline.length - 1
                  const cfg = TIMELINE_CONFIG[entry.action] ?? TIMELINE_CONFIG.submitted
                  const Icon = cfg.icon
                  return (
                    <div key={i} className="ur-timeline-row">
                      <div className="ur-timeline-track">
                        <div className="ur-timeline-dot" style={{ background: cfg.color, boxShadow: `0 0 0 3px ${cfg.glow}` }}>
                          <Icon size={10} color="#fff" />
                        </div>
                        {!isLast && <div className="ur-timeline-line" />}
                      </div>
                      <div className="ur-timeline-content">
                        <span className="ur-timeline-action" style={{ color: cfg.color }}>{cfg.label}</span>
                        <span className="ur-timeline-actor">{entry.actorName}</span>
                        <span className="ur-timeline-date">
                          {entry.date ? entry.date.toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—"}
                        </span>
                        {entry.action === "user_request_note" && entry.description && (
                          <span className="ur-timeline-note-text">{entry.description}</span>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}

            {/* ── Add note (pending only) ── */}
            {(viewItem.status ?? "pending") === "pending" && (
              <div className="ur-note-box">
                <textarea
                  className="ur-textarea ur-note-textarea"
                  placeholder="Add a progress note…"
                  rows={2}
                  value={noteText}
                  onChange={e => setNoteText(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handleAddNote()
                  }}
                />
                <button
                  className="ur-note-submit-btn"
                  onClick={handleAddNote}
                  disabled={!noteText.trim() || addingNote}
                >
                  <Send size={13} />
                  {addingNote ? "Saving…" : "Add Note"}
                </button>
              </div>
            )}

            {(viewItem.status ?? "pending") === "pending" && (
              <div className="ticket-modal-actions">
                <button
                  className="ticket-btn-cancel ur-reject-action"
                  onClick={() => { setViewItem(null); openRejectModal(viewItem) }}
                >
                  Reject
                </button>
                <button
                  className="ticket-btn-confirm"
                  onClick={() => { handleApprove(viewItem); setViewItem(null) }}
                  disabled={mutatingId === viewItem.id}
                >
                  {mutatingId === viewItem.id ? "Approving..." : "Approve"}
                </button>
              </div>
            )}
            {(viewItem.status ?? "pending") !== "pending" && (
              <div className="ticket-modal-actions">
                <button className="ticket-btn-cancel" onClick={() => setViewItem(null)}>
                  Close
                </button>
                <button
                  className="ticket-btn-confirm ur-reopen-modal-btn"
                  onClick={() => { handleReopen(viewItem); setViewItem(null) }}
                  disabled={mutatingId === viewItem.id}
                >
                  <RotateCcw size={14} />
                  {mutatingId === viewItem.id ? "Reopening..." : "Reopen as Pending"}
                </button>
              </div>
            )}
          </div>
        )}
      </Modal>

      {/* ── Reject modal ── */}
      <Modal
        open={!!rejectTarget}
        onClose={() => { setRejectTarget(null); setRejectionReason("") }}
        title="Reject Skill Request"
        size="sm"
      >
        {rejectTarget && (
          <div className="ticket-modal">
            <div className="ticket-modal-section">
              <span className="ticket-modal-label">Request</span>
              <p className="ticket-modal-subject" style={{ fontSize: 14 }}>
                {rejectTarget.skillName || rejectTarget.skill_req_Id}
              </p>
              <span className="ticket-modal-email">
                {rejectTarget.userName} · {rejectTarget.skillCategory || "—"}
              </span>
            </div>

            <hr className="ticket-modal-divider" />

            <div className="ticket-modal-section">
              <label className="ticket-modal-label" htmlFor="ur-rejection-reason">
                Admin Remarks <span style={{ color: "var(--red)" }}>*</span>
              </label>
              <textarea
                id="ur-rejection-reason"
                className="ur-textarea"
                placeholder="Explain why this request is being rejected..."
                value={rejectionReason}
                onChange={e => setRejectionReason(e.target.value)}
                rows={4}
              />
            </div>

            <hr className="ticket-modal-divider" />

            <div className="ticket-modal-actions">
              <button className="ticket-btn-cancel" onClick={() => { setRejectTarget(null); setRejectionReason("") }}>
                Cancel
              </button>
              <button
                className="ticket-btn-confirm ur-btn-danger"
                onClick={handleReject}
                disabled={!rejectionReason.trim() || rejecting}
              >
                {rejecting ? "Rejecting..." : "Confirm Rejection"}
              </button>
            </div>
          </div>
        )}
      </Modal>

    </div>
  )
}

export default UserRequests
