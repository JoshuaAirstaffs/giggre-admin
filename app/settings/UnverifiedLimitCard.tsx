"use client";

import { useEffect, useState } from "react";
import { doc, getDoc, serverTimestamp, setDoc } from "firebase/firestore";
import { RefreshCw, Save, ShieldAlert } from "lucide-react";
import { db } from "@/lib/firebase";
import { toast } from "@/components/ui/Toaster";
import type { AdminUser } from "@/context/AuthContext";
import { writeLog } from "@/lib/activitylog";
import { useFx, phpHint } from "@/lib/fx";
import { fmtMoney } from "@/lib/gigPoints";

// general_config/unverified_limits — see giggre_app/functions/src/unverifiedLimits.ts.
// Unverified users can transact (as worker: paid; as host: paid out) up to
// maxUsd in total; then the app asks them to verify before they can apply
// for, accept or post more gigs.
const LIMIT_DOC = doc(db, "general_config", "unverified_limits");

export default function UnverifiedLimitCard({ user, canEdit }: { user: AdminUser; canEdit: boolean }) {
  const fx = useFx();
  const [enabled, setEnabled] = useState(false);
  const [max, setMax] = useState("");
  const [saved, setSaved] = useState<{ enabled: boolean; maxUsd: number | null } | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    getDoc(LIMIT_DOC).then((snap) => {
      const d = snap.data() ?? {};
      const m = typeof d.maxUsd === "number" && d.maxUsd > 0 ? d.maxUsd : null;
      setEnabled(d.enabled === true);
      setMax(m == null ? "" : String(m));
      setSaved({ enabled: d.enabled === true, maxUsd: m });
    }).catch(() => setSaved({ enabled: false, maxUsd: null }));
  }, []);

  const value = max.trim() === "" ? null : /^\d+(\.\d{1,2})?$/.test(max.trim()) && Number(max) > 0 ? Number(max) : NaN;
  const invalid = Number.isNaN(value) || (enabled && value == null);
  const dirty = !!saved && (saved.enabled !== enabled || saved.maxUsd !== value);

  const save = async () => {
    if (invalid || value === undefined) return;
    setSaving(true);
    const next = { enabled, maxUsd: Number.isNaN(value) ? null : value };
    try {
      await setDoc(LIMIT_DOC, { ...next, updatedAt: serverTimestamp(), updatedBy: user.uid });
      await writeLog({
        actorId: user.uid, actorName: user.displayName ?? user.email ?? "Unknown", actorEmail: user.email ?? undefined,
        module: "settings", action: "settings_updated",
        description: next.enabled
          ? `Set the unverified account limit to ${fmtMoney(next.maxUsd ?? 0)} total`
          : "Turned off the unverified account limit",
        targetId: "general_config/unverified_limits", targetName: "Unverified account limit",
        meta: { from: saved, to: next },
      });
      setSaved(next);
      toast.success("Saved", "Unverified account limit updated");
    } catch (err) {
      toast.error("Save failed", (err as { code?: string })?.code === "permission-denied"
        ? "Only super admins can change this (deploy firestore.rules from giggre_app if you are one)."
        : "Please try again");
    } finally {
      setSaving(false);
    }
  };

  const row: React.CSSProperties = { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, padding: "11px 0", borderBottom: "1px solid var(--border-muted)" };
  const label: React.CSSProperties = { fontSize: 13, fontWeight: 600, color: "var(--text-primary)" };
  const sub: React.CSSProperties = { fontSize: 11.5, color: "var(--text-muted)", marginTop: 2 };

  return (
    <div style={{ background: "var(--bg-surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 9, padding: "14px 18px", borderBottom: "1px solid var(--border)" }}>
        <span style={{ color: "var(--amber)", display: "flex" }}><ShieldAlert size={15} /></span>
        <span style={{ fontSize: 12.5, fontWeight: 700, color: "var(--text-primary)", letterSpacing: 0.2 }}>Unverified Account Limit</span>
      </div>
      <div style={{ padding: 18 }}>
        {!saved ? (
          <div style={{ fontSize: 12.5, color: "var(--text-muted)" }}>Loading…</div>
        ) : (
          <>
            <div style={row}>
              <div>
                <div style={label}>Limit unverified accounts</div>
                <div style={sub}>Applies to everything a user does on gigs — what they earn as a Gig Worker and what they pay as a Gig Host — counted in total until they verify.</div>
              </div>
              <button type="button" disabled={!canEdit} onClick={() => setEnabled(!enabled)}
                style={{ width: 40, height: 22, borderRadius: 11, border: "none", cursor: canEdit ? "pointer" : "not-allowed", background: enabled ? "var(--green)" : "var(--bg-elevated)", outline: "2px solid " + (enabled ? "var(--green)" : "var(--border)"), outlineOffset: -2, position: "relative", flexShrink: 0 }}>
                <span style={{ position: "absolute", top: 3, left: enabled ? 21 : 3, width: 16, height: 16, borderRadius: "50%", background: "#fff", transition: "left 0.2s", display: "block" }} />
              </button>
            </div>
            <div style={{ ...row, borderBottom: "none" }}>
              <div>
                <div style={label}>Maximum total (USD)</div>
                <div style={sub}>
                  When a user reaches this, the app asks them to verify and they can&apos;t apply for, accept or post gigs until they do.
                  Users in the Philippines get it in pesos at the live rate{value && !Number.isNaN(value) && fx.php ? ` (${phpHint(value, fx)})` : ""}.
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
                <span style={{ fontSize: 12, color: "var(--text-muted)" }}>$</span>
                <input type="number" min={0.01} step="0.01" inputMode="decimal" value={max} disabled={!canEdit}
                  onChange={(e) => setMax(e.target.value)} placeholder="e.g. 100"
                  style={{ width: 110, padding: "5px 8px", background: "var(--bg-elevated)", border: `1px solid ${Number.isNaN(value) ? "var(--red)" : "var(--border)"}`, borderRadius: "var(--radius-sm)", color: "var(--text-primary)", fontSize: 13, fontFamily: "inherit", textAlign: "right" }} />
              </div>
            </div>
            {invalid && <div style={{ fontSize: 12, color: "var(--red)" }}>{enabled && value == null ? "Enter the maximum to turn the limit on." : "Use an amount above $0 with up to 2 decimals."}</div>}
            {!canEdit && <p style={{ fontSize: 11.5, color: "var(--text-muted)", margin: "10px 0 0" }}>Only super admins can change this.</p>}
            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 16 }}>
              <button onClick={save} disabled={saving || invalid || !dirty || !canEdit}
                style={{ display: "flex", alignItems: "center", gap: 7, padding: "8px 18px", background: "var(--blue)", border: "none", borderRadius: "var(--radius-sm)", color: "#fff", fontSize: 13, fontWeight: 600, fontFamily: "inherit", cursor: saving || invalid || !dirty ? "not-allowed" : "pointer", opacity: saving || invalid || !dirty ? 0.6 : 1 }}>
                {saving ? <RefreshCw size={13} style={{ animation: "spin 0.8s linear infinite" }} /> : <Save size={13} />}
                {saving ? "Saving…" : "Save Changes"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
