'use client'

import React, { useEffect, useState, useMemo, useRef } from "react"
import {
  collection, getDocs, onSnapshot, orderBy, query, doc, updateDoc,
  addDoc, serverTimestamp, Timestamp, where, limit,
} from "firebase/firestore"
import { db } from "@/lib/firebase"
import "./userRequestsStyle.css"
import Modal from "@/components/ui/Modal"
import { Eye, Check, X, Plus, RefreshCw, Search, Upload, User, ChevronUp, ChevronDown, RotateCcw, Calendar, FileText, CheckCircle2, XCircle, Clock, MessageSquare, Send } from "lucide-react"
import { toast } from "@/components/ui/Toaster"
import { generateTicketNumber } from "../utils/generateTicketNumber"
import { useAuth } from "@/context/AuthContext"
import { writeLog, buildDescription } from "@/lib/activitylog"

// ── Types ────────────────────────────────────────────────────────────────────

type RequestType = "skill" | "host_eligible_reward_skill"
type RequestStatus = "pending" | "approved" | "rejected"

interface UserRequest {
  id: string
  ticket_number: string
  cert_photo_url: string
  isApproved: boolean | null
  rejection_reason: string
  request_type: RequestType
  skill_name: string
  userId: string
  userName: string
  userEmail: string
  createdAt: Timestamp
}

interface Skill {
  id: string
  skillId: string
  name: string
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

const REQUEST_TYPE_LABELS: Record<RequestType, string> = {
  skill: "Skill",
  host_eligible_reward_skill: "Host-Eligible Reward Skill",
}

const EMPTY_FORM = {
  request_type: "skill" as RequestType,
  skill_name: "",
  cert_photo_url: "",
  isApproved: null as boolean | null,
  rejection_reason: "",
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const deriveStatus = (isApproved: boolean | null | undefined): RequestStatus => {
  if (isApproved === true)  return "approved"
  if (isApproved === false) return "rejected"
  return "pending"
}

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
  const [requests, setRequests]   = useState<UserRequest[]>([])
  const [loading, setLoading]     = useState(true)
  const [error, setError]         = useState<string | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)

  // skills
  const [skills, setSkills]           = useState<Skill[]>([])
  const [loadingSkills, setLoadingSkills] = useState(false)

  // filters
  const [search, setSearch]             = useState("")
  const [filterStatus, setFilterStatus] = useState<RequestStatus | "">("")
  const [filterType, setFilterType]     = useState<RequestType | "">("")
  const [dateFrom, setDateFrom]         = useState("")
  const [dateTo, setDateTo]             = useState("")
  const [filterUserId, setFilterUserId] = useState<string | null>(null)
  const [filterUserName, setFilterUserName] = useState<string>("")

  // view modal
  const [viewItem, setViewItem]               = useState<UserRequest | null>(null)
  const [timeline, setTimeline]               = useState<TimelineEntry[]>([])
  const [timelineLoading, setTimelineLoading] = useState(false)
  const [timelineKey, setTimelineKey]         = useState(0)
  const [noteText, setNoteText]               = useState("")
  const [addingNote, setAddingNote]           = useState(false)

  // reject modal
  const [rejectTarget, setRejectTarget]       = useState<UserRequest | null>(null)
  const [rejectionReason, setRejectionReason] = useState("")
  const [rejecting, setRejecting]             = useState(false)

  // single loading tracker for approve / reopen (reject uses its own `rejecting`)
  const [mutatingId, setMutatingId] = useState<string | null>(null)

  // create modal
  const [showCreate, setShowCreate]     = useState(false)
  const [createForm, setCreateForm]     = useState(EMPTY_FORM)
  const [creating, setCreating]         = useState(false)

  // user search (inside create modal)
  const [userSearch, setUserSearch]         = useState("")
  const [userResults, setUserResults]       = useState<FoundUser[]>([])
  const [showUserDrop, setShowUserDrop]     = useState(false)
  const [searchingUser, setSearchingUser]   = useState(false)
  const [selectedUser, setSelectedUser]     = useState<FoundUser | null>(null)
  const userDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const userWrapRef     = useRef<HTMLDivElement>(null)

  // skill search (inside create modal)
  const [skillSearch, setSkillSearch]       = useState("")
  const [showSkillDrop, setShowSkillDrop]   = useState(false)
  const skillWrapRef = useRef<HTMLDivElement>(null)

  // sort & pagination
  const [sortDir, setSortDir]   = useState<"desc" | "asc">("desc")
  const [page, setPage]         = useState(1)
  const PAGE_SIZE               = 20

  // photo upload (UI only – no storage yet)
  const [photoPreview, setPhotoPreview] = useState<string | null>(null)
  const photoInputRef = useRef<HTMLInputElement>(null)

  // auth
  const { user } = useAuth()

  // ── Init ─────────────────────────────────────────────────────────────────

  useEffect(() => {
    fetchSkills()
  }, [])

  // Real-time listener — re-subscribes when refreshKey bumps
  useEffect(() => {
    setLoading(true)
    setError(null)
    const q = query(collection(db, "user_requests"), orderBy("createdAt", "desc"))
    const unsub = onSnapshot(
      q,
      snap => {
        setRequests(snap.docs.map(d => ({ id: d.id, ...d.data() })) as UserRequest[])
        setLoading(false)
      },
      err => {
        console.error("Failed to listen to user requests:", err)
        setError("Failed to load user requests.")
        setLoading(false)
      },
    )
    return unsub
  }, [refreshKey])

  // close dropdowns on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (userWrapRef.current && !userWrapRef.current.contains(e.target as Node))
        setShowUserDrop(false)
      if (skillWrapRef.current && !skillWrapRef.current.contains(e.target as Node))
        setShowSkillDrop(false)
    }
    document.addEventListener("mousedown", handler)
    return () => document.removeEventListener("mousedown", handler)
  }, [])

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

      // Prepend the original submission as the first entry
      const submitted: TimelineEntry = {
        action:    "submitted",
        actorName: viewItem.userName || "User",
        date:      viewItem.createdAt?.toDate?.() ?? null,
      }

      setTimeline([submitted, ...logEntries])
    }).catch((err: unknown) => {
      console.error("Failed to fetch timeline:", err)
      // If this still fails, check Firestore indexes in your Firebase console
      setTimeline([])
    }).finally(() => setTimelineLoading(false))
  }, [viewItem?.id, timelineKey])

  // ── Firestore fetches ────────────────────────────────────────────────────

  const fetchSkills = async () => {
    try {
      setLoadingSkills(true)
      const snap = await getDocs(query(collection(db, "skills"), orderBy("createdAt", "asc")))
      const list: Skill[] = []
      snap.forEach(d => {
        if (d.id.startsWith("_")) return
        const data = d.data()
        list.push({ id: d.id, skillId: data.skillId ?? d.id, name: data.name ?? "" })
      })
      setSkills(list)
    } catch (err) {
      console.error("Failed to fetch skills:", err)
    } finally {
      setLoadingSkills(false)
    }
  }

  // ── User search ──────────────────────────────────────────────────────────

  useEffect(() => {
    if (userDebounceRef.current) clearTimeout(userDebounceRef.current)

    const q = userSearch.trim()
    if (!q) {
      setUserResults([])
      setShowUserDrop(false)
      setSearchingUser(false)
      return
    }

    setSearchingUser(true)

    userDebounceRef.current = setTimeout(async () => {
      try {
        const seen = new Set<string>()
        const merged: FoundUser[] = []

        const push = (d: { id: string; data: () => Record<string, unknown> }) => {
          if (!seen.has(d.id)) {
            seen.add(d.id)
            const data = d.data()
            merged.push({ id: String(data.userId ?? d.id), name: String(data.name ?? ""), email: String(data.email ?? "") })
          }
        }

        // All 3 queries fire in parallel
        const [byUserId, nameSnap, emailSnap] = await Promise.all([
          getDocs(query(collection(db, "users"), where("userId", "==", q), limit(1))),
          getDocs(query(collection(db, "users"), where("name", ">=", q), where("name", "<=", q + "\uf8ff"), orderBy("name"), limit(8))),
          getDocs(query(collection(db, "users"), where("email", ">=", q.toLowerCase()), where("email", "<=", q.toLowerCase() + "\uf8ff"), orderBy("email"), limit(8))),
        ])
        byUserId.forEach(d => push(d))
        nameSnap.forEach(d => push(d))
        emailSnap.forEach(d => push(d))

        setUserResults(merged.slice(0, 10))
        setShowUserDrop(merged.length > 0)
      } catch (err) {
        console.error("User search failed:", err)
        setUserResults([])
        setShowUserDrop(false)
      } finally {
        setSearchingUser(false)
      }
    }, 300)

    return () => { if (userDebounceRef.current) clearTimeout(userDebounceRef.current) }
  }, [userSearch])

  const selectUser = (u: FoundUser) => {
    setSelectedUser(u)
    setUserSearch("")
    setShowUserDrop(false)
    setUserResults([])
  }

  const clearUser = () => {
    setSelectedUser(null)
    setUserSearch("")
  }

  // ── Photo upload handler (UI only) ───────────────────────────────────────

  const handlePhotoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => setPhotoPreview(reader.result as string)
    reader.readAsDataURL(file)
  }

  const clearPhoto = () => {
    setPhotoPreview(null)
    if (photoInputRef.current) photoInputRef.current.value = ""
  }

  // ── Filtered list ────────────────────────────────────────────────────────

  const filteredRequests = useMemo(() => {
    const q = search.toLowerCase().trim()
    const fromMs = dateFrom ? new Date(dateFrom).setHours(0, 0, 0, 0)    : null
    const toMs   = dateTo   ? new Date(dateTo).setHours(23, 59, 59, 999) : null
    const filtered = requests.filter(r => {
      const matchesSearch = !q
        || r.ticket_number?.toLowerCase().includes(q)
        || r.userName?.toLowerCase().includes(q)
        || r.userEmail?.toLowerCase().includes(q)
        || r.skill_name?.toLowerCase().includes(q)
      const matchesStatus = !filterStatus  || deriveStatus(r.isApproved) === filterStatus
      const matchesType   = !filterType    || r.request_type === filterType
      const matchesUser   = !filterUserId  || r.userId === filterUserId
      const rMs = r.createdAt?.toMillis?.() ?? 0
      const matchesFrom = fromMs === null || rMs >= fromMs
      const matchesTo   = toMs   === null || rMs <= toMs
      return matchesSearch && matchesStatus && matchesType && matchesUser && matchesFrom && matchesTo
    })
    filtered.sort((a, b) => {
      const aMs = a.createdAt?.toMillis?.() ?? 0
      const bMs = b.createdAt?.toMillis?.() ?? 0
      return sortDir === "desc" ? bMs - aMs : aMs - bMs
    })
    return filtered
  }, [requests, search, filterStatus, filterType, sortDir, dateFrom, dateTo, filterUserId])

  const hasActiveFilters = search || filterStatus || filterType || dateFrom || dateTo || filterUserId

  const clearFilters = () => {
    setSearch("")
    setFilterStatus("")
    setFilterType("")
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
  useEffect(() => { setPage(1) }, [search, filterStatus, filterType, sortDir, dateFrom, dateTo, filterUserId])

  const totalPages       = Math.max(1, Math.ceil(filteredRequests.length / PAGE_SIZE))
  const paginatedRequests = filteredRequests.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  // ── Counts ───────────────────────────────────────────────────────────────

  const counts = useMemo(() =>
    requests.reduce(
      (acc, r) => { acc.total++; acc[deriveStatus(r.isApproved)]++; return acc },
      { total: 0, pending: 0, approved: 0, rejected: 0 },
    )
  , [requests])

  // request count per user
  const userRequestCount = useMemo(() => {
    const map = new Map<string, number>()
    requests.forEach(r => map.set(r.userId, (map.get(r.userId) ?? 0) + 1))
    return map
  }, [requests])

  // duplicate detection: userId + skill_name combos that appear more than once
  const duplicateKeys = useMemo(() => {
    const seen = new Map<string, number>()
    requests.forEach(r => {
      const key = `${r.userId}::${r.skill_name?.toLowerCase()}::${r.request_type}`
      seen.set(key, (seen.get(key) ?? 0) + 1)
    })
    const dupes = new Set<string>()
    seen.forEach((count, key) => { if (count > 1) dupes.add(key) })
    return dupes
  }, [requests])

  // ── Approve ──────────────────────────────────────────────────────────────

  const handleApprove = async (request: UserRequest) => {
    try {
      setMutatingId(request.id)
      await updateDoc(doc(db, "user_requests", request.id), {
        isApproved: true,
        rejection_reason: "",
      })
      toast.success("Request approved")
      writeLog({
        actorId:    user?.uid ?? "",
        actorName:  user?.displayName ?? "Unknown",
        actorEmail: user?.email ?? "",
        module:     "user_requests",
        action:     "user_request_approved",
        description: buildDescription.userRequestApproved(request.ticket_number, request.skill_name, request.userName),
        targetId:   request.id,
        targetName: request.ticket_number,
        meta: { other: { skillName: request.skill_name, userId: request.userId } },
      })
    } catch (err) {
      console.error("Approve failed:", err)
      toast.error("Failed to approve request")
    } finally {
      setMutatingId(null)
    }
  }

  // ── Reject ───────────────────────────────────────────────────────────────

  const openRejectModal = (request: UserRequest) => {
    setRejectTarget(request)
    setRejectionReason(request.rejection_reason ?? "")
  }

  const handleReject = async () => {
    if (!rejectTarget || !rejectionReason.trim()) return
    try {
      setRejecting(true)
      const reason = rejectionReason.trim()
      await updateDoc(doc(db, "user_requests", rejectTarget.id), {
        isApproved: false,
        rejection_reason: reason,
      })
      toast.success("Request rejected")
      writeLog({
        actorId:    user?.uid ?? "",
        actorName:  user?.displayName ?? "Unknown",
        actorEmail: user?.email ?? "",
        module:     "user_requests",
        action:     "user_request_rejected",
        description: buildDescription.userRequestRejected(rejectTarget.ticket_number, rejectTarget.skill_name, rejectTarget.userName, reason),
        targetId:   rejectTarget.id,
        targetName: rejectTarget.ticket_number,
        meta: { other: { skillName: rejectTarget.skill_name, userId: rejectTarget.userId, reason } },
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

  const handleReopen = async (request: UserRequest) => {
    try {
      setMutatingId(request.id)
      await updateDoc(doc(db, "user_requests", request.id), {
        isApproved: null,
        rejection_reason: "",
      })
      toast.success("Request reopened")
      writeLog({
        actorId:    user?.uid ?? "",
        actorName:  user?.displayName ?? "Unknown",
        actorEmail: user?.email ?? "",
        module:     "user_requests",
        action:     "user_request_reopened",
        description: buildDescription.userRequestReopened(request.ticket_number, request.skill_name, request.userName),
        targetId:   request.id,
        targetName: request.ticket_number,
        meta: { other: { skillName: request.skill_name, userId: request.userId } },
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
        targetName:  viewItem.ticket_number,
        meta: { other: { skillName: viewItem.skill_name, userId: viewItem.userId } },
      })
      setNoteText("")
      setTimelineKey(k => k + 1)   // re-fetch timeline
    } catch (err) {
      console.error("Add note failed:", err)
      toast.error("Failed to save note")
    } finally {
      setAddingNote(false)
    }
  }

  // ── Create ───────────────────────────────────────────────────────────────

  // filtered skills for the search dropdown
  const filteredSkills = useMemo(() => {
    const q = skillSearch.toLowerCase().trim()
    if (!q) return skills
    return skills.filter(s =>
      s.name.toLowerCase().includes(q) ||
      s.skillId.toLowerCase().includes(q)
    )
  }, [skills, skillSearch])

  const resetCreateModal = () => {
    setShowCreate(false)
    setCreateForm(EMPTY_FORM)
    setSelectedUser(null)
    setUserSearch("")
    setSkillSearch("")
    setShowSkillDrop(false)
    setPhotoPreview(null)
    if (photoInputRef.current) photoInputRef.current.value = ""
  }

  const handleCreate = async () => {
    if (!createForm.skill_name.trim()) return
    if (!selectedUser) return
    if (createForm.isApproved === false && !createForm.rejection_reason.trim()) return
    try {
      setCreating(true)
      const ticket_number = await generateTicketNumber()
      await addDoc(collection(db, "user_requests"), {
        ...createForm,
        ticket_number,
        cert_photo_url: createForm.cert_photo_url.trim(),
        userId:    selectedUser.id,
        userName:  selectedUser.name,
        userEmail: selectedUser.email,
        createdAt: serverTimestamp(),
      })
      toast.success("Request created successfully")
      resetCreateModal()
    } catch (err) {
      console.error("Create failed:", err)
      toast.error("Failed to create request")
    } finally {
      setCreating(false)
    }
  }

  // ── Status badge helper ───────────────────────────────────────────────────

  const statusBadge = (isApproved: boolean | null | undefined) => {
    const status = deriveStatus(isApproved)
    const cls: Record<RequestStatus, string> = {
      pending:  "ur-badge ur-badge--pending",
      approved: "ur-badge ur-badge--approved",
      rejected: "ur-badge ur-badge--rejected",
    }
    return <span className={cls[status]}>{status}</span>
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
            <span className="ur-stat-value">{counts[k]}</span>
          </div>
        ))}
      </div>

      {/* Toolbar */}
      <div className="ur-toolbar">
        <div className="ur-search-wrap">
          <Search size={14} className="ur-search-icon" />
          <input
            className="ur-search-input"
            placeholder="Search by ticket, name, email, or skill..."
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
          value={filterType}
          onChange={e => setFilterType(e.target.value as RequestType | "")}
        >
          <option value="">All Types</option>
          <option value="skill">Skill</option>
          <option value="host_eligible_reward_skill">Host-Eligible Reward Skill</option>
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

        {/* <button className="ur-create-btn" onClick={() => setShowCreate(true)}>
          <Plus size={14} /> Create Request
        </button> */}

        <button className="ur-refresh-btn" onClick={() => setRefreshKey(k => k + 1)} title="Refresh">
          <RefreshCw size={14} />
        </button>
      </div>

      {/* Table */}
      <div className="admins-table-wrap">
        <table className="admins-table">
          <thead>
            <tr>
              <th>Ticket #</th>
              <th>Skill Name</th>
              <th>Request Type</th>
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
                  <td><span className="ur-ticket">{r.ticket_number}</span></td>
                  <td><div className="admin-name">{r.skill_name || "—"}</div></td>
                  <td>
                    <span className="ur-type-badge">
                      {REQUEST_TYPE_LABELS[r.request_type] ?? r.request_type ?? "—"}
                    </span>
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
                    {duplicateKeys.has(`${r.userId}::${r.skill_name?.toLowerCase()}::${r.request_type}`) && (
                      <span className="ur-dup-badge" title="Another request exists for this user + skill">duplicate</span>
                    )}
                  </td>
                  <td>
                    <div className="ur-status-cell">
                      {statusBadge(r.isApproved)}
                      {deriveStatus(r.isApproved) === "pending" && r.createdAt && (() => {
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
                    {deriveStatus(r.isApproved) !== "approved" && (
                      <button
                        className="icon-btn ur-approve-btn"
                        title="Approve"
                        onClick={() => handleApprove(r)}
                        disabled={mutatingId === r.id}
                      >
                        <Check size={13} />
                      </button>
                    )}
                    {deriveStatus(r.isApproved) !== "rejected" && (
                      <button
                        className="icon-btn danger"
                        title="Reject"
                        onClick={() => openRejectModal(r)}
                      >
                        <X size={13} />
                      </button>
                    )}
                    {deriveStatus(r.isApproved) !== "pending" && (
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
          <button
            className="ur-page-btn"
            onClick={() => setPage(1)}
            disabled={page === 1}
          >«</button>
          <button
            className="ur-page-btn"
            onClick={() => setPage(p => Math.max(1, p - 1))}
            disabled={page === 1}
          >‹</button>
          <span className="ur-page-info">
            Page {page} of {totalPages} &nbsp;·&nbsp; {filteredRequests.length} results
          </span>
          <button
            className="ur-page-btn"
            onClick={() => setPage(p => Math.min(totalPages, p + 1))}
            disabled={page === totalPages}
          >›</button>
          <button
            className="ur-page-btn"
            onClick={() => setPage(totalPages)}
            disabled={page === totalPages}
          >»</button>
        </div>

      {/* ── View modal ── */}
      <Modal open={!!viewItem} onClose={() => { setViewItem(null); setNoteText("") }} title="Request Details" size="lg">
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
                {statusBadge(viewItem.isApproved)}
              </div>
            </div>

            <hr className="ticket-modal-divider" />

            <div className="ur-detail-grid">
              <div className="ticket-modal-section">
                <span className="ticket-modal-label">Ticket #</span>
                <p className="ticket-modal-subject" style={{ fontSize: 14 }}>{viewItem.ticket_number}</p>
              </div>
              <div className="ticket-modal-section">
                <span className="ticket-modal-label">Request Type</span>
                <p className="ticket-modal-subject" style={{ fontSize: 14 }}>
                  {REQUEST_TYPE_LABELS[viewItem.request_type] ?? viewItem.request_type ?? "—"}
                </p>
              </div>
              <div className="ticket-modal-section">
                <span className="ticket-modal-label">Skill Name</span>
                <p className="ticket-modal-subject" style={{ fontSize: 14 }}>{viewItem.skill_name || "—"}</p>
              </div>
              <div className="ticket-modal-section">
                <span className="ticket-modal-label">User ID</span>
                <p className="ticket-modal-message" style={{ wordBreak: "break-all" }}>{viewItem.userId || "—"}</p>
              </div>
            </div>

            {viewItem.rejection_reason && (
              <>
                <hr className="ticket-modal-divider" />
                <div className="ticket-modal-section">
                  <span className="ticket-modal-label">Rejection Reason</span>
                  <p className="ticket-modal-message ur-rejection-text">{viewItem.rejection_reason}</p>
                </div>
              </>
            )}

            <hr className="ticket-modal-divider" />

            <div className="ticket-modal-section">
              <span className="ticket-modal-label">Certification Photo</span>
              {viewItem.cert_photo_url ? (
                <div className="ur-cert-wrap">
                  <img src={viewItem.cert_photo_url} alt="Certification" className="ur-cert-img" />
                  <a href={viewItem.cert_photo_url} target="_blank" rel="noopener noreferrer" className="ur-cert-link">
                    Open full image
                  </a>
                </div>
              ) : (
                <p className="ticket-modal-message">No photo provided.</p>
              )}
            </div>

            <hr className="ticket-modal-divider" />

            <div className="ticket-modal-footer">
              <span>User ID: {viewItem.userId || "—"}</span>
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
            {deriveStatus(viewItem.isApproved) === "pending" && (
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

            {deriveStatus(viewItem.isApproved) === "pending" && (
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
            {deriveStatus(viewItem.isApproved) !== "pending" && (
              <div className="ticket-modal-actions">
                <button
                  className="ticket-btn-cancel"
                  onClick={() => setViewItem(null)}
                >
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
        title="Reject Request"
        size="sm"
      >
        {rejectTarget && (
          <div className="ticket-modal">
            <div className="ticket-modal-section">
              <span className="ticket-modal-label">Request</span>
              <p className="ticket-modal-subject" style={{ fontSize: 14 }}>
                {rejectTarget.skill_name || rejectTarget.ticket_number}
              </p>
              <span className="ticket-modal-email">
                {rejectTarget.userName} · {REQUEST_TYPE_LABELS[rejectTarget.request_type] ?? rejectTarget.request_type}
              </span>
            </div>

            <hr className="ticket-modal-divider" />

            <div className="ticket-modal-section">
              <label className="ticket-modal-label" htmlFor="ur-rejection-reason">
                Rejection Reason <span style={{ color: "var(--red)" }}>*</span>
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

      {/* ── Create request modal ── */}
      <Modal
        open={showCreate}
        onClose={resetCreateModal}
        title="Create Request"
        size="md"
      >
        <div className="ticket-modal">

          {/* ── User search ── */}
          <div className="ticket-modal-section">
            <span className="ticket-modal-label">
              User <span style={{ color: "var(--red)" }}>*</span>
            </span>

            {selectedUser ? (
              /* Selected user card */
              <div className="ur-user-card">
                <div className="ur-user-card-avatar">{initials(selectedUser.name)}</div>
                <div className="ur-user-card-info">
                  <p className="ur-user-card-name">{selectedUser.name}</p>
                  <p className="ur-user-card-email">{selectedUser.email}</p>
                  <p className="ur-user-card-id">{selectedUser.id}</p>
                </div>
                <button className="ur-user-card-clear" onClick={clearUser} title="Remove user">
                  <X size={13} />
                </button>
              </div>
            ) : (
              /* Search input + dropdown */
              <div className="ur-user-search-wrap" ref={userWrapRef}>
                <div className="ur-user-search-field">
                  <User size={14} className="ur-user-search-icon" />
                  <input
                    className="ur-input ur-user-search-input"
                    placeholder="Search by User ID, name, or email..."
                    value={userSearch}
                    onChange={e => setUserSearch(e.target.value)}
                    onFocus={() => userResults.length > 0 && setShowUserDrop(true)}
                    autoComplete="off"
                  />
                  {userSearch && (
                    <button className="ur-search-clear ur-user-search-x" onClick={() => setUserSearch("")}>
                      <X size={12} />
                    </button>
                  )}
                </div>

                {(showUserDrop || searchingUser) && (
                  <div className="ur-user-dropdown">
                    {searchingUser ? (
                      <div className="ur-user-dd-empty">Searching...</div>
                    ) : userResults.length === 0 ? (
                      <div className="ur-user-dd-empty">No users found</div>
                    ) : (
                      userResults.map(u => (
                        <div key={u.id} className="ur-user-dd-item" onClick={() => selectUser(u)}>
                          <div className="ur-user-dd-avatar">{initials(u.name)}</div>
                          <div>
                            <p className="ur-user-dd-name">{u.name}</p>
                            <p className="ur-user-dd-email">{u.email}</p>
                            <p className="ur-user-dd-id">{u.id}</p>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          <hr className="ticket-modal-divider" />

          {/* ── Skill search ── */}
          <div className="ticket-modal-section">
            <label className="ticket-modal-label" htmlFor="ur-skill-search">
              Skill <span style={{ color: "var(--red)" }}>*</span>
            </label>
            <div className="ur-user-search-wrap" ref={skillWrapRef}>
              <div className="ur-user-search-field">
                <Search size={14} className="ur-user-search-icon" />
                <input
                  id="ur-skill-search"
                  className="ur-input ur-user-search-input"
                  placeholder={loadingSkills ? "Loading skills..." : "Search skills..."}
                  disabled={loadingSkills}
                  value={createForm.skill_name ? createForm.skill_name : skillSearch}
                  onChange={e => {
                    setSkillSearch(e.target.value)
                    setCreateForm(f => ({ ...f, skill_name: "" }))
                    setShowSkillDrop(true)
                  }}
                  onFocus={() => setShowSkillDrop(true)}
                  autoComplete="off"
                />
                {(createForm.skill_name || skillSearch) && (
                  <button
                    className="ur-search-clear ur-user-search-x"
                    onClick={() => {
                      setCreateForm(f => ({ ...f, skill_name: "" }))
                      setSkillSearch("")
                      setShowSkillDrop(false)
                    }}
                  >
                    <X size={12} />
                  </button>
                )}
              </div>

              {showSkillDrop && !createForm.skill_name && (
                <div className="ur-user-dropdown">
                  {filteredSkills.length === 0 ? (
                    <div className="ur-user-dd-empty">No skills found</div>
                  ) : (
                    filteredSkills.map(s => (
                      <div
                        key={s.id}
                        className="ur-skill-dd-item"
                        onClick={() => {
                          setCreateForm(f => ({ ...f, skill_name: s.name }))
                          setSkillSearch("")
                          setShowSkillDrop(false)
                        }}
                      >
                        <p className="ur-skill-dd-name">{s.name}</p>
                        <p className="ur-skill-dd-id">ID: {s.skillId}</p>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          </div>

          {/* ── Request type ── */}
          <div className="ticket-modal-section">
            <label className="ticket-modal-label" htmlFor="ur-request-type">Request Type</label>
            <select
              id="ur-request-type"
              className="ur-select"
              value={createForm.request_type}
              onChange={e => setCreateForm(f => ({ ...f, request_type: e.target.value as RequestType }))}
            >
              <option value="skill">Skill</option>
              <option value="host_eligible_reward_skill">Host-Eligible Reward Skill</option>
            </select>
          </div>

          {/* ── Photo upload (UI only) ── */}
          <div className="ticket-modal-section">
            <span className="ticket-modal-label">Certification Photo</span>
            <div
              className={`ur-upload-zone${photoPreview ? " ur-upload-zone--has-preview" : ""}`}
              onClick={() => photoInputRef.current?.click()}
            >
              {photoPreview ? (
                <>
                  <img src={photoPreview} alt="Preview" className="ur-upload-preview" />
                  <button
                    className="ur-upload-clear"
                    onClick={e => { e.stopPropagation(); clearPhoto() }}
                    title="Remove photo"
                  >
                    <X size={13} />
                  </button>
                </>
              ) : (
                <div className="ur-upload-placeholder">
                  <Upload size={20} className="ur-upload-icon" />
                  <p className="ur-upload-label">Click to upload photo</p>
                  <p className="ur-upload-hint">PNG, JPG, WEBP</p>
                </div>
              )}
            </div>
            <input
              ref={photoInputRef}
              type="file"
              accept="image/*"
              style={{ display: "none" }}
              onChange={handlePhotoChange}
            />
            <p className="ur-upload-note">Storage upload coming soon — preview only.</p>
            <div style={{ marginTop: 10 }}>
              <label className="ticket-modal-label" htmlFor="ur-cert-url" style={{ display: "block", marginBottom: 6 }}>
                Or paste photo URL
              </label>
              <input
                id="ur-cert-url"
                className="ur-input"
                placeholder="https://..."
                value={createForm.cert_photo_url}
                onChange={e => setCreateForm(f => ({ ...f, cert_photo_url: e.target.value }))}
              />
            </div>
          </div>

          <hr className="ticket-modal-divider" />

          {/* ── Approval status ── */}
          <div className="ticket-modal-section">
            <span className="ticket-modal-label">Approval Status</span>
            <div className="ur-status-options">
              {(["pending", "approved", "rejected"] as const).map(s => {
                const active =
                  s === "pending"  ? createForm.isApproved === null :
                  s === "approved" ? createForm.isApproved === true :
                                     createForm.isApproved === false
                return (
                  <button
                    key={s}
                    type="button"
                    className={`ur-status-option ur-status-option--${s}${active ? " ur-status-option--active" : ""}`}
                    onClick={() => {
                      const val = s === "pending" ? null : s === "approved" ? true : false
                      setCreateForm(f => ({
                        ...f,
                        isApproved: val,
                        rejection_reason: s !== "rejected" ? "" : f.rejection_reason,
                      }))
                    }}
                  >
                    {s.charAt(0).toUpperCase() + s.slice(1)}
                  </button>
                )
              })}
            </div>
          </div>

          {createForm.isApproved === false && (
            <div className="ticket-modal-section">
              <label className="ticket-modal-label" htmlFor="ur-create-rejection">
                Rejection Reason <span style={{ color: "var(--red)" }}>*</span>
              </label>
              <textarea
                id="ur-create-rejection"
                className="ur-textarea"
                placeholder="Explain why this request is being rejected..."
                rows={3}
                value={createForm.rejection_reason}
                onChange={e => setCreateForm(f => ({ ...f, rejection_reason: e.target.value }))}
              />
            </div>
          )}

          <hr className="ticket-modal-divider" />

          <div className="ticket-modal-actions">
            <button className="ticket-btn-cancel" onClick={resetCreateModal}>
              Cancel
            </button>
            <button
              className="ticket-btn-confirm"
              onClick={handleCreate}
              disabled={
                !createForm.skill_name.trim() ||
                !selectedUser ||
                (createForm.isApproved === false && !createForm.rejection_reason.trim()) ||
                creating
              }
            >
              {creating ? "Creating..." : "Create Request"}
            </button>
          </div>
        </div>
      </Modal>

    </div>
  )
}

export default UserRequests
