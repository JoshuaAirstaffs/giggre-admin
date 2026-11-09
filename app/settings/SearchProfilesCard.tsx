"use client";

import { useState } from "react";
import { getFunctions, httpsCallable } from "firebase/functions";
import { RefreshCw, UserSearch } from "lucide-react";
import app from "@/lib/firebase";
import { toast } from "@/components/ui/Toaster";
import { ConfirmDialog } from "@/components/ui/Modal";
import type { AdminUser } from "@/context/AuthContext";
import { writeLog } from "@/lib/activitylog";
import { FUNCTIONS_REGION } from "@/lib/gigPoints";

// The app's user search reads publicProfiles/{uid} (name, photo, verification,
// rating averages), which giggre_app/functions/src/directMessages.ts keeps in
// sync on every users/{uid} write. Users from before that function existed have
// no entry until their doc next changes; backfillPublicProfiles writes one for
// every user, 400 per call, returning a cursor until done. Safe to re-run.
interface Page { written: number; cursor: string | null; done: boolean }

const backfillCall = (data: { startAfter?: string }) =>
  httpsCallable<typeof data, Page>(getFunctions(app, FUNCTIONS_REGION), "backfillPublicProfiles")(data).then((r) => r.data);

const errMsg = (err: unknown) => {
  const e = err as { code?: string; message?: string };
  if (e?.code === "functions/not-found") return "Deploy backfillPublicProfiles from giggre_app first.";
  if (e?.code === "functions/permission-denied") return "Only active admins can run this.";
  return e?.message || "Please try again";
};

export default function SearchProfilesCard({ user, canEdit }: { user: AdminUser; canEdit: boolean }) {
  const [confirm, setConfirm] = useState(false);
  const [running, setRunning] = useState(false);
  const [written, setWritten] = useState<number | null>(null);

  const run = async () => {
    setConfirm(false);
    setRunning(true);
    setWritten(0);
    let total = 0;
    try {
      let startAfter: string | undefined;
      for (;;) {
        const page = await backfillCall(startAfter ? { startAfter } : {});
        total += page.written;
        setWritten(total);
        if (page.done || !page.cursor) break;
        startAfter = page.cursor;
      }
      await writeLog({
        actorId: user.uid, actorName: user.displayName ?? user.email ?? "Unknown", actorEmail: user.email ?? undefined,
        module: "settings", action: "settings_updated",
        description: `Rebuilt search profiles for ${total} user${total === 1 ? "" : "s"}`,
        targetId: "publicProfiles", targetName: "User search profiles",
      });
      toast.success("Search profiles rebuilt", `${total} user${total === 1 ? "" : "s"} can now be found in the app's search`);
    } catch (err) {
      toast.error(total ? `Stopped after ${total} users` : "Rebuild failed", errMsg(err));
    } finally {
      setRunning(false);
    }
  };

  const label: React.CSSProperties = { fontSize: 13, fontWeight: 600, color: "var(--text-primary)" };
  const sub: React.CSSProperties = { fontSize: 11.5, color: "var(--text-muted)", marginTop: 2 };
  const disabled = !canEdit || running;

  return (
    <div style={{ background: "var(--bg-surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 9, padding: "14px 18px", borderBottom: "1px solid var(--border)" }}>
        <span style={{ color: "var(--blue)", display: "flex" }}><UserSearch size={15} /></span>
        <span style={{ fontSize: 12.5, fontWeight: 700, color: "var(--text-primary)", letterSpacing: 0.2 }}>User Search</span>
      </div>
      <div style={{ padding: 18 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16 }}>
          <div>
            <div style={label}>Rebuild search profiles</div>
            <div style={sub}>
              Makes every user findable in the app&apos;s people search. New and edited profiles are added automatically —
              run this once after deploying search, or if someone can&apos;t be found. Users who turned off
              &ldquo;Let others find me&rdquo; stay hidden.
            </div>
          </div>
          <button type="button" disabled={disabled} onClick={() => setConfirm(true)}
            style={{ display: "flex", alignItems: "center", gap: 7, padding: "8px 16px", background: "var(--blue)", border: "none", borderRadius: "var(--radius-sm)", color: "#fff", fontSize: 13, fontWeight: 600, fontFamily: "inherit", cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.6 : 1, whiteSpace: "nowrap", flexShrink: 0 }}>
            <RefreshCw size={13} style={running ? { animation: "spin 0.8s linear infinite" } : undefined} />
            {running ? `Rebuilding… ${written ?? 0}` : "Rebuild"}
          </button>
        </div>
        {!running && written !== null && (
          <p style={{ fontSize: 12, color: "var(--text-secondary)", margin: "10px 0 0" }}>Last run: {written} user{written === 1 ? "" : "s"} updated.</p>
        )}
        {!canEdit && <p style={{ fontSize: 11.5, color: "var(--text-muted)", margin: "10px 0 0" }}>Only super admins can run this.</p>}
      </div>
      <ConfirmDialog open={confirm} onClose={() => setConfirm(false)} onConfirm={run}
        title="Rebuild search profiles?" confirmLabel="Rebuild"
        message="Every user's search entry is rewritten from their profile (one database write per user). People who opted out of search stay hidden." />
    </div>
  );
}
