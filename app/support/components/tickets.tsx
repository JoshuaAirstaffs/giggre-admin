'use client'

import { SkeletonRows } from "@/components/ui/Skeleton";
import { useEffect, useState, useMemo, useCallback, useRef } from "react"
import { getCountFromServer, collection, getDocs, orderBy, query, Timestamp, where, doc, updateDoc, serverTimestamp } from "firebase/firestore"
import { db } from "@/lib/firebase"
import { useAuth } from "@/context/AuthContext"
import "./ticketStyle.css"
import Modal from "@/components/ui/Modal"
import { Eye, RefreshCw, Search, X, FileText, Send } from "lucide-react"
import { toast } from "@/components/ui/Toaster"
import { writeLog, buildDescription } from "@/lib/activitylog"

type TicketStatus = 'open' | 'in progress' | 'resolved'

const PAGE_SIZE = 15

interface SupportTicket {
  ticket_number: string
  id: string
  name: string
  email: string
  message: string
  subject: string
  status: TicketStatus
  createdAt: Timestamp
  userId: string
  resolvedBy?: string | null
  resolvedAt?: Timestamp | null
  [key: string]: unknown
}

interface TicketCounts {
  total: number
  open: number
  'in progress': number
  resolved: number
}

interface TimelineEntry {
  action: string
  actorName: string
  date: Date | null
  description?: string
  fromStatus?: string
  toStatus?: string
}

const STATUS_OPTIONS: TicketStatus[] = ['open', 'in progress', 'resolved']

const TIMELINE_CONFIG: Record<string, { label: string; color: string; glow: string }> = {
  ticket_status_updated: { label: "Status Updated", color: "var(--blue)", glow: "rgba(59,130,246,0.18)" },
  ticket_note:           { label: "Note Added",     color: "var(--text-secondary)", glow: "rgba(100,116,139,0.18)" },
}

const TicketsTab = () => {
  const { user } = useAuth()

  const [tickets, setTickets] = useState<SupportTicket[]>([])
  const [counts, setCounts] = useState<TicketCounts>({ total: 0, open: 0, 'in progress': 0, resolved: 0 })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [mounted, setMounted] = useState(false)

  // filters
  const [search, setSearch] = useState("")
  const [filterStatus, setFilterStatus] = useState<TicketStatus | "">("")

  // view modal
  const [isOpen, setIsOpen] = useState(false)
  const [ticketData, setTicketData] = useState<SupportTicket>()

  // update modal
  const [isUpdateOpen, setIsUpdateOpen] = useState(false)
  const [updateTarget, setUpdateTarget] = useState<SupportTicket>()
  const [selectedStatus, setSelectedStatus] = useState<TicketStatus>('open')
  const [updating, setUpdating] = useState(false)

  // timeline / history
  const [timeline, setTimeline] = useState<TimelineEntry[]>([])
  const [timelineLoading, setTimelineLoading] = useState(false)
  const [timelineKey, setTimelineKey] = useState(0)

  // notes
  const [noteText, setNoteText] = useState("")
  const [addingNote, setAddingNote] = useState(false)

  // update modal note
  const [updateNote, setUpdateNote] = useState("")

  // scroll persistence for timeline
  const timelineRef = useRef<HTMLDivElement>(null)
  const scrollPositions = useRef<Map<string, number>>(new Map())

  //pagination
  const [page, setPage] = useState(1)
  const totalPages = Math.max(1, Math.ceil(tickets.length / PAGE_SIZE))
  const safePage = Math.min(page, totalPages)

  const pagedTickets = tickets.slice(
    (safePage - 1) * PAGE_SIZE,
    safePage * PAGE_SIZE
  )

  useEffect(() => {
    setMounted(true)
    fetchTicketData()
  }, [])

  const fetchTicketData = async () => {
    try {
      setLoading(true)

      const [snap, total, open, progress, resolved] = await Promise.all([
        getDocs(query(collection(db, "support_tickets"), orderBy("createdAt", "desc"))),
        getCountFromServer(collection(db, "support_tickets")),
        getCountFromServer(query(collection(db, "support_tickets"), where("status", "==", "open"))),
        getCountFromServer(query(collection(db, "support_tickets"), where("status", "==", "in progress"))),
        getCountFromServer(query(collection(db, "support_tickets"), where("status", "==", "resolved"))),
      ])

      const data = snap.docs.map(d => ({ id: d.id, ...d.data() })) as SupportTicket[]
      setTickets(data)

      setCounts({
        total:    total.data().count,
        open:     open.data().count,
        'in progress': progress.data().count,
        resolved: resolved.data().count,
      })
    } catch (err) {
      console.error("Failed to fetch tickets:", err)
      setError("Failed to load tickets.")
    } finally {
      setLoading(false)
    }
  }

  const fetchTimeline = useCallback(async (ticketId: string) => {
    setTimelineLoading(true)
    try {
      const snap = await getDocs(
        query(
          collection(db, "activityLogs"),
          where("targetId", "==", ticketId),
          where("module", "==", "support"),
        )
      )
      const entries: TimelineEntry[] = snap.docs
        .map(d => {
          const data = d.data()
          return {
            action:     data.action ?? "",
            actorName:  data.actorName ?? "Unknown",
            date:       data.createdAt?.toDate?.() ?? null,
            description: data.description ?? undefined,
            fromStatus: data.meta?.other?.fromStatus ?? undefined,
            toStatus:   data.meta?.other?.toStatus ?? undefined,
          }
        })
        .filter(e => e.action in TIMELINE_CONFIG)
        .sort((a, b) => (b.date?.getTime() ?? 0) - (a.date?.getTime() ?? 0))
      setTimeline(entries)
    } catch {
      setTimeline([])
    } finally {
      setTimelineLoading(false)
    }
  }, [])

  // live-filtered tickets
  const filteredTickets = useMemo(() => {
    const q = search.toLowerCase().trim()
    return tickets.filter(t => {
      const matchesSearch = !q || t.name.toLowerCase().includes(q) || t.email.toLowerCase().includes(q)
      const matchesStatus = !filterStatus || t.status === filterStatus
      return matchesSearch && matchesStatus
    })
  }, [tickets, search, filterStatus])

  const hasActiveFilters = search || filterStatus

  const clearFilters = () => {
    setSearch("")
    setFilterStatus("")
  }

  const handleOpenView = (ticket: SupportTicket) => {
    setTicketData(ticket)
    setNoteText("")
    setTimeline([])
    setIsOpen(true)
    fetchTimeline(ticket.id)
  }

  const handleOpenUpdate = (ticket: SupportTicket) => {
    setUpdateTarget(ticket)
    setSelectedStatus(ticket.status)
    setUpdateNote("")
    setIsUpdateOpen(true)
  }

  const handleConfirmUpdate = async () => {
    if (!updateTarget) return
    try {
      setUpdating(true)
      const prevStatus = updateTarget.status
      const extras: Record<string, unknown> = { status: selectedStatus }
      if (selectedStatus === 'resolved') {
        extras.resolvedBy = user?.displayName ?? user?.email ?? "Admin"
        extras.resolvedAt = serverTimestamp()
      }
      await updateDoc(doc(db, "support_tickets", updateTarget.id), extras)

      if (selectedStatus === 'resolved' && updateTarget.roomId) {
        await updateDoc(doc(db, "chat_rooms", updateTarget.roomId as string), { status: 'resolved' })
      }

      if (user) {
        await writeLog({
          actorId:    user.uid,
          actorName:  user.displayName ?? "Admin",
          actorEmail: user.email ?? undefined,
          module:     "support",
          action:     "ticket_status_updated",
          description: buildDescription.ticketStatusUpdated(
            updateTarget.ticket_number,
            prevStatus,
            selectedStatus,
            user.displayName ?? "Admin"
          ),
          targetId:   updateTarget.id,
          targetName: updateTarget.subject,
          meta: { other: { fromStatus: prevStatus, toStatus: selectedStatus } },
        })
      }

      if (updateNote.trim() && user) {
        await writeLog({
          actorId:    user.uid,
          actorName:  user.displayName ?? "Admin",
          actorEmail: user.email ?? undefined,
          module:     "support",
          action:     "ticket_note",
          description: updateNote.trim(),
          targetId:   updateTarget.id,
          targetName: updateTarget.subject,
        })
      }

      fetchTicketData()
      setIsUpdateOpen(false)
      setUpdateNote("")
      toast.success("Ticket updated successfully")

      // refresh view modal timeline if the same ticket is open
      if (ticketData?.id === updateTarget.id) {
        setTimelineKey(k => k + 1)
      }
    } catch (err) {
      console.error("Failed to update ticket:", err)
      toast.error("Failed to update ticket")
    } finally {
      setUpdating(false)
    }
  }

  const handleAddNote = useCallback(async () => {
    if (!ticketData || !user || !noteText.trim()) return
    setAddingNote(true)
    try {
      await writeLog({
        actorId:    user.uid,
        actorName:  user.displayName ?? "Admin",
        actorEmail: user.email ?? undefined,
        module:     "support",
        action:     "ticket_note",
        description: noteText.trim(),
        targetId:   ticketData.id,
        targetName: ticketData.subject,
      })
      setNoteText("")
      scrollPositions.current.delete(ticketData.id)
      await fetchTimeline(ticketData.id)
      setTimeout(() => { if (timelineRef.current) timelineRef.current.scrollTop = 0 }, 100)
    } finally {
      setAddingNote(false)
    }
  }, [ticketData, user, noteText, fetchTimeline])

  // refresh timeline when timelineKey changes (triggered after update)
  useEffect(() => {
    if (ticketData && timelineKey > 0) fetchTimeline(ticketData.id)
  }, [timelineKey]) // eslint-disable-line react-hooks/exhaustive-deps

  // restore scroll position when timeline reloads
  useEffect(() => {
    if (!ticketData || !timelineRef.current) return
    const saved = scrollPositions.current.get(ticketData.id) ?? 0
    timelineRef.current.scrollTop = saved
  }, [ticketData?.id, timelineLoading])

  const formatDate = (date: Timestamp) => {
    return date.toDate().toLocaleString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    })
  }

  const fmtDate = (date: Date | null) => {
    if (!date) return "—"
    return date.toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" })
  }

  const statusClassName = (status: string) => {
    const map: Record<string, string> = {
      open:          "status-open",
      "in progress": "status-progress",
      resolved:      "status-resolved",
    }
    return map[status] ?? "status-open"
  }

  if (!mounted) return null
  if (loading) return <SkeletonRows />
  if (error)   return <p style={{ color: "var(--red)" }}>{error}</p>
  if (!tickets.length) return <p style={{ color: "var(--text-muted)" }}>No tickets found.</p>

  return (
    <div>
      {/* Stat cards */}
      <div className="ticket-stats">
        <div className="ticket-stat-card total">
          <span className="ticket-stat-label">Total Tickets</span>
          <span className="ticket-stat-value">{counts.total}</span>
        </div>
        <div className="ticket-stat-card open">
          <span className="ticket-stat-label">Open</span>
          <span className="ticket-stat-value">{counts.open}</span>
        </div>
        <div className="ticket-stat-card progress">
          <span className="ticket-stat-label">In Progress</span>
          <span className="ticket-stat-value">{counts['in progress']}</span>
        </div>
        <div className="ticket-stat-card resolved">
          <span className="ticket-stat-label">Resolved</span>
          <span className="ticket-stat-value">{counts.resolved}</span>
        </div>
      </div>

      {/* Filter bar */}
      <div className="ticket-filters">
        <div className="ticket-filter-search">
          <Search size={14} className="ticket-filter-search-icon" />
          <input
            type="text"
            placeholder="Search by name or email..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="ticket-filter-input"
          />
          {search && (
            <button className="ticket-filter-clear-input" onClick={() => setSearch("")}>
              <X size={12} />
            </button>
          )}
        </div>

        <select
          value={filterStatus}
          onChange={e => setFilterStatus(e.target.value as TicketStatus | "")}
          className="ticket-filter-select"
        >
          <option value="">All Statuses</option>
          {STATUS_OPTIONS.map(s => (
            <option key={s} value={s}>
              {s === 'in progress' ? 'In Progress' : s.charAt(0).toUpperCase() + s.slice(1)}
            </option>
          ))}
        </select>

        {hasActiveFilters && (
          <button className="ticket-filter-clear-all" onClick={clearFilters}>
            <X size={12} /> Clear
          </button>
        )}

        <span className="ticket-filter-count">
          {pagedTickets.length} of {tickets.length}
        </span>
      </div>

      <div className="admins-table-wrap">
        <table className="admins-table">
          <thead>
            <tr>
              <th>Ticket #</th>
              <th>Name</th>
              <th>Subject</th>
              <th>Status</th>
              <th>Created</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {pagedTickets.length === 0 ? (
              <tr>
                <td colSpan={6} style={{ textAlign: "center", color: "var(--text-muted)", padding: "2rem" }}>
                  No tickets match your filters.
                </td>
              </tr>
            ) : (
              pagedTickets.map((ticket) => (
                <tr key={ticket.id}>
                  <td>{ticket.ticket_number}</td>
                  <td><div className="admin-name">{ticket.name || "Giggre Support"}</div></td>
                  <td><div className="admin-name">{ticket.subject}</div></td>
                  <td><div className={statusClassName(ticket.status)}>{ticket.status}</div></td>
                  <td><div className="admin-name">{formatDate(ticket.createdAt as Timestamp)}</div></td>
                  <td className="action-row">
                    <button className="icon-btn" onClick={() => handleOpenView(ticket)}>
                      <Eye size={13} />
                    </button>
                    <button className="icon-btn" onClick={() => handleOpenUpdate(ticket)}>
                      <RefreshCw size={13} />
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
        <div className="up-pg">
          <span className="up-pg-info">
            {(safePage - 1) * PAGE_SIZE + 1}–{Math.min(safePage * PAGE_SIZE, tickets.length)} of {tickets.length} tickets
          </span>
          <div className="up-pg-btns">
            <button className="up-pg-btn" onClick={() => setPage(1)} disabled={safePage === 1}>«</button>
            <button className="up-pg-btn" onClick={() => setPage((p) => p - 1)} disabled={safePage === 1}>‹</button>
            {Array.from({ length: totalPages }, (_, i) => i + 1)
              .filter((p) => Math.abs(p - safePage) <= 2 || p === 1 || p === totalPages)
              .reduce<(number | "…")[]>((acc, p, i, arr) => {
                if (i > 0 && (p as number) - (arr[i - 1] as number) > 1) acc.push("…");
                acc.push(p);
                return acc;
              }, [])
              .map((p, i) =>
                p === "…" ? (
                  <span key={`e${i}`} style={{ padding: "0 4px", color: "var(--text-muted)", fontSize: 12 }}>…</span>
                ) : (
                  <button
                    key={p}
                    className={`up-pg-btn${p === safePage ? " active" : ""}`}
                    onClick={() => setPage(p as number)}
                    disabled={p === safePage}
                  >
                    {p}
                  </button>
                )
              )}
            <button className="up-pg-btn" onClick={() => setPage((p) => p + 1)} disabled={safePage === totalPages}>›</button>
            <button className="up-pg-btn" onClick={() => setPage(totalPages)} disabled={safePage === totalPages}>»</button>
          </div>
        </div>
      </div>

      {/* View modal */}
      <Modal open={isOpen} onClose={() => setIsOpen(false)} title="Ticket Details" size="lg">
        {ticketData && (
          <div className="ticket-modal">
            <div className="ticket-modal-meta">
              <div className="ticket-modal-author">
                <span className="ticket-modal-label">Submitted by</span>
                <span className="ticket-modal-name">{ticketData.name}</span>
                <span className="ticket-modal-email">{ticketData.email}</span>
              </div>
              <div className="ticket-modal-status">
                <span className="ticket-modal-label">Status</span>
                <span className={`ticket-modal-status-val ${statusClassName(ticketData.status)}`}>
                  {ticketData.status}
                </span>
              </div>
            </div>
            <hr className="ticket-modal-divider" />
            <div className="ticket-modal-section">
              <span className="ticket-modal-label">Subject</span>
              <p className="ticket-modal-subject">{ticketData.subject}</p>
            </div>
            <div className="ticket-modal-section">
              <span className="ticket-modal-label">Message</span>
              <p className="ticket-modal-message">{ticketData.message}</p>
            </div>

            {ticketData.status === 'resolved' && ticketData.resolvedBy && (
              <div className="ticket-resolved-banner">
                <span>Resolved by <strong>{ticketData.resolvedBy}</strong></span>
                {ticketData.resolvedAt && (
                  <span style={{ marginLeft: 8, color: "var(--text-muted)" }}>
                    · {formatDate(ticketData.resolvedAt as Timestamp)}
                  </span>
                )}
              </div>
            )}

            <hr className="ticket-modal-divider" />

            {/* History / Timeline */}
            <div className="ticket-modal-section">
              <span className="ticket-modal-label" style={{ display: "flex", alignItems: "center", gap: 5 }}>
                <FileText size={11} /> History
              </span>
              <div
                ref={timelineRef}
                className="ticket-timeline-wrap"
                onScroll={() => {
                  if (ticketData && timelineRef.current)
                    scrollPositions.current.set(ticketData.id, timelineRef.current.scrollTop)
                }}
              >
                {timelineLoading ? (
                  <SkeletonRows count={3} avatar={false} />
                ) : timeline.length === 0 ? (
                  <div className="ticket-timeline-empty">No history yet.</div>
                ) : (
                  <div className="ticket-timeline">
                    {timeline.map((entry, i) => {
                      const isLast = i === timeline.length - 1
                      const cfg = TIMELINE_CONFIG[entry.action] ?? TIMELINE_CONFIG.ticket_status_updated
                      return (
                        <div key={i} className="ticket-timeline-row">
                          <div className="ticket-timeline-track">
                            <div
                              className="ticket-timeline-dot"
                              style={{ background: cfg.color, boxShadow: `0 0 0 3px ${cfg.glow}` }}
                            />
                            {!isLast && <div className="ticket-timeline-line" />}
                          </div>
                          <div className="ticket-timeline-content">
                            <span className="ticket-timeline-action" style={{ color: cfg.color }}>
                              {cfg.label}
                              {entry.action === "ticket_status_updated" && entry.fromStatus && entry.toStatus && (
                                <span style={{ fontWeight: 400, color: "var(--text-muted)" }}>
                                  {" "}· {entry.fromStatus} → {entry.toStatus}
                                </span>
                              )}
                            </span>
                            <span className="ticket-timeline-actor">{entry.actorName}</span>
                            <span className="ticket-timeline-date">{fmtDate(entry.date)}</span>
                            {entry.action === "ticket_note" && entry.description && (
                              <span className="ticket-timeline-note-text">{entry.description}</span>
                            )}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            </div>

            {/* Add note box */}
            {ticketData.status === 'resolved' ? (
              <div className="ticket-note-box ticket-note-box--locked">
                <p className="ticket-note-locked-msg">This ticket is resolved. No further notes can be added.</p>
              </div>
            ) : (
              <div className="ticket-note-box">
                <textarea
                  className="ticket-note-textarea"
                  placeholder="Add a note… (Ctrl+Enter to submit)"
                  rows={2}
                  value={noteText}
                  onChange={e => setNoteText(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handleAddNote() }}
                />
                <button
                  className="ticket-note-submit"
                  onClick={handleAddNote}
                  disabled={!noteText.trim() || addingNote}
                >
                  <Send size={12} />
                  {addingNote ? "Saving…" : "Add Note"}
                </button>
              </div>
            )}

            <hr className="ticket-modal-divider" />
            <div className="ticket-modal-footer">
              <span>User ID: {ticketData.userId}</span>
              <span>{formatDate(ticketData.createdAt as Timestamp)}</span>
            </div>
          </div>
        )}
      </Modal>

      {/* Update status modal */}
      <Modal open={isUpdateOpen} onClose={() => setIsUpdateOpen(false)} title="Update Ticket Status" size="sm">
        {updateTarget && (
          <div className="ticket-modal">
            <div className="ticket-modal-section">
              <span className="ticket-modal-label">Ticket</span>
              <p className="ticket-modal-subject">{updateTarget.subject}</p>
              <span className="ticket-modal-email">{updateTarget.name} · {updateTarget.email}</span>
            </div>

            <hr className="ticket-modal-divider" />

            <div className="ticket-modal-section">
              <span className="ticket-modal-label">Select new status</span>
              <div className="ticket-status-options">
                {STATUS_OPTIONS.map(s => (
                  <button
                    key={s}
                    className={`ticket-status-option ${s === selectedStatus ? "selected" : ""} ${statusClassName(s)}`}
                    onClick={() => setSelectedStatus(s)}
                  >
                    {s === 'in progress' ? 'In Progress' : s.charAt(0).toUpperCase() + s.slice(1)}
                  </button>
                ))}
              </div>
            </div>

            <div className="ticket-modal-section">
              <span className="ticket-modal-label">Note (optional)</span>
              <textarea
                className="ticket-note-textarea"
                placeholder="Add a comment about this status change…"
                rows={2}
                value={updateNote}
                onChange={e => setUpdateNote(e.target.value)}
              />
            </div>

            <hr className="ticket-modal-divider" />

            <div className="ticket-modal-actions">
              <button className="ticket-btn-cancel" onClick={() => setIsUpdateOpen(false)}>
                Cancel
              </button>
              <button
                className="ticket-btn-confirm"
                onClick={handleConfirmUpdate}
                disabled={updating || selectedStatus === updateTarget.status}
              >
                {updating ? "Updating..." : "Confirm Update"}
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}

export default TicketsTab
