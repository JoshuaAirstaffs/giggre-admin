'use client'

import { useEffect, useState, useMemo } from "react"
import { getCountFromServer, collection, getDocs, orderBy, query, Timestamp, where, doc, updateDoc } from "firebase/firestore"
import { db } from "@/lib/firebase"
import "./ticketStyle.css"
import Modal from "@/components/ui/Modal"
import { Eye, RefreshCw, Search, X } from "lucide-react"
import { toast } from "@/components/ui/Toaster"

type TicketStatus = 'open' | 'in progress' | 'resolved'

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
  [key: string]: unknown
}

interface TicketCounts {
  total: number
  open: number
  'in progress': number
  resolved: number
}

const STATUS_OPTIONS: TicketStatus[] = ['open', 'in progress', 'resolved']

const TicketsTab = () => {
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

      const data = snap.docs.map(doc => ({ id: doc.id, ...doc.data() })) as SupportTicket[]
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

  // derive unique subjects for the subject dropdown
  const subjectOptions = useMemo(() => {
    const set = new Set(tickets.map(t => t.subject).filter(Boolean))
    return Array.from(set).sort()
  }, [tickets])

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

  const handleOpenUpdate = (ticket: SupportTicket) => {
    setUpdateTarget(ticket)
    setSelectedStatus(ticket.status)
    setIsUpdateOpen(true)
  }

  const handleConfirmUpdate = async () => {
    if (!updateTarget) return
    try {
      setUpdating(true)
      await updateDoc(doc(db, "support_tickets", updateTarget.id), { status: selectedStatus })
      fetchTicketData()
      setIsUpdateOpen(false)
      toast.success("Ticket updated successfully")
    } catch (err) {
      console.error("Failed to update ticket:", err)
      toast.error("Failed to update ticket")
    } finally {
      setUpdating(false)
    }
  }

  const formatDate = (date: Timestamp) => {
    return date.toDate().toLocaleString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    })
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
  if (loading) return <p style={{ color: "var(--text-secondary)" }}>Loading tickets...</p>
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
        {/* Search: name or email */}
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

        {/* Status dropdown */}
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

        {/* Clear all */}
        {hasActiveFilters && (
          <button className="ticket-filter-clear-all" onClick={clearFilters}>
            <X size={12} /> Clear
          </button>
        )}

        <span className="ticket-filter-count">
          {filteredTickets.length} of {tickets.length}
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
            {filteredTickets.length === 0 ? (
              <tr>
                <td colSpan={6} style={{ textAlign: "center", color: "var(--text-muted)", padding: "2rem" }}>
                  No tickets match your filters.
                </td>
              </tr>
            ) : (
              filteredTickets.map((ticket) => (
                <tr key={ticket.id}>
                  <td>{ticket.ticket_number}</td>
                  <td><div className="admin-name">{ticket.name || "Giggre Support"}</div></td>
                  <td><div className="admin-name">{ticket.subject}</div></td>
                  <td><div className={statusClassName(ticket.status)}>{ticket.status}</div></td>
                  <td><div className="admin-name">{formatDate(ticket.createdAt as Timestamp)}</div></td>
                  <td className="action-row">
                    <button className="icon-btn" onClick={() => { setTicketData(ticket); setIsOpen(true) }}>
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