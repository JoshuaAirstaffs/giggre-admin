"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { useParams, useRouter } from "next/navigation";
import AdminLayout from "@/components/layout/AdminLayout";
import Badge from "@/components/ui/Badge";
import Button from "@/components/ui/Button";
import Modal, { ConfirmDialog } from "@/components/ui/Modal";
import { useAuthGuard } from "@/hooks/useAuthGuard";
import {
  doc,
  onSnapshot,
  collection,
  getDocs,
  getDoc,
  query,
  where,
  documentId,
  updateDoc,
  serverTimestamp,
  Timestamp,
  GeoPoint,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { writeLog, buildDescription } from "@/lib/activitylog";
import {
  ArrowLeft, User, MapPin, Star, Briefcase,
  Clock, Shield, Wrench, Plus, Trash2, ChevronLeft, ChevronRight, CheckCircle,
  Copy, Check, Ban, ShieldOff, ShieldCheck, AlertTriangle, History,
  GitBranch, BadgeCheck, ExternalLink, FileText, UserX,
} from "lucide-react";
import { useCurrency } from "@/context/CurrencyContext";

// ─── Types ────────────────────────────────────────────────────────────────────

interface UserDoc {
  id: string;
  name: string;
  email: string;
  phone: string;
  balance: number;
  createdAt: Timestamp | null;
  isOnline: boolean;
  role: string;
  signInMethod: string;
  // Ratings & performance
  ratingAsHost: number;
  ratingAsWorker: number;
  ratingCount: number;
  acceptanceRate: number;
  decline_count: number;
  quickGigDailyDeclineCount: number;
  quickGigTotalDeclines: number;
  totalGigs: number;
  // Availability
  autoAccept: boolean;
  availableForGigs: boolean;
  seekingQuickGigs: boolean;
  openGigsUnlocked: boolean;
  slot: number;
  // Location
  location: GeoPoint | null;
  lastOnline: Timestamp | null;
  // Status
  suspended_until: Timestamp | null;
  isBanned: boolean;
  pendingDeletion: boolean;
  scheduledDeleteAt: Timestamp | null;
  ban_reason: string | null;
  // Skills (legacy array)
  skills: string[];
  // Skills XP object
  skillsXP: Record<string, number>;
  // Host-eligible reward skills
  hostRewardSkills: string[];
  // Referrals
  referral_code: string | null;
  referral_level: number;
  referrals_count: number;
  verified_referrals: number;
  referredByName: string | null;
  referredByUID: string | null;
  referred_by: string | null;
  // Blocking
  blockedUsers: string[];
}

interface SkillEntry {
  id: string;
  name: string;
}

type WorkedGigType = "offered" | "open" | "quick";
const WORKED_GIG_COLLECTIONS: Record<WorkedGigType, string> = {
  offered: "offered_gigs",
  open: "open_gigs",
  quick: "quick_gigs",
};
const WORKED_GIG_LABELS: Record<WorkedGigType, string> = {
  offered: "Offered",
  open: "Open",
  quick: "Quick",
};

interface WorkedGig {
  id: string;
  gigType: WorkedGigType;
  title: string;
  status: string;
  salary?: string | number;
  createdAt: Timestamp | null;
  hostId?: string;
  hostName?: string;
  assignedWorkerId?: string;
  assignedWorkerName?: string;
  workerRating?: number;
  hostRating?: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(ts: Timestamp | null): string {
  if (!ts) return "N/A";
  return ts.toDate().toLocaleDateString("en-US", {
    month: "short", day: "numeric", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

function formatBalance(n: number): string {
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n ?? 0);
}

function formatLocation(loc: GeoPoint | null): string {
  if (!loc) return "No Location";
  return `${loc.latitude.toFixed(5)}, ${loc.longitude.toFixed(5)}`;
}

function formatRating(n: number): string {
  if (!n && n !== 0) return "N/A";
  return n.toFixed(1);
}

function formatRelativeTime(ts: Timestamp | null): string {
  if (!ts) return "Never";
  const diff = Date.now() - ts.toDate().getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return `${weeks}w ago`;
  return ts.toDate().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function isCurrentlySuspended(user: UserDoc): boolean {
  if (!user.suspended_until) return false;
  return user.suspended_until.toDate() > new Date();
}

function toUserDoc(id: string, d: Record<string, any>): UserDoc {
  return {
    id,
    name:              d.name              ?? "No Name",
    email:             d.email             ?? "No Email",
    phone:             d.phone             ?? "No Phone",
    balance:           typeof d.balance === "number" ? d.balance : 0,
    createdAt:         d.createdAt instanceof Timestamp ? d.createdAt : null,
    isOnline:          d.isOnline          ?? false,
    role:              d.role              ?? "N/A",
    signInMethod:      d.signInMethod      ?? "N/A",
    ratingAsHost:      typeof d.ratingAsHost      === "number" ? d.ratingAsHost      : 0,
    ratingAsWorker:    typeof d.ratingAsWorker    === "number" ? d.ratingAsWorker    : 0,
    ratingCount:       typeof d.ratingCount       === "number" ? d.ratingCount       : 0,
    acceptanceRate:    typeof d.acceptanceRate    === "number" ? d.acceptanceRate    : 0,
    decline_count:     typeof d.decline_count     === "number" ? d.decline_count     : 0,
    quickGigDailyDeclineCount: typeof d.quickGigDailyDeclineCount === "number" ? d.quickGigDailyDeclineCount : 0,
    quickGigTotalDeclines:     typeof d.quickGigTotalDeclines     === "number" ? d.quickGigTotalDeclines     : 0,
    totalGigs:                 typeof d.totalGigs                 === "number" ? d.totalGigs                 : 0,
    autoAccept:        d.autoAccept        ?? false,
    availableForGigs:  d.availableForGigs  ?? false,
    seekingQuickGigs:  d.seekingQuickGigs  ?? false,
    openGigsUnlocked:  d.openGigsUnlocked  ?? false,
    slot:              typeof d.slot       === "number" ? d.slot : 0,
    location:          d.location instanceof GeoPoint ? d.location : null,
    suspended_until:   d.suspended_until instanceof Timestamp ? d.suspended_until : null,
    isBanned:          d.isBanned          ?? false,
    pendingDeletion:   d.pendingDeletion   ?? false,
    scheduledDeleteAt: d.scheduledDeleteAt instanceof Timestamp ? d.scheduledDeleteAt : null,
    lastOnline: d.lastOnline instanceof Timestamp ? d.lastOnline : null,
    ban_reason:        typeof d.ban_reason === "string" ? d.ban_reason : null,
    skills:            Array.isArray(d.skills)   ? d.skills   : [],
    skillsXP:          d.skillsXP && typeof d.skillsXP === "object" ? d.skillsXP : {},
    hostRewardSkills:  Array.isArray(d.hostRewardSkills) ? d.hostRewardSkills : [],
    referral_code:     typeof (d.referrals as any)?.referral_code === "string" ? (d.referrals as any).referral_code : null,
    referral_level:    typeof (d.referrals as any)?.referral_level === "number" ? (d.referrals as any).referral_level : 0,
    referrals_count:   typeof (d.referrals as any)?.referrals_count === "number" ? (d.referrals as any).referrals_count : 0,
    verified_referrals: typeof (d.referrals as any)?.verified_referrals === "number" ? (d.referrals as any).verified_referrals : 0,
    referredByName:    typeof (d.referrals as any)?.referredByName === "string" ? (d.referrals as any).referredByName : null,
    referredByUID:     typeof (d.referrals as any)?.referredByUID === "string" ? (d.referrals as any).referredByUID : null,
    referred_by:       typeof d.referred_by === "string" ? d.referred_by : null,
    blockedUsers:      Array.isArray(d.blockedUsers) ? d.blockedUsers : [],
  };
}

// ─── Info Row ─────────────────────────────────────────────────────────────────

function InfoRow({ label, value, mono = false }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16, padding: "9px 0", borderBottom: "1px solid var(--border-muted)" }}>
      <span style={{ fontSize: 12, color: "var(--text-muted)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.5px", flexShrink: 0 }}>
        {label}
      </span>
      <span style={{ fontSize: 13, color: "var(--text-primary)", textAlign: "right", fontFamily: mono ? "monospace" : undefined, wordBreak: "break-all" }}>
        {value}
      </span>
    </div>
  );
}

function SectionCard({ title, icon: Icon, children }: { title: string; icon: React.ElementType; children: React.ReactNode }) {
  return (
    <div style={{ background: "var(--bg-surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", padding: "20px 24px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
        <Icon size={15} style={{ color: "var(--blue)" }} />
        <span style={{ fontSize: 13, fontWeight: 700, color: "var(--text-primary)" }}>{title}</span>
      </div>
      {children}
    </div>
  );
}

// ─── Skills Modal ─────────────────────────────────────────────────────────────

interface SkillsModalProps {
  open: boolean;
  onClose: () => void;
  user: UserDoc;
  availableSkills: SkillEntry[];
  onSave: (newSkillsXP: Record<string, number>) => Promise<void>;
  saving: boolean;
}

function SkillsModal({ open, onClose, user, availableSkills, onSave, saving }: SkillsModalProps) {
  const [skillsXP, setSkillsXP] = useState<Record<string, number>>({});
  const [selectedSkill, setSelectedSkill] = useState("");
  const [selectedLevel, setSelectedLevel] = useState(1);
  const [skillSearch, setSkillSearch] = useState("");
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [error, setError] = useState("");
  const [checkedSkills, setCheckedSkills] = useState<Set<string>>(new Set());

  // Reset when opening
  useEffect(() => {
    if (open) {
      setSkillsXP({ ...user.skillsXP });
      setSelectedSkill("");
      setSelectedLevel(1);
      setSkillSearch("");
      setDropdownOpen(false);
      setError("");
      setCheckedSkills(new Set());
    }
  }, [open, user.skillsXP]);

  const unassignedSkills = availableSkills.filter((s) => !(s.name in skillsXP));
  const filteredSkills = skillSearch.trim()
    ? unassignedSkills.filter((s) => s.name.toLowerCase().includes(skillSearch.trim().toLowerCase()))
    : unassignedSkills;

  const handleAdd = () => {
    if (!selectedSkill) { setError("Select a skill."); return; }
    if (selectedSkill in skillsXP) { setError("Skill already assigned."); return; }
    if (selectedLevel < 1 || selectedLevel > 5) { setError("Level must be between 1 and 5."); return; }
    setSkillsXP((prev) => ({ ...prev, [selectedSkill]: selectedLevel }));
    setSelectedSkill("");
    setSkillSearch("");
    setSelectedLevel(1);
    setDropdownOpen(false);
    setError("");
  };

  const handleSkillSelect = (skillName: string) => {
    setSelectedSkill(skillName);
    setSkillSearch(skillName);
    setDropdownOpen(false);
    setError("");
  };

  const handleRemove = (skillName: string) => {
    setSkillsXP((prev) => {
      const next = { ...prev };
      delete next[skillName];
      return next;
    });
    setCheckedSkills((prev) => { const next = new Set(prev); next.delete(skillName); return next; });
  };

  const handleBulkRemove = () => {
    setSkillsXP((prev) => {
      const next = { ...prev };
      checkedSkills.forEach((k) => delete next[k]);
      return next;
    });
    setCheckedSkills(new Set());
  };

  const toggleCheck = (skillName: string) => {
    setCheckedSkills((prev) => {
      const next = new Set(prev);
      next.has(skillName) ? next.delete(skillName) : next.add(skillName);
      return next;
    });
  };

  const handleLevelChange = (skillName: string, level: number) => {
    const clamped = Math.max(1, Math.min(5, level));
    setSkillsXP((prev) => ({ ...prev, [skillName]: clamped }));
  };

  const entries = Object.entries(skillsXP);
  const allChecked = entries.length > 0 && checkedSkills.size === entries.length;
  const toggleAll = () => setCheckedSkills(allChecked ? new Set() : new Set(entries.map(([k]) => k)));

  return (
    <Modal
      open={open}
      onClose={saving ? () => {} : onClose}
      title="Manage Skills"
      description={`Assign skills and levels for ${user.name}`}
      size="md"
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button variant="primary" size="sm" loading={saving} onClick={() => onSave(skillsXP)}>Save Skills</Button>
        </>
      }
    >
      <style>{`
        .sm-skill-row { display: flex; align-items: center; gap: 10px; padding: 8px 0; border-bottom: 1px solid var(--border-muted); }
        .sm-skill-row:last-child { border-bottom: none; }
        .sm-skill-row.checked { background: color-mix(in srgb, var(--red) 6%, transparent); border-radius: 6px; }
        .sm-skill-name { flex: 1; font-size: 13px; color: var(--text-primary); font-weight: 500; }
        .sm-level-input { width: 56px; padding: 4px 8px; border-radius: 6px; border: 1px solid var(--border); background: var(--bg-elevated); color: var(--text-primary); font-size: 13px; font-family: inherit; text-align: center; }
        .sm-level-input:focus { outline: none; border-color: var(--blue); }
        .sm-remove-btn { width: 26px; height: 26px; border-radius: 5px; border: 1px solid var(--border); background: var(--bg-elevated); color: var(--text-muted); display: flex; align-items: center; justify-content: center; cursor: pointer; transition: all 0.15s; flex-shrink: 0; }
        .sm-remove-btn:hover { background: var(--red-dim); color: var(--red); border-color: rgba(239,68,68,0.3); }
        .sm-bulk-bar { display: flex; align-items: center; gap: 8px; padding: 6px 10px; background: var(--red-dim); border: 1px solid rgba(239,68,68,0.25); border-radius: 6px; margin-bottom: 10px; }
        .sm-bulk-label { flex: 1; font-size: 12px; color: var(--red); font-weight: 600; }
        .sm-bulk-del { display: flex; align-items: center; gap: 5px; padding: 4px 10px; border-radius: 5px; border: 1px solid rgba(239,68,68,0.4); background: none; color: var(--red); font-size: 12px; font-family: inherit; cursor: pointer; transition: all 0.15s; font-weight: 600; }
        .sm-bulk-del:hover { background: var(--red); color: #fff; }
        .sm-check { width: 15px; height: 15px; accent-color: var(--red); cursor: pointer; flex-shrink: 0; }
        .sm-add-row { display: flex; gap: 8px; margin-bottom: 16px; flex-wrap: wrap; align-items: flex-start; }
        .sm-search-wrap { position: relative; flex: 1; min-width: 140px; }
        .sm-search-input { width: 100%; padding: 7px 10px; border-radius: 6px; border: 1px solid var(--border); background: var(--bg-elevated); color: var(--text-primary); font-size: 13px; font-family: inherit; box-sizing: border-box; }
        .sm-search-input:focus { outline: none; border-color: var(--blue); }
        .sm-search-input.selected { border-color: var(--blue); background: var(--blue-dim); }
        .sm-dropdown { position: absolute; top: calc(100% + 4px); left: 0; right: 0; background: var(--bg-surface); border: 1px solid var(--border); border-radius: 8px; box-shadow: 0 8px 24px rgba(0,0,0,0.2); z-index: 100; max-height: 200px; overflow-y: auto; }
        .sm-dropdown-item { padding: 8px 12px; font-size: 13px; color: var(--text-primary); cursor: pointer; transition: background 0.1s; }
        .sm-dropdown-item:hover { background: var(--bg-elevated); }
        .sm-dropdown-empty { padding: 10px 12px; font-size: 12px; color: var(--text-muted); font-style: italic; }
        .sm-level-sel { width: 70px; padding: 7px 10px; border-radius: 6px; border: 1px solid var(--border); background: var(--bg-elevated); color: var(--text-primary); font-size: 13px; font-family: inherit; }
        .sm-level-sel:focus { outline: none; border-color: var(--blue); }
        .sm-error { font-size: 12px; color: var(--red); margin-top: -8px; margin-bottom: 8px; }
        .sm-empty { font-size: 13px; color: var(--text-muted); font-style: italic; padding: 12px 0; }
        .sm-level-label { display: flex; align-items: center; justify-content: center; width: 24px; height: 24px; border-radius: 50%; font-size: 11px; font-weight: 700; background: var(--blue-dim); color: var(--blue); flex-shrink: 0; }
      `}</style>

      {/* Add skill */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.5px", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: 8 }}>
          Add Skill
        </div>
        <div className="sm-add-row">
          <div className="sm-search-wrap">
            <input
              type="text"
              className={`sm-search-input${selectedSkill ? " selected" : ""}`}
              placeholder="Search skills…"
              value={skillSearch}
              onChange={(e) => {
                setSkillSearch(e.target.value);
                setSelectedSkill("");
                setDropdownOpen(true);
                setError("");
              }}
              onFocus={() => setDropdownOpen(true)}
              onBlur={() => setTimeout(() => setDropdownOpen(false), 150)}
            />
            {dropdownOpen && (
              <div className="sm-dropdown">
                {filteredSkills.length === 0 ? (
                  <div className="sm-dropdown-empty">
                    {skillSearch.trim() ? `No skills match "${skillSearch}"` : "All skills assigned"}
                  </div>
                ) : (
                  filteredSkills.map((s) => (
                    <div
                      key={s.id}
                      className="sm-dropdown-item"
                      onMouseDown={() => handleSkillSelect(s.name)}
                    >
                      {s.name}
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
          <select
            className="sm-level-sel"
            value={selectedLevel}
            onChange={(e) => setSelectedLevel(Number(e.target.value))}
          >
            {[1, 2, 3, 4, 5].map((l) => (
              <option key={l} value={l}>Level {l}</option>
            ))}
          </select>
          <Button variant="primary" size="sm" icon={Plus} onClick={handleAdd} disabled={!selectedSkill}>
            Add
          </Button>
        </div>
        {error && <div className="sm-error">{error}</div>}
      </div>

      {/* Assigned skills */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.5px", textTransform: "uppercase", color: "var(--text-muted)", flex: 1 }}>
          Assigned Skills ({entries.length})
        </span>
        {entries.length > 0 && (
          <label style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11.5, color: "var(--text-muted)", cursor: "pointer", userSelect: "none" }}>
            <input type="checkbox" className="sm-check" checked={allChecked} onChange={toggleAll} />
            Select all
          </label>
        )}
      </div>
      {checkedSkills.size > 0 && (
        <div className="sm-bulk-bar">
          <span className="sm-bulk-label">{checkedSkills.size} skill{checkedSkills.size !== 1 ? "s" : ""} selected</span>
          <button className="sm-bulk-del" onClick={handleBulkRemove}>
            <Trash2 size={12} /> Delete selected
          </button>
        </div>
      )}
      {entries.length === 0 ? (
        <div className="sm-empty">No skills assigned yet.</div>
      ) : (
        <div>
          {entries.map(([skillName, level]) => (
            <div key={skillName} className={`sm-skill-row${checkedSkills.has(skillName) ? " checked" : ""}`}>
              <input type="checkbox" className="sm-check" checked={checkedSkills.has(skillName)} onChange={() => toggleCheck(skillName)} />
              <span className="sm-skill-name">{skillName}</span>
              <span style={{ fontSize: 11, color: "var(--text-muted)" }}>Level</span>
              <input
                type="number"
                className="sm-level-input"
                value={level}
                min={1}
                max={5}
                onChange={(e) => handleLevelChange(skillName, Number(e.target.value))}
              />
              <button className="sm-remove-btn" title="Remove skill" onClick={() => handleRemove(skillName)}>
                <Trash2 size={12} />
              </button>
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}

// ─── Host Reward Skills Modal ─────────────────────────────────────────────────

interface HostRewardSkillsModalProps {
  open: boolean;
  onClose: () => void;
  user: UserDoc;
  availableSkills: SkillEntry[];
  onSave: (newSkills: string[]) => Promise<void>;
  saving: boolean;
}

function HostRewardSkillsModal({ open, onClose, user, availableSkills, onSave, saving }: HostRewardSkillsModalProps) {
  const [skills, setSkills] = useState<string[]>([]);
  const [selectedSkill, setSelectedSkill] = useState("");
  const [skillSearch, setSkillSearch] = useState("");
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [error, setError] = useState("");
  const [checkedSkills, setCheckedSkills] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (open) {
      setSkills([...user.hostRewardSkills]);
      setSelectedSkill("");
      setSkillSearch("");
      setDropdownOpen(false);
      setError("");
      setCheckedSkills(new Set());
    }
  }, [open, user.hostRewardSkills]);

  const unassigned = availableSkills.filter((s) => !skills.includes(s.name));
  const filtered = skillSearch.trim()
    ? unassigned.filter((s) => s.name.toLowerCase().includes(skillSearch.trim().toLowerCase()))
    : unassigned;

  const handleAdd = () => {
    if (!selectedSkill) { setError("Select a skill."); return; }
    if (skills.includes(selectedSkill)) { setError("Skill already added."); return; }
    setSkills((prev) => [...prev, selectedSkill]);
    setSelectedSkill("");
    setSkillSearch("");
    setDropdownOpen(false);
    setError("");
  };

  const handleSelect = (skillName: string) => {
    setSelectedSkill(skillName);
    setSkillSearch(skillName);
    setDropdownOpen(false);
    setError("");
  };

  const handleRemove = (skillName: string) => {
    setSkills((prev) => prev.filter((s) => s !== skillName));
    setCheckedSkills((prev) => { const next = new Set(prev); next.delete(skillName); return next; });
  };

  const handleBulkRemove = () => {
    setSkills((prev) => prev.filter((s) => !checkedSkills.has(s)));
    setCheckedSkills(new Set());
  };

  const toggleCheck = (skillName: string) => {
    setCheckedSkills((prev) => {
      const next = new Set(prev);
      next.has(skillName) ? next.delete(skillName) : next.add(skillName);
      return next;
    });
  };

  const allChecked = skills.length > 0 && checkedSkills.size === skills.length;
  const toggleAll = () => setCheckedSkills(allChecked ? new Set() : new Set(skills));

  return (
    <Modal
      open={open}
      onClose={saving ? () => {} : onClose}
      title="Host-Eligible Reward Skills"
      description={`Manage host-eligible reward skills for ${user.name}`}
      size="md"
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button variant="primary" size="sm" loading={saving} onClick={() => onSave(skills)}>Save Skills</Button>
        </>
      }
    >
      <style>{`
        .hrs-skill-row { display: flex; align-items: center; gap: 10px; padding: 8px 0; border-bottom: 1px solid var(--border-muted); }
        .hrs-skill-row:last-child { border-bottom: none; }
        .hrs-skill-row.checked { background: color-mix(in srgb, var(--red) 6%, transparent); border-radius: 6px; }
        .hrs-skill-name { flex: 1; font-size: 13px; color: var(--text-primary); font-weight: 500; }
        .hrs-remove-btn { width: 26px; height: 26px; border-radius: 5px; border: 1px solid var(--border); background: var(--bg-elevated); color: var(--text-muted); display: flex; align-items: center; justify-content: center; cursor: pointer; transition: all 0.15s; flex-shrink: 0; }
        .hrs-remove-btn:hover { background: var(--red-dim); color: var(--red); border-color: rgba(239,68,68,0.3); }
        .hrs-bulk-bar { display: flex; align-items: center; gap: 8px; padding: 6px 10px; background: var(--red-dim); border: 1px solid rgba(239,68,68,0.25); border-radius: 6px; margin-bottom: 10px; }
        .hrs-bulk-label { flex: 1; font-size: 12px; color: var(--red); font-weight: 600; }
        .hrs-bulk-del { display: flex; align-items: center; gap: 5px; padding: 4px 10px; border-radius: 5px; border: 1px solid rgba(239,68,68,0.4); background: none; color: var(--red); font-size: 12px; font-family: inherit; cursor: pointer; transition: all 0.15s; font-weight: 600; }
        .hrs-bulk-del:hover { background: var(--red); color: #fff; }
        .hrs-check { width: 15px; height: 15px; accent-color: var(--red); cursor: pointer; flex-shrink: 0; }
        .hrs-add-row { display: flex; gap: 8px; margin-bottom: 16px; flex-wrap: wrap; align-items: flex-start; }
        .hrs-search-wrap { position: relative; flex: 1; min-width: 160px; }
        .hrs-search-input { width: 100%; padding: 7px 10px; border-radius: 6px; border: 1px solid var(--border); background: var(--bg-elevated); color: var(--text-primary); font-size: 13px; font-family: inherit; box-sizing: border-box; }
        .hrs-search-input:focus { outline: none; border-color: var(--blue); }
        .hrs-search-input.selected { border-color: var(--blue); background: var(--blue-dim); }
        .hrs-dropdown { position: absolute; top: calc(100% + 4px); left: 0; right: 0; background: var(--bg-surface); border: 1px solid var(--border); border-radius: 8px; box-shadow: 0 8px 24px rgba(0,0,0,0.2); z-index: 100; max-height: 200px; overflow-y: auto; }
        .hrs-dropdown-item { padding: 8px 12px; font-size: 13px; color: var(--text-primary); cursor: pointer; transition: background 0.1s; }
        .hrs-dropdown-item:hover { background: var(--bg-elevated); }
        .hrs-dropdown-empty { padding: 10px 12px; font-size: 12px; color: var(--text-muted); font-style: italic; }
        .hrs-error { font-size: 12px; color: var(--red); margin-top: -8px; margin-bottom: 8px; }
        .hrs-empty { font-size: 13px; color: var(--text-muted); font-style: italic; padding: 12px 0; }
      `}</style>

      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.5px", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: 8 }}>
          Add Skill
        </div>
        <div className="hrs-add-row">
          <div className="hrs-search-wrap">
            <input
              type="text"
              className={`hrs-search-input${selectedSkill ? " selected" : ""}`}
              placeholder="Search skills…"
              value={skillSearch}
              onChange={(e) => {
                setSkillSearch(e.target.value);
                setSelectedSkill("");
                setDropdownOpen(true);
                setError("");
              }}
              onFocus={() => setDropdownOpen(true)}
              onBlur={() => setTimeout(() => setDropdownOpen(false), 150)}
            />
            {dropdownOpen && (
              <div className="hrs-dropdown">
                {filtered.length === 0 ? (
                  <div className="hrs-dropdown-empty">
                    {skillSearch.trim() ? `No skills match "${skillSearch}"` : "All skills assigned"}
                  </div>
                ) : (
                  filtered.map((s) => (
                    <div key={s.id} className="hrs-dropdown-item" onMouseDown={() => handleSelect(s.name)}>
                      {s.name}
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
          <Button variant="primary" size="sm" icon={Plus} onClick={handleAdd} disabled={!selectedSkill}>
            Add
          </Button>
        </div>
        {error && <div className="hrs-error">{error}</div>}
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.5px", textTransform: "uppercase", color: "var(--text-muted)", flex: 1 }}>
          Assigned Skills ({skills.length})
        </span>
        {skills.length > 0 && (
          <label style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11.5, color: "var(--text-muted)", cursor: "pointer", userSelect: "none" }}>
            <input type="checkbox" className="hrs-check" checked={allChecked} onChange={toggleAll} />
            Select all
          </label>
        )}
      </div>
      {checkedSkills.size > 0 && (
        <div className="hrs-bulk-bar">
          <span className="hrs-bulk-label">{checkedSkills.size} skill{checkedSkills.size !== 1 ? "s" : ""} selected</span>
          <button className="hrs-bulk-del" onClick={handleBulkRemove}>
            <Trash2 size={12} /> Delete selected
          </button>
        </div>
      )}
      {skills.length === 0 ? (
        <div className="hrs-empty">No reward skills assigned yet.</div>
      ) : (
        <div>
          {skills.map((skillName) => (
            <div key={skillName} className={`hrs-skill-row${checkedSkills.has(skillName) ? " checked" : ""}`}>
              <input type="checkbox" className="hrs-check" checked={checkedSkills.has(skillName)} onChange={() => toggleCheck(skillName)} />
              <span className="hrs-skill-name">{skillName}</span>
              <button className="hrs-remove-btn" title="Remove skill" onClick={() => handleRemove(skillName)}>
                <Trash2 size={12} />
              </button>
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}

// ─── Suspension helpers ───────────────────────────────────────────────────────

interface SuspensionHistoryEntry {
  id: string;
  action: string;
  description: string;
  actorName: string;
  createdAt: Timestamp | null;
  meta: {
    other?: {
      duration_minutes?: number;
      tier?: string;
      reason?: string;
    };
  } | null;
}

interface SuspensionTier {
  decline_count_trigger: number;
  suspension_duration_minutes: number;
  tier_label?: string;
  is_active: boolean;
}

function getApplicableTier(declineCount: number, tiers: SuspensionTier[]): SuspensionTier | null {
  const active = tiers.filter((t) => t.is_active && declineCount >= t.decline_count_trigger);
  if (active.length === 0) return null;
  return active.reduce((prev, curr) =>
    curr.decline_count_trigger > prev.decline_count_trigger ? curr : prev
  );
}

type ConfirmAction = "ban" | "unban" | "lift" | "delete" | "cancel_deletion" | null;

// ─── Suspend Modal ────────────────────────────────────────────────────────────

function SuspendModal({
  open, onClose, user, tiers, onConfirm, loading,
}: {
  open: boolean;
  onClose: () => void;
  user: UserDoc | null;
  tiers: SuspensionTier[];
  onConfirm: (minutes: number, label: string) => void;
  loading: boolean;
}) {
  const activeTiers = [...tiers].sort((a, b) => a.decline_count_trigger - b.decline_count_trigger);
  const [selected, setSelected] = useState<number | "custom">("custom");
  const [customMin, setCustomMin] = useState(60);

  useEffect(() => {
    if (!open || !user) return;
    let best = -1;
    activeTiers.forEach((t, i) => {
      if (user.decline_count >= t.decline_count_trigger) best = i;
    });
    setSelected(best >= 0 ? best : "custom");
    setCustomMin(60);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const selectedMinutes =
    selected === "custom"
      ? customMin
      : (activeTiers[selected as number]?.suspension_duration_minutes ?? 0);

  const selectedLabel =
    selected === "custom"
      ? "Custom"
      : (activeTiers[selected as number]?.tier_label || `Tier ${(selected as number) + 1}`);

  if (!user) return null;

  return (
    <Modal
      open={open}
      onClose={loading ? () => {} : onClose}
      title="Suspend User"
      description={`${user.name} · ${user.decline_count} decline${user.decline_count !== 1 ? "s" : ""}`}
      size="sm"
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose} disabled={loading}>Cancel</Button>
          <Button
            variant="primary" size="sm"
            loading={loading}
            disabled={selected === "custom" ? customMin < 1 : false}
            onClick={() => onConfirm(selectedMinutes, selectedLabel)}
          >
            Suspend
          </Button>
        </>
      }
    >
      <style>{`
        .sus-tier { display: flex; align-items: center; gap: 10px; padding: 10px 12px; border-radius: 8px; border: 1px solid var(--border); background: var(--bg-elevated); cursor: pointer; transition: all 0.15s; margin-bottom: 6px; }
        .sus-tier:hover { border-color: var(--blue); }
        .sus-tier.active { border-color: var(--blue); background: var(--blue-dim); }
        .sus-tier-radio { width: 15px; height: 15px; border-radius: 50%; border: 2px solid var(--border); flex-shrink: 0; display: flex; align-items: center; justify-content: center; transition: all 0.15s; }
        .sus-tier.active .sus-tier-radio { border-color: var(--blue); }
        .sus-tier.active .sus-tier-radio::after { content: ''; width: 7px; height: 7px; border-radius: 50%; background: var(--blue); display: block; }
        .sus-tier-label { flex: 1; font-size: 13px; font-weight: 600; color: var(--text-primary); }
        .sus-tier-meta { font-size: 11px; color: var(--text-muted); }
        .sus-tier-trigger { font-size: 10px; font-weight: 600; padding: 2px 7px; border-radius: 20px; background: rgba(249,115,22,0.12); color: var(--orange,#f97316); white-space: nowrap; }
        .sus-divider { border: none; border-top: 1px solid var(--border-muted); margin: 10px 0; }
        .sus-custom-row { display: flex; align-items: center; gap: 10px; }
        .sus-custom-input { width: 80px; padding: 6px 10px; border-radius: 6px; border: 1px solid var(--border); background: var(--bg-elevated); color: var(--text-primary); font-size: 13px; font-family: inherit; text-align: center; }
        .sus-custom-input:focus { outline: none; border-color: var(--blue); }
        .sus-section-label { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.6px; color: var(--text-muted); margin-bottom: 8px; }
      `}</style>

      {activeTiers.length > 0 && (
        <>
          <div className="sus-section-label">Suspension Tiers</div>
          {activeTiers.map((tier, i) => (
            <div
              key={i}
              className={`sus-tier${selected === i ? " active" : ""}`}
              onClick={() => setSelected(i)}
            >
              <div className="sus-tier-radio" />
              <div style={{ flex: 1 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span className="sus-tier-label">{tier.tier_label || `Tier ${i + 1}`}</span>
                  <span className="sus-tier-trigger">≥ {tier.decline_count_trigger} declines</span>
                </div>
                <div className="sus-tier-meta">{tier.suspension_duration_minutes} minutes suspension</div>
              </div>
              <span style={{ fontSize: 12, fontWeight: 700, color: "var(--text-secondary)" }}>
                {tier.suspension_duration_minutes}m
              </span>
            </div>
          ))}
          <div className="sus-divider" />
        </>
      )}

      <div className="sus-section-label">Custom Duration</div>
      <div
        className={`sus-tier${selected === "custom" ? " active" : ""}`}
        onClick={() => setSelected("custom")}
      >
        <div className="sus-tier-radio" />
        <span className="sus-tier-label">Custom</span>
        {selected === "custom" && (
          <div className="sus-custom-row" onClick={(e) => e.stopPropagation()}>
            <input
              type="number"
              className="sus-custom-input"
              value={customMin}
              min={1}
              onChange={(e) => setCustomMin(Math.max(1, Number(e.target.value)))}
            />
            <span className="sus-tier-meta">minutes</span>
          </div>
        )}
      </div>
    </Modal>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function UserProfilePage() {
  const { user: adminUser } = useAuthGuard({ module: "users" });
  const params = useParams();
  const router = useRouter();
  const userId = params.userId as string;
  const { symbol } = useCurrency();

  const [userData, setUserData]         = useState<UserDoc | null>(null);
  const [loading, setLoading]           = useState(true);
  const [availableSkills, setAvailableSkills] = useState<SkillEntry[]>([]);
  const [skillsModalOpen, setSkillsModalOpen] = useState(false);
  const [savingSkills, setSavingSkills]  = useState(false);
  const [hostRewardSkillsModalOpen, setHostRewardSkillsModalOpen] = useState(false);
  const [savingHostRewardSkills, setSavingHostRewardSkills] = useState(false);
  const [postedGigs, setPostedGigs]      = useState<WorkedGig[]>([]);
  const [postedGigsLoading, setPostedGigsLoading] = useState(false);
  const [postedGigsPage, setPostedGigsPage] = useState(1);
  const [workedGigs, setWorkedGigs]      = useState<WorkedGig[]>([]);
  const [workedGigsLoading, setWorkedGigsLoading] = useState(false);
  const [workedGigsPage, setWorkedGigsPage] = useState(1);
  const [copiedKey, setCopiedKey]            = useState<string | null>(null);
  const [suspensionTiers, setSuspensionTiers]   = useState<SuspensionTier[]>([]);
  const [actionLoading, setActionLoading]       = useState<string | null>(null);
  const [confirmAction, setConfirmAction]       = useState<ConfirmAction>(null);
  const [banReason, setBanReason]               = useState("");
  const [suspendModalOpen, setSuspendModalOpen] = useState(false);
  const [suspensionHistory, setSuspensionHistory]   = useState<SuspensionHistoryEntry[]>([]);
  const [historyLoading, setHistoryLoading]         = useState(false);
  const [verificationStatus, setVerificationStatus] = useState<"verified" | "pending" | "rejected" | "cancelled" | null>(null);
  const [verifiedAt, setVerifiedAt]                 = useState<Timestamp | null>(null);
  const [verificationDocs, setVerificationDocs]     = useState<{ category: string; name: string; url: string; uploadedAt: Timestamp | null }[]>([]);
  const [verificationRejectReason, setVerificationRejectReason] = useState<string | null>(null);
  const [referredUsers, setReferredUsers]           = useState<{ uid: string; name: string; email: string; referral_code_used: string | null; joined_at: Timestamp | null; verified_at: Timestamp | null }[]>([]);
  const [referredUsersLoading, setReferredUsersLoading] = useState(false);
  const [referredUsersPage, setReferredUsersPage]   = useState(1);
  const [blockedUsersList, setBlockedUsersList]     = useState<{ uid: string; name: string; email: string }[]>([]);
  const [blockedUsersLoading, setBlockedUsersLoading] = useState(false);
  const [blockedByList, setBlockedByList]           = useState<{ uid: string; name: string; email: string }[]>([]);
  const [blockedByLoading, setBlockedByLoading]     = useState(false);
  const [blockedTab, setBlockedTab]                 = useState<"blocked" | "blockedBy">("blocked");
  const [activeSkillTab, setActiveSkillTab]         = useState<"skills" | "requests" | "delete_request">("skills");
  const [selectedDoc, setSelectedDoc]               = useState<{ category: string; name: string; url: string; uploadedAt: Timestamp | null } | null>(null);
  const [userSkillRequests, setUserSkillRequests]   = useState<{
    id: string; skillName: string; skillCategory: string; status: string;
    reason: string; experienceLevel: string; createdAt: Timestamp | null;
    updatedAt: Timestamp | null; adminRemarks: string; skill_req_Id: string;
  }[]>([]);
  const [userRequestsLoading, setUserRequestsLoading] = useState(false);

  const GIGS_PAGE_SIZE = 10;

  const handleCopy = useCallback((key: string, text: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopiedKey(key);
      setTimeout(() => setCopiedKey((k) => (k === key ? null : k)), 1500);
    });
  }, []);

  // ── Real-time user listener ───────────────────────────────────────────────
  useEffect(() => {
    if (!userId) return;
    setLoading(true);
    const unsub = onSnapshot(
      doc(db, "users", userId),
      (snap) => {
        if (snap.exists()) {
          setUserData(toUserDoc(snap.id, snap.data() as Record<string, any>));
        } else {
          setUserData(null);
        }
        setLoading(false);
      },
      (err) => {
        console.error("[UserProfile] onSnapshot error:", err);
        setLoading(false);
      }
    );
    return () => unsub();
  }, [userId]);

  // ── Fetch gigs posted by the user (hostId) ───────────────────────────────
  useEffect(() => {
    if (!userId) return;
    setPostedGigsLoading(true);
    const types: WorkedGigType[] = ["offered", "open", "quick"];
    Promise.all(
      types.map((t) =>
        getDocs(query(collection(db, WORKED_GIG_COLLECTIONS[t]), where("hostId", "==", userId)))
      )
    ).then((snaps) => {
      const gigs: WorkedGig[] = snaps.flatMap((snap, i) =>
        snap.docs.map((d) => {
          const data = d.data() as Record<string, any>;
          return {
            id: d.id,
            gigType: types[i],
            title: data.title ?? "Untitled",
            status: data.status ?? "unknown",
            salary: data.salary,
            createdAt: data.createdAt instanceof Timestamp ? data.createdAt : null,
            hostId: data.hostId,
            assignedWorkerId: data.assignedWorkerId ?? undefined,
            assignedWorkerName: data.assignedWorkerName ?? undefined,
            hostRating: typeof data.hostRating === "number" ? data.hostRating : undefined,
          } satisfies WorkedGig;
        })
      );
      gigs.sort((a, b) => (b.createdAt?.toMillis() ?? 0) - (a.createdAt?.toMillis() ?? 0));
      setPostedGigs(gigs);
    }).catch((err) => {
      console.error("[UserProfile] fetchPostedGigs error:", err);
    }).finally(() => {
      setPostedGigsLoading(false);
    });
  }, [userId]);

  // ── Fetch gigs where user was the worker ─────────────────────────────────
  useEffect(() => {
    if (!userId) return;
    setWorkedGigsLoading(true);
    const types: WorkedGigType[] = ["offered", "open", "quick"];
    Promise.all(
      types.map((t) =>
        getDocs(query(collection(db, WORKED_GIG_COLLECTIONS[t]), where("workerId", "==", userId)))
      )
    ).then((snaps) => {
      const gigs: WorkedGig[] = snaps.flatMap((snap, i) =>
        snap.docs.map((d) => {
          const data = d.data() as Record<string, any>;
          return {
            id: d.id,
            gigType: types[i],
            title: data.title ?? "Untitled",
            status: data.status ?? "unknown",
            salary: data.salary,
            createdAt: data.createdAt instanceof Timestamp ? data.createdAt : null,
            hostId: data.hostId,
            hostName: data.hostName ?? undefined,
            workerRating: typeof data.workerRating === "number" ? data.workerRating : undefined,
          } satisfies WorkedGig;
        })
      );
      gigs.sort((a, b) => {
        const ta = a.createdAt?.toMillis() ?? 0;
        const tb = b.createdAt?.toMillis() ?? 0;
        return tb - ta;
      });
      setWorkedGigs(gigs);
    }).catch((err) => {
      console.error("[UserProfile] fetchWorkedGigs error:", err);
    }).finally(() => {
      setWorkedGigsLoading(false);
    });
  }, [userId]);

  // ── Suspension tier config ────────────────────────────────────────────────
  useEffect(() => {
    getDoc(doc(db, "quick_gig_config", "decline_suspension")).then((snap) => {
      if (snap.exists()) {
        const data = snap.data();
        const tiers: SuspensionTier[] = Array.isArray(data.suspension_tier_table)
          ? data.suspension_tier_table
          : [];
        setSuspensionTiers(tiers);
      }
    }).catch((err) => console.warn("[UserProfile] Failed to load suspension config:", err));
  }, []);

  // ── Suspension & ban history ──────────────────────────────────────────────
  useEffect(() => {
    if (!userId) return;
    setHistoryLoading(true);
    const MODERATION_ACTIONS = new Set(["user_suspended", "user_unsuspended", "user_banned", "user_unbanned"]);
    getDocs(
      query(
        collection(db, "activityLogs"),
        where("targetId", "==", userId)
      )
    ).then((snap) => {
      const entries: SuspensionHistoryEntry[] = snap.docs
        .filter((d) => MODERATION_ACTIONS.has(d.data().action))
        .map((d) => {
          const data = d.data() as Record<string, any>;
          return {
            id: d.id,
            action: data.action ?? "",
            description: data.description ?? "",
            actorName: data.actorName ?? "Unknown",
            createdAt: data.createdAt instanceof Timestamp ? data.createdAt : null,
            meta: data.meta ?? null,
          };
        })
        .sort((a, b) => (b.createdAt?.toMillis() ?? 0) - (a.createdAt?.toMillis() ?? 0));
      setSuspensionHistory(entries);
    }).catch((err) => {
      console.error("[UserProfile] suspension history error:", err);
    }).finally(() => {
      setHistoryLoading(false);
    });
  }, [userId]);

  // ── Fetch referred users list ─────────────────────────────────────────────
  useEffect(() => {
    if (!userId) return;
    setReferredUsersLoading(true);
    getDocs(collection(db, "users", userId, "referrals_list"))
      .then(async (snap) => {
        const base = snap.docs.map((d) => {
          const data = d.data() as Record<string, any>;
          return {
            uid: d.id,
            name: typeof data.name === "string" ? data.name : d.id,
            email: typeof data.email === "string" ? data.email : "",
            referral_code_used: typeof data.referral_code_used === "string" ? data.referral_code_used : null,
            joined_at: data.joined_at instanceof Timestamp ? data.joined_at : null,
            verified_at: null as Timestamp | null,
          };
        });
        // Batch-fetch verification_requests in chunks of 30
        const uids = base.map((u) => u.uid);
        const chunks: string[][] = [];
        for (let i = 0; i < uids.length; i += 30) chunks.push(uids.slice(i, i + 30));
        const verifSnaps = await Promise.all(
          chunks.map((chunk) => getDocs(query(collection(db, "verification_requests"), where("userId", "in", chunk))))
        );
        const verifiedAtMap: Record<string, Timestamp> = {};
        verifSnaps.forEach((s) => {
          s.docs.forEach((d) => {
            const data = d.data() as Record<string, any>;
            if (data.status === "verified" && data.reviewedAt instanceof Timestamp) {
              verifiedAtMap[data.userId] = data.reviewedAt;
            }
          });
        });
        base.forEach((u) => { u.verified_at = verifiedAtMap[u.uid] ?? null; });
        base.sort((a, b) => (b.joined_at?.toMillis() ?? 0) - (a.joined_at?.toMillis() ?? 0));
        setReferredUsers(base);
      })
      .catch((err) => console.warn("[UserProfile] referrals_list error:", err))
      .finally(() => setReferredUsersLoading(false));
  }, [userId]);

  // ── Fetch users this user has blocked ─────────────────────────────────────
  useEffect(() => {
    const ids = userData?.blockedUsers ?? [];
    if (ids.length === 0) { setBlockedUsersList([]); return; }
    setBlockedUsersLoading(true);
    const chunks: string[][] = [];
    for (let i = 0; i < ids.length; i += 30) chunks.push(ids.slice(i, i + 30));
    Promise.all(
      chunks.map((chunk) => getDocs(query(collection(db, "users"), where(documentId(), "in", chunk))))
    )
      .then((snaps) => {
        const list = snaps.flatMap((snap) => snap.docs.map((d) => {
          const data = d.data() as Record<string, any>;
          return {
            uid: d.id,
            name: typeof data.name === "string" ? data.name : d.id,
            email: typeof data.email === "string" ? data.email : "",
          };
        }));
        list.sort((a, b) => a.name.localeCompare(b.name));
        setBlockedUsersList(list);
      })
      .catch((err) => console.warn("[UserProfile] blockedUsers fetch error:", err))
      .finally(() => setBlockedUsersLoading(false));
  }, [userData?.blockedUsers.join(",")]);

  // ── Fetch users who have blocked this user ──────────────────────────────
  useEffect(() => {
    if (!userId) return;
    setBlockedByLoading(true);
    getDocs(query(collection(db, "users"), where("blockedUsers", "array-contains", userId)))
      .then((snap) => {
        const list = snap.docs.map((d) => {
          const data = d.data() as Record<string, any>;
          return {
            uid: d.id,
            name: typeof data.name === "string" ? data.name : d.id,
            email: typeof data.email === "string" ? data.email : "",
          };
        });
        list.sort((a, b) => a.name.localeCompare(b.name));
        setBlockedByList(list);
      })
      .catch((err) => console.warn("[UserProfile] blockedBy fetch error:", err))
      .finally(() => setBlockedByLoading(false));
  }, [userId]);

  // ── Fetch verification status & documents ────────────────────────────────
  useEffect(() => {
    if (!userId) return;
    getDocs(query(collection(db, "verification_requests"), where("userId", "==", userId)))
      .then((snap) => {
        const verified = snap.docs.find((d) => d.data().status === "verified");
        const target = verified ?? (snap.empty ? null : snap.docs.sort((a, b) => {
          const ta = a.data().submittedAt instanceof Timestamp ? a.data().submittedAt.toMillis() : 0;
          const tb = b.data().submittedAt instanceof Timestamp ? b.data().submittedAt.toMillis() : 0;
          return tb - ta;
        })[0]);
        if (!target) return;
        const data = target.data() as Record<string, any>;
        setVerificationStatus(data.status ?? null);
        setVerifiedAt(data.status === "verified" && data.reviewedAt instanceof Timestamp ? data.reviewedAt : null);
        setVerificationDocs(Array.isArray(data.documents) ? data.documents : []);
        setVerificationRejectReason(data.rejectReason ?? null);
      })
      .catch((err) => console.warn("[UserProfile] verification fetch error:", err));
  }, [userId]);

  // ── Real-time skills collection listener ─────────────────────────────────
  useEffect(() => {
    const unsub = onSnapshot(
      collection(db, "skills"),
      (snap) => {
        const entries: SkillEntry[] = snap.docs.filter((d) => !d.id.startsWith("_")).map((d) => ({
          id: d.id,
          name: d.data().name ?? d.id,
        }));
        setAvailableSkills(entries);
      },
      (err) => console.warn("[UserProfile] skills listener error:", err)
    );
    return () => unsub();
  }, []);

  // ── Fetch skill requests for this user ────────────────────────────────────
  useEffect(() => {
    if (!userId) return;
    setUserRequestsLoading(true);
    const q = query(collection(db, "skill_requests"), where("userId", "==", userId));
    const unsub = onSnapshot(q, (snap) => {
      const reqs = snap.docs.map((d) => {
        const data = d.data() as Record<string, any>;
        return {
          id: d.id,
          skillName: data.skillName ?? "",
          skillCategory: data.skillCategory ?? "",
          status: data.status ?? "pending",
          reason: data.reason ?? "",
          experienceLevel: data.experienceLevel ?? "",
          createdAt: data.createdAt instanceof Timestamp ? data.createdAt : null,
          updatedAt: data.updatedAt instanceof Timestamp ? data.updatedAt : null,
          adminRemarks: data.adminRemarks ?? "",
          skill_req_Id: data.skill_req_Id ?? "",
        };
      });
      reqs.sort((a, b) => (b.createdAt?.toMillis() ?? 0) - (a.createdAt?.toMillis() ?? 0));
      setUserSkillRequests(reqs);
      setUserRequestsLoading(false);
    }, (err) => {
      console.warn("[UserProfile] skill_requests listener error:", err);
      setUserRequestsLoading(false);
    });
    return () => unsub();
  }, [userId]);

  // ── Save skills ───────────────────────────────────────────────────────────
  const handleSaveSkills = useCallback(async (newSkillsXP: Record<string, number>) => {
    if (!userData || !adminUser) return;
    setSavingSkills(true);
    try {
      await updateDoc(doc(db, "users", userData.id), {
        skillsXP: newSkillsXP,
        updatedAt: serverTimestamp(),
      });
      await writeLog({
        actorId: adminUser.uid,
        actorName: adminUser.displayName ?? "Unknown",
        actorEmail: adminUser.email ?? "",
        module: "user_management",
        action: "user_skills_updated",
        description: buildDescription.userSkillsUpdated(userData.name),
        targetId: userData.id,
        targetName: userData.name,
        affectedFiles: [`users/${userData.id}`],
        meta: { from: userData.skillsXP, to: newSkillsXP },
      });
      setSkillsModalOpen(false);
    } catch (err) {
      console.error("[UserProfile] save skills error:", err);
    } finally {
      setSavingSkills(false);
    }
  }, [userData, adminUser]);

  // ── Save host reward skills ───────────────────────────────────────────────
  const handleSaveHostRewardSkills = useCallback(async (newSkills: string[]) => {
    if (!userData || !adminUser) return;
    setSavingHostRewardSkills(true);
    const added   = newSkills.filter((s) => !userData.hostRewardSkills.includes(s));
    const removed = userData.hostRewardSkills.filter((s) => !newSkills.includes(s));
    try {
      await updateDoc(doc(db, "users", userData.id), {
        hostRewardSkills: newSkills,
        updatedAt: serverTimestamp(),
      });
      await writeLog({
        actorId: adminUser.uid,
        actorName: adminUser.displayName ?? "Unknown",
        actorEmail: adminUser.email ?? "",
        module: "user_management",
        action: "user_host_reward_skills_updated",
        description: buildDescription.userSkillsUpdated(userData.name),
        targetId: userData.id,
        targetName: userData.name,
        affectedFiles: [`users/${userData.id}`],
        meta: { from: userData.hostRewardSkills, to: newSkills, other: { added, removed } },
      });
      setHostRewardSkillsModalOpen(false);
    } catch (err) {
      console.error("[UserProfile] save host reward skills error:", err);
    } finally {
      setSavingHostRewardSkills(false);
    }
  }, [userData, adminUser]);

  // ── Moderation actions ────────────────────────────────────────────────────

  const handleSuspend = useCallback(async (durationMinutes: number, tierLabel: string) => {
    if (!userData || !adminUser) return;
    setActionLoading("suspend");
    try {
      const suspendedUntil = Timestamp.fromDate(new Date(Date.now() + durationMinutes * 60 * 1000));
      await updateDoc(doc(db, "users", userData.id), {
        suspended_until: suspendedUntil,
        updatedAt: serverTimestamp(),
      });
      await writeLog({
        actorId: adminUser.uid,
        actorName: adminUser.displayName ?? "Unknown",
        actorEmail: adminUser.email ?? "",
        module: "user_management",
        action: "user_suspended",
        description: buildDescription.userSuspended(userData.name, durationMinutes),
        targetId: userData.id,
        targetName: userData.name,
        affectedFiles: [`users/${userData.id}`],
        meta: { other: { duration_minutes: durationMinutes, tier: tierLabel } },
      });
      setSuspendModalOpen(false);
    } catch (err) {
      console.error("[UserProfile] suspend error:", err);
    } finally {
      setActionLoading(null);
    }
  }, [userData, adminUser]);

  const handleLiftSuspension = useCallback(async () => {
    if (!userData || !adminUser) return;
    setActionLoading("lift");
    try {
      await updateDoc(doc(db, "users", userData.id), {
        suspended_until: null,
        updatedAt: serverTimestamp(),
      });
      await writeLog({
        actorId: adminUser.uid,
        actorName: adminUser.displayName ?? "Unknown",
        actorEmail: adminUser.email ?? "",
        module: "user_management",
        action: "user_unsuspended",
        description: buildDescription.userUnsuspended(userData.name),
        targetId: userData.id,
        targetName: userData.name,
        affectedFiles: [`users/${userData.id}`],
      });
      setConfirmAction(null);
    } catch (err) {
      console.error("[UserProfile] lift suspension error:", err);
    } finally {
      setActionLoading(null);
    }
  }, [userData, adminUser]);

  const handleBan = useCallback(async () => {
    if (!userData || !adminUser) return;
    setActionLoading("ban");
    try {
      await updateDoc(doc(db, "users", userData.id), {
        isBanned: true,
        ban_reason: banReason.trim() || null,
        suspended_until: null,
        updatedAt: serverTimestamp(),
      });
      await writeLog({
        actorId: adminUser.uid,
        actorName: adminUser.displayName ?? "Unknown",
        actorEmail: adminUser.email ?? "",
        module: "user_management",
        action: "user_banned",
        description: buildDescription.userBanned(userData.name),
        targetId: userData.id,
        targetName: userData.name,
        affectedFiles: [`users/${userData.id}`],
        meta: banReason.trim() ? { other: { reason: banReason.trim() } } : undefined,
      });
      setConfirmAction(null);
      setBanReason("");
    } catch (err) {
      console.error("[UserProfile] ban error:", err);
    } finally {
      setActionLoading(null);
    }
  }, [userData, adminUser, banReason]);

  const handleUnban = useCallback(async () => {
    if (!userData || !adminUser) return;
    setActionLoading("unban");
    try {
      await updateDoc(doc(db, "users", userData.id), {
        isBanned: false,
        updatedAt: serverTimestamp(),
      });
      await writeLog({
        actorId: adminUser.uid,
        actorName: adminUser.displayName ?? "Unknown",
        actorEmail: adminUser.email ?? "",
        module: "user_management",
        action: "user_unbanned",
        description: buildDescription.userUnbanned(userData.name),
        targetId: userData.id,
        targetName: userData.name,
        affectedFiles: [`users/${userData.id}`],
      });
      setConfirmAction(null);
    } catch (err) {
      console.error("[UserProfile] unban error:", err);
    } finally {
      setActionLoading(null);
    }
  }, [userData, adminUser]);

  const handleDelete = useCallback(async () => {
    if (!userData || !adminUser) return;
    setActionLoading("delete");
    try {
      const deleteAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
      await updateDoc(doc(db, "users", userData.id), {
        pendingDeletion: true,
        scheduledDeleteAt: Timestamp.fromDate(deleteAt),
        updatedAt: serverTimestamp(),
      });
      await writeLog({
        actorId: adminUser.uid,
        actorName: adminUser.displayName ?? "Unknown",
        actorEmail: adminUser.email ?? "",
        module: "user_management",
        action: "user_deletion_scheduled",
        description: buildDescription.userDeletionScheduled(userData.name, deleteAt),
        targetId: userData.id,
        targetName: userData.name,
        affectedFiles: [`users/${userData.id}`],
      });
      setConfirmAction(null);
    } catch (err) {
      console.error("[UserProfile] delete error:", err);
    } finally {
      setActionLoading(null);
    }
  }, [userData, adminUser]);

  const handleCancelDeletion = useCallback(async () => {
    if (!userData || !adminUser) return;
    setActionLoading("cancel_deletion");
    try {
      await updateDoc(doc(db, "users", userData.id), {
        pendingDeletion: false,
        scheduledDeleteAt: null,
        updatedAt: serverTimestamp(),
      });
      await writeLog({
        actorId: adminUser.uid,
        actorName: adminUser.displayName ?? "Unknown",
        actorEmail: adminUser.email ?? "",
        module: "user_management",
        action: "user_deletion_cancelled",
        description: buildDescription.userDeletionCancelled(userData.name),
        targetId: userData.id,
        targetName: userData.name,
        affectedFiles: [`users/${userData.id}`],
      });
      setConfirmAction(null);
    } catch (err) {
      console.error("[UserProfile] cancel deletion error:", err);
    } finally {
      setActionLoading(null);
    }
  }, [userData, adminUser]);

  const handleConfirm = useCallback(() => {
    switch (confirmAction) {
      case "lift":             return handleLiftSuspension();
      case "ban":              return handleBan();
      case "unban":            return handleUnban();
      case "delete":           return handleDelete();
      case "cancel_deletion":  return handleCancelDeletion();
    }
  }, [confirmAction, handleLiftSuspension, handleBan, handleUnban, handleDelete, handleCancelDeletion]);

  // ── Render ────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <AdminLayout title="User Profile">
        <div style={{ padding: 40, textAlign: "center", color: "var(--text-muted)" }}>Loading…</div>
      </AdminLayout>
    );
  }

  if (!userData) {
    return (
      <AdminLayout title="User Profile">
        <div style={{ padding: 40, textAlign: "center", color: "var(--text-muted)" }}>
          User not found.
          <br />
          <button
            onClick={() => router.push("/users")}
            style={{ marginTop: 12, background: "none", border: "none", color: "var(--blue)", cursor: "pointer", fontSize: 13 }}
          >
            ← Back to Users
          </button>
        </div>
      </AdminLayout>
    );
  }

  const suspended = isCurrentlySuspended(userData);
  const skillEntries = Object.entries(userData.skillsXP);

  const statusBadge = userData.isBanned
    ? <Badge variant="red" dot>Banned</Badge>
    : suspended
      ? <Badge variant="orange" dot>Suspended</Badge>
      : userData.isOnline
        ? <Badge variant="green" dot>Online</Badge>
        : <Badge variant="gray" dot>Offline</Badge>;

  const acceptPct = (userData.acceptanceRate * (userData.acceptanceRate <= 1 ? 100 : 1)).toFixed(1);

  return (
    <AdminLayout
      title={userData.name}
      subtitle={userData.email}
      actions={
        <Button variant="ghost" size="sm" icon={ChevronLeft} onClick={() => router.push("/users")}>
          Back to Users
        </Button>
      }
    >
      <style>{`
        .up-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(340px, 1fr)); gap: 16px; }
        .up-info-section { display: flex; flex-direction: column; }
      `}</style>

      {/* Header card */}
      <div style={{ background: "var(--bg-surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", padding: "24px", marginBottom: 16, display: "flex", alignItems: "center", gap: 20, flexWrap: "wrap" }}>
        <div style={{ width: 56, height: 56, borderRadius: "50%", background: "var(--blue-dim)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          <User size={24} style={{ color: "var(--blue)" }} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 20, fontWeight: 700, color: "var(--text-primary)" }}>{userData.name}</div>
          <div style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 2 }}>{userData.email}</div>
          <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap", alignItems: "center" }}>
            {statusBadge}
            {verificationStatus === "verified" && (
              <Badge variant="blue"><ShieldCheck size={11} style={{ marginRight: 3 }} />Verified</Badge>
            )}
            {/* <Badge variant="blue">{userData.role}</Badge> */}
            {/* <Badge variant="gray">{userData.signInMethod}</Badge> */}
          </div>
        </div>
        <Button variant="primary" size="sm" icon={Wrench} onClick={() => setSkillsModalOpen(true)}>
          Manage Skills
        </Button>
      </div>

      <div className="up-grid">
        {/* Identity */}
        <SectionCard title="Identity" icon={User}>
          <InfoRow label="User ID" value={userData.id} mono />
          <InfoRow label="Phone" value={userData.phone} />
          <InfoRow label="Balance" value={<strong>{formatBalance(userData.balance)}</strong>} />
          <InfoRow label="Date Registered" value={formatDate(userData.createdAt)} />
          <InfoRow
            label="Referred By"
            value={
              userData.referredByName
                ? <button
                    onClick={() => userData.referredByUID && router.push(`/users/${userData.referredByUID}`)}
                    style={{ background: "none", border: "none", padding: 0, color: "var(--blue)", cursor: userData.referredByUID ? "pointer" : "default", fontSize: 13, fontWeight: 600, display: "inline-flex", alignItems: "center", gap: 4 }}
                  >
                    {userData.referredByName}
                    {userData.referredByUID && <ExternalLink size={11} style={{ opacity: 0.6 }} />}
                  </button>
                : <span style={{ color: "var(--text-muted)" }}>—</span>
            }
          />
          <InfoRow
            label="Verified"
            value={
              verificationStatus === "verified"
                ? <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
                    <ShieldCheck size={13} style={{ color: "var(--blue)" }} />
                    <span style={{ color: "var(--blue)", fontWeight: 600 }}>
                      {verifiedAt ? formatDate(verifiedAt) : "Yes"}
                    </span>
                  </span>
                : verificationStatus === "pending"
                  ? <Badge variant="orange" dot>Pending</Badge>
                  : <span style={{ color: "var(--text-muted)" }}>Not verified</span>
            }
          />
          <InfoRow label="Location" value={
            <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <MapPin size={11} style={{ color: "var(--text-muted)" }} />
              {formatLocation(userData.location)}
            </span>
          } />
          <InfoRow label="Slot" value={userData.slot} />
          <InfoRow
            label="Last Online"
            value={
              userData.isOnline
                ? <span style={{ color: "var(--green)" }}>Now</span>
                : <span style={{ color: "var(--text-muted)" }}>{formatRelativeTime(userData.lastOnline)}</span>
            }
          />
        </SectionCard>

        {/* Ratings & Performance */}
        <SectionCard title="Ratings & Performance" icon={Star}>
          <InfoRow label="Rating as Host" value={`${formatRating(userData.ratingAsHost)} ★ (${userData.ratingCount} ratings)`} />
          <InfoRow label="Rating as Worker" value={`${formatRating(userData.ratingAsWorker)} ★`} />
          <InfoRow label="Acceptance Rate" value={`${acceptPct}%`} />
          <InfoRow label="Total Accepted Gigs" value={userData.totalGigs} />
          <InfoRow label="Daily Declines" value={userData.quickGigDailyDeclineCount} />
          <InfoRow label="Total Declines" value={userData.quickGigTotalDeclines} />
          <InfoRow label="Decline Count" value={userData.decline_count} />
        </SectionCard>

        {/* Availability */}
        <SectionCard title="Availability" icon={Briefcase}>
          <InfoRow label="Available for Gigs" value={userData.availableForGigs ? "Yes" : "No"} />
          <InfoRow label="Seeking Quick Gigs" value={userData.seekingQuickGigs ? "Yes" : "No"} />
          <InfoRow label="Auto Accept" value={userData.autoAccept ? "Yes" : "No"} />
          <InfoRow label="Open Gigs Unlocked" value={userData.openGigsUnlocked ? "Yes" : "No"} />
        </SectionCard>

        {/* Account Status */}
        <SectionCard title="Account Status" icon={Shield}>
          <InfoRow label="Status" value={statusBadge} />
          <InfoRow label="Banned" value={userData.isBanned ? <Badge variant="red">Banned</Badge> : "No"} />
          {userData.isBanned && userData.ban_reason && (
            <InfoRow label="Ban Reason" value={<span style={{ color: "var(--text-secondary)" }}>{userData.ban_reason}</span>} />
          )}
          <InfoRow
            label="Suspended Until"
            value={
              userData.suspended_until
                ? <span style={{ color: suspended ? "var(--orange)" : "var(--text-muted)" }}>
                    {formatDate(userData.suspended_until)}
                    {!suspended && <span style={{ marginLeft: 6, fontSize: 11 }}>(expired)</span>}
                  </span>
                : "—"
            }
          />
          <div style={{ display: "flex", gap: 8, marginTop: 14, flexWrap: "wrap" }}>
            {suspended ? (
              <Button
                variant="success" size="sm" icon={ShieldCheck}
                loading={actionLoading === "lift"}
                onClick={() => setConfirmAction("lift")}
              >
                Lift Suspension
              </Button>
            ) : (
              <Button
                variant="secondary" size="sm" icon={Clock}
                onClick={() => setSuspendModalOpen(true)}
                disabled={userData.isBanned}
              >
                Suspend
              </Button>
            )}
            {userData.isBanned ? (
              <Button
                variant="success" size="sm" icon={ShieldOff}
                loading={actionLoading === "unban"}
                onClick={() => setConfirmAction("unban")}
              >
                Unban
              </Button>
            ) : (
              <Button
                variant="danger" size="sm" icon={Ban}
                loading={actionLoading === "ban"}
                onClick={() => setConfirmAction("ban")}
              >
                Ban User
              </Button>
            )}
            <Button
              variant="danger" size="sm" icon={Trash2}
              loading={actionLoading === "delete"}
              onClick={() => setConfirmAction("delete")}
              style={{ marginLeft: "auto" }}
            >
              Delete User
            </Button>
          </div>
        </SectionCard>

        {/* Referrals */}
        <SectionCard title="Referrals" icon={GitBranch}>
          <InfoRow
            label="Referral Code"
            value={
              userData.referral_code
                ? <span style={{ fontFamily: "'Space Mono', monospace", fontSize: 12, background: "var(--bg-elevated)", border: "1px solid var(--border)", borderRadius: 4, padding: "2px 8px", letterSpacing: "0.5px" }}>{userData.referral_code}</span>
                : <span style={{ color: "var(--text-muted)" }}>—</span>
            }
          />
          <InfoRow label="Level" value={userData.referral_level > 0 ? `Level ${userData.referral_level}` : <span style={{ color: "var(--text-muted)" }}>—</span>} />
          <InfoRow label="Total Referrals" value={userData.referrals_count} />
          <InfoRow
            label="Verified Referrals"
            value={
              <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                <BadgeCheck size={13} style={{ color: "var(--blue)" }} />
                <span style={{ fontWeight: 600, color: "var(--blue)" }}>{userData.verified_referrals}</span>
              </span>
            }
          />
          {userData.referredByName && (
            <InfoRow
              label="Referred By"
              value={
                <button
                  onClick={() => userData.referredByUID && userData.referredByUID !== "none" && router.push(`/users/${userData.referredByUID}`)}
                  style={{ background: "none", border: "none", padding: 0, color: "var(--blue)", cursor: userData.referredByUID ? "pointer" : "default", fontSize: 13, fontWeight: 600, display: "inline-flex", alignItems: "center", gap: 4 }}
                >
                  {userData.referredByName !== "none" ? userData.referredByName : "Self-Registered"}
                  {userData.referredByUID && userData.referredByUID !== "none" && <ExternalLink size={11} style={{ opacity: 0.6 }} />}
                </button>
              }
            />
          )}
        </SectionCard>

        {/* Verification Documents */}
        <SectionCard title="Verification Documents" icon={FileText}>
          {verificationStatus ? (
            <div style={{ marginBottom: 12 }}>
              {verificationStatus === "verified" && <Badge variant="blue"><ShieldCheck size={10} style={{ marginRight: 3 }} />Verified</Badge>}
              {verificationStatus === "pending"  && <Badge variant="orange" dot>Pending Review</Badge>}
              {verificationStatus === "rejected" && <Badge variant="red">Rejected</Badge>}
              {verificationStatus === "cancelled" && <Badge variant="gray">Cancelled</Badge>}
            </div>
          ) : null}
          {verificationRejectReason && (
            <div style={{ background: "rgba(239,68,68,0.08)", border: "1px solid var(--red)", borderRadius: "var(--radius-sm)", padding: "8px 12px", marginBottom: 12, fontSize: 12, color: "var(--red)" }}>
              <strong>Rejection reason:</strong> {verificationRejectReason}
            </div>
          )}
          {verificationDocs.length === 0 ? (
            <span style={{ fontSize: 13, color: "var(--text-muted)" }}>
              {verificationStatus ? "No documents attached." : "No verification submission."}
            </span>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {verificationDocs.map((d, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, background: "var(--bg-elevated)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", padding: "8px 12px" }}>
                  <FileText size={14} style={{ color: "var(--blue)", flexShrink: 0 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{d.name}</div>
                    <div style={{ fontSize: 11, color: "var(--text-muted)", textTransform: "capitalize" }}>
                      {d.category.replace(/_/g, " ")}
                      {d.uploadedAt && <> · {d.uploadedAt.toDate().toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" })}</>}
                    </div>
                  </div>
                  {d.url && (
                    <button
                      onClick={() => setSelectedDoc(d)}
                      style={{ background: "none", border: "none", cursor: "pointer", color: "var(--blue)", display: "flex", alignItems: "center", flexShrink: 0, padding: 0 }}
                      title="View document"
                    >
                      <ExternalLink size={13} />
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </SectionCard>

      </div>

      {/* Skills & User Requests Tabs */}
      <div style={{ marginTop: 16 }}>
        <div style={{ background: "var(--bg-surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", overflow: "hidden" }}>
          {/* Tab header */}
          <div style={{ display: "flex", borderBottom: "1px solid var(--border)" }}>
            {(["skills", "requests", "delete_request"] as const).map((tab) => {
              const label =
                tab === "skills" ? "Skills" :
                tab === "requests" ? `User Requests${userSkillRequests.length > 0 ? ` (${userSkillRequests.length})` : ""}` :
                "Account Delete Request";
              const isDanger = tab === "delete_request" && userData.pendingDeletion;
              return (
                <button
                  key={tab}
                  onClick={() => setActiveSkillTab(tab)}
                  style={{
                    padding: "12px 20px",
                    fontSize: 13,
                    fontWeight: 600,
                    border: "none",
                    borderBottom: `2px solid ${activeSkillTab === tab ? (isDanger ? "var(--red)" : "var(--blue)") : "transparent"}`,
                    background: "none",
                    cursor: "pointer",
                    color: activeSkillTab === tab ? (isDanger ? "var(--red)" : "var(--blue)") : isDanger ? "var(--red)" : "var(--text-muted)",
                    marginBottom: -1,
                    transition: "color 0.15s",
                    fontFamily: "inherit",
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                  }}
                >
                  {label}
                  {tab === "delete_request" && userData.pendingDeletion && (
                    <span style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--red)", flexShrink: 0, display: "inline-block" }} />
                  )}
                </button>
              );
            })}
          </div>

          {/* Tab content */}
          <div style={{ padding: "20px 24px" }}>
            {activeSkillTab === "skills" ? (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 16 }}>
                {/* Skills (XP) */}
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                    <Wrench size={14} style={{ color: "var(--blue)" }} />
                    <span style={{ fontSize: 13, fontWeight: 700, color: "var(--text-primary)" }}>Skills (XP)</span>
                  </div>
                  {skillEntries.length === 0 ? (
                    <div style={{ fontSize: 13, color: "var(--text-muted)", fontStyle: "italic" }}>
                      No skills assigned.{" "}
                      <button style={{ background: "none", border: "none", color: "var(--blue)", cursor: "pointer", fontSize: 13, padding: 0 }} onClick={() => setSkillsModalOpen(true)}>
                        Add skills →
                      </button>
                    </div>
                  ) : (
                    <>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                        {skillEntries.map(([skillName, level]) => (
                          <div key={skillName} style={{ display: "flex", alignItems: "center", gap: 6, background: "var(--bg-elevated)", border: "1px solid var(--border)", borderRadius: 20, padding: "4px 12px 4px 8px", fontSize: 12 }}>
                            <span style={{ width: 20, height: 20, borderRadius: "50%", background: "var(--blue-dim)", color: "var(--blue)", fontSize: 10, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{level}</span>
                            <span style={{ color: "var(--text-primary)", fontWeight: 500 }}>{skillName}</span>
                          </div>
                        ))}
                      </div>
                      <div style={{ marginTop: 12 }}>
                        <Button variant="secondary" size="sm" icon={Wrench} onClick={() => setSkillsModalOpen(true)}>Edit Skills</Button>
                      </div>
                    </>
                  )}
                </div>

                {/* Host-Eligible Reward Skills */}
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                    <Star size={14} style={{ color: "var(--blue)" }} />
                    <span style={{ fontSize: 13, fontWeight: 700, color: "var(--text-primary)" }}>Host-Eligible Reward Skills</span>
                  </div>
                  {userData.hostRewardSkills.length === 0 ? (
                    <div style={{ fontSize: 13, color: "var(--text-muted)", fontStyle: "italic" }}>
                      No reward skills assigned.{" "}
                      <button style={{ background: "none", border: "none", color: "var(--blue)", cursor: "pointer", fontSize: 13, padding: 0 }} onClick={() => setHostRewardSkillsModalOpen(true)}>
                        Add skills →
                      </button>
                    </div>
                  ) : (
                    <>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                        {userData.hostRewardSkills.map((skillName) => (
                          <div key={skillName} style={{ display: "flex", alignItems: "center", gap: 6, background: "var(--bg-elevated)", border: "1px solid var(--border)", borderRadius: 20, padding: "4px 12px", fontSize: 12 }}>
                            <span style={{ color: "var(--text-primary)", fontWeight: 500 }}>{skillName}</span>
                          </div>
                        ))}
                      </div>
                      <div style={{ marginTop: 12 }}>
                        <Button variant="secondary" size="sm" icon={Wrench} onClick={() => setHostRewardSkillsModalOpen(true)}>Edit Reward Skills</Button>
                      </div>
                    </>
                  )}
                </div>

                {/* Legacy Skills */}
                {userData.skills.length > 0 && (
                  <div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                      <Wrench size={14} style={{ color: "var(--text-muted)" }} />
                      <span style={{ fontSize: 13, fontWeight: 700, color: "var(--text-primary)" }}>Legacy Skills</span>
                    </div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                      {userData.skills.map((s, i) => (
                        <span key={i} style={{ fontSize: 11, fontWeight: 600, background: "var(--blue-dim)", color: "var(--blue)", borderRadius: 20, padding: "2px 10px" }}>{s}</span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : activeSkillTab === "requests" ? (
              /* User Requests tab */
              userRequestsLoading ? (
                <div style={{ fontSize: 13, color: "var(--text-muted)" }}>Loading requests…</div>
              ) : userSkillRequests.length === 0 ? (
                <div style={{ fontSize: 13, color: "var(--text-muted)", fontStyle: "italic" }}>No skill requests found.</div>
              ) : (
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                    <thead>
                      <tr style={{ borderBottom: "1px solid var(--border)" }}>
                        {["Ticket", "Skill", "Category", "Level", "Status", "Submitted", "Admin Remarks"].map((h) => (
                          <th key={h} style={{ textAlign: "left", padding: "6px 10px", fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.5px", color: "var(--text-muted)", whiteSpace: "nowrap" }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {userSkillRequests.map((req) => {
                        const statusColor =
                          req.status === "approved" ? "var(--green)" :
                          req.status === "rejected" ? "var(--red)" : "var(--amber,#f59e0b)";
                        const statusBg =
                          req.status === "approved" ? "var(--green-dim)" :
                          req.status === "rejected" ? "var(--red-dim)" : "rgba(245,158,11,0.12)";
                        return (
                          <tr key={req.id} style={{ borderBottom: "1px solid var(--border-muted)" }}>
                            <td style={{ padding: "9px 10px", fontFamily: "monospace", fontSize: 11, color: "var(--text-muted)", whiteSpace: "nowrap" }}>{req.skill_req_Id || req.id.slice(0, 8)}</td>
                            <td style={{ padding: "9px 10px", fontWeight: 600, color: "var(--text-primary)", whiteSpace: "nowrap" }}>{req.skillName}</td>
                            <td style={{ padding: "9px 10px", color: "var(--text-secondary)", whiteSpace: "nowrap" }}>{req.skillCategory || "—"}</td>
                            <td style={{ padding: "9px 10px", color: "var(--text-secondary)", whiteSpace: "nowrap" }}>{req.experienceLevel || "—"}</td>
                            <td style={{ padding: "9px 10px" }}>
                              <span style={{ fontSize: 11, fontWeight: 600, borderRadius: 20, padding: "2px 8px", background: statusBg, color: statusColor, textTransform: "capitalize" }}>
                                {req.status}
                              </span>
                            </td>
                            <td style={{ padding: "9px 10px", color: "var(--text-muted)", whiteSpace: "nowrap" }}>
                              {req.createdAt ? req.createdAt.toDate().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—"}
                            </td>
                            <td style={{ padding: "9px 10px", color: "var(--text-secondary)", maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                              {req.adminRemarks || <span style={{ color: "var(--text-muted)" }}>—</span>}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )
            ) : (
              /* Account Delete Request tab */
              userData.pendingDeletion ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                  <div style={{ display: "flex", alignItems: "flex-start", gap: 14, background: "var(--red-dim)", border: "1px solid rgba(239,68,68,0.3)", borderRadius: "var(--radius-sm)", padding: "14px 16px" }}>
                    <AlertTriangle size={18} style={{ color: "var(--red)", flexShrink: 0, marginTop: 1 }} />
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: "var(--red)", marginBottom: 4 }}>Deletion Scheduled</div>
                      <div style={{ fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.5 }}>
                        This account is scheduled for permanent deletion.
                        {userData.scheduledDeleteAt && (
                          <> It will be deleted on <strong style={{ color: "var(--text-primary)" }}>{formatDate(userData.scheduledDeleteAt)}</strong>.</>
                        )}
                      </div>
                    </div>
                  </div>

                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 12 }}>
                    <div style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", padding: "12px 14px" }}>
                      <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.5px", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: 6 }}>Status</div>
                      <span style={{ fontSize: 12, fontWeight: 600, padding: "2px 10px", borderRadius: 20, background: "var(--red-dim)", color: "var(--red)" }}>
                        Pending Deletion
                      </span>
                    </div>
                    {userData.scheduledDeleteAt && (
                      <div style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", padding: "12px 14px" }}>
                        <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.5px", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: 6 }}>Scheduled Date</div>
                        <span style={{ fontSize: 13, color: "var(--text-primary)", fontWeight: 600 }}>{formatDate(userData.scheduledDeleteAt)}</span>
                      </div>
                    )}
                    {userData.scheduledDeleteAt && (
                      <div style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", padding: "12px 14px" }}>
                        <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.5px", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: 6 }}>Time Remaining</div>
                        <span style={{ fontSize: 13, color: "var(--orange,#f97316)", fontWeight: 600 }}>
                          {(() => {
                            const diff = userData.scheduledDeleteAt.toDate().getTime() - Date.now();
                            if (diff <= 0) return "Overdue";
                            const days = Math.floor(diff / (1000 * 60 * 60 * 24));
                            const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
                            return days > 0 ? `${days}d ${hours}h` : `${hours}h`;
                          })()}
                        </span>
                      </div>
                    )}
                  </div>

                  <div>
                    <Button
                      variant="success"
                      size="sm"
                      icon={ShieldCheck}
                      loading={actionLoading === "cancel_deletion"}
                      onClick={() => setConfirmAction("cancel_deletion")}
                    >
                      Cancel Deletion
                    </Button>
                  </div>
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  <div style={{ fontSize: 13, color: "var(--text-muted)", fontStyle: "italic" }}>
                    No pending account deletion request.
                  </div>
                  <div>
                    <Button
                      variant="danger"
                      size="sm"
                      icon={Trash2}
                      loading={actionLoading === "delete"}
                      onClick={() => setConfirmAction("delete")}
                    >
                      Schedule Account Deletion
                    </Button>
                  </div>
                </div>
              )
            )}
          </div>
        </div>
      </div>

      {/* Referred Users */}
      <div style={{ marginTop: 16 }}>
        <div style={{ background: "var(--bg-surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", overflow: "hidden" }}>
          <div style={{ padding: "20px 24px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <GitBranch size={15} style={{ color: "var(--blue)" }} />
              <span style={{ fontSize: 13, fontWeight: 700, color: "var(--text-primary)" }}>Referred Users</span>
              <span style={{ fontSize: 12, color: "var(--text-muted)" }}>({userData.referrals_count} total · <span style={{ color: "var(--blue)", fontWeight: 600 }}>{userData.verified_referrals} verified</span>)</span>
            </div>
          </div>
          {(() => {
            const REF_PAGE_SIZE = 5;
            const totalRefPages = Math.max(1, Math.ceil(referredUsers.length / REF_PAGE_SIZE));
            const safeRefPage = Math.min(referredUsersPage, totalRefPages);
            const pagedRef = referredUsers.slice((safeRefPage - 1) * REF_PAGE_SIZE, safeRefPage * REF_PAGE_SIZE);
            return referredUsersLoading ? (
              <div style={{ padding: "20px 24px", fontSize: 13, color: "var(--text-muted)" }}>Loading…</div>
            ) : referredUsers.length === 0 ? (
              <div style={{ padding: "20px 24px", fontSize: 13, color: "var(--text-muted)", fontStyle: "italic" }}>No referred users found.</div>
            ) : (
              <>
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse" }}>
                    <thead>
                      <tr style={{ borderBottom: "1px solid var(--border-muted)" }}>
                        {["Name", "Email", "Code Used", "Joined", "Date Verified"].map((h) => (
                          <th key={h} style={{ padding: "9px 16px", textAlign: "left", fontSize: 10, fontWeight: 700, letterSpacing: "0.5px", textTransform: "uppercase", color: "var(--text-muted)", whiteSpace: "nowrap" }}>{h}</th>
                        ))}
                        <th style={{ width: 32 }} />
                      </tr>
                    </thead>
                    <tbody>
                      {pagedRef.map((u) => (
                        <tr
                          key={u.uid}
                          style={{ borderTop: "1px solid var(--border-muted)", cursor: "pointer", transition: "background 0.1s" }}
                          onClick={() => router.push(`/users/${u.uid}`)}
                          onMouseEnter={(e) => { (e.currentTarget as HTMLTableRowElement).style.background = "var(--bg-elevated)"; }}
                          onMouseLeave={(e) => { (e.currentTarget as HTMLTableRowElement).style.background = ""; }}
                        >
                          <td style={{ padding: "10px 16px", fontSize: 13, fontWeight: 600, color: "var(--text-primary)", whiteSpace: "nowrap" }}>
                            <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                              {u.name}
                              <ExternalLink size={11} style={{ opacity: 0.4 }} />
                            </span>
                          </td>
                          <td style={{ padding: "10px 16px", fontSize: 13, color: "var(--text-muted)" }}>{u.email || "—"}</td>
                          <td style={{ padding: "10px 16px" }}>
                            {u.referral_code_used
                              ? <span style={{ fontFamily: "'Space Mono', monospace", fontSize: 11, background: "var(--bg-elevated)", border: "1px solid var(--border)", borderRadius: 4, padding: "2px 6px", letterSpacing: "0.5px" }}>{u.referral_code_used}</span>
                              : <span style={{ color: "var(--text-muted)" }}>—</span>}
                          </td>
                          <td style={{ padding: "10px 16px", fontSize: 12, color: "var(--text-muted)", whiteSpace: "nowrap" }}>
                            {u.joined_at ? u.joined_at.toDate().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—"}
                          </td>
                          <td style={{ padding: "10px 16px", fontSize: 12, whiteSpace: "nowrap" }}>
                            {u.verified_at
                              ? <span style={{ display: "inline-flex", alignItems: "center", gap: 4, color: "var(--blue)", fontWeight: 600 }}>
                                  <BadgeCheck size={12} />
                                  {u.verified_at.toDate().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                                </span>
                              : <span style={{ color: "var(--text-muted)" }}>—</span>}
                          </td>
                          <td style={{ width: 32 }} />
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {(
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 16px", borderTop: "1px solid var(--border-muted)" }}>
                    <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
                      {(safeRefPage - 1) * REF_PAGE_SIZE + 1}–{Math.min(safeRefPage * REF_PAGE_SIZE, referredUsers.length)} of {referredUsers.length}
                    </span>
                    <div style={{ display: "flex", gap: 6 }}>
                      <button
                        onClick={() => setReferredUsersPage((p) => Math.max(1, p - 1))}
                        disabled={safeRefPage === 1}
                        style={{ width: 28, height: 28, borderRadius: 6, border: "1px solid var(--border)", background: "var(--bg-elevated)", color: safeRefPage === 1 ? "var(--text-muted)" : "var(--text-primary)", cursor: safeRefPage === 1 ? "not-allowed" : "pointer", display: "flex", alignItems: "center", justifyContent: "center", opacity: safeRefPage === 1 ? 0.4 : 1 }}
                      >
                        <ChevronLeft size={14} />
                      </button>
                      <button
                        onClick={() => setReferredUsersPage((p) => Math.min(totalRefPages, p + 1))}
                        disabled={safeRefPage === totalRefPages}
                        style={{ width: 28, height: 28, borderRadius: 6, border: "1px solid var(--border)", background: "var(--bg-elevated)", color: safeRefPage === totalRefPages ? "var(--text-muted)" : "var(--text-primary)", cursor: safeRefPage === totalRefPages ? "not-allowed" : "pointer", display: "flex", alignItems: "center", justifyContent: "center", opacity: safeRefPage === totalRefPages ? 0.4 : 1 }}
                      >
                        <ChevronRight size={14} />
                      </button>
                    </div>
                  </div>
                )}
              </>
            );
          })()}
        </div>
      </div>

      {/* Blocked Users */}
      <div style={{ marginTop: 16 }}>
        <div style={{ background: "var(--bg-surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", overflow: "hidden" }}>
          <div style={{ display: "flex", borderBottom: "1px solid var(--border)" }}>
            {(["blocked", "blockedBy"] as const).map((tab) => {
              const label =
                tab === "blocked"
                  ? `Users Blocked${blockedUsersList.length > 0 ? ` (${blockedUsersList.length})` : ""}`
                  : `Blocked By${blockedByList.length > 0 ? ` (${blockedByList.length})` : ""}`;
              return (
                <button
                  key={tab}
                  onClick={() => setBlockedTab(tab)}
                  style={{
                    padding: "12px 20px",
                    fontSize: 13,
                    fontWeight: 600,
                    border: "none",
                    borderBottom: `2px solid ${blockedTab === tab ? "var(--blue)" : "transparent"}`,
                    background: "none",
                    cursor: "pointer",
                    color: blockedTab === tab ? "var(--blue)" : "var(--text-muted)",
                    marginBottom: -1,
                    transition: "color 0.15s",
                    fontFamily: "inherit",
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                  }}
                >
                  <UserX size={14} />
                  {label}
                </button>
              );
            })}
          </div>

          <div style={{ padding: "20px 24px" }}>
            {(() => {
              const list = blockedTab === "blocked" ? blockedUsersList : blockedByList;
              const isLoading = blockedTab === "blocked" ? blockedUsersLoading : blockedByLoading;
              const emptyMsg = blockedTab === "blocked" ? "This user hasn't blocked anyone." : "No one has blocked this user.";
              return isLoading ? (
                <div style={{ fontSize: 13, color: "var(--text-muted)" }}>Loading…</div>
              ) : list.length === 0 ? (
                <div style={{ fontSize: 13, color: "var(--text-muted)", fontStyle: "italic" }}>{emptyMsg}</div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {list.map((u) => (
                    <div
                      key={u.uid}
                      onClick={() => router.push(`/users/${u.uid}`)}
                      style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, background: "var(--bg-elevated)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", padding: "10px 14px", cursor: "pointer" }}
                    >
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)", display: "inline-flex", alignItems: "center", gap: 5 }}>
                          {u.name}
                          <ExternalLink size={11} style={{ opacity: 0.4 }} />
                        </div>
                        <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{u.email || "—"}</div>
                      </div>
                    </div>
                  ))}
                </div>
              );
            })()}
          </div>
        </div>
      </div>

      {/* Gigs Posted */}
      {(() => {
        const counts = postedGigs.reduce(
          (acc, g) => {
            const s = g.status.toLowerCase();
            if (s === "completed") acc.completed++;
            else if (s === "cancelled" || s === "canceled") acc.cancelled++;
            else if (s === "expired") acc.expired++;
            else acc.inprogress++;
            return acc;
          },
          { completed: 0, cancelled: 0, expired: 0, inprogress: 0 }
        );
        const totalPages = Math.max(1, Math.ceil(postedGigs.length / GIGS_PAGE_SIZE));
        const safePage = Math.min(postedGigsPage, totalPages);
        const paged = postedGigs.slice((safePage - 1) * GIGS_PAGE_SIZE, safePage * GIGS_PAGE_SIZE);

        return (
          <div style={{ marginTop: 16 }}>
            <div style={{ background: "var(--bg-surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", padding: "20px 24px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
                <Briefcase size={15} style={{ color: "var(--blue)" }} />
                <span style={{ fontSize: 13, fontWeight: 700, color: "var(--text-primary)" }}>
                  Gigs Posted ({postedGigsLoading ? "…" : postedGigs.length})
                </span>
                {!postedGigsLoading && postedGigs.length > 0 && (
                  <div style={{ display: "flex", gap: 6, marginLeft: 4, flexWrap: "wrap" }}>
                    {counts.completed > 0 && <span style={{ fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 20, background: "var(--green-dim)", color: "var(--green)" }}>Completed {counts.completed}</span>}
                    {counts.cancelled > 0 && <span style={{ fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 20, background: "var(--red-dim)", color: "var(--red)" }}>Cancelled {counts.cancelled}</span>}
                    {counts.expired > 0 && <span style={{ fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 20, background: "rgba(245,158,11,0.12)", color: "var(--amber,#f59e0b)" }}>Expired {counts.expired}</span>}
                    {counts.inprogress > 0 && <span style={{ fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 20, background: "var(--blue-dim)", color: "var(--blue)" }}>In Progress {counts.inprogress}</span>}
                  </div>
                )}
              </div>
              {postedGigsLoading ? (
                <div style={{ fontSize: 13, color: "var(--text-muted)", padding: "8px 0" }}>Loading gigs…</div>
              ) : postedGigs.length === 0 ? (
                <div style={{ fontSize: 13, color: "var(--text-muted)", fontStyle: "italic", padding: "8px 0" }}>No gigs posted yet.</div>
              ) : (
                <>
                  <div style={{ overflowX: "auto" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                      <thead>
                        <tr style={{ borderBottom: "1px solid var(--border)" }}>
                          {["Title", "Type", "Gig ID", "Status", "Rating (Host)", "Assigned Worker", "Worker ID", "Pay", "Date"].map((h) => (
                            <th key={h} style={{ textAlign: "left", padding: "6px 10px", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.5px", color: "var(--text-muted)", whiteSpace: "nowrap" }}>
                              {h}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {paged.map((gig) => {
                          const s = gig.status.toLowerCase();
                          const isCompleted = s === "completed";
                          const isCancelled = s === "cancelled" || s === "canceled";
                          const isExpired = s === "expired";
                          return (
                            <tr key={`${gig.gigType}-${gig.id}`} style={{ borderBottom: "1px solid var(--border-muted)" }}>
                              <td style={{ padding: "9px 10px", color: "var(--text-primary)", fontWeight: 500, maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{gig.title}</td>
                              <td style={{ padding: "9px 10px" }}>
                                <span style={{ fontSize: 11, fontWeight: 600, background: "var(--blue-dim)", color: "var(--blue)", borderRadius: 20, padding: "2px 8px" }}>
                                  {WORKED_GIG_LABELS[gig.gigType]}
                                </span>
                              </td>
                              <td style={{ padding: "9px 10px" }}>
                                <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                                  <span style={{ fontFamily: "monospace", fontSize: 11, color: "var(--text-muted)" }} title={gig.id}>{gig.id.slice(0, 10)}…</span>
                                  <button
                                    title="Copy gig ID"
                                    onClick={() => handleCopy(gig.id, gig.id)}
                                    style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 18, height: 18, border: "none", background: "none", cursor: "pointer", borderRadius: 4, padding: 0, color: copiedKey === gig.id ? "var(--green)" : "var(--text-muted)", flexShrink: 0 }}
                                  >
                                    {copiedKey === gig.id ? <Check size={11} /> : <Copy size={11} />}
                                  </button>
                                </div>
                              </td>
                              <td style={{ padding: "9px 10px" }}>
                                <span style={{
                                  fontSize: 11, fontWeight: 600, borderRadius: 20, padding: "2px 8px",
                                  background: isCompleted ? "var(--green-dim)" : isCancelled ? "var(--red-dim)" : isExpired ? "rgba(245,158,11,0.12)" : "var(--blue-dim)",
                                  color: isCompleted ? "var(--green)" : isCancelled ? "var(--red)" : isExpired ? "var(--amber,#f59e0b)" : "var(--blue)",
                                }}>
                                  {isCompleted ? "Completed" : isCancelled ? "Cancelled" : isExpired ? "Expired" : "In Progress"}
                                </span>
                              </td>
                              <td style={{ padding: "9px 10px", whiteSpace: "nowrap" }}>
                                {gig.hostRating != null
                                  ? <span style={{ color: "var(--amber,#f59e0b)", fontWeight: 600 }}>{"★".repeat(Math.round(gig.hostRating))} <span style={{ color: "var(--text-muted)", fontWeight: 400, fontSize: 11 }}>{gig.hostRating.toFixed(1)}</span></span>
                                  : <span style={{ color: "var(--text-muted)" }}>—</span>}
                              </td>
                              <td style={{ padding: "9px 10px", color: "var(--text-primary)", whiteSpace: "nowrap" }}>
                                {gig.assignedWorkerName ?? <span style={{ color: "var(--text-muted)" }}>—</span>}
                              </td>
                              <td style={{ padding: "9px 10px" }}>
                                {gig.assignedWorkerId ? (
                                  <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                                    <span style={{ fontFamily: "monospace", fontSize: 11, color: "var(--text-muted)" }} title={gig.assignedWorkerId}>{gig.assignedWorkerId.slice(0, 10)}…</span>
                                    <button
                                      title="Copy worker ID"
                                      onClick={() => handleCopy(`worker-${gig.id}`, gig.assignedWorkerId!)}
                                      style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 18, height: 18, border: "none", background: "none", cursor: "pointer", borderRadius: 4, padding: 0, color: copiedKey === `worker-${gig.id}` ? "var(--green)" : "var(--text-muted)", flexShrink: 0 }}
                                    >
                                      {copiedKey === `worker-${gig.id}` ? <Check size={11} /> : <Copy size={11} />}
                                    </button>
                                  </div>
                                ) : <span style={{ color: "var(--text-muted)" }}>—</span>}
                              </td>
                              <td style={{ padding: "9px 10px", color: "var(--text-primary)", whiteSpace: "nowrap" }}>{gig.salary != null ? `${symbol}${gig.salary}` : "—"}</td>
                              <td style={{ padding: "9px 10px", color: "var(--text-muted)", whiteSpace: "nowrap" }}>
                                {gig.createdAt ? gig.createdAt.toDate().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—"}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  {totalPages > 1 && (
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 0 0", borderTop: "1px solid var(--border-muted)", marginTop: 8 }}>
                      <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
                        {(safePage - 1) * GIGS_PAGE_SIZE + 1}–{Math.min(safePage * GIGS_PAGE_SIZE, postedGigs.length)} of {postedGigs.length}
                      </span>
                      <div style={{ display: "flex", gap: 4 }}>
                        <button onClick={() => setPostedGigsPage((p) => Math.max(1, p - 1))} disabled={safePage === 1} style={{ display: "flex", alignItems: "center", gap: 4, padding: "4px 10px", border: "1px solid var(--border)", borderRadius: 6, background: "var(--bg-elevated)", color: "var(--text-secondary)", fontSize: 12, cursor: safePage === 1 ? "not-allowed" : "pointer", opacity: safePage === 1 ? 0.4 : 1, fontFamily: "inherit" }}>
                          <ChevronLeft size={12} /> Prev
                        </button>
                        <span style={{ display: "flex", alignItems: "center", padding: "4px 10px", fontSize: 12, color: "var(--text-muted)" }}>
                          {safePage} / {totalPages}
                        </span>
                        <button onClick={() => setPostedGigsPage((p) => Math.min(totalPages, p + 1))} disabled={safePage === totalPages} style={{ display: "flex", alignItems: "center", gap: 4, padding: "4px 10px", border: "1px solid var(--border)", borderRadius: 6, background: "var(--bg-elevated)", color: "var(--text-secondary)", fontSize: 12, cursor: safePage === totalPages ? "not-allowed" : "pointer", opacity: safePage === totalPages ? 0.4 : 1, fontFamily: "inherit" }}>
                          Next <ChevronRight size={12} />
                        </button>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        );
      })()}

      {/* Gigs Worked */}
      {(() => {
        const counts = workedGigs.reduce(
          (acc, g) => {
            const s = g.status.toLowerCase();
            if (s === "completed") acc.completed++;
            else if (s === "cancelled" || s === "canceled") acc.cancelled++;
            else if (s === "expired") acc.expired++;
            else acc.inprogress++;
            return acc;
          },
          { completed: 0, cancelled: 0, expired: 0, inprogress: 0 }
        );
        const totalPages = Math.max(1, Math.ceil(workedGigs.length / GIGS_PAGE_SIZE));
        const safePage = Math.min(workedGigsPage, totalPages);
        const paged = workedGigs.slice((safePage - 1) * GIGS_PAGE_SIZE, safePage * GIGS_PAGE_SIZE);

        return (
          <div style={{ marginTop: 16 }}>
            <div style={{ background: "var(--bg-surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", padding: "20px 24px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
                <CheckCircle size={15} style={{ color: "var(--blue)" }} />
                <span style={{ fontSize: 13, fontWeight: 700, color: "var(--text-primary)" }}>
                  Gigs Worked ({workedGigsLoading ? "…" : workedGigs.length})
                </span>
                {!workedGigsLoading && workedGigs.length > 0 && (
                  <div style={{ display: "flex", gap: 6, marginLeft: 4, flexWrap: "wrap" }}>
                    {counts.completed > 0 && <span style={{ fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 20, background: "var(--green-dim)", color: "var(--green)" }}>Completed {counts.completed}</span>}
                    {counts.cancelled > 0 && <span style={{ fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 20, background: "var(--red-dim)", color: "var(--red)" }}>Cancelled {counts.cancelled}</span>}
                    {counts.expired > 0 && <span style={{ fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 20, background: "rgba(245,158,11,0.12)", color: "var(--amber,#f59e0b)" }}>Expired {counts.expired}</span>}
                    {counts.inprogress > 0 && <span style={{ fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 20, background: "var(--blue-dim)", color: "var(--blue)" }}>In Progress {counts.inprogress}</span>}
                  </div>
                )}
              </div>
              {workedGigsLoading ? (
                <div style={{ fontSize: 13, color: "var(--text-muted)", padding: "8px 0" }}>Loading gigs…</div>
              ) : workedGigs.length === 0 ? (
                <div style={{ fontSize: 13, color: "var(--text-muted)", fontStyle: "italic", padding: "8px 0" }}>No gigs worked yet.</div>
              ) : (
                <>
                  <div style={{ overflowX: "auto" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                      <thead>
                        <tr style={{ borderBottom: "1px solid var(--border)" }}>
                          {["Title", "Type", "Gig ID", "Status", "Rating (Worker)", "Host Name", "Host ID", "Pay", "Date"].map((h) => (
                            <th key={h} style={{ textAlign: "left", padding: "6px 10px", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.5px", color: "var(--text-muted)", whiteSpace: "nowrap" }}>
                              {h}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {paged.map((gig) => {
                          const s = gig.status.toLowerCase();
                          const isCompleted = s === "completed";
                          const isCancelled = s === "cancelled" || s === "canceled";
                          const isExpired = s === "expired";
                          return (
                            <tr key={`${gig.gigType}-${gig.id}`} style={{ borderBottom: "1px solid var(--border-muted)" }}>
                              <td style={{ padding: "9px 10px", color: "var(--text-primary)", fontWeight: 500, maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{gig.title}</td>
                              <td style={{ padding: "9px 10px" }}>
                                <span style={{ fontSize: 11, fontWeight: 600, background: "var(--blue-dim)", color: "var(--blue)", borderRadius: 20, padding: "2px 8px" }}>
                                  {WORKED_GIG_LABELS[gig.gigType]}
                                </span>
                              </td>
                              <td style={{ padding: "9px 10px" }}>
                                <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                                  <span style={{ fontFamily: "monospace", fontSize: 11, color: "var(--text-muted)" }} title={gig.id}>{gig.id.slice(0, 10)}…</span>
                                  <button
                                    title="Copy gig ID"
                                    onClick={() => handleCopy(gig.id, gig.id)}
                                    style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 18, height: 18, border: "none", background: "none", cursor: "pointer", borderRadius: 4, padding: 0, color: copiedKey === gig.id ? "var(--green)" : "var(--text-muted)", flexShrink: 0 }}
                                  >
                                    {copiedKey === gig.id ? <Check size={11} /> : <Copy size={11} />}
                                  </button>
                                </div>
                              </td>
                              <td style={{ padding: "9px 10px" }}>
                                <span style={{
                                  fontSize: 11, fontWeight: 600, borderRadius: 20, padding: "2px 8px",
                                  background: isCompleted ? "var(--green-dim)" : isCancelled ? "var(--red-dim)" : isExpired ? "rgba(245,158,11,0.12)" : "var(--blue-dim)",
                                  color: isCompleted ? "var(--green)" : isCancelled ? "var(--red)" : isExpired ? "var(--amber,#f59e0b)" : "var(--blue)",
                                }}>
                                  {isCompleted ? "Completed" : isCancelled ? "Cancelled" : isExpired ? "Expired" : "In Progress"}
                                </span>
                              </td>
                              <td style={{ padding: "9px 10px", whiteSpace: "nowrap" }}>
                                {gig.workerRating != null
                                  ? <span style={{ color: "var(--amber,#f59e0b)", fontWeight: 600 }}>{"★".repeat(Math.round(gig.workerRating))} <span style={{ color: "var(--text-muted)", fontWeight: 400, fontSize: 11 }}>{gig.workerRating.toFixed(1)}</span></span>
                                  : <span style={{ color: "var(--text-muted)" }}>—</span>}
                              </td>
                              <td style={{ padding: "9px 10px", color: "var(--text-primary)", whiteSpace: "nowrap" }}>
                                {gig.hostName ?? <span style={{ color: "var(--text-muted)" }}>—</span>}
                              </td>
                              <td style={{ padding: "9px 10px" }}>
                                {gig.hostId ? (
                                  <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                                    <span style={{ fontFamily: "monospace", fontSize: 11, color: "var(--text-muted)" }} title={gig.hostId}>{gig.hostId.slice(0, 10)}…</span>
                                    <button
                                      title="Copy host ID"
                                      onClick={() => handleCopy(`host-${gig.id}`, gig.hostId!)}
                                      style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 18, height: 18, border: "none", background: "none", cursor: "pointer", borderRadius: 4, padding: 0, color: copiedKey === `host-${gig.id}` ? "var(--green)" : "var(--text-muted)", flexShrink: 0 }}
                                    >
                                      {copiedKey === `host-${gig.id}` ? <Check size={11} /> : <Copy size={11} />}
                                    </button>
                                  </div>
                                ) : <span style={{ color: "var(--text-muted)" }}>—</span>}
                              </td>
                              <td style={{ padding: "9px 10px", color: "var(--text-primary)", whiteSpace: "nowrap" }}>{gig.salary != null ? `${symbol}${gig.salary}` : "—"}</td>
                              <td style={{ padding: "9px 10px", color: "var(--text-muted)", whiteSpace: "nowrap" }}>
                                {gig.createdAt ? gig.createdAt.toDate().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—"}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  {totalPages > 1 && (
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 0 0", borderTop: "1px solid var(--border-muted)", marginTop: 8 }}>
                      <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
                        {(safePage - 1) * GIGS_PAGE_SIZE + 1}–{Math.min(safePage * GIGS_PAGE_SIZE, workedGigs.length)} of {workedGigs.length}
                      </span>
                      <div style={{ display: "flex", gap: 4 }}>
                        <button onClick={() => setWorkedGigsPage((p) => Math.max(1, p - 1))} disabled={safePage === 1} style={{ display: "flex", alignItems: "center", gap: 4, padding: "4px 10px", border: "1px solid var(--border)", borderRadius: 6, background: "var(--bg-elevated)", color: "var(--text-secondary)", fontSize: 12, cursor: safePage === 1 ? "not-allowed" : "pointer", opacity: safePage === 1 ? 0.4 : 1, fontFamily: "inherit" }}>
                          <ChevronLeft size={12} /> Prev
                        </button>
                        <span style={{ display: "flex", alignItems: "center", padding: "4px 10px", fontSize: 12, color: "var(--text-muted)" }}>
                          {safePage} / {totalPages}
                        </span>
                        <button onClick={() => setWorkedGigsPage((p) => Math.min(totalPages, p + 1))} disabled={safePage === totalPages} style={{ display: "flex", alignItems: "center", gap: 4, padding: "4px 10px", border: "1px solid var(--border)", borderRadius: 6, background: "var(--bg-elevated)", color: "var(--text-secondary)", fontSize: 12, cursor: safePage === totalPages ? "not-allowed" : "pointer", opacity: safePage === totalPages ? 0.4 : 1, fontFamily: "inherit" }}>
                          Next <ChevronRight size={12} />
                        </button>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        );
      })()}

      {/* Suspension & Ban History */}
      <div style={{ marginTop: 16 }}>
        <div style={{ background: "var(--bg-surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", padding: "20px 24px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
            <History size={15} style={{ color: "var(--blue)" }} />
            <span style={{ fontSize: 13, fontWeight: 700, color: "var(--text-primary)" }}>
              Suspension & Ban History ({historyLoading ? "…" : suspensionHistory.length})
            </span>
          </div>
          {historyLoading ? (
            <div style={{ fontSize: 13, color: "var(--text-muted)", padding: "8px 0" }}>Loading history…</div>
          ) : suspensionHistory.length === 0 ? (
            <div style={{ fontSize: 13, color: "var(--text-muted)", fontStyle: "italic", padding: "8px 0" }}>No moderation history found.</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
              {suspensionHistory.map((entry, i) => {
                const isSuspend  = entry.action === "user_suspended";
                const isUnsuspend = entry.action === "user_unsuspended";
                const isBan      = entry.action === "user_banned";
                const isUnban    = entry.action === "user_unbanned";
                const color = isSuspend ? "var(--orange,#f97316)" : isUnsuspend ? "var(--green)" : isBan ? "var(--red)" : "var(--green)";
                const label = isSuspend ? "Suspended" : isUnsuspend ? "Suspension Lifted" : isBan ? "Banned" : "Unbanned";
                const reason = entry.meta?.other?.reason;
                const duration = entry.meta?.other?.duration_minutes;
                const tier = entry.meta?.other?.tier;
                return (
                  <div
                    key={entry.id}
                    style={{
                      display: "grid",
                      gridTemplateColumns: "auto 1fr auto",
                      gap: "0 14px",
                      padding: "10px 0",
                      borderBottom: i < suspensionHistory.length - 1 ? "1px solid var(--border-muted)" : "none",
                      alignItems: "start",
                    }}
                  >
                    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4, paddingTop: 2 }}>
                      <div style={{ width: 8, height: 8, borderRadius: "50%", background: color, flexShrink: 0 }} />
                      {i < suspensionHistory.length - 1 && (
                        <div style={{ width: 1, flex: 1, background: "var(--border-muted)", minHeight: 20 }} />
                      )}
                    </div>
                    <div>
                      <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                        <span style={{ fontSize: 12.5, fontWeight: 700, color }}>{label}</span>
                        {isSuspend && duration != null && (
                          <span style={{ fontSize: 11, color: "var(--text-muted)" }}>· {duration} min{tier ? ` (${tier})` : ""}</span>
                        )}
                      </div>
                      <div style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 2 }}>{entry.description}</div>
                      {reason && (
                        <div style={{ fontSize: 11.5, color: "var(--text-muted)", marginTop: 3, fontStyle: "italic" }}>Reason: {reason}</div>
                      )}
                      <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 3 }}>by {entry.actorName}</div>
                    </div>
                    <div style={{ fontSize: 11, color: "var(--text-muted)", whiteSpace: "nowrap", paddingTop: 2 }}>
                      {entry.createdAt
                        ? entry.createdAt.toDate().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" })
                        : "—"}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Suspend Modal */}
      <SuspendModal
        open={suspendModalOpen}
        onClose={() => { if (!actionLoading) setSuspendModalOpen(false); }}
        user={userData}
        tiers={suspensionTiers}
        onConfirm={handleSuspend}
        loading={actionLoading === "suspend"}
      />

      {/* Confirm dialogs */}
      {confirmAction && (() => {
        const configs: Record<NonNullable<ConfirmAction>, { title: string; message: string; label: string; danger: boolean }> = {
          lift: {
            title: "Lift Suspension",
            message: `Remove the active suspension for ${userData.name}? They will be able to accept gigs immediately.`,
            label: "Lift Suspension",
            danger: false,
          },
          ban: {
            title: "Ban User",
            message: `Permanently ban ${userData.name}? They will be unable to use the app until unbanned.`,
            label: "Ban User",
            danger: true,
          },
          unban: {
            title: "Unban User",
            message: `Lift the ban on ${userData.name}? They will regain full access to the app.`,
            label: "Unban",
            danger: false,
          },
          delete: {
            title: "Schedule Deletion",
            message: `Schedule ${userData.name}'s account for deletion? The account will be permanently deleted in 30 days. You can cancel this during the grace period.`,
            label: "Schedule Deletion",
            danger: true,
          },
          cancel_deletion: {
            title: "Cancel Deletion",
            message: `Cancel the scheduled deletion for ${userData.name}? Their account will be restored to normal.`,
            label: "Cancel Deletion",
            danger: false,
          },
        };
        const cfg = configs[confirmAction];
        return (
          <ConfirmDialog
            open
            onClose={() => { if (!actionLoading) { setConfirmAction(null); setBanReason(""); } }}
            onConfirm={handleConfirm}
            title={cfg.title}
            message={cfg.message}
            confirmLabel={cfg.label}
            danger={cfg.danger}
            loading={actionLoading !== null}
          >
            {confirmAction === "ban" && (
              <div style={{ marginTop: 14 }}>
                <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "var(--text-secondary)", marginBottom: 6 }}>
                  Reason <span style={{ color: "var(--text-muted)", fontWeight: 400 }}>(optional)</span>
                </label>
                <textarea
                  rows={3}
                  placeholder="e.g. Repeated policy violations, fraudulent activity…"
                  value={banReason}
                  onChange={(e) => setBanReason(e.target.value)}
                  style={{
                    width: "100%", resize: "vertical", padding: "8px 10px",
                    background: "var(--bg-elevated)", border: "1px solid var(--border)",
                    borderRadius: "var(--radius-sm)", color: "var(--text-primary)",
                    fontSize: 13, fontFamily: "inherit", lineHeight: 1.5,
                    outline: "none", boxSizing: "border-box",
                  }}
                />
              </div>
            )}
          </ConfirmDialog>
        );
      })()}

      {/* Skills Modal */}
      {userData && (
        <SkillsModal
          open={skillsModalOpen}
          onClose={() => setSkillsModalOpen(false)}
          user={userData}
          availableSkills={availableSkills}
          onSave={handleSaveSkills}
          saving={savingSkills}
        />
      )}

      {/* Host Reward Skills Modal */}
      {userData && (
        <HostRewardSkillsModal
          open={hostRewardSkillsModalOpen}
          onClose={() => setHostRewardSkillsModalOpen(false)}
          user={userData}
          availableSkills={availableSkills}
          onSave={handleSaveHostRewardSkills}
          saving={savingHostRewardSkills}
        />
      )}

      {/* Document Viewer Modal */}
      <Modal
        open={!!selectedDoc}
        onClose={() => setSelectedDoc(null)}
        title={selectedDoc?.name ?? "Document"}
        description={selectedDoc ? selectedDoc.category.replace(/_/g, " ") + (selectedDoc.uploadedAt ? ` · ${selectedDoc.uploadedAt.toDate().toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" })}` : "") : undefined}
        size="lg"
        bodyStyle={{ padding: 0 }}
        footer={
          selectedDoc?.url ? (
            <a href={selectedDoc.url} target="_blank" rel="noopener noreferrer" style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: "var(--blue)", textDecoration: "none" }}>
              <ExternalLink size={13} /> Open in new tab
            </a>
          ) : undefined
        }
      >
        {selectedDoc?.url && (() => {
          const url = selectedDoc.url;
          const isImage = /\.(jpe?g|png|gif|webp|bmp|svg)(\?|$)/i.test(url) || url.includes("image");
          const isPdf = /\.pdf(\?|$)/i.test(url) || url.includes("pdf");
          if (isImage) {
            return (
              <div style={{ display: "flex", alignItems: "center", justifyContent: "center", background: "var(--bg-base)", minHeight: 300, maxHeight: "70vh", overflow: "auto" }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={url} alt={selectedDoc.name} style={{ maxWidth: "100%", maxHeight: "70vh", objectFit: "contain", display: "block" }} />
              </div>
            );
          }
          if (isPdf) {
            return (
              <iframe
                src={url}
                title={selectedDoc.name}
                style={{ width: "100%", height: 600, border: "none", display: "block" }}
              />
            );
          }
          return (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 16, padding: "40px 24px", color: "var(--text-muted)", fontSize: 13 }}>
              <FileText size={40} style={{ color: "var(--blue)", opacity: 0.6 }} />
              <span>Preview not available for this file type.</span>
            </div>
          );
        })()}
      </Modal>
    </AdminLayout>
  );
}
