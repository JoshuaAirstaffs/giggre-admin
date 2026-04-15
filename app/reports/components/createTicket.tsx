"use client"
import { useState, useRef, useEffect } from "react"
import { Users, Trash2, Pencil } from "lucide-react"
import {
  collection,
  query,
  where,
  getDocs,
  orderBy,
  limit,
  doc,
  getDoc,
  arrayUnion,
  updateDoc,
  addDoc,
  serverTimestamp,
} from "firebase/firestore"
import { db } from "@/lib/firebase"
import "./createTicketStyle.css"
import Modal from "@/components/ui/Modal"
import RichTextEditor from "@/components/ui/RichTextEditor"
import { generateTicketNumber } from "../utils/generateTicketNumber"

interface User {
  id: string
  name: string
  email: string
}

interface Template {
  title: string
  message: string
}

const SUPPORT_SETTINGS_ID = "qGDefSx1JYdx86VxlznN"

const CreateTicket = () => {
  const [sendToAll, setSendToAll] = useState(true)
  const [selectedUsers, setSelectedUsers] = useState<User[]>([])
  const [searchQuery, setSearchQuery] = useState("")
  const [results, setResults] = useState<User[]>([])
  const [showDropdown, setShowDropdown] = useState(false)
  const [searching, setSearching] = useState(false)
  const [subject, setSubject] = useState("")
  const [selectedMessage, setSelectedMessage] = useState("")
  const [templates, setTemplates] = useState<Template[]>([])
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null)

  // add template modal
  const [showAddTemplateModal, setShowAddTemplateModal] = useState(false)
  const [addTemplateForm, setAddTemplateForm] = useState({ title: "", message: "" })

  // edit template modal
  const [showEditTemplateModal, setShowEditTemplateModal] = useState(false)
  const [editTemplateForm, setEditTemplateForm] = useState({ title: "", message: "" })
  const [editingIndex, setEditingIndex] = useState<number | null>(null)

  // loading states
  const [isSending, setIsSending] = useState(false)
  const [isSavingTemplate, setIsSavingTemplate] = useState(false)
  const [isEditingTemplate, setIsEditingTemplate] = useState(false)

  const wrapRef = useRef<HTMLDivElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // ── Live Firestore user search ──────────────────────────────────────────────
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)

    if (!searchQuery.trim()) {
      setResults([])
      setShowDropdown(false)
      setSearching(false)
      return
    }

    setSearching(true)

    debounceRef.current = setTimeout(async () => {
      try {
        const lower = searchQuery.trim().toLowerCase()
        const end = lower + "\uf8ff"

        const nameSnap = await getDocs(
          query(
            collection(db, "users"),
            where("name", ">=", searchQuery.trim()),
            where("name", "<=", searchQuery.trim() + "\uf8ff"),
            orderBy("name"),
            limit(10)
          )
        )

        const emailSnap = await getDocs(
          query(
            collection(db, "users"),
            where("email", ">=", lower),
            where("email", "<=", end),
            orderBy("email"),
            limit(10)
          )
        )

        const seen = new Set<string>()
        const merged: User[] = []

        for (const snap of [nameSnap, emailSnap]) {
          for (const d of snap.docs) {
            const data = d.data()
            if (!seen.has(d.id) && !selectedUsers.find(u => u.id === d.id)) {
              seen.add(d.id)
              merged.push({ id: d.id, name: data.name ?? "", email: data.email ?? "" })
            }
          }
        }

        setResults(merged)
        setShowDropdown(merged.length > 0)
      } catch (err) {
        console.error("User search failed:", err)
        setResults([])
        setShowDropdown(false)
      } finally {
        setSearching(false)
      }
    }, 300)

    return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
  }, [searchQuery, selectedUsers])

  // ── Close dropdown on outside click ────────────────────────────────────────
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node))
        setShowDropdown(false)
    }
    document.addEventListener("mousedown", handler)
    return () => document.removeEventListener("mousedown", handler)
  }, [])

  // ── Fetch templates on mount ────────────────────────────────────────────────
  useEffect(() => { fetchTemplates() }, [])

  // ── Handlers ────────────────────────────────────────────────────────────────
  const fetchTemplates = async () => {
    try {
      const snap = await getDoc(doc(db, "support_settings", SUPPORT_SETTINGS_ID))
      const data = snap.data()
      if (data?.template?.length > 0) setTemplates(data?.template || [])
    } catch (error) {
      console.error("Failed to fetch templates:", error)
    }
  }

  const saveTemplate = async () => {
    setIsSavingTemplate(true)
    try {
      await updateDoc(doc(db, "support_settings", SUPPORT_SETTINGS_ID), {
        template: arrayUnion({
          title: addTemplateForm.title,
          message: addTemplateForm.message,
        }),
      })
      setShowAddTemplateModal(false)
      setAddTemplateForm({ title: "", message: "" })
      fetchTemplates()
    } catch (error) {
      console.error("Failed to save template:", error)
    } finally {
      setIsSavingTemplate(false)
    }
  }

  const openEditModal = (index: number) => {
    setEditingIndex(index)
    setEditTemplateForm({
      title: templates[index].title,
      message: templates[index].message,
    })
    setShowEditTemplateModal(true)
  }

  const saveEditTemplate = async () => {
    if (editingIndex === null) return
    setIsEditingTemplate(true)
    try {
      const updated = templates.map((t, i) =>
        i === editingIndex
          ? { title: editTemplateForm.title, message: editTemplateForm.message }
          : t
      )
      await updateDoc(doc(db, "support_settings", SUPPORT_SETTINGS_ID), {
        template: updated,
      })
      setTemplates(updated)
      setShowEditTemplateModal(false)
      setEditingIndex(null)
      setEditTemplateForm({ title: "", message: "" })
    } catch (error) {
      console.error("Failed to edit template:", error)
    } finally {
      setIsEditingTemplate(false)
    }
  }

  const deleteTemplate = async (index: number) => {
    try {
      const updated = templates.filter((_, i) => i !== index)
      await updateDoc(doc(db, "support_settings", SUPPORT_SETTINGS_ID), {
        template: updated,
      })
      setTemplates(updated)
    } catch (error) {
      console.error("Failed to delete template:", error)
    }
  }

  const sendTicket = async () => {
    if (!subject.trim() || !selectedMessage.trim()) return
    if (!sendToAll && selectedUsers.length === 0) return

    setIsSending(true)
    try {
      const ticketNumber = await generateTicketNumber()
      const base = {
        source: "admin",
        subject: subject.trim(),
        message: selectedMessage.trim(),
        createdBy: null, // TODO: replace with currentAdmin.uid
        status: "open",
        hasSeen: false, //for user
        hasSeenByAdmin: true, //for admin
        roomId: null,
        createdAt: serverTimestamp(),
        userId: null,
        name: null,
        email: null,
        ticketNumber,
      }

      if (sendToAll) {
        await addDoc(collection(db, "support_tickets"), {
          ...base,
          recipientType: "all",
          recipients: [],
        })
      } else {
        await addDoc(collection(db, "support_tickets"), {
          ...base,
          recipientType: "specific",
          recipients: selectedUsers.map(u => u.id),
        })
      }

      setSubject("")
      setSelectedMessage("")
      setSelectedUsers([])
      setSendToAll(true)
    } catch (error) {
      console.error("Failed to send ticket:", error)
    } finally {
      setIsSending(false)
    }
  }

  const addUser = (user: User) => {
    setSelectedUsers(prev => [...prev, user])
    setSearchQuery("")
    setShowDropdown(false)
  }

  const removeUser = (id: string) =>
    setSelectedUsers(prev => prev.filter(u => u.id !== id))

  const initials = (name: string) =>
    name.split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase()

  const canSend =
    subject.trim() &&
    selectedMessage.trim() &&
    (sendToAll || selectedUsers.length > 0)

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div className="create-ticket">

      {/* Send to all users switcher */}
      <div className="ct-section">
        <div className="ct-switcher-row">
          <div className="ct-switcher-left">
            <div className="ct-switcher-icon">
              <Users size={20} />
            </div>
            <div>
              <p className="ct-switcher-label">Send to all users</p>
              <p className="ct-switcher-sub">
                {sendToAll
                  ? "Ticket will be sent to all registered users"
                  : "Choose specific users to receive this ticket"}
              </p>
            </div>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={sendToAll}
            className={`ct-toggle ${sendToAll ? "ct-toggle--on" : ""}`}
            onClick={() => setSendToAll(v => !v)}
          >
            <span className="ct-toggle-thumb" />
          </button>
        </div>
      </div>

      {/* Specific user selector */}
      {!sendToAll && (
        <div className="ct-section">
          <p className="ct-field-label">
            Select users <span className="ct-required">*</span>
          </p>
          <div
            className="ct-chip-wrap"
            ref={wrapRef}
            onClick={() => document.getElementById("ct-user-input")?.focus()}
          >
            {selectedUsers.map(u => (
              <span key={u.id} className="ct-chip">
                <span className="ct-chip-avatar">{initials(u.name)}</span>
                {u.name}
                <button
                  type="button"
                  className="ct-chip-remove"
                  onClick={e => { e.stopPropagation(); removeUser(u.id) }}
                  aria-label={`Remove ${u.name}`}
                >
                  &#10005;
                </button>
              </span>
            ))}
            <input
              id="ct-user-input"
              className="ct-chip-input"
              placeholder={selectedUsers.length ? "" : "Search by name or email..."}
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              onKeyDown={e => e.key === "Escape" && setShowDropdown(false)}
              autoComplete="off"
            />
            {(showDropdown || searching) && (
              <div className="ct-dropdown">
                {searching ? (
                  <div className="ct-dd-empty">Searching...</div>
                ) : results.length === 0 ? (
                  <div className="ct-dd-empty">No users found</div>
                ) : (
                  results.map(u => (
                    <div key={u.id} className="ct-dd-item" onClick={() => addUser(u)}>
                      <span className="ct-dd-avatar">{initials(u.name)}</span>
                      <div>
                        <p className="ct-dd-name">{u.name}</p>
                        <p className="ct-dd-email">{u.email}</p>
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
          {selectedUsers.length > 0 && (
            <p className="ct-count">
              {selectedUsers.length} user{selectedUsers.length > 1 ? "s" : ""} selected
            </p>
          )}
        </div>
      )}

      {/* Form */}
      <div className="create-ticket-form-container">
        <input
          id="ct-subject-input"
          className="ct-subject-input"
          placeholder="Input Subject"
          value={subject}
          onChange={e => setSubject(e.target.value)}
          autoComplete="off"
        />

        <div className="ct-templates-container">
          <div className="ct-template-header">
            <p>Quick Templates</p>
            <button
              className="ct-add-template-btn"
              onClick={() => setShowAddTemplateModal(true)}
            >
              + Add Template
            </button>
          </div>
          <div className="ct-template-items-container">
            {templates.map((template, index) => (
              <div
                key={index}
                className={`ct-template-item ${selectedMessage === template.message ? "ct-template-item--active" : ""}`}
                onClick={() => setSelectedMessage(template.message)}
                onMouseEnter={() => setHoveredIndex(index)}
                onMouseLeave={() => setHoveredIndex(null)}
              >
                <p>{template.title}</p>
                {hoveredIndex === index && (
                  <div className="ct-template-actions">
                    <button
                      className="ct-template-edit-btn"
                      onClick={e => { e.stopPropagation(); openEditModal(index) }}
                      aria-label="Edit template"
                    >
                      <Pencil size={13} />
                    </button>
                    <button
                      className="ct-template-delete-btn"
                      onClick={e => { e.stopPropagation(); deleteTemplate(index) }}
                      aria-label="Delete template"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        <div className="ct-message-container">
          <RichTextEditor
            value={selectedMessage}
            onChange={setSelectedMessage}
            placeholder="Input Message"
          />
        </div>

        <div className="ct-actions-container">
          <button
            className="ct-send-btn"
            onClick={sendTicket}
            disabled={!canSend || isSending}
          >
            {isSending ? "Sending..." : "Send"}
          </button>
        </div>
      </div>

      {/* Add Template Modal */}
      <Modal
        open={showAddTemplateModal}
        onClose={() => setShowAddTemplateModal(false)}
        title="Add Template"
      >
        <div>
          <input
            id="ct-template-name-input"
            className="ct-template-name-input"
            placeholder="Input Template Name"
            value={addTemplateForm.title}
            onChange={e => setAddTemplateForm({ ...addTemplateForm, title: e.target.value })}
            autoComplete="off"
          />
          <br />
          <RichTextEditor
            value={addTemplateForm.message}
            onChange={value => setAddTemplateForm({ ...addTemplateForm, message: value })}
          />
        </div>
        <button
          className="ct-save-template-btn"
          disabled={!addTemplateForm.title || !addTemplateForm.message || isSavingTemplate}
          onClick={saveTemplate}
        >
          {isSavingTemplate ? "Saving..." : "Save Template"}
        </button>
      </Modal>

      {/* Edit Template Modal */}
      <Modal
        open={showEditTemplateModal}
        onClose={() => {
          setShowEditTemplateModal(false)
          setEditingIndex(null)
          setEditTemplateForm({ title: "", message: "" })
        }}
        title="Edit Template"
      >
        <div>
          <input
            className="ct-template-name-input"
            placeholder="Input Template Name"
            value={editTemplateForm.title}
            onChange={e => setEditTemplateForm({ ...editTemplateForm, title: e.target.value })}
            autoComplete="off"
          />
          <br />
          <RichTextEditor
            value={editTemplateForm.message}
            onChange={value => setEditTemplateForm({ ...editTemplateForm, message: value })}
          />
        </div>
        <button
          className="ct-save-template-btn"
          disabled={!editTemplateForm.title || !editTemplateForm.message || isEditingTemplate}
          onClick={saveEditTemplate}
        >
          {isEditingTemplate ? "Saving..." : "Save Changes"}
        </button>
      </Modal>

    </div>
  )
}

export default CreateTicket