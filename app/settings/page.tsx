"use client";

import { useState, useEffect, useCallback } from "react";
import AdminLayout from "@/components/layout/AdminLayout";
import { useAuthGuard } from "@/hooks/useAuthGuard";
import { db } from "@/lib/firebase";
import { doc, getDoc, setDoc, serverTimestamp } from "firebase/firestore";
import { writeLog, buildDescription } from "@/lib/activitylog";
import { toast } from "@/components/ui/Toaster";
import {
  Shield,
  Percent,
  Eye,
  AlertTriangle,
  Save,
  RefreshCw,
  Calendar,
  MessageSquare,
  Timer,
} from "lucide-react";

// ─── Firestore doc refs ───────────────────────────────────────────────────────

const DOCS = {
  maintenance:        doc(db, "general_config", "maintenance"),
  platformCommission: doc(db, "general_config", "platform_commission_rules"),
  gigVisibility:      doc(db, "general_config", "gig_visibility_rules"),
  gigExpiry:          doc(db, "general_config", "gigExpiry"),
};

// ─── Types ────────────────────────────────────────────────────────────────────

interface MaintenanceConfig {
  enabled: boolean;
  startDate: string;   // ISO date string "YYYY-MM-DDTHH:mm"
  endDate: string;
  message: string;
}

interface CommissionConfig {
  offeredGig: number;
  openGig: number;
  quickGig: number;
  minPayoutThreshold: number;
  processingFee: number;
  cancellationPenalty: number;
  minBudgetPerGig: number;
}

interface GigExpiryConfig {
  open_gigs: number;
  quick_gigs: number;
  offered_gigs: number;
}

interface VisibilityConfig {
  autoHideEnabled: boolean;
  autoHideAfterDays: number;
  autoCancelEnabled: boolean;
  autoCancelAfterDays: number;
  expiryWarningDays: number;
  maxGigsPerUserPerDay: number;
}

// ─── Defaults ─────────────────────────────────────────────────────────────────

const D_MAINT: MaintenanceConfig = {
  enabled: false,
  startDate: "",
  endDate: "",
  message: "We're currently performing scheduled maintenance. Please check back shortly.",
};

const D_COMM: CommissionConfig = {
  offeredGig: 10,
  openGig: 10,
  quickGig: 5,
  minPayoutThreshold: 500,
  processingFee: 2.5,
  cancellationPenalty: 50,
  minBudgetPerGig: 100,
};

const D_EXPIRY: GigExpiryConfig = {
  open_gigs: 480,
  quick_gigs: 480,
  offered_gigs: 480,
};

const D_VIS: VisibilityConfig = {
  autoHideEnabled: false,
  autoHideAfterDays: 30,
  autoCancelEnabled: false,
  autoCancelAfterDays: 7,
  expiryWarningDays: 3,
  maxGigsPerUserPerDay: 5,
};

// ─── UI Helpers ───────────────────────────────────────────────────────────────

function SectionCard({
  icon,
  title,
  accent,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  accent: string;
  children: React.ReactNode;
}) {
  return (
    <div style={{ background: "var(--bg-surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 9, padding: "14px 18px", borderBottom: "1px solid var(--border)" }}>
        <span style={{ color: accent, display: "flex", alignItems: "center" }}>{icon}</span>
        <span style={{ fontSize: 12.5, fontWeight: 700, color: "var(--text-primary)", letterSpacing: 0.2 }}>{title}</span>
      </div>
      <div style={{ padding: "18px" }}>{children}</div>
    </div>
  );
}

function Toggle({ checked, onChange, disabled }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={() => !disabled && onChange(!checked)}
      disabled={disabled}
      style={{
        width: 40, height: 22, borderRadius: 11, border: "none",
        cursor: disabled ? "not-allowed" : "pointer",
        background: checked ? "var(--green)" : "var(--bg-elevated)",
        outline: "2px solid " + (checked ? "var(--green)" : "var(--border)"),
        outlineOffset: -2, position: "relative", transition: "background 0.2s, outline-color 0.2s", flexShrink: 0,
      }}
    >
      <span style={{
        position: "absolute", top: 3, left: checked ? 21 : 3,
        width: 16, height: 16, borderRadius: "50%", background: "#fff",
        boxShadow: "0 1px 3px rgba(0,0,0,0.3)", transition: "left 0.2s", display: "block",
      }} />
    </button>
  );
}

function FieldRow({ label, sub, last, children }: { label: string; sub?: string; last?: boolean; children: React.ReactNode }) {
  return (
    <div style={{
      display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16,
      padding: "11px 0", borderBottom: last ? "none" : "1px solid var(--border-muted)",
    }}>
      <div>
        <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)" }}>{label}</div>
        {sub && <div style={{ fontSize: 11.5, color: "var(--text-muted)", marginTop: 2 }}>{sub}</div>}
      </div>
      <div style={{ flexShrink: 0 }}>{children}</div>
    </div>
  );
}

function NumberInput({ value, onChange, min, max, suffix }: { value: number; onChange: (v: number) => void; min?: number; max?: number; suffix?: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <input
        type="number" value={value} min={min} max={max}
        onChange={(e) => { const n = Number(e.target.value); if (!isNaN(n)) onChange(n); }}
        style={{ width: 80, padding: "5px 8px", background: "var(--bg-elevated)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", color: "var(--text-primary)", fontSize: 13, fontFamily: "inherit", textAlign: "right" }}
      />
      {suffix && <span style={{ fontSize: 12, color: "var(--text-muted)" }}>{suffix}</span>}
    </div>
  );
}

function DateInput({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 5, flex: 1 }}>
      <label style={{ fontSize: 11, fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.5px" }}>{label}</label>
      <input
        type="datetime-local" value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{ padding: "6px 10px", background: "var(--bg-elevated)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", color: "var(--text-primary)", fontSize: 12.5, fontFamily: "inherit", colorScheme: "dark" }}
      />
    </div>
  );
}

function TextArea({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <textarea
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      rows={3}
      style={{ width: "100%", padding: "8px 10px", background: "var(--bg-elevated)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", color: "var(--text-primary)", fontSize: 12.5, fontFamily: "inherit", resize: "vertical", boxSizing: "border-box" }}
    />
  );
}

function SaveBtn({ onClick, saving }: { onClick: () => void; saving: boolean }) {
  return (
    <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 16 }}>
      <button
        onClick={onClick} disabled={saving}
        style={{ display: "flex", alignItems: "center", gap: 7, padding: "8px 18px", background: "var(--blue)", border: "none", borderRadius: "var(--radius-sm)", color: "#fff", fontSize: 13, fontWeight: 600, fontFamily: "inherit", cursor: saving ? "not-allowed" : "pointer", opacity: saving ? 0.7 : 1, transition: "opacity 0.15s" }}
      >
        {saving ? <RefreshCw size={13} style={{ animation: "spin 0.8s linear infinite" }} /> : <Save size={13} />}
        {saving ? "Saving…" : "Save Changes"}
      </button>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function SettingsPage() {
  const { user } = useAuthGuard({ module: "settings" });
  const isSuperAdmin = user?.role === "super_admin";

  const [loading, setLoading] = useState(true);

  // Section states
  const [maint,   setMaint]   = useState<MaintenanceConfig>(D_MAINT);
  const [comm,    setComm]    = useState<CommissionConfig>(D_COMM);
  const [vis,     setVis]     = useState<VisibilityConfig>(D_VIS);
  const [expiry,  setExpiry]  = useState<GigExpiryConfig>(D_EXPIRY);
  // Saving states
  const [savingMaint,  setSavingMaint]  = useState(false);
  const [savingComm,   setSavingComm]   = useState(false);
  const [savingVis,    setSavingVis]    = useState(false);
  const [savingExpiry, setSavingExpiry] = useState(false);

  // ── Load all sections in parallel ───────────────────────────────────────────
  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [mSnap, cSnap, vSnap, eSnap] = await Promise.all([
        getDoc(DOCS.maintenance),
        getDoc(DOCS.platformCommission),
        getDoc(DOCS.gigVisibility),
        getDoc(DOCS.gigExpiry),
      ]);
      if (mSnap.exists()) setMaint({ ...D_MAINT,  ...mSnap.data() as Partial<MaintenanceConfig>  });
      if (cSnap.exists()) setComm({ ...D_COMM,   ...cSnap.data() as Partial<CommissionConfig>   });
      if (vSnap.exists()) setVis({ ...D_VIS,    ...vSnap.data() as Partial<VisibilityConfig>   });
      if (eSnap.exists()) setExpiry({ ...D_EXPIRY, ...eSnap.data() as Partial<GigExpiryConfig> });
    } catch {
      toast.error("Failed to load settings");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);

  // ── Generic save ────────────────────────────────────────────────────────────
  async function save(
    ref: typeof DOCS[keyof typeof DOCS],
    data: object,
    section: string,
    setSaving: (v: boolean) => void,
  ) {
    if (!user) return;
    setSaving(true);
    try {
      await setDoc(ref, { ...data, updatedAt: serverTimestamp() }, { merge: true });
      await writeLog({
        actorId: user.uid,
        actorName: user.displayName ?? user.email ?? "Unknown",
        actorEmail: user.email ?? undefined,
        module: "settings",
        action: "settings_updated",
        description: buildDescription.settingsUpdated(section),
        meta: { other: data as Record<string, unknown> },
      });
      toast.success("Saved", `${section} updated`);
    } catch {
      toast.error("Save failed", "Please try again");
    } finally {
      setSaving(false);
    }
  }

  return (
    <AdminLayout title="Settings" subtitle="Configure platform preferences and system options">
      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        .st-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
        @media (max-width: 860px) { .st-grid { grid-template-columns: 1fr; } }
        .st-date-row { display: flex; gap: 12px; margin: 12px 0 4px; }
      `}</style>

      {loading ? (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: 200, color: "var(--text-muted)", fontSize: 13 }}>
          Loading settings…
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>

          {/* ── 1. Maintenance ──────────────────────────────────────────────── */}
          <SectionCard icon={<Shield size={15} />} title="Maintenance Mode" accent="var(--red)">
            {maint.enabled && (
              <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.3)", borderRadius: "var(--radius-sm)", marginBottom: 14, fontSize: 12.5, color: "var(--red)", fontWeight: 600 }}>
                <AlertTriangle size={14} />
                Maintenance mode is ON — non-admins are locked out
              </div>
            )}

            <FieldRow label="Enable Maintenance Mode" sub="Non-admin users will see a maintenance screen">
              <Toggle checked={maint.enabled} onChange={(v) => setMaint((p) => ({ ...p, enabled: v }))} disabled={!isSuperAdmin} />
            </FieldRow>

            <FieldRow label="Scheduled Window" sub="Optional: set when maintenance starts and ends">
              <Calendar size={14} style={{ color: "var(--text-muted)" }} />
            </FieldRow>
            <div className="st-date-row">
              <DateInput label="Start" value={maint.startDate} onChange={(v) => setMaint((p) => ({ ...p, startDate: v }))} />
              <DateInput label="End"   value={maint.endDate}   onChange={(v) => setMaint((p) => ({ ...p, endDate: v }))}   />
            </div>

            <FieldRow label="User-facing Message" sub="Shown to users during maintenance" last>
              <MessageSquare size={14} style={{ color: "var(--text-muted)" }} />
            </FieldRow>
            <div style={{ marginTop: 8 }}>
              <TextArea
                value={maint.message}
                onChange={(v) => setMaint((p) => ({ ...p, message: v }))}
                placeholder="We're performing scheduled maintenance…"
              />
            </div>

            {!isSuperAdmin && (
              <p style={{ fontSize: 11.5, color: "var(--text-muted)", margin: "10px 0 0" }}>
                Only super admins can modify maintenance settings.
              </p>
            )}
            <SaveBtn onClick={() => save(DOCS.maintenance, maint, "Maintenance Mode", setSavingMaint)} saving={savingMaint} />
          </SectionCard>

          {/* ── 2 + 3. Commission + Visibility (side by side) ───────────────── */}
          <div className="st-grid">

            {/* Platform Commission Rules */}
            <SectionCard icon={<Percent size={15} />} title="Platform Commission Rules" accent="var(--orange)">
              <FieldRow label="Offered Gig" sub="Commission on offered gigs">
                <NumberInput value={comm.offeredGig} onChange={(v) => setComm((p) => ({ ...p, offeredGig: v }))} min={0} max={100} suffix="%" />
              </FieldRow>
              <FieldRow label="Open Gig" sub="Commission on open gigs">
                <NumberInput value={comm.openGig} onChange={(v) => setComm((p) => ({ ...p, openGig: v }))} min={0} max={100} suffix="%" />
              </FieldRow>
              <FieldRow label="Quick Gig" sub="Commission on quick gigs">
                <NumberInput value={comm.quickGig} onChange={(v) => setComm((p) => ({ ...p, quickGig: v }))} min={0} max={100} suffix="%" />
              </FieldRow>
              <FieldRow label="Min. Payout" sub="Minimum withdrawal amount">
                <NumberInput value={comm.minPayoutThreshold} onChange={(v) => setComm((p) => ({ ...p, minPayoutThreshold: v }))} min={0} suffix="$" />
              </FieldRow>
              <FieldRow label="Processing Fee" sub="Flat fee per transaction">
                <NumberInput value={comm.processingFee} onChange={(v) => setComm((p) => ({ ...p, processingFee: v }))} min={0} suffix="%" />
              </FieldRow>
              <FieldRow label="Cancellation Penalty" sub="Fixed fee charged when a gig is cancelled">
                <NumberInput value={comm.cancellationPenalty} onChange={(v) => setComm((p) => ({ ...p, cancellationPenalty: v }))} min={0} suffix="$" />
              </FieldRow>
              <FieldRow label="Minimum Budget per Gig" sub="Lowest allowed budget when posting a gig" last>
                <NumberInput value={comm.minBudgetPerGig} onChange={(v) => setComm((p) => ({ ...p, minBudgetPerGig: v }))} min={0} suffix="$" />
              </FieldRow>
              <SaveBtn onClick={() => save(DOCS.platformCommission, comm, "Platform Commission Rules", setSavingComm)} saving={savingComm} />
            </SectionCard>

            {/* Gig Visibility Rules */}
            <SectionCard icon={<Eye size={15} />} title="Gig Visibility Rules" accent="var(--blue)">
              <FieldRow label="Auto-hide inactive gigs" sub="Hide gigs that haven't been updated">
                <Toggle checked={vis.autoHideEnabled} onChange={(v) => setVis((p) => ({ ...p, autoHideEnabled: v }))} />
              </FieldRow>
              {vis.autoHideEnabled && (
                <FieldRow label="Hide after">
                  <NumberInput value={vis.autoHideAfterDays} onChange={(v) => setVis((p) => ({ ...p, autoHideAfterDays: v }))} min={1} suffix="days" />
                </FieldRow>
              )}
              <FieldRow label="Auto-cancel inactive gigs" sub="Cancel gigs with no activity">
                <Toggle checked={vis.autoCancelEnabled} onChange={(v) => setVis((p) => ({ ...p, autoCancelEnabled: v }))} />
              </FieldRow>
              {vis.autoCancelEnabled && (
                <FieldRow label="Cancel after">
                  <NumberInput value={vis.autoCancelAfterDays} onChange={(v) => setVis((p) => ({ ...p, autoCancelAfterDays: v }))} min={1} suffix="days" />
                </FieldRow>
              )}
              <FieldRow label="Expiry Warning" sub="Notify poster X days before auto-cancel">
                <NumberInput value={vis.expiryWarningDays} onChange={(v) => setVis((p) => ({ ...p, expiryWarningDays: v }))} min={1} suffix="days" />
              </FieldRow>
              <FieldRow label="Max Gigs / User / Day" sub="Rate limit for gig posting" last>
                <NumberInput value={vis.maxGigsPerUserPerDay} onChange={(v) => setVis((p) => ({ ...p, maxGigsPerUserPerDay: v }))} min={1} suffix="gigs" />
              </FieldRow>
              <SaveBtn onClick={() => save(DOCS.gigVisibility, vis, "Gig Visibility Rules", setSavingVis)} saving={savingVis} />
            </SectionCard>
          </div>

          {/* ── 4. Gig Expiry ───────────────────────────────────────────────── */}
          <SectionCard icon={<Timer size={15} />} title="Gig Auto-Expiry" accent="var(--purple, #a855f7)">
            <FieldRow label="Open Gigs" sub="Hours before an open gig is auto-expired">
              <NumberInput value={expiry.open_gigs} onChange={(v) => setExpiry((p) => ({ ...p, open_gigs: v }))} min={1} suffix="hrs" />
            </FieldRow>
            <FieldRow label="Quick Gigs" sub="Hours before a quick gig is auto-expired">
              <NumberInput value={expiry.quick_gigs} onChange={(v) => setExpiry((p) => ({ ...p, quick_gigs: v }))} min={1} suffix="hrs" />
            </FieldRow>
            <FieldRow label="Offered Gigs" sub="Hours before an offered gig is auto-expired" last>
              <NumberInput value={expiry.offered_gigs} onChange={(v) => setExpiry((p) => ({ ...p, offered_gigs: v }))} min={1} suffix="hrs" />
            </FieldRow>
            <SaveBtn onClick={() => save(DOCS.gigExpiry, expiry, "Gig Auto-Expiry", setSavingExpiry)} saving={savingExpiry} />
          </SectionCard>

        </div>
      )}
    </AdminLayout>
  );
}
