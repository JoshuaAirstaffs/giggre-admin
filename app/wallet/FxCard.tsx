"use client";

import { useState } from "react";
import { RefreshCw, Save, X } from "lucide-react";
import Button from "@/components/ui/Button";
import { toast } from "@/components/ui/Toaster";
import type { AdminUser } from "@/context/AuthContext";
import { callableError } from "@/lib/gigPoints";
import { refreshFxNow, saveFxOverride, useFx } from "@/lib/fx";
import { writeLog } from "@/lib/activitylog";

/** Live USD→PHP rate, with refresh and an optional manual override. */
export default function FxCard({ user, canEdit }: { user: AdminUser; canEdit: boolean }) {
  const fx = useFx();
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);

  const refresh = async () => {
    setBusy(true);
    try {
      const r = await refreshFxNow();
      toast.success("Rate updated", `1 USD = ${r.PHP} PHP (${r.source})`);
    } catch (err) {
      toast.error("Couldn't refresh", callableError(err));
    } finally {
      setBusy(false);
    }
  };

  const setOverride = async (php: number | null) => {
    setBusy(true);
    try {
      await saveFxOverride(php, user.uid);
      await writeLog({
        actorId: user.uid, actorName: user.displayName ?? user.email ?? "Unknown", actorEmail: user.email ?? undefined,
        module: "wallet", action: "wallet_settings_updated",
        description: php == null ? "Cleared the USD→PHP rate override (live rate in use)" : `Set the USD→PHP rate override to ${php}`,
        targetId: "general_config/fx_rates", targetName: "Exchange rate",
        meta: { from: fx.override, to: php },
      });
      setDraft("");
      toast.success(php == null ? "Using the live rate again" : "Override saved", "New requests use it right away.");
    } catch (err) {
      console.error("[fx] override", err);
      toast.error("Save failed", (err as { code?: string })?.code === "permission-denied"
        ? "Only super admins can override the rate (deploy firestore.rules from giggre_app if you are one)."
        : "Please try again.");
    } finally {
      setBusy(false);
    }
  };

  const val = Number(draft);
  const valid = /^\d+(\.\d{1,4})?$/.test(draft.trim()) && val > 0;

  return (
    <div className="gp-card" style={{ marginBottom: 16 }}>
      <div className="gp-head">
        <div>
          <div className="gp-title">Exchange rate (USD → PHP)</div>
          <div className="gp-hint">
            All Gig Points and Gig Wallet settings are in US dollars. Users in the Philippines see and use them converted to pesos at
            this rate, and a Send between a peso and a dollar wallet is converted too. The live rate updates every 6 hours; each request
            keeps the rate it was made at.
          </div>
        </div>
        <div className="gp-big" style={{ color: "var(--blue)" }}>
          {fx.loading ? "…" : fx.php ? `₱${fx.php.toFixed(2)}` : "—"}
          <small>per $1{fx.override ? " · override" : ""}</small>
        </div>
      </div>
      <div className="gp-note">
        {fx.live ? `Live: 1 USD = ${fx.live.toFixed(4)} PHP` : "No live rate yet — press Refresh now."}
        {fx.source ? ` · ${fx.source}` : ""}
        {fx.fetchedAt ? ` · updated ${fx.fetchedAt.toLocaleString()}` : ""}
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <Button size="sm" variant="secondary" icon={RefreshCw} loading={busy} onClick={refresh}>Refresh now</Button>
        {canEdit && (
          <>
            <input className="gp-input" style={{ maxWidth: 160 }} type="number" min={0.0001} step="0.0001" inputMode="decimal"
              placeholder="Override, e.g. 56.00" value={draft} onChange={(e) => setDraft(e.target.value)} disabled={busy} />
            <Button size="sm" icon={Save} disabled={!valid || busy} onClick={() => setOverride(Math.round(val * 10000) / 10000)}>Use this rate</Button>
            {fx.override != null && (
              <Button size="sm" variant="ghost" icon={X} disabled={busy} onClick={() => setOverride(null)}>Clear override</Button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
