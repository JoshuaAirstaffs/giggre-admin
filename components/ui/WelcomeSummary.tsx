"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { X } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { usePendingVerifications } from "@/hooks/usePendingVerifications";
import { usePendingSkillRequests } from "@/hooks/usePendingSkillRequests";
import { usePendingGigPointsRequests, usePendingWalletRequests } from "@/hooks/usePendingGigPointsRequests";

// Set by the login page on sign-in, read (and cleared) by the first admin page
// that mounts — so the summary shows once per login, never on later pages.
const FRESH_LOGIN_KEY = "giggre:fresh-login";

// The page the summary belongs to: undefined = not checked yet this login,
// null = nothing to show. Kept in the module (not just component state) so
// React's dev double-mount doesn't consume the flag and then hide the banner.
let freshPath: string | null | undefined;

export function markFreshLogin() {
  freshPath = undefined;
  try { sessionStorage.setItem(FRESH_LOGIN_KEY, "1"); } catch { /* storage blocked */ }
}

export function clearFreshLogin() {
  try { sessionStorage.removeItem(FRESH_LOGIN_KEY); } catch { /* storage blocked */ }
}

/** True only on the first admin page opened after login. */
function takeFreshLogin(): boolean {
  const path = window.location.pathname;
  if (freshPath === undefined) {
    let fresh = false;
    try {
      fresh = sessionStorage.getItem(FRESH_LOGIN_KEY) === "1";
      sessionStorage.removeItem(FRESH_LOGIN_KEY);
    } catch { /* storage blocked */ }
    freshPath = fresh ? path : null;
  }
  if (freshPath !== path) freshPath = null; // moved on to another page
  return freshPath === path;
}

/**
 * "Welcome back" banner shown right after login, listing what's waiting for
 * review. Only counts modules the admin has access to; hidden when nothing is
 * pending. Counts stay live while it's open.
 */
export default function WelcomeSummary() {
  const { user, hasPermission } = useAuth();
  const [show, setShow] = useState(false);

  useEffect(() => setShow(takeFreshLogin()), []);

  const items = [
    { count: usePendingSkillRequests(show && hasPermission("library-gsin")), one: "skill request", many: "skill requests", href: "/user-skills?tab=requests" },
    { count: usePendingVerifications(show && hasPermission("verification")), one: "verification", many: "verifications", href: "/verification" },
    { count: usePendingWalletRequests(show && hasPermission("wallet")), one: "wallet request", many: "wallet requests", href: "/wallet" },
    { count: usePendingGigPointsRequests(show && hasPermission("gig-points")), one: "Gig Points request", many: "Gig Points requests", href: "/gig-points" },
  ].filter((i) => i.count > 0);

  if (!show || items.length === 0) return null;

  const firstName = user?.displayName?.split(" ")[0];

  return (
    <div className="ws-banner" role="status">
      <style>{`
        .ws-banner {
          display: flex; align-items: center; gap: 12px; flex-wrap: wrap;
          margin-bottom: 20px; padding: 12px 14px 12px 16px;
          background: var(--blue-dim); border: 1px solid var(--blue); border-radius: var(--radius-sm);
          font-size: 13px; color: var(--text-primary);
          animation: ws-in 0.25s ease-out;
        }
        @keyframes ws-in { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: none; } }
        .ws-text { flex: 1; min-width: 200px; line-height: 1.6; }
        .ws-hello { font-weight: 600; }
        .ws-links { display: inline-flex; flex-wrap: wrap; gap: 6px; margin-left: 4px; vertical-align: middle; }
        .ws-link {
          display: inline-flex; align-items: center; gap: 5px; padding: 2px 10px;
          font-size: 12px; font-weight: 600; text-decoration: none; border-radius: 999px;
          color: var(--blue); background: var(--bg-surface); border: 1px solid var(--blue);
          transition: background 0.15s, color 0.15s;
        }
        .ws-link:hover { background: var(--blue); color: #fff; }
        .ws-count { font-family: 'Space Mono', monospace; }
        .ws-x { background: none; border: none; color: var(--text-muted); cursor: pointer; padding: 2px; display: flex; }
        .ws-x:hover { color: var(--text-primary); }
      `}</style>

      <div className="ws-text">
        <span className="ws-hello">👋 Welcome back{firstName ? `, ${firstName}` : ""}.</span>{" "}
        Waiting for review:
        <span className="ws-links">
          {items.map((i) => (
            <Link key={i.href} href={i.href} className="ws-link">
              <span className="ws-count">{i.count}</span> {i.count === 1 ? i.one : i.many}
            </Link>
          ))}
        </span>
      </div>
      <button className="ws-x" onClick={() => { freshPath = null; setShow(false); }} aria-label="Dismiss">
        <X size={15} />
      </button>
    </div>
  );
}
