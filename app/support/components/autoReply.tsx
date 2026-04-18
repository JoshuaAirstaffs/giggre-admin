'use client'
import { useState, useEffect } from 'react'
import { BellRing, BellOff, Sparkles } from 'lucide-react'
import './autoReplyStyle.css'
import RichTextEditor from '@/components/ui/RichTextEditor'
import { getDoc, setDoc, doc } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { toast } from '@/components/ui/Toaster'

const SETTINGS_DOC = doc(db, 'support_settings', 'qGDefSx1JYdx86VxlznN')

const DEFAULT_MESSAGE = `Hello 👋<div><br></div><div>Thank you for reaching out to our support team. We've received your ticket and want to let you know that our admin team is currently reviewing all incoming messages.</div><div><br></div><div>Due to the high volume of tickets, please allow us a few hours to 1 business day to get back to you with a proper response.</div><div><br></div><div>We appreciate your patience!</div><div><br></div><div>— Support Team</div>`

const AutoReply = () => {
    const [enabled, setEnabled] = useState(true)
    const [message, setMessage] = useState('')
    const [loading, setLoading] = useState(true)
    const [saving, setSaving] = useState(false)

    useEffect(() => {
        fetchAutoReplySettings()
    }, [])

    const fetchAutoReplySettings = async () => {
        try {
            const snap = await getDoc(SETTINGS_DOC)
            if (snap.exists()) {
                const data = snap.data()
                setMessage(data.auto_reply_message || '')
                setEnabled(data.enabled_auto_reply ?? true)
            }
        } catch (error) {
            console.error('Error fetching auto reply settings:', error)
        } finally {
            setLoading(false)
        }
    }

    const saveAutoReplySettings = async () => {
        setSaving(true)
        try {
            // merge: true preserves any other fields in the document
            await setDoc(SETTINGS_DOC, {
                auto_reply_message: message,
                enabled_auto_reply: enabled,
            }, { merge: true })
            toast.success('Auto reply settings saved successfully')
        } catch (error) {
            console.error('Error saving auto reply settings:', error)
            toast.error('Failed to save auto reply settings')
        } finally {
            setSaving(false)
        }
    }

    const handleToggle = async () => {
        const next = !enabled
        setEnabled(next)
        // persist toggle immediately without waiting for Save
        try {
            await setDoc(SETTINGS_DOC, { enabled_auto_reply: next }, { merge: true })
        } catch (error) {
            console.error('Error toggling auto reply:', error)
            setEnabled(!next) // revert on failure
        }
    }

    const handleResetDefault = () => {
        setMessage(DEFAULT_MESSAGE)
    }

    if (loading) return <p className="auto-reply-loading">Loading settings...</p>

    return (
        <div className="auto-reply">
            <div className="header">
                <div className="icon">
                    <Sparkles />
                </div>
                <div>
                    <div className='title-header'>Auto Reply</div>
                    <p className='description-header'>Automatically reply to users in first message</p>
                </div>
            </div>

            <p className='auto-reply-info'>
                Auto reply is only set once - on the very first message a user sends to you. If the ticket already has existing messages, auto reply will not be sent.
            </p>

            <div className={`auto-reply-switcher-container ${enabled ? 'on' : 'off'}`}>
                <div className="auto-reply-switcher-sub-container">
                    {enabled
                        ? <BellRing className="icon-bell on" />
                        : <BellOff className="icon-bell off" />
                    }
                    <div>
                        <div className={`auto-reply-title ${enabled ? 'on' : 'off'}`}>
                            Auto Reply is {enabled ? 'ON' : 'OFF'}
                        </div>
                        <div className='auto-reply-description'>
                            {enabled
                                ? 'User receives automated response on their first message'
                                : 'Users will not receive an automated response'
                            }
                        </div>
                    </div>
                </div>

                <button
                    className={`toggle ${enabled ? 'on' : 'off'}`}
                    onClick={handleToggle}
                    aria-label="Toggle auto reply"
                >
                    <span className="toggle-thumb" />
                </button>
            </div>

            <div className='auto-reply-message-container'>
                <div className='auto-reply-message-sub-container'>
                    <p>Auto Reply Message</p>
                    <button onClick={handleResetDefault}>Reset Default</button>
                </div>
                <div className='auto-reply-message-editor-container'>
                    <RichTextEditor
                        value={message}
                        onChange={(value) => setMessage(value)}
                    />
                    <button
                        className='save-btn'
                        onClick={saveAutoReplySettings}
                        disabled={saving}
                    >
                        {saving ? 'Saving...' : 'Save'}
                    </button>
                </div>
            </div>
        </div>
    )
}

export default AutoReply