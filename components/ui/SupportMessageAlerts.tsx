"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { collection, limit, onSnapshot, orderBy, query } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/context/AuthContext";
import { toast } from "@/components/ui/Toaster";
import { playNotifSound } from "@/lib/notifSound";

// Support chats live in chat_rooms next to user-to-user gig chats (those carry
// a `participants` array). The app sets lastMessageSender to "You" when the
// user writes and "Support" for our replies / auto-replies.
const WATCHED_ROOMS = 20;

// Module-level so a page change (every page renders its own AdminLayout)
// doesn't treat the current rooms as new: roomId → lastMessageAt (ms).
let seen: { uid: string; at: Map<string, number> } | null = null;

/**
 * Pops up + chimes when a user sends a new support message, on any admin page.
 * On the Support page itself it only chimes — the conversation list already
 * shows the message.
 */
export default function SupportMessageAlerts() {
  const { user, hasPermission } = useAuth();
  const router = useRouter();
  const enabled = !!user && hasPermission("reports");

  useEffect(() => {
    if (!enabled || !user) return;
    const q = query(collection(db, "chat_rooms"), orderBy("lastMessageAt", "desc"), limit(WATCHED_ROOMS));
    return onSnapshot(
      q,
      (snap) => {
        const rooms = snap.docs
          .filter((d) => !Array.isArray(d.data().participants))
          .map((d) => {
            const data = d.data();
            const at = data.lastMessageAt?.toMillis?.() ?? 0;
            return { id: d.id, at, data };
          });

        if (seen?.uid !== user.uid) {
          seen = { uid: user.uid, at: new Map(rooms.map((r) => [r.id, r.at])) };
          return;
        }
        const known = seen.at;
        const fresh = rooms.filter((r) => r.at > (known.get(r.id) ?? 0) && r.data.lastMessageSender === "You");
        rooms.forEach((r) => known.set(r.id, Math.max(r.at, known.get(r.id) ?? 0)));
        if (fresh.length === 0) return;

        playNotifSound();
        if (window.location.pathname.startsWith("/support")) return;
        fresh.slice(0, 3).forEach((r) => {
          const name = (r.data.name as string) || "A user";
          const text = (r.data.lastMessage as string) || "Sent a message";
          toast.notify(`New support message from ${name}`, text, () => router.push("/support"));
        });
      },
      (err) => console.warn("[SupportMessageAlerts]", err.code ?? err),
    );
  }, [enabled, user, router]);

  return null;
}
