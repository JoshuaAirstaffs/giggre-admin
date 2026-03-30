'use client'
import {
  collection, query, orderBy, addDoc,
  serverTimestamp, onSnapshot, doc
} from 'firebase/firestore'
import { db } from '@/lib/firebase'
import './messagesStyle.css'
import { useEffect, useState, useRef } from 'react'

interface Message {
  id: string
  text: string
  senderId: string
  name: string
  isSupport: boolean
  isAutoReply: boolean
  hasSeen: boolean
  createdAt: any
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
  messages: Message[]
}

const Messages = () => {
  const [chatRooms, setChatRooms] = useState<ChatRoom[]>([])
  const [selectedRoomId, setSelectedRoomId] = useState<string | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [loadingRooms, setLoadingRooms] = useState(true)
  const [loadingMessages, setLoadingMessages] = useState(false)
  const [message, setMessage] = useState('')
  const [sending, setSending] = useState(false)
  const chatBodyRef = useRef<HTMLDivElement>(null)

  const selectedRoom = chatRooms.find((r) => r.id === selectedRoomId) ?? null

  const scrollToBottom = () => {
    if (chatBodyRef.current) {
      chatBodyRef.current.scrollTop = chatBodyRef.current.scrollHeight
    }
  }

  // ── 1. Realtime listener for chat_rooms list ──
  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'chat_rooms'), (snap) => {
      const rooms = snap.docs.map((d) => ({
        ...(d.data() as Omit<ChatRoom, 'id' | 'messages'>),
        id: d.id,
        messages: [],
      })) as ChatRoom[]

      // Sort by lastMessageAt descending
      rooms.sort((a, b) => {
        const aTime = a.lastMessageAt?.toMillis?.() ?? 0
        const bTime = b.lastMessageAt?.toMillis?.() ?? 0
        return bTime - aTime
      })

      setChatRooms(rooms)

      // Auto-select first room on initial load only
      setSelectedRoomId((prev) => prev ?? (rooms[0]?.id || null))
      setLoadingRooms(false)
    })

    return () => unsub()
  }, [])

  // ── 2. Realtime listener for selected room's messages ──
  useEffect(() => {
    if (!selectedRoomId) return

    setLoadingMessages(true)
    setMessages([])

    const q = query(
      collection(db, 'chat_rooms', selectedRoomId, 'messages'),
      orderBy('createdAt', 'asc')
    )

    const unsub = onSnapshot(q, (snap) => {
      const msgs = snap.docs.map((d) => ({
        id: d.id,
        ...d.data(),
      })) as Message[]

      setMessages(msgs)
      setLoadingMessages(false)
      // Scroll after messages render
      setTimeout(scrollToBottom, 50)
    })

    return () => unsub()
  }, [selectedRoomId])

  const sendMessage = async () => {
    if (!message.trim() || !selectedRoomId || sending) return

    setSending(true)
    try {
      await addDoc(
        collection(db, 'chat_rooms', selectedRoomId, 'messages'),
        {
          text: message.trim(),
          senderId: 'support',
          name: 'Giggre Support',
          isSupport: true,
          isAutoReply: false,
          hasSeen: false,
          createdAt: serverTimestamp(),
        }
      )
      // No optimistic update needed — onSnapshot will pick it up automatically
      setMessage('')
    } catch (error) {
      console.error('Error sending message:', error)
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

  const formatTime = (timestamp: any) => {
    if (!timestamp) return ''
    const date = timestamp.toDate?.() ?? new Date(timestamp)
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  }

  if (loadingRooms) return <p className="messages-loading">Loading chats...</p>

  return (
    <div className="messages-container">

      {/* ── Sidebar ── */}
      <div className="messages-sidebar">
        <div className="messages-sidebar-header">
          <h2>Chats</h2>
        </div>
        <div className="messages-room-list">
          {chatRooms.map((room) => (
            <div
              key={room.id}
              className={`messages-room-item ${selectedRoomId === room.id ? 'active' : ''}`}
              onClick={() => setSelectedRoomId(room.id)}
            >
              {room.isSupport && <span className="messages-badge">Support</span>}
              <p className="messages-room-name">{room.name || room.id}</p>
              <p className="messages-room-preview">
                {room.lastMessageSender === 'You' ? `${room.name}: ` : ''}
                <span dangerouslySetInnerHTML={{ __html: room.lastMessage }} />
              </p>
            </div>
          ))}
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

            <div className="messages-chat-body" ref={chatBodyRef}>
              {loadingMessages ? (
                <p className="messages-empty">Loading messages...</p>
              ) : messages.length === 0 ? (
                <p className="messages-empty">No messages yet.</p>
              ) : (
                messages.map((msg) => (
                  <div
                    key={msg.id}
                    className={`messages-bubble ${msg.isSupport ? 'outgoing' : 'incoming'}`}
                  >
                    {!msg.isSupport && (
                      <span className="messages-bubble-name">{msg.name}</span>
                    )}
                    <p dangerouslySetInnerHTML={{ __html: msg.text }} />
                    <span className="messages-time">{formatTime(msg.createdAt)}</span>
                  </div>
                ))
              )}
            </div>

            {/* ── Send form ── */}
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