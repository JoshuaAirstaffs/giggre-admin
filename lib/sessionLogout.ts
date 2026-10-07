import { auth } from "@/lib/firebase";

// ─── Automatic sign-outs ──────────────────────────────────────────────────────
//
// Why the admin was signed out, kept in localStorage just long enough for the
// login screen (in this tab and any other open admin tab) to explain it.

export type LogoutReason = "idle" | "expired" | "revoked";

const REASON_KEY = "giggre-admin:logoutReason";
const REASON_TTL_MS = 15_000;

export const LOGOUT_MESSAGES: Record<LogoutReason, { title: string; message: string }> = {
  idle:    { title: "Signed out due to inactivity", message: "Please sign in again to continue." },
  expired: { title: "Your session has expired",     message: "For security, please sign in again." },
  revoked: { title: "Your admin access was changed", message: "Your account was deactivated or removed. Contact a super admin if this is unexpected." },
};

export function signOutWithReason(reason: LogoutReason) {
  try {
    localStorage.setItem(REASON_KEY, JSON.stringify({ reason, at: Date.now() }));
  } catch {
    // storage blocked — sign-out still happens, just without the explanation
  }
  return auth.signOut();
}

/** The reason for a sign-out that just happened, if any. */
export function recentLogoutReason(): LogoutReason | null {
  try {
    const raw = localStorage.getItem(REASON_KEY);
    if (!raw) return null;
    const { reason, at } = JSON.parse(raw) as { reason: LogoutReason; at: number };
    return Date.now() - at < REASON_TTL_MS && reason in LOGOUT_MESSAGES ? reason : null;
  } catch {
    return null;
  }
}
