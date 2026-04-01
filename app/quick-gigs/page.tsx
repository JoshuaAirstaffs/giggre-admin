"use client";

import { useState, useEffect, useCallback } from "react";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import AdminLayout from "@/components/layout/AdminLayout";
import Button from "@/components/ui/Button";
import Modal from "@/components/ui/Modal";
import { useAuthGuard } from "@/hooks/useAuthGuard";
import { useAuth } from "@/context/AuthContext";
import { writeLog, buildDescription } from "@/lib/activitylog";
import { toast } from "@/components/ui/Toaster";
import {
  ShieldOff,
  Clock,
  Zap,
  Bell,
  Plus,
  Pencil,
  Trash2,
  RotateCcw,
  Save,
  RefreshCw,
  Info,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

type TabKey = "decline_suspension" | "time_limits" | "matching_engine" | "notifications";

interface SuspensionTier {
  decline_count_trigger: number;
  suspension_duration_minutes: number;
  tier_label?: string;
  is_active: boolean;
}

// Each tab maps to its own Firestore document
interface DeclineSuspensionConfig {
  free_decline_limit: number;
  suspension_enabled: boolean;
  suspension_tier_table: SuspensionTier[];
}

interface TimeLimitsConfig {
  auto_accept_enabled_default: boolean;
  worker_toggle_default: boolean;
}

interface MatchingEngineConfig {
  review_window_seconds: number;
  max_search_radius_km: number | null;
  allow_reassignment_after_exhaustion: boolean;
  search_timeout_minutes: number;
  max_dispatch_attempts: number;
}

interface NotificationsConfig {
  notification_template_suspension: string;
  notification_template_no_worker_found: string;
  notification_template_dispatch: string;
  notification_template_timeout: string;
}

// ─── Defaults ────────────────────────────────────────────────────────────────

const DECLINE_DEFAULTS: DeclineSuspensionConfig = {
  free_decline_limit: 5,
  suspension_enabled: true,
  suspension_tier_table: [
    { decline_count_trigger: 3, suspension_duration_minutes: 20, tier_label: "Warning", is_active: true },
    { decline_count_trigger: 5, suspension_duration_minutes: 25, tier_label: "Strike 1", is_active: true },
    { decline_count_trigger: 10, suspension_duration_minutes: 30, tier_label: "Strike 2", is_active: true },
    { decline_count_trigger: 15, suspension_duration_minutes: 60, tier_label: "Strike 3", is_active: true },
    { decline_count_trigger: 20, suspension_duration_minutes: 120, tier_label: "Final Warning", is_active: true },
  ],
};

const TIME_DEFAULTS: TimeLimitsConfig = {
  auto_accept_enabled_default: false,
  worker_toggle_default: false,
};

const MATCHING_DEFAULTS: MatchingEngineConfig = {
  review_window_seconds: 20,
  max_search_radius_km: null,
  allow_reassignment_after_exhaustion: true,
  search_timeout_minutes: 10,
  max_dispatch_attempts: 5,
};

const NOTIF_DEFAULTS: NotificationsConfig = {
  notification_template_suspension:
    "Your account has been temporarily suspended due to excessive gig declines. Please wait before accepting more gigs.",
  notification_template_no_worker_found:
    "We're sorry, no available workers were found for your gig at this time. Please try again later.",
  notification_template_dispatch:
    "You have a new gig assigned! Please check the details and confirm your availability.",
  notification_template_timeout:
    "Your response time has expired. The gig has been assigned to another worker.",
};

// ─── Tab config ───────────────────────────────────────────────────────────────

const TABS: {
  key: TabKey;
  label: string;
  icon: React.ElementType;
  color: string;
  description: string;
}[] = [
    {
      key: "decline_suspension",
      label: "Decline & Suspension",
      icon: ShieldOff,
      color: "var(--orange)",
      description:
        "Configure how the system handles excessive gig declines and automatic worker suspensions.",
    },
    // {
    //   key: "time_limits",
    //   label: "Time & Limits",
    //   icon: Clock,
    //   color: "var(--blue)",
    //   description:
    //     "Set time windows for gig acceptance and default worker availability settings.",
    // },
    {
      key: "matching_engine",
      label: "Matching Engine",
      icon: Zap,
      color: "var(--purple)",
      description:
        "Define how the platform searches for and dispatches workers to gigs.",
    },
    {
      key: "notifications",
      label: "Notifications",
      icon: Bell,
      color: "var(--green)",
      description:
        "Manage message templates sent to workers and hosts for key events.",
    },
  ];

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h} hr` : `${h} hr ${m} min`;
}

function docRef(tab: TabKey) {
  return doc(db, "quick_gig_config", tab);
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function QuickGigsPage() {
  const { user } = useAuth();
  useAuthGuard({ module: "quick-gigs" });

  const [activeTab, setActiveTab] = useState<TabKey>("decline_suspension");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Per-document state
  const [decline, setDecline] = useState<DeclineSuspensionConfig>(DECLINE_DEFAULTS);
  const [savedDecline, setSavedDecline] = useState<DeclineSuspensionConfig>(DECLINE_DEFAULTS);

  const [timeLimits, setTimeLimits] = useState<TimeLimitsConfig>(TIME_DEFAULTS);
  const [savedTimeLimits, setSavedTimeLimits] = useState<TimeLimitsConfig>(TIME_DEFAULTS);

  const [matching, setMatching] = useState<MatchingEngineConfig>(MATCHING_DEFAULTS);
  const [savedMatching, setSavedMatching] = useState<MatchingEngineConfig>(MATCHING_DEFAULTS);

  const [notifs, setNotifs] = useState<NotificationsConfig>(NOTIF_DEFAULTS);
  const [savedNotifs, setSavedNotifs] = useState<NotificationsConfig>(NOTIF_DEFAULTS);

  // Tier modal
  const [tierModalOpen, setTierModalOpen] = useState(false);
  const [editingTierIdx, setEditingTierIdx] = useState<number | null>(null);
  const [tierForm, setTierForm] = useState<SuspensionTier>({
    decline_count_trigger: 0,
    suspension_duration_minutes: 0,
    tier_label: "",
    is_active: true,
  });
  const [deleteConfirmIdx, setDeleteConfirmIdx] = useState<number | null>(null);

  // ── Data loading ─────────────────────────────────────────────────────────────

  const loadConfig = useCallback(async () => {
    setLoading(true);
    try {
      const [dSnap, tSnap, mSnap, nSnap] = await Promise.all([
        getDoc(docRef("decline_suspension")),
        getDoc(docRef("time_limits")),
        getDoc(docRef("matching_engine")),
        getDoc(docRef("notifications")),
      ]);

      const d = dSnap.exists()
        ? { ...DECLINE_DEFAULTS, ...(dSnap.data() as Partial<DeclineSuspensionConfig>) }
        : DECLINE_DEFAULTS;
      const t = tSnap.exists()
        ? { ...TIME_DEFAULTS, ...(tSnap.data() as Partial<TimeLimitsConfig>) }
        : TIME_DEFAULTS;
      const m = mSnap.exists()
        ? { ...MATCHING_DEFAULTS, ...(mSnap.data() as Partial<MatchingEngineConfig>) }
        : MATCHING_DEFAULTS;
      const n = nSnap.exists()
        ? { ...NOTIF_DEFAULTS, ...(nSnap.data() as Partial<NotificationsConfig>) }
        : NOTIF_DEFAULTS;

      setDecline(d); setSavedDecline(d);
      setTimeLimits(t); setSavedTimeLimits(t);
      setMatching(m); setSavedMatching(m);
      setNotifs(n); setSavedNotifs(n);
    } catch {
      toast.error("Load failed", "Could not load Quick Gig configuration.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadConfig(); }, [loadConfig]);

  // ── Has-changes per active tab ───────────────────────────────────────────────

  const hasChanges = (() => {
    switch (activeTab) {
      case "decline_suspension": return JSON.stringify(decline) !== JSON.stringify(savedDecline);
      case "time_limits": return JSON.stringify(timeLimits) !== JSON.stringify(savedTimeLimits);
      case "matching_engine": return JSON.stringify(matching) !== JSON.stringify(savedMatching);
      case "notifications": return JSON.stringify(notifs) !== JSON.stringify(savedNotifs);
    }
  })();

  // ── Save active tab ──────────────────────────────────────────────────────────

  const handleSave = async () => {
    if (!user) return;
    setSaving(true);
    try {
      const tabLabel = TABS.find((t) => t.key === activeTab)!.label;

      switch (activeTab) {
        case "decline_suspension":
          await setDoc(docRef("decline_suspension"), decline);
          setSavedDecline({ ...decline });
          break;
        case "time_limits":
          await setDoc(docRef("time_limits"), timeLimits);
          setSavedTimeLimits({ ...timeLimits });
          break;
        case "matching_engine":
          await setDoc(docRef("matching_engine"), matching);
          setSavedMatching({ ...matching });
          break;
        case "notifications":
          await setDoc(docRef("notifications"), notifs);
          setSavedNotifs({ ...notifs });
          break;
      }

      await writeLog({
        actorId: user.uid,
        actorName: user.displayName ?? "Unknown",
        actorEmail: user.email ?? "",
        module: "quick_gig_config",
        action: "config_updated",
        description: buildDescription.configUpdated(tabLabel),
        targetName: activeTab,
      });

      toast.success("Saved", `${tabLabel} configuration updated.`);
    } catch {
      toast.error("Save failed", "Could not save configuration. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  // ── Discard active tab ───────────────────────────────────────────────────────

  const handleDiscard = () => {
    switch (activeTab) {
      case "decline_suspension": setDecline({ ...savedDecline }); break;
      case "time_limits": setTimeLimits({ ...savedTimeLimits }); break;
      case "matching_engine": setMatching({ ...savedMatching }); break;
      case "notifications": setNotifs({ ...savedNotifs }); break;
    }
    toast.info("Discarded", "Changes reverted to last saved state.");
  };

  // ── Tier CRUD ────────────────────────────────────────────────────────────────

  const openAddTier = () => {
    setEditingTierIdx(null);
    setTierForm({ decline_count_trigger: 0, suspension_duration_minutes: 0, tier_label: "", is_active: true });
    setTierModalOpen(true);
  };

  const openEditTier = (idx: number) => {
    setEditingTierIdx(idx);
    const tier = decline.suspension_tier_table[idx];
    setTierForm({
      tier_label: "",
      is_active: true,
      ...tier,
    });
    setTierModalOpen(true);
  };

  const saveTier = () => {
    if (tierForm.decline_count_trigger <= 0 || tierForm.suspension_duration_minutes <= 0) {
      toast.warning("Invalid input", "Both fields must be greater than zero.");
      return;
    }
    const tiers = [...decline.suspension_tier_table];
    if (editingTierIdx !== null) {
      tiers[editingTierIdx] = { ...tierForm };
    } else {
      tiers.push({ ...tierForm });
    }
    tiers.sort((a, b) => a.decline_count_trigger - b.decline_count_trigger);
    setDecline((prev) => ({ ...prev, suspension_tier_table: tiers }));
    setTierModalOpen(false);
  };

  const deleteTier = (idx: number) => {
    const tiers = decline.suspension_tier_table.filter((_, i) => i !== idx);
    setDecline((prev) => ({ ...prev, suspension_tier_table: tiers }));
    setDeleteConfirmIdx(null);
  };

  // ── Render ───────────────────────────────────────────────────────────────────

  const activeTabMeta = TABS.find((t) => t.key === activeTab)!;

  return (
    <AdminLayout
      title="Quick Gig Configuration"
      subtitle="Manage system behavior for quick gig dispatch, suspensions, and notifications"
    >
      <style>{`
        .qgc-wrap { display: flex; flex-direction: column; height: 100%; }
        .qgc-body { flex: 1; overflow-y: auto; padding: 24px; display: flex; flex-direction: column; gap: 24px; }

        /* ── Save bar ── */
        .qgc-save-bar {
          display: flex; align-items: center; justify-content: space-between;
          gap: 12px; padding: 12px 24px;
          background: var(--bg-elevated); border-bottom: 1px solid var(--border); flex-shrink: 0;
        }
        .qgc-save-bar-info { display: flex; align-items: center; gap: 8px; font-size: 13px; }
        .qgc-save-bar-actions { display: flex; gap: 8px; }
        .qgc-unsaved-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--orange); flex-shrink: 0; }

        /* ── Tabs ── */
        .qgc-tabs {
          display: flex; gap: 2px; padding: 4px; min-height: 36px;
          background: var(--bg-elevated); border: 1px solid var(--border);
          border-radius: var(--radius-lg); overflow-x: auto;
          scrollbar-width: none; -ms-overflow-style: none;
        }
        .qgc-tabs::-webkit-scrollbar { display: none; }
        .qgc-tab {
          display: flex; align-items: center; gap: 7px;
          padding: 8px 16px; border: 1px solid transparent;
          border-radius: 8px; background: transparent;
          color: var(--text-muted); font-size: 13px; font-weight: 500;
          font-family: inherit; cursor: pointer; white-space: nowrap;
          flex-shrink: 0; transition: background 0.12s, color 0.12s;
        }
        .qgc-tab:hover:not(.qgc-tab--active) { background: var(--bg-surface); color: var(--text-secondary); }
        .qgc-tab--active { background: var(--bg-surface); border-color: var(--border); color: var(--text-primary); box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
        .qgc-tab-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--orange); flex-shrink: 0; }

        /* ── Section header ── */
        .qgc-section-header {
          display: flex; align-items: flex-start; gap: 12px;
          padding: 16px 20px; background: var(--bg-elevated);
          border: 1px solid var(--border); border-radius: var(--radius-md);
        }
        .qgc-section-icon { width: 36px; height: 36px; border-radius: 10px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
        .qgc-section-title { font-size: 15px; font-weight: 700; color: var(--text-primary); }
        .qgc-section-desc { font-size: 13px; color: var(--text-muted); margin-top: 3px; line-height: 1.5; }
        .qgc-section-path { font-family: 'Space Mono', monospace; font-size: 10px; color: var(--text-muted); margin-top: 5px; opacity: 0.7; }

        /* ── Card ── */
        .qgc-card { background: var(--bg-surface); border: 1px solid var(--border); border-radius: var(--radius-md); overflow-y: auto; }
        .qgc-card-header { padding: 16px 20px; border-bottom: 1px solid var(--border); display: flex; align-items: center; justify-content: space-between; }
        .qgc-card-title { font-size: 13px; font-weight: 700; color: var(--text-primary); }

        /* ── Fields ── */
        .qgc-field { padding: 16px 20px; border-bottom: 1px solid var(--border); }
        .qgc-field:last-child { border-bottom: none; }
        .qgc-field--row { display: flex; align-items: center; justify-content: space-between; gap: 24px; }
        .qgc-field--col { display: flex; flex-direction: column; gap: 8px; }
        .qgc-field-meta { flex: 1; min-width: 0; }
        .qgc-field-label { font-size: 13px; font-weight: 600; color: var(--text-primary); }
        // .qgc-field-code { font-family: 'Space Mono', monospace; font-size: 11px; color: var(--text-muted); margin-top: 2px; }
        .qgc-field-desc { font-size: 12px; color: var(--text-muted); margin-top: 4px; line-height: 1.5; }

        /* ── Number input ── */
        .qgc-number-wrap { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }
        .qgc-number {
          width: 100px; padding: 7px 12px; text-align: right;
          background: var(--bg-elevated); border: 1px solid var(--border);
          border-radius: var(--radius-sm); color: var(--text-primary);
          font-size: 14px; font-family: 'Space Mono', monospace; font-weight: 600;
          transition: border 0.15s; -moz-appearance: textfield;
        }
        .qgc-number:focus { outline: none; border-color: var(--blue); }
        .qgc-number::-webkit-inner-spin-button,
        .qgc-number::-webkit-outer-spin-button { -webkit-appearance: none; margin: 0; }
        .qgc-unit { font-size: 12px; color: var(--text-muted); white-space: nowrap; }

        /* ── Nullable number ── */
        .qgc-nullable-wrap { display: flex; align-items: center; gap: 10px; }
        .qgc-optional-label { font-size: 11px; color: var(--text-muted); font-style: italic; }

        /* ── Toggle ── */
        .qgc-toggle-wrap { flex-shrink: 0; display: flex; align-items: center; gap: 10px; }
        .qgc-toggle { position: relative; width: 44px; height: 24px; border-radius: 12px; cursor: pointer; border: none; transition: background 0.2s; outline: none; flex-shrink: 0; }
        .qgc-toggle--on  { background: var(--blue); }
        .qgc-toggle--off { background: var(--bg-hover); border: 1px solid var(--border); }
        .qgc-toggle-thumb { position: absolute; top: 3px; width: 18px; height: 18px; border-radius: 50%; background: white; transition: left 0.2s; box-shadow: 0 1px 3px rgba(0,0,0,0.3); }
        .qgc-toggle--on  .qgc-toggle-thumb { left: 23px; }
        .qgc-toggle--off .qgc-toggle-thumb { left: 3px; }
        .qgc-toggle-state { font-size: 12px; font-weight: 600; }
        .qgc-toggle-state--on  { color: var(--blue); }
        .qgc-toggle-state--off { color: var(--text-muted); }

        /* ── Textarea ── */
        .qgc-textarea {
          width: 100%; padding: 10px 14px;
          background: var(--bg-elevated); border: 1px solid var(--border);
          border-radius: var(--radius-sm); color: var(--text-primary);
          font-size: 13px; font-family: inherit; resize: vertical;
          min-height: 96px; line-height: 1.6; transition: border 0.15s;
        }
        .qgc-textarea:focus { outline: none; border-color: var(--blue); }

        /* ── Modal inputs ── */
        .qgc-modal-field { margin-bottom: 16px; }
        .qgc-modal-field:last-child { margin-bottom: 0; }
        .qgc-modal-label { font-size: 12px; font-weight: 600; color: var(--text-secondary); margin-bottom: 4px; }
        .qgc-modal-desc { font-size: 11px; color: var(--text-muted); margin-bottom: 6px; line-height: 1.4; }
        .qgc-modal-input {
          width: 100%; padding: 8px 12px;
          background: var(--bg-elevated); border: 1px solid var(--border);
          border-radius: var(--radius-sm); color: var(--text-primary);
          font-size: 14px; font-family: 'Space Mono', monospace; transition: border 0.15s;
        }
        .qgc-modal-input:focus { outline: none; border-color: var(--blue); }

        /* ── Tier table ── */
        .qgc-tier-table { width: 100%; border-collapse: collapse; }
        .qgc-tier-table th {
          padding: 10px 16px; text-align: left;
          font-size: 11px; font-weight: 600; letter-spacing: 0.05em;
          text-transform: uppercase; color: var(--text-muted);
          border-bottom: 1px solid var(--border); background: var(--bg-elevated);
        }
        .qgc-tier-table td { padding: 11px 16px; border-bottom: 1px solid var(--border); vertical-align: middle; }
        .qgc-tier-row:last-child td { border-bottom: none; }
        .qgc-tier-row:hover td { background: var(--bg-elevated); }
        .qgc-tier-num { font-family: 'Space Mono', monospace; font-size: 13px; font-weight: 700; color: var(--text-primary); }
        .qgc-tier-badge { display: inline-flex; align-items: center; padding: 2px 8px; border-radius: 20px; font-size: 11px; font-weight: 600; background: rgba(249,115,22,0.12); color: var(--orange); }
        .qgc-tier-actions { display: flex; gap: 6px; justify-content: flex-end; }
        .qgc-icon-btn { width: 28px; height: 28px; border-radius: 6px; display: flex; align-items: center; justify-content: center; border: 1px solid var(--border); background: transparent; color: var(--text-muted); cursor: pointer; transition: all 0.15s; }
        .qgc-icon-btn:hover { background: var(--bg-elevated); color: var(--text-primary); }
        .qgc-icon-btn--danger:hover { background: rgba(239,68,68,0.1); color: var(--red); border-color: rgba(239,68,68,0.3); }

        /* ── Misc ── */
        .qgc-empty { padding: 40px 20px; text-align: center; color: var(--text-muted); font-size: 13px; }
        .qgc-info { display: flex; gap: 10px; align-items: flex-start; padding: 12px 16px; background: rgba(59,130,246,0.06); border: 1px solid rgba(59,130,246,0.2); border-radius: var(--radius-sm); font-size: 12px; color: var(--text-secondary); line-height: 1.5; }
        .qgc-how { padding: 16px 20px; background: var(--bg-elevated); border-radius: var(--radius-sm); border: 1px dashed var(--border); }
        .qgc-how-title { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; color: var(--text-muted); margin-bottom: 8px; }
        .qgc-how-steps { display: flex; flex-direction: column; gap: 6px; }
        .qgc-how-step { display: flex; gap: 10px; align-items: flex-start; font-size: 12px; color: var(--text-secondary); line-height: 1.5; }
        .qgc-how-num { width: 18px; height: 18px; border-radius: 50%; background: var(--bg-hover); color: var(--text-muted); font-size: 10px; font-weight: 700; display: flex; align-items: center; justify-content: center; flex-shrink: 0; margin-top: 1px; }
        .qgc-skeleton { background: var(--bg-elevated); border-radius: 6px; animation: qgc-pulse 1.4s ease-in-out infinite; }
        @keyframes qgc-pulse { 0%,100% { opacity: 0.4; } 50% { opacity: 0.9; } }
        .qgc-delete-msg { font-size: 13px; color: var(--text-secondary); line-height: 1.6; }
        .qgc-delete-highlight { font-weight: 700; color: var(--text-primary); }
      `}</style>

      <div className="qgc-wrap">

        {/* ── Save bar ── */}
        <div className="qgc-save-bar">
          <div className="qgc-save-bar-info">
            {hasChanges ? (
              <>
                <span className="qgc-unsaved-dot" />
                <span style={{ color: "var(--text-secondary)" }}>Unsaved changes in this section</span>
              </>
            ) : (
              <span style={{ color: "var(--text-muted)" }}>
                {loading ? "Loading configuration…" : "Configuration is up to date"}
              </span>
            )}
          </div>
          <div className="qgc-save-bar-actions">
            <Button variant="ghost" size="sm" icon={RefreshCw} onClick={loadConfig} disabled={loading || saving}>
              Refresh
            </Button>
            {hasChanges && (
              <Button variant="secondary" size="sm" icon={RotateCcw} onClick={handleDiscard} disabled={saving}>
                Discard
              </Button>
            )}
            <Button variant="primary" size="sm" icon={Save} onClick={handleSave} loading={saving} disabled={!hasChanges || loading}>
              Save Changes
            </Button>
          </div>
        </div>

        <div className="qgc-body">

          {/* ── Tab bar ── */}
          <nav className="qgc-tabs" role="tablist">
            {TABS.map(({ key, label, icon: Icon, color }) => {
              const isDirty = (() => {
                switch (key) {
                  case "decline_suspension": return JSON.stringify(decline) !== JSON.stringify(savedDecline);
                  case "time_limits": return JSON.stringify(timeLimits) !== JSON.stringify(savedTimeLimits);
                  case "matching_engine": return JSON.stringify(matching) !== JSON.stringify(savedMatching);
                  case "notifications": return JSON.stringify(notifs) !== JSON.stringify(savedNotifs);
                }
              })();
              return (
                <button
                  key={key}
                  role="tab"
                  aria-selected={activeTab === key}
                  className={`qgc-tab${activeTab === key ? " qgc-tab--active" : ""}`}
                  onClick={() => setActiveTab(key)}
                >
                  <Icon size={13} style={{ color: activeTab === key ? color : "currentColor", flexShrink: 0 }} />
                  {label}
                  {isDirty && <span className="qgc-tab-dot" title="Unsaved changes" />}
                </button>
              );
            })}
          </nav>

          {/* ── Section header ── */}
          <div className="qgc-section-header">
            <div
              className="qgc-section-icon"
              style={{ background: `color-mix(in srgb, ${activeTabMeta.color} 15%, transparent)` }}
            >
              <activeTabMeta.icon size={18} style={{ color: activeTabMeta.color }} />
            </div>
            <div>
              <div className="qgc-section-title">{activeTabMeta.label}</div>
              <div className="qgc-section-desc">{activeTabMeta.description}</div>
              <div className="qgc-section-path">
                quick_gig_config / {activeTab}
              </div>
            </div>
          </div>

          {/* ── Tab content ── */}
          {loading ? <LoadingSkeleton /> : (
            <>
              {activeTab === "decline_suspension" && (
                <DeclineSuspensionTab
                  config={decline}
                  set={(key, value) => setDecline((prev) => ({ ...prev, [key]: value }))}
                  openAddTier={openAddTier}
                  openEditTier={openEditTier}
                  setDeleteConfirmIdx={setDeleteConfirmIdx}
                />
              )}
              {/* {activeTab === "time_limits" && (
                <TimeLimitsTab
                  config={timeLimits}
                  set={(key, value) => setTimeLimits((prev) => ({ ...prev, [key]: value }))}
                />
              )} */}
              {activeTab === "matching_engine" && (
                <MatchingEngineTab
                  config={matching}
                  set={(key, value) => setMatching((prev) => ({ ...prev, [key]: value }))}
                />
              )}
              {activeTab === "notifications" && (
                <NotificationsTab
                  config={notifs}
                  set={(key, value) => setNotifs((prev) => ({ ...prev, [key]: value }))}
                />
              )}
            </>
          )}

        </div>
      </div>

      {/* ── Tier Add/Edit Modal ── */}
      <Modal
        open={tierModalOpen}
        onClose={() => setTierModalOpen(false)}
        title={editingTierIdx !== null ? "Edit Suspension Tier" : "Add Suspension Tier"}
        description="Define the decline threshold and suspension length for this tier."
        size="sm"
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setTierModalOpen(false)}>Cancel</Button>
            <Button variant="primary" size="sm" icon={Save} onClick={saveTier}>
              {editingTierIdx !== null ? "Update Tier" : "Add Tier"}
            </Button>
          </>
        }
      >
        <div className="qgc-modal-field">
          <div className="qgc-modal-label">Tier Label <span style={{ fontWeight: 400, color: "var(--text-muted)" }}>(optional)</span></div>
          <div className="qgc-modal-desc">
            A short display name for this tier shown in the table (e.g. "Warning", "Strike 1").
          </div>
          <input
            className="qgc-modal-input"
            type="text"
            value={tierForm.tier_label ?? ""}
            onChange={(e) => setTierForm((f) => ({ ...f, tier_label: e.target.value }))}
            placeholder="e.g. Warning"
            style={{ fontFamily: "inherit" }}
          />
        </div>
        <div className="qgc-modal-field">
          <div className="qgc-modal-label">Decline Count Trigger</div>
          <div className="qgc-modal-desc">
            Minimum number of declines required to activate this suspension tier.
          </div>
          <input
            className="qgc-modal-input"
            type="number"
            min={1}
            value={tierForm.decline_count_trigger || ""}
            onChange={(e) =>
              setTierForm((f) => ({ ...f, decline_count_trigger: parseInt(e.target.value) || 0 }))
            }
            placeholder="e.g. 5"
          />
        </div>
        <div className="qgc-modal-field">
          <div className="qgc-modal-label">Suspension Duration (minutes)</div>
          <div className="qgc-modal-desc">
            How long the worker will be suspended when this tier is triggered.
            {tierForm.suspension_duration_minutes > 0 && (
              <span style={{ color: "var(--orange)", fontWeight: 600, marginLeft: 6 }}>
                = {formatDuration(tierForm.suspension_duration_minutes)}
              </span>
            )}
          </div>
          <input
            className="qgc-modal-input"
            type="number"
            min={1}
            value={tierForm.suspension_duration_minutes || ""}
            onChange={(e) =>
              setTierForm((f) => ({
                ...f,
                suspension_duration_minutes: parseInt(e.target.value) || 0,
              }))
            }
            placeholder="e.g. 30"
          />
        </div>
        <div className="qgc-modal-field" style={{ marginBottom: 0 }}>
          <div className="qgc-modal-label">Active</div>
          <div className="qgc-modal-desc">
            When disabled, this tier is stored but will not be enforced by the suspension system.
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 4 }}>
            <button
              className={`qgc-toggle qgc-toggle--${tierForm.is_active ? "on" : "off"}`}
              onClick={() => setTierForm((f) => ({ ...f, is_active: !f.is_active }))}
              role="switch"
              aria-checked={tierForm.is_active}
              type="button"
            >
              <span className="qgc-toggle-thumb" />
            </button>
            <span className={`qgc-toggle-state qgc-toggle-state--${tierForm.is_active ? "on" : "off"}`}>
              {tierForm.is_active ? "Enforced" : "Disabled"}
            </span>
          </div>
        </div>
      </Modal>

      {/* ── Delete Confirm Modal ── */}
      <Modal
        open={deleteConfirmIdx !== null}
        onClose={() => setDeleteConfirmIdx(null)}
        title="Remove Suspension Tier"
        size="sm"
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setDeleteConfirmIdx(null)}>Cancel</Button>
            <Button
              variant="danger"
              size="sm"
              icon={Trash2}
              onClick={() => deleteConfirmIdx !== null && deleteTier(deleteConfirmIdx)}
            >
              Remove Tier
            </Button>
          </>
        }
      >
        {deleteConfirmIdx !== null && (
          <p className="qgc-delete-msg">
            Remove the tier triggered at{" "}
            <span className="qgc-delete-highlight">
              {decline.suspension_tier_table[deleteConfirmIdx]?.decline_count_trigger} declines
            </span>{" "}
            ({formatDuration(decline.suspension_tier_table[deleteConfirmIdx]?.suspension_duration_minutes ?? 0)} suspension)?
            This cannot be undone.
          </p>
        )}
      </Modal>
    </AdminLayout>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Tab: Decline & Suspension
// ─────────────────────────────────────────────────────────────────────────────

function DeclineSuspensionTab({
  config, set, openAddTier, openEditTier, setDeleteConfirmIdx,
}: {
  config: DeclineSuspensionConfig;
  set: <K extends keyof DeclineSuspensionConfig>(key: K, value: DeclineSuspensionConfig[K]) => void;
  openAddTier: () => void;
  openEditTier: (idx: number) => void;
  setDeleteConfirmIdx: (idx: number) => void;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>

      <div className="qgc-card">
        <div className="qgc-card-header">
          <span className="qgc-card-title">Decline Settings</span>
        </div>

        <div className="qgc-field qgc-field--row">
          <div className="qgc-field-meta">
            <div className="qgc-field-label">Free Decline Limit</div>
            {/* <div className="qgc-field-code">free_decline_limit · Integer · default: 5</div> */}
            <div className="qgc-field-desc">
              Number of gig declines a worker can make per day without any penalty. Once exceeded,
              the suspension system takes over (if enabled).
            </div>
          </div>
          <div className="qgc-number-wrap">
            <input
              className="qgc-number"
              type="number"
              min={0}
              value={config.free_decline_limit}
              onChange={(e) => set("free_decline_limit", Math.max(0, parseInt(e.target.value) || 0))}
            />
            <span className="qgc-unit">declines / day</span>
          </div>
        </div>

        <div className="qgc-field qgc-field--row">
          <div className="qgc-field-meta">
            <div className="qgc-field-label">Automatic Suspension</div>
            {/* <div className="qgc-field-code">suspension_enabled · Boolean · default: true</div> */}
            <div className="qgc-field-desc">
              Enable or disable the automatic suspension system. When disabled, workers can exceed
              the free decline limit without penalty.
            </div>
          </div>
          <Toggle value={config.suspension_enabled} onChange={(v) => set("suspension_enabled", v)} />
        </div>
      </div>

      <div className="qgc-card">
        <div className="qgc-card-header">
          <span className="qgc-card-title">Suspension Tier Table</span>
          <Button variant="secondary" size="sm" icon={Plus} onClick={openAddTier}>Add Tier</Button>
        </div>

        <div style={{ padding: "14px 20px", borderBottom: "1px solid var(--border)" }}>
          <div className="qgc-how">
            <div className="qgc-how-title">How it works</div>
            <div className="qgc-field-desc" style={{ marginBottom: 10 }}>
              Defines the escalating suspension rules applied when a worker exceeds the free decline
              limit. Each tier specifies how long a worker will be suspended based on their total
              decline count.
            </div>
            <div className="qgc-how-steps">
              <div className="qgc-how-step">
                <span className="qgc-how-num">1</span>
                <span>Once a worker exceeds the <strong>free decline limit</strong>, the system checks their total decline count.</span>
              </div>
              <div className="qgc-how-step">
                <span className="qgc-how-num">2</span>
                <span>The system applies the matching suspension tier based on total declines.</span>
              </div>
              <div className="qgc-how-step">
                <span className="qgc-how-num">3</span>
                <span>The higher the decline count, the longer the suspension duration.</span>
              </div>
            </div>
          </div>
        </div>

        {config.suspension_tier_table.length === 0 ? (
          <div className="qgc-empty">No tiers configured. Add a tier to enable suspension escalation.</div>
        ) : (
          <table className="qgc-tier-table">
            <thead>
              <tr>
                <th>Label</th>
                <th>Decline Trigger</th>
                <th>Suspension Duration</th>
                <th>Status</th>
                <th style={{ textAlign: "right" }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {config.suspension_tier_table.map((tier, idx) => {
                const active = tier.is_active !== false;
                return (
                  <tr key={idx} className="qgc-tier-row" style={{ opacity: active ? 1 : 0.5 }}>
                    <td>
                      {tier.tier_label ? (
                        <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text-secondary)" }}>
                          {tier.tier_label}
                        </span>
                      ) : (
                        <span style={{ fontSize: 11, color: "var(--text-muted)", fontStyle: "italic" }}>—</span>
                      )}
                    </td>
                    <td>
                      <span className="qgc-tier-num">{tier.decline_count_trigger}</span>
                      <span style={{ fontSize: 11, color: "var(--text-muted)", marginLeft: 6 }}>declines</span>
                    </td>
                    <td>
                      <span className="qgc-tier-badge">{formatDuration(tier.suspension_duration_minutes)}</span>
                      <span style={{ fontSize: 11, color: "var(--text-muted)", marginLeft: 8 }}>
                        ({tier.suspension_duration_minutes} min)
                      </span>
                    </td>
                    <td>
                      <span style={{
                        display: "inline-flex", alignItems: "center", gap: 4,
                        padding: "2px 8px", borderRadius: 20, fontSize: 11, fontWeight: 600,
                        background: active ? "rgba(16,185,129,0.12)" : "rgba(71,85,105,0.15)",
                        color: active ? "var(--green)" : "var(--text-muted)",
                      }}>
                        <span style={{ width: 5, height: 5, borderRadius: "50%", background: "currentColor", flexShrink: 0 }} />
                        {active ? "Active" : "Disabled"}
                      </span>
                    </td>
                    <td>
                      <div className="qgc-tier-actions">
                        <button className="qgc-icon-btn" title="Edit tier" onClick={() => openEditTier(idx)}>
                          <Pencil size={12} />
                        </button>
                        <button className="qgc-icon-btn qgc-icon-btn--danger" title="Remove tier" onClick={() => setDeleteConfirmIdx(idx)}>
                          <Trash2 size={12} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Tab: Time & Limits
// ─────────────────────────────────────────────────────────────────────────────

// function TimeLimitsTab({
//   config, set,
// }: {
//   config: TimeLimitsConfig;
//   set: <K extends keyof TimeLimitsConfig>(key: K, value: TimeLimitsConfig[K]) => void;
// }) {
//   return (
//     <div className="qgc-card">
//       <div className="qgc-card-header">
//         <span className="qgc-card-title">Time & Limit Settings</span>
//       </div>



//       <div className="qgc-field qgc-field--row">
//         <div className="qgc-field-meta">
//           <div className="qgc-field-label">Auto-Accept Default</div>
//           {/* <div className="qgc-field-code">auto_accept_enabled_default · Boolean · default: false</div> */}
//           <div className="qgc-field-desc">
//             The default auto-accept setting applied when a new worker joins the platform. When
//             enabled, gigs are accepted automatically on behalf of the worker.
//           </div>
//         </div>
//         <Toggle
//           value={config.auto_accept_enabled_default}
//           onChange={(v) => set("auto_accept_enabled_default", v)}
//         />
//       </div>

//       <div className="qgc-field qgc-field--row">
//         <div className="qgc-field-meta">
//           <div className="qgc-field-label">Worker Availability Default</div>
//           {/* <div className="qgc-field-code">worker_toggle_default · Boolean · default: false</div> */}
//           <div className="qgc-field-desc">
//             Default availability state (ON / OFF) when a worker opens the app. When enabled,
//             workers start as available immediately upon opening.
//           </div>
//         </div>
//         <Toggle
//           value={config.worker_toggle_default}
//           onChange={(v) => set("worker_toggle_default", v)}
//         />
//       </div>
//     </div>
//   );
// }

// ─────────────────────────────────────────────────────────────────────────────
// Tab: Matching Engine
// ─────────────────────────────────────────────────────────────────────────────

function MatchingEngineTab({
  config, set,
}: {
  config: MatchingEngineConfig;
  set: <K extends keyof MatchingEngineConfig>(key: K, value: MatchingEngineConfig[K]) => void;
}) {
  return (
    <div className="qgc-card">
      <div className="qgc-card-header">
        <span className="qgc-card-title">Matching Engine Settings</span>
      </div>
      <div className="qgc-field qgc-field--row">
        <div className="qgc-field-meta">
          <div className="qgc-field-label">Review Window</div>
          {/* <div className="qgc-field-code">review_window_seconds · Integer · default: 20</div> */}
          <div className="qgc-field-desc">
            Time given to a worker to accept or decline a gig before the system automatically
            counts it as a decline and moves to the next candidate.
          </div>
        </div>
        <div className="qgc-number-wrap">
          <input
            className="qgc-number"
            type="number"
            min={5}
            value={config.review_window_seconds}
            onChange={(e) => set("review_window_seconds", Math.max(5, parseInt(e.target.value) || 5))}
          />
          <span className="qgc-unit">seconds</span>
        </div>
      </div>
      <div className="qgc-field qgc-field--row">
        <div className="qgc-field-meta">
          <div className="qgc-field-label">Max Search Radius</div>
          <div className="qgc-field-desc">
            Maximum distance from the gig location to search for available workers. Leave blank
            to remove the radius limit and search all available workers.
          </div>
        </div>

        <div className="qgc-nullable-wrap">
          {config.max_search_radius_km === null ? (
            <>
              <span className="qgc-optional-label">No limit set</span>
              <Button variant="secondary" size="sm" onClick={() => set("max_search_radius_km", 10)}>
                Set limit
              </Button>
            </>
          ) : (
            <>
              <div className="qgc-number-wrap">
                <input
                  className="qgc-number"
                  type="number"
                  min={1}
                  value={config.max_search_radius_km}
                  onChange={(e) => set("max_search_radius_km", Math.max(1, parseInt(e.target.value) || 1))}
                />
                <span className="qgc-unit">km</span>
              </div>
              <Button variant="ghost" size="sm" onClick={() => set("max_search_radius_km", null)}>
                Clear
              </Button>
            </>
          )}
        </div>
      </div>

      <div className="qgc-field qgc-field--row">
        <div className="qgc-field-meta">
          <div className="qgc-field-label">Allow Reassignment After Exhaustion</div>
          {/* <div className="qgc-field-code">allow_reassignment_after_exhaustion · Boolean · default: true</div> */}
          <div className="qgc-field-desc">
            When enabled, workers who previously declined the gig can be reconsidered if no other
            worker accepts it — useful when worker supply is low.
          </div>
        </div>
        <Toggle
          value={config.allow_reassignment_after_exhaustion}
          onChange={(v) => set("allow_reassignment_after_exhaustion", v)}
        />
      </div>

      <div className="qgc-field qgc-field--row">
        <div className="qgc-field-meta">
          <div className="qgc-field-label">Search Timeout</div>
          {/* <div className="qgc-field-code">search_timeout_minutes · Integer</div> */}
          <div className="qgc-field-desc">
            How long the system continues searching for a worker after a gig is posted. After this
            period expires, the host is notified that no worker was found.
          </div>
        </div>
        <div className="qgc-number-wrap">
          <input
            className="qgc-number"
            type="number"
            min={1}
            value={config.search_timeout_minutes}
            onChange={(e) => set("search_timeout_minutes", Math.max(1, parseInt(e.target.value) || 1))}
          />
          <span className="qgc-unit">minutes</span>
        </div>
      </div>

      <div className="qgc-field qgc-field--row">
        <div className="qgc-field-meta">
          <div className="qgc-field-label">Max Dispatch Attempts</div>
          {/* <div className="qgc-field-code">max_dispatch_attempts · Integer</div> */}
          <div className="qgc-field-desc">
            Maximum number of individual workers to try before stopping dispatch and marking
            the gig as unfilled.
          </div>
        </div>
        <div className="qgc-number-wrap">
          <input
            className="qgc-number"
            type="number"
            min={1}
            value={config.max_dispatch_attempts}
            onChange={(e) => set("max_dispatch_attempts", Math.max(1, parseInt(e.target.value) || 1))}
          />
          <span className="qgc-unit">workers</span>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Tab: Notifications
// ─────────────────────────────────────────────────────────────────────────────

interface NotifTemplate {
  key: keyof NotificationsConfig;
  label: string;
  desc: string;
  recipient: string;
  color: string;
}

const NOTIF_TEMPLATES: NotifTemplate[] = [
  {
    key: "notification_template_suspension",
    label: "Worker Suspended",
    desc: "Message sent to a worker when their account is automatically suspended due to excessive gig declines.",
    recipient: "Worker",
    color: "var(--orange)",
  },
  {
    key: "notification_template_dispatch",
    label: "Gig Dispatched",
    desc: "Notification sent to a worker when a gig has been assigned and they are expected to accept or decline.",
    recipient: "Worker",
    color: "var(--blue)",
  },
  {
    key: "notification_template_timeout",
    label: "Response Timeout",
    desc: "Message sent to a worker when they fail to respond within the review window and the gig moves on.",
    recipient: "Worker",
    color: "var(--purple)",
  },
  {
    key: "notification_template_no_worker_found",
    label: "No Worker Found",
    desc: "Message shown to the host when no available worker accepts the gig within the search timeout period.",
    recipient: "Host",
    color: "var(--red)",
  },
];

function NotificationsTab({
  config, set,
}: {
  config: NotificationsConfig;
  set: <K extends keyof NotificationsConfig>(key: K, value: NotificationsConfig[K]) => void;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div className="qgc-info">
        <Info size={14} style={{ color: "var(--blue)", flexShrink: 0, marginTop: 1 }} />
        <span>
          These are plain-text notification messages. Keep them concise and informative.
          Future versions may support dynamic variables like{" "}
          <code style={{ fontFamily: "monospace", fontSize: 11 }}>{"{worker_name}"}</code>.
        </span>
      </div>

      {NOTIF_TEMPLATES.map(({ key, label, desc, recipient, color }) => (
        <div key={key} className="qgc-card">
          <div className="qgc-card-header">
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span className="qgc-card-title">{label}</span>
              <span style={{
                fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 20,
                background: `color-mix(in srgb, ${color} 12%, transparent)`,
                color, letterSpacing: "0.04em",
              }}>
                → {recipient}
              </span>
            </div>
          </div>
          <div className="qgc-field qgc-field--col">
            {/* <div className="qgc-field-code">{key}</div> */}
            <div className="qgc-field-desc">{desc}</div>
            <textarea
              className="qgc-textarea"
              value={config[key]}
              onChange={(e) => set(key, e.target.value)}
              rows={3}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared: Toggle
// ─────────────────────────────────────────────────────────────────────────────

function Toggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="qgc-toggle-wrap">
      <span className={`qgc-toggle-state qgc-toggle-state--${value ? "on" : "off"}`}>
        {value ? "ON" : "OFF"}
      </span>
      <button
        className={`qgc-toggle qgc-toggle--${value ? "on" : "off"}`}
        onClick={() => onChange(!value)}
        role="switch"
        aria-checked={value}
      >
        <span className="qgc-toggle-thumb" />
      </button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared: Loading skeleton
// ─────────────────────────────────────────────────────────────────────────────

function LoadingSkeleton() {
  return (
    <div className="qgc-card">
      <div style={{ padding: 20, display: "flex", flexDirection: "column", gap: 20 }}>
        {[1, 2, 3].map((i) => (
          <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 24 }}>
            <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 6 }}>
              <div className="qgc-skeleton" style={{ height: 14, width: "40%" }} />
              <div className="qgc-skeleton" style={{ height: 11, width: "65%" }} />
              <div className="qgc-skeleton" style={{ height: 11, width: "80%" }} />
            </div>
            <div className="qgc-skeleton" style={{ height: 34, width: 100, borderRadius: 8 }} />
          </div>
        ))}
      </div>
    </div>
  );
}
