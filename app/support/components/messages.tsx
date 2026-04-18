'use client'
import {
  collection, query, orderBy, addDoc,
  serverTimestamp, onSnapshot, doc,
  updateDoc, where, getDocs, writeBatch,
  limit, startAfter, QueryDocumentSnapshot,
  DocumentData, getDoc
} from 'firebase/firestore'
import { db } from '@/lib/firebase'
import './messagesStyle.css'
import { useEffect, useState, useRef, useCallback } from 'react'
import { CheckCheck } from 'lucide-react'

// ── Types ──────────────────────────────────────────────────────────────────────

interface Message {
  id: string
  text: string
  senderId: string
  name: string
  isSupport: boolean
  isAutoReply: boolean
  hasSeen: boolean
  hasSeenByAdmin: boolean
  createdAt: any
  pending?: boolean  // optimistic
}

interface ChatRoom {
  id: string
  name: string
  lastMessage: string
  lastMessageAt: any
  lastMessageSender: string
  sendTo: string
  subject: string
  status: string
  isSupport: boolean
}

// ── Constants ──────────────────────────────────────────────────────────────────
const ROOMS_PAGE  = 20
const MSGS_PAGE   = 20

// ── Component ──────────────────────────────────────────────────────────────────
const Messages = () => {
  // ── Rooms state ─────────────────────────────────────────────────────────────
  const [rooms, setRooms]               = useState<ChatRoom[]>([])
  const [loadingRooms, setLoadingRooms] = useState(true)
  const [loadingMoreRooms, setLoadingMoreRooms] = useState(false)
  const [hasMoreRooms, setHasMoreRooms] = useState(true)
  const lastRoomDocRef = useRef<QueryDocumentSnapshot<DocumentData> | null>(null)
  const roomUnsubRef   = useRef<(() => void) | null>(null)

  // ── Messages state ───────────────────────────────────────────────────────────
  const [selectedRoomId, setSelectedRoomId] = useState<string | null>(null)
  const [messages, setMessages]             = useState<Message[]>([])
  const [loadingMessages, setLoadingMessages]     = useState(false)
  const [loadingMoreMsgs, setLoadingMoreMsgs]     = useState(false)
  const [hasMoreMsgs, setHasMoreMsgs]             = useState(true)
  const oldestMsgDocRef  = useRef<QueryDocumentSnapshot<DocumentData> | null>(null)
  const msgUnsubRef      = useRef<(() => void) | null>(null)
  const newestMsgTimeRef = useRef<any>(null) // Firestore Timestamp cursor

  // ── Input state ──────────────────────────────────────────────────────────────
  const [message, setMessage] = useState('')
  const [sending, setSending] = useState(false)

  // ── Refs ─────────────────────────────────────────────────────────────────────
  const chatBodyRef  = useRef<HTMLDivElement>(null)
  const roomListRef  = useRef<HTMLDivElement>(null)
  const isAtBottomRef = useRef(true)

  const selectedRoom = rooms.find((r) => r.id === selectedRoomId) ?? null

  // ── Scroll helpers ───────────────────────────────────────────────────────────
  const scrollToBottom = useCallback((smooth = false) => {
    if (chatBodyRef.current) {
      chatBodyRef.current.scrollTo({
        top: chatBodyRef.current.scrollHeight,
        behavior: smooth ? 'smooth' : 'auto',
      })
    }
  }, [])

  const checkAtBottom = () => {
    if (!chatBodyRef.current) return
    const { scrollTop, scrollHeight, clientHeight } = chatBodyRef.current
    isAtBottomRef.current = scrollHeight - scrollTop - clientHeight < 80
  }

  // ── 1. Initial rooms load ────────────────────────────────────────────────────
  useEffect(() => {
    loadInitialRooms()
    return () => roomUnsubRef.current?.()
  }, [])

  const loadInitialRooms = () => {
    setLoadingRooms(true)
    roomUnsubRef.current?.()

    // Listen to only first page, sorted by lastMessageAt desc
    const q = query(
      collection(db, 'chat_rooms'),
      orderBy('lastMessageAt', 'desc'),
      limit(ROOMS_PAGE)
    )

    const unsub = onSnapshot(q, (snap) => {
      const docs = snap.docs
      const fetched: ChatRoom[] = docs.map((d) => ({
        id: d.id,
        ...(d.data() as Omit<ChatRoom, 'id'>),
      }))

      lastRoomDocRef.current = docs[docs.length - 1] ?? null
      setHasMoreRooms(docs.length === ROOMS_PAGE)
      setRooms(fetched)
      setLoadingRooms(false)

      // Auto-select first room once
      setSelectedRoomId((prev) => {
        if (prev) return prev
        const firstId = fetched[0]?.id
        if (firstId) markRoomSeen(firstId)
        return firstId ?? null
      })
    })

    roomUnsubRef.current = unsub
  }

  // ── 2. Load more rooms (scroll down in sidebar) ──────────────────────────────
  const loadMoreRooms = useCallback(async () => {
    if (loadingMoreRooms || !hasMoreRooms || !lastRoomDocRef.current) return
    setLoadingMoreRooms(true)
    try {
      const snap = await getDocs(
        query(
          collection(db, 'chat_rooms'),
          orderBy('lastMessageAt', 'desc'),
          startAfter(lastRoomDocRef.current),
          limit(ROOMS_PAGE)
        )
      )
      const fetched: ChatRoom[] = snap.docs.map((d) => ({
        id: d.id,
        ...(d.data() as Omit<ChatRoom, 'id'>),
      }))
      lastRoomDocRef.current = snap.docs[snap.docs.length - 1] ?? lastRoomDocRef.current
      setHasMoreRooms(snap.docs.length === ROOMS_PAGE)
      setRooms((prev) => {
        const existingIds = new Set(prev.map((r) => r.id))
        return [...prev, ...fetched.filter((r) => !existingIds.has(r.id))]
      })
    } catch (e) {
      console.error('Load more rooms error:', e)
    } finally {
      setLoadingMoreRooms(false)
    }
  }, [loadingMoreRooms, hasMoreRooms])

  // ── Sidebar scroll → load more rooms ────────────────────────────────────────
  const onRoomListScroll = () => {
    const el = roomListRef.current
    if (!el) return
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 60) loadMoreRooms()
  }

  // ── 3. Load initial messages when room selected ──────────────────────────────
  useEffect(() => {
    if (!selectedRoomId) return
    loadInitialMessages(selectedRoomId)
    return () => msgUnsubRef.current?.()
  }, [selectedRoomId])

  const loadInitialMessages = (roomId: string) => {
    setLoadingMessages(true)
    setMessages([])
    setHasMoreMsgs(true)
    oldestMsgDocRef.current  = null
    newestMsgTimeRef.current = null
    msgUnsubRef.current?.()

    // Fetch newest MSGS_PAGE messages
    getDocs(
      query(
        collection(db, 'chat_rooms', roomId, 'messages'),
        orderBy('createdAt', 'desc'),
        limit(MSGS_PAGE)
      )
    ).then((snap) => {
      const docs = [...snap.docs].reverse() // oldest → newest
      const fetched: Message[] = docs.map((d) => ({
        id: d.id,
        ...(d.data() as Omit<Message, 'id'>),
      }))

      oldestMsgDocRef.current  = docs[0] ?? null
      newestMsgTimeRef.current = fetched[fetched.length - 1]?.createdAt ?? null
      setHasMoreMsgs(snap.docs.length === MSGS_PAGE)
      setMessages(fetched)
      setLoadingMessages(false)

      // Start live stream for new messages only
      startIncomingStream(roomId)
    }).catch((e) => {
      console.error('Initial messages error:', e)
      setLoadingMessages(false)
    })
  }

  // ── 4. Live stream for new messages (incoming from support / own confirms) ───
  const startIncomingStream = (roomId: string) => {
    let q = query(
      collection(db, 'chat_rooms', roomId, 'messages'),
      orderBy('createdAt', 'asc')
    )

    if (newestMsgTimeRef.current) {
      q = query(
        collection(db, 'chat_rooms', roomId, 'messages'),
        orderBy('createdAt', 'asc'),
        where('createdAt', '>', newestMsgTimeRef.current)
      )
    }

    const unsub = onSnapshot(q, (snap) => {
      if (snap.empty) return
      let changed = false

      setMessages((prev) => {
        let updated = [...prev]
        for (const change of snap.docChanges()) {
          const msg: Message = { id: change.doc.id, ...(change.doc.data() as Omit<Message, 'id'>) }

          if (change.type === 'added') {
            const exists = updated.some((m) => m.id === msg.id)
            if (exists) continue

            // Replace matching optimistic message
            const optimisticIdx = updated.findIndex(
              (m) => m.pending && m.isSupport && m.text === msg.text
            )
            if (optimisticIdx !== -1) {
              updated[optimisticIdx] = msg
              changed = true
              continue
            }

            // New message from user side
            if (!msg.isSupport) {
              updated = [...updated, msg]
              changed = true
            }
          } else if (change.type === 'modified') {
            const idx = updated.findIndex((m) => m.id === msg.id)
            if (idx !== -1) { updated[idx] = msg; changed = true }
          }
        }
        return changed ? updated : prev
      })

      if (changed && isAtBottomRef.current) {
        setTimeout(() => scrollToBottom(true), 50)
      }
    })

    msgUnsubRef.current = unsub
  }

  // ── 5. Load older messages (scroll to top) ───────────────────────────────────
  const loadMoreMessages = useCallback(async () => {
    if (loadingMoreMsgs || !hasMoreMsgs || !selectedRoomId || !oldestMsgDocRef.current) return
    setLoadingMoreMsgs(true)

    const prevScrollHeight = chatBodyRef.current?.scrollHeight ?? 0

    try {
      const snap = await getDocs(
        query(
          collection(db, 'chat_rooms', selectedRoomId, 'messages'),
          orderBy('createdAt', 'desc'),
          startAfter(oldestMsgDocRef.current),
          limit(MSGS_PAGE)
        )
      )
      const docs = [...snap.docs].reverse()
      const fetched: Message[] = docs.map((d) => ({
        id: d.id,
        ...(d.data() as Omit<Message, 'id'>),
      }))

      oldestMsgDocRef.current = docs[0] ?? oldestMsgDocRef.current
      setHasMoreMsgs(snap.docs.length === MSGS_PAGE)
      setMessages((prev) => {
        const existingIds = new Set(prev.map((m) => m.id))
        return [...fetched.filter((m) => !existingIds.has(m.id)), ...prev]
      })

      // Preserve scroll position after prepend
      requestAnimationFrame(() => {
        if (chatBodyRef.current) {
          chatBodyRef.current.scrollTop =
            chatBodyRef.current.scrollHeight - prevScrollHeight
        }
      })
    } catch (e) {
      console.error('Load more messages error:', e)
    } finally {
      setLoadingMoreMsgs(false)
    }
  }, [loadingMoreMsgs, hasMoreMsgs, selectedRoomId])

  // ── Chat body scroll → load more messages ────────────────────────────────────
  const onChatBodyScroll = () => {
    checkAtBottom()
    if (chatBodyRef.current && chatBodyRef.current.scrollTop <= 60) {
      loadMoreMessages()
    }
  }

  // ── Auto-scroll to bottom when entering a room ───────────────────────────────
  const didInitialScrollRef = useRef(false)
  useEffect(() => {
    if (!selectedRoomId) return
    // Reset flag every time room changes
    didInitialScrollRef.current = false
  }, [selectedRoomId])

  useEffect(() => {
    if (loadingMessages || messages.length === 0 || didInitialScrollRef.current) return
    if (!chatBodyRef.current) return

    const el = chatBodyRef.current
    let lastScrollHeight = 0
    let stableCount = 0

    // Keep scrolling to bottom until scrollHeight stops changing
    // (i.e. all content including HTML/images has fully rendered)
    const observer = new ResizeObserver(() => {
      el.scrollTop = el.scrollHeight
      if (el.scrollHeight === lastScrollHeight) {
        stableCount++
        if (stableCount >= 3) {
          didInitialScrollRef.current = true
          observer.disconnect()
        }
      } else {
        stableCount = 0
        lastScrollHeight = el.scrollHeight
      }
    })
    observer.observe(el)

    const fallback = setTimeout(() => {
      el.scrollTop = el.scrollHeight
      didInitialScrollRef.current = true
      observer.disconnect()
    }, 1000)

    return () => {
      observer.disconnect()
      clearTimeout(fallback)
    }
  }, [loadingMessages, messages])

  // ── Auto-mark incoming messages as seen ──────────────────────────────────────
  useEffect(() => {
    if (!selectedRoomId || messages.length === 0) return
    const unread = messages.filter((m) => !m.isSupport && !m.hasSeenByAdmin && !m.pending)
    if (unread.length === 0) return
    const batch = writeBatch(db)
    unread.forEach((m) =>
      batch.update(doc(db, 'chat_rooms', selectedRoomId, 'messages', m.id), {
        hasSeenByAdmin: true,
      })
    )
    batch.commit().catch((e) => console.error('Auto-mark seen error:', e))
  }, [messages, selectedRoomId])

  // ── Mark room seen on select ─────────────────────────────────────────────────
  const markRoomSeen = async (roomId: string) => {
    try {
      await updateDoc(doc(db, 'chat_rooms', roomId), { hasSeenByAdmin: true })
      const unreadSnap = await getDocs(
        query(
          collection(db, 'chat_rooms', roomId, 'messages'),
          where('isSupport', '==', false),
          where('hasSeenByAdmin', '==', false)
        )
      )
      if (!unreadSnap.empty) {
        const batch = writeBatch(db)
        unreadSnap.docs.forEach((d) => batch.update(d.ref, { hasSeenByAdmin: true }))
        await batch.commit()
      }
    } catch (e) {
      console.error('markRoomSeen error:', e)
    }
  }

  const onSelectRoom = (roomId: string) => {
    setSelectedRoomId(roomId)
    markRoomSeen(roomId)
  }

  // ── Send message (optimistic) ─────────────────────────────────────────────────
  const sendMessage = async () => {
    if (!message.trim() || !selectedRoomId || sending) return
    const text = message.trim()
    setMessage('')
    setSending(true)

    // Optimistic bubble
    const tempId = `temp_${Date.now()}`
    const optimistic: Message = {
      id: tempId,
      text,
      senderId: 'support',
      name: 'Giggre Support',
      isSupport: true,
      isAutoReply: false,
      hasSeen: false,
      hasSeenByAdmin: true,
      createdAt: null,
      pending: true,
    }
    setMessages((prev) => [...prev, optimistic])
    setTimeout(() => scrollToBottom(true), 50)

    try {
      const docRef = await addDoc(
        collection(db, 'chat_rooms', selectedRoomId, 'messages'),
        {
          text,
          senderId: 'support',
          name: 'Giggre Support',
          isSupport: true,
          isAutoReply: false,
          hasSeen: false,
          hasSeenByAdmin: true,
          createdAt: serverTimestamp(),
        }
      )

      await updateDoc(doc(db, 'chat_rooms', selectedRoomId), {
        lastMessage: text,
        lastMessageSender: 'Support',
        lastMessageAt: serverTimestamp(),
      })

      // Confirm optimistic → real
      setMessages((prev) =>
        prev.map((m) =>
          m.id === tempId ? { ...m, id: docRef.id, pending: false } : m
        )
      )
    } catch (e) {
      console.error('Send error:', e)
      setMessages((prev) => prev.filter((m) => m.id !== tempId))
    } finally {
      setSending(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage()
    }
  }

  // ── Format time ───────────────────────────────────────────────────────────────
  const formatTime = (timestamp: any): string => {
    if (!timestamp) return ''
    const date: Date = timestamp.toDate?.() ?? new Date(timestamp)
    const now = new Date()
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    const msgDay = new Date(date.getFullYear(), date.getMonth(), date.getDate())
    const diffDays = Math.round((today.getTime() - msgDay.getTime()) / 86_400_000)
    const timeStr = date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    if (diffDays === 0) return timeStr
    if (diffDays === 1) return `Yesterday ${timeStr}`
    if (diffDays < 7) return `${date.toLocaleDateString([], { weekday: 'short' })} ${timeStr}`
    return `${date.toLocaleDateString([], { month: 'short', day: 'numeric' })} ${timeStr}`
  }

  // ── Render ────────────────────────────────────────────────────────────────────
  if (loadingRooms) return <p className="messages-loading">Loading chats...</p>

  return (
    <div className="messages-container">

      {/* ── Sidebar ── */}
      <div className="messages-sidebar">
        <div className="messages-sidebar-header">
          <h2>Chats</h2>
        </div>
        <div
          className="messages-room-list"
          ref={roomListRef}
          onScroll={onRoomListScroll}
        >
          {rooms.map((room) => (
            <div
              key={room.id}
              className={`messages-room-item ${selectedRoomId === room.id ? 'active' : ''}`}
              onClick={() => onSelectRoom(room.id)}
            >
              {room.isSupport && <span className="messages-badge">Support</span>}
              <p className="messages-room-name">{room.name || room.id}</p>
              <p className="messages-room-preview">
                {room.lastMessageSender === 'You' ? `${room.name}: ` : ''}
                <span dangerouslySetInnerHTML={{ __html: room.lastMessage }} />
              </p>
            </div>
          ))}
          {loadingMoreRooms && (
            <p className="messages-loading-more">Loading more chats...</p>
          )}
          {!hasMoreRooms && rooms.length > 0 && (
            <p className="messages-end-label">No more chats</p>
          )}
        </div>
      </div>

      {/* ── Chat content ── */}
      <div className="messages-content">
        {selectedRoom ? (
          <>
            <div className="messages-content-header">
              <h3>{selectedRoom.name || selectedRoom.id}</h3>
              <span>Subject: {selectedRoom.subject} · {selectedRoom.status}</span>
            </div>

            <div
              className="messages-chat-body"
              ref={chatBodyRef}
              onScroll={onChatBodyScroll}
            >
              {/* Load more spinner at top */}
              {loadingMoreMsgs && (
                <div className="messages-load-more-spinner">
                  <span className="messages-send-spinner" />
                </div>
              )}

              {loadingMessages ? (
                <p className="messages-empty">Loading messages...</p>
              ) : messages.length === 0 ? (
                <p className="messages-empty">No messages yet.</p>
              ) : (
                messages.map((msg) => (
                  <div
                    key={msg.id}
                    className={`messages-bubble ${msg.isSupport ? 'outgoing' : 'incoming'} ${msg.pending ? 'pending' : ''}`}
                  >
                    {!msg.isSupport && (
                      <span className="messages-bubble-name">{msg.name}</span>
                    )}
                    <p dangerouslySetInnerHTML={{ __html: msg.text }} />
                    <span className="messages-time">
                      {msg.pending ? '...' : formatTime(msg.createdAt)}
                      {msg.hasSeen && !msg.pending && (
                        <CheckCheck
                          size={14}
                          style={{ display: 'inline', marginLeft: 4, verticalAlign: 'middle' }}
                          color="white"
                        />
                      )}
                    </span>
                  </div>
                ))
              )}
            </div>

            {/* ── Input bar ── */}
            <div className="messages-input-bar">
              <input
                type="text"
                className="messages-input"
                placeholder="Type a message..."
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                onKeyDown={handleKeyDown}
                disabled={sending}
              />
              <button
                className="messages-send-btn"
                onClick={sendMessage}
                disabled={!message.trim() || sending}
              >
                {sending ? (
                  <span className="messages-send-spinner" />
                ) : (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="22" y1="2" x2="11" y2="13" />
                    <polygon points="22 2 15 22 11 13 2 9 22 2" />
                  </svg>
                )}
              </button>
            </div>
          </>
        ) : (
          <div className="messages-empty-state">
            <p>Select a chat to view messages</p>
          </div>
        )}
      </div>
    </div>
  )
}

export default Messages