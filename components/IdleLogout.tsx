"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { auth } from "@/lib/firebase";
import Modal from "@/components/ui/Modal";
import Button from "@/components/ui/Button";
import { toast } from "@/components/ui/Toaster";
import { signOutWithReason, recentLogoutReason, LOGOUT_MESSAGES } from "@/lib/sessionLogout";

// ─── Session limits ───────────────────────────────────────────────────────────
//
// 1. Inactivity: signs the admin out after IDLE_TIMEOUT_MS with no mouse,
//    keyboard, scroll or touch activity, with a countdown for the last WARNING_MS.
// 2. Maximum session: signs out MAX_SESSION_MS after the actual sign-in, even
//    for an admin who stayed active, with a heads-up MAX_SESSION_NOTICE_MS early.
//    Measured from Firebase's lastSignInTime, which survives page reloads and
//    browser restarts (token refreshes don't touch it).
//
// (Deactivated / removed admins are signed out by AuthContext's live listener.)
//
// The last-activity time lives in localStorage so every open admin tab shares
// it: working in one tab keeps the others signed in, and Firebase's own
// cross-tab auth sync carries the sign-out to every tab. It also survives a
// closed browser, so coming back to a session that went idle long ago signs
// out right away instead of resuming it.

const IDLE_TIMEOUT_MS = 10 * 60 * 1000;
const WARNING_MS = 60 * 1000;
const CHECK_EVERY_MS = 1000;
const WRITE_THROTTLE_MS = 5000;
const MAX_SESSION_MS = 12 * 60 * 60 * 1000;
const MAX_SESSION_NOTICE_MS = 5 * 60 * 1000;

const ACTIVITY_KEY = "giggre-admin:lastActivity";

const ACTIVITY_EVENTS = ["mousemove", "mousedown", "keydown", "wheel", "touchstart", "scroll"] as const;

function readNumber(key: string): number | null {
  try {
    const v = Number(localStorage.getItem(key));
    return Number.isFinite(v) && v > 0 ? v : null;
  } catch {
    return null;
  }
}

function write(key: string, value: number | null) {
  try {
    if (value == null) localStorage.removeItem(key);
    else localStorage.setItem(key, String(value));
  } catch {
    // storage blocked (private mode etc.) — the in-memory fallback still works per tab
  }
}

export default function IdleLogout() {
  const { user, loading } = useAuth();
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);

  // In-memory copy, used when localStorage is unavailable
  const lastActivity = useRef(Date.now());
  const lastWrite = useRef(0);
  const signingOut = useRef(false);
  const wasSignedIn = useRef(false);
  const expiryNoticeShown = useRef(false);

  const markActive = useCallback((force = false) => {
    const now = Date.now();
    lastActivity.current = now;
    if (force || now - lastWrite.current > WRITE_THROTTLE_MS) {
      lastWrite.current = now;
      write(ACTIVITY_KEY, now);
    }
  }, []);

  const lastActive = () => Math.max(lastActivity.current, readNumber(ACTIVITY_KEY) ?? 0);

  // ── Session start / end bookkeeping ────────────────────────────────────────
  useEffect(() => {
    if (loading) return;

    if (user) {
      wasSignedIn.current = true;
      signingOut.current = false;
      expiryNoticeShown.current = false;
      // Fresh sign-in has no stored time yet; a restored session keeps its old
      // one, so a session left idle while the browser was closed still expires.
      const stored = readNumber(ACTIVITY_KEY);
      if (stored == null) markActive(true);
      else lastActivity.current = stored;
      return;
    }

    // Signed out (by us, the sidebar, or another tab)
    setSecondsLeft(null);
    write(ACTIVITY_KEY, null);
    if (wasSignedIn.current) {
      const reason = recentLogoutReason();
      if (reason) toast.info(LOGOUT_MESSAGES[reason].title, LOGOUT_MESSAGES[reason].message);
    }
    wasSignedIn.current = false;
  }, [user, loading, markActive]);

  // ── Activity listeners + idle check ────────────────────────────────────────
  useEffect(() => {
    if (!user) return;

    const onActivity = () => markActive();
    const onVisible = () => {
      if (document.visibilityState === "visible") check();
    };

    const signOut = (reason: "idle" | "expired") => {
      signingOut.current = true;
      setSecondsLeft(null);
      signOutWithReason(reason).catch((err) => {
        console.error("[IdleLogout] sign-out failed:", err);
        signingOut.current = false;
      });
    };

    const check = () => {
      if (signingOut.current) return;
      const now = Date.now();

      // Maximum session length
      const signedInAt = Date.parse(auth.currentUser?.metadata.lastSignInTime ?? "");
      if (Number.isFinite(signedInAt)) {
        const sessionLeft = signedInAt + MAX_SESSION_MS - now;
        if (sessionLeft <= 0) {
          signOut("expired");
          return;
        }
        if (sessionLeft <= MAX_SESSION_NOTICE_MS && !expiryNoticeShown.current) {
          expiryNoticeShown.current = true;
          toast.warning(
            "Your session ends soon",
            `You'll be signed out in ${Math.ceil(sessionLeft / 60_000)} min — save your work.`
          );
        }
      }

      // Inactivity
      const idleFor = now - lastActive();
      if (idleFor >= IDLE_TIMEOUT_MS) {
        signOut("idle");
      } else if (idleFor >= IDLE_TIMEOUT_MS - WARNING_MS) {
        setSecondsLeft(Math.ceil((IDLE_TIMEOUT_MS - idleFor) / 1000));
      } else {
        setSecondsLeft(null);
      }
    };

    ACTIVITY_EVENTS.forEach((e) => window.addEventListener(e, onActivity, { passive: true, capture: true }));
    document.addEventListener("visibilitychange", onVisible);
    check();
    const timer = window.setInterval(check, CHECK_EVERY_MS);

    return () => {
      ACTIVITY_EVENTS.forEach((e) => window.removeEventListener(e, onActivity, { capture: true }));
      document.removeEventListener("visibilitychange", onVisible);
      window.clearInterval(timer);
    };
  }, [user, markActive]);

  const staySignedIn = () => {
    markActive(true);
    setSecondsLeft(null);
  };

  const signOutNow = () => {
    signingOut.current = true;
    setSecondsLeft(null);
    auth.signOut();
  };

  return (
    <Modal
      open={user != null && secondsLeft != null}
      onClose={staySignedIn}
      title="Are you still there?"
      description="You've been inactive for a while."
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={signOutNow}>Sign out</Button>
          <Button onClick={staySignedIn}>Stay signed in</Button>
        </>
      }
    >
      <p style={{ fontSize: 14, color: "var(--text-secondary)", lineHeight: 1.5 }}>
        For security, you&apos;ll be signed out in{" "}
        <b style={{ color: "var(--text-primary)", fontFamily: "'Space Mono', monospace" }}>{secondsLeft}s</b>.
      </p>
    </Modal>
  );
}
