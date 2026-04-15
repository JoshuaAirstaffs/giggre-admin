"use client";

import { useState, useEffect, useCallback, useMemo, useRef, Fragment, memo } from "react";
import { useRouter } from "next/navigation";
import AdminLayout from "@/components/layout/AdminLayout";
import Badge from "@/components/ui/Badge";
import Button from "@/components/ui/Button";
import Modal, { ConfirmDialog } from "@/components/ui/Modal";
import { useAuthGuard } from "@/hooks/useAuthGuard";
import {
  collection,
  onSnapshot,
  doc,
  getDoc,
  getDocs,
  updateDoc,
  deleteDoc,
  serverTimestamp,
  Timestamp,
  GeoPoint,
  query,
  where,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { writeLog, buildDescription } from "@/lib/activitylog";
import {
  Search, ChevronDown, ChevronUp, X,
  Users, ArrowUpDown, ExternalLink, Clock, ShieldOff,
  Ban, ShieldCheck, Trash2, AlertTriangle, Briefcase, CheckCircle,
} from "lucide-react";

// ─── Gig types (for user gigs panel) ──────────────────────────────────────────

type GigType = "offered" | "open" | "quick";
const GIG_COLLECTIONS: Record<GigType, string> = {
  offered: "offered_gigs",
  open: "open_gigs",
  quick: "quick_gigs",
};
const GIG_TYPE_LABELS: Record<GigType, string> = {
  offered: "Offered",
  open: "Open",
  quick: "Quick",
};

interface UserGig {
  id: string;
  gigType: GigType;
  title: string;
  status: string;
  salary?: string | number;
  category?: string;
  vacancy?: number;
  slot?: number;
  createdAt: Timestamp | null;
  cancelledByAdmin?: boolean;
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface SuspensionTier {
  decline_count_trigger: number;
  suspension_duration_minutes: number;
  tier_label?: string;
  is_active: boolean;
}

interface AppUser {
  id: string;
  // Collapsed view
  name: string;
  email: string;
  phone: string;
  balance: number;
  createdAt: Timestamp | null;
  isOnline: boolean;
  // Expanded view
  acceptanceRate: number;
  autoAccept: boolean;
  availableForGigs: boolean;
  decline_count: number;
  location: GeoPoint | null;
  openGigsUnlocked: boolean;
  ratingAsHost: number;
  ratingAsWorker: number;
  ratingCount: number;
  role: string;
  seekingQuickGigs: boolean;
  signInMethod: string;
  skills: string[];
  slot: number;
  userId: string;
  // Status / moderation
  suspended_until: Timestamp | null;
  isBanned: boolean;
  // Additional stats
  quickGigDailyDeclineCount: number;
  quickGigTotalDeclines: number;
  totalGigs: number;
}

type SortField = "createdAt" | "balance" | "name";
type SortDir = "asc" | "desc";
type StatusFilter = "all" | "online" | "offline" | "suspended" | "banned";

const SORT_LABELS: Record<SortField, { label: string; asc: string; desc: string }> = {
  name:      { label: "Name",    asc: "A → Z",        desc: "Z → A"        },
  balance:   { label: "Balance", asc: "Low → High",   desc: "High → Low"   },
  createdAt: { label: "Date",    asc: "Oldest first", desc: "Newest first" },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(ts: Timestamp | null): string {
  if (!ts) return "N/A";
  return ts.toDate().toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatBalance(n: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
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

function isCurrentlySuspended(user: AppUser): boolean {
  if (!user.suspended_until) return false;
  return user.suspended_until.toDate() > new Date();
}

function getApplicableTier(declineCount: number, tiers: SuspensionTier[]): SuspensionTier | null {
  const active = tiers.filter((t) => t.is_active && declineCount >= t.decline_count_trigger);
  if (active.length === 0) return null;
  return active.reduce((prev, curr) =>
    curr.decline_count_trigger > prev.decline_count_trigger ? curr : prev
  );
}

function toUser(id: string, d: Record<string, any>): AppUser {
  return {
    id,
    name:              d.name              ?? "No Name",
    email:             d.email             ?? "No Email",
    phone:             d.phone             ?? "No Phone",
    balance:           typeof d.balance === "number" ? d.balance : 0,
    createdAt:         d.createdAt instanceof Timestamp ? d.createdAt : null,
    isOnline:          d.isOnline          ?? false,
    acceptanceRate:    typeof d.acceptanceRate    === "number" ? d.acceptanceRate    : 0,
    autoAccept:        d.autoAccept        ?? false,
    availableForGigs:  d.availableForGigs  ?? false,
    decline_count:     typeof d.decline_count     === "number" ? d.decline_count     : 0,
    location:          d.location instanceof GeoPoint ? d.location : null,
    openGigsUnlocked:  d.openGigsUnlocked  ?? false,
    ratingAsHost:      typeof d.ratingAsHost      === "number" ? d.ratingAsHost      : 0,
    ratingAsWorker:    typeof d.ratingAsWorker    === "number" ? d.ratingAsWorker    : 0,
    ratingCount:       typeof d.ratingCount       === "number" ? d.ratingCount       : 0,
    role:              d.role              ?? "N/A",
    seekingQuickGigs:  d.seekingQuickGigs  ?? false,
    signInMethod:      d.signInMethod      ?? "N/A",
    skills:            Array.isArray(d.skills)    ? d.skills    : [],
    slot:              typeof d.slot              === "number" ? d.slot              : 0,
    userId:            d.userId            ?? d.uid ?? id,
    suspended_until:   d.suspended_until instanceof Timestamp ? d.suspended_until : null,
    isBanned:          d.isBanned          ?? false,
    quickGigDailyDeclineCount: typeof d.quickGigDailyDeclineCount === "number" ? d.quickGigDailyDeclineCount : 0,
    quickGigTotalDeclines:     typeof d.quickGigTotalDeclines     === "number" ? d.quickGigTotalDeclines     : 0,
    totalGigs:                 typeof d.totalGigs                 === "number" ? d.totalGigs                 : 0,
  };
}

// ─── Skeleton ─────────────────────────────────────────────────────────────────

function TableSkeleton() {
  return (
    <>
      <style>{`
        @keyframes skel-pulse { 0%,100%{opacity:.45} 50%{opacity:.9} }
        .sk { background: var(--bg-elevated); border-radius: 5px; animation: skel-pulse 1.4s ease-in-out infinite; }
      `}</style>
      {Array.from({ length: 8 }).map((_, i) => (
        <tr key={i} style={{ borderBottom: "1px solid var(--border-muted)" }}>
          {[140, 180, 100, 70, 130, 55].map((w, j) => (
            <td key={j} style={{ padding: "13px 14px" }}>
              <div className="sk" style={{ height: 13, width: w, opacity: 1 - i * 0.09 }} />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}

// ─── Suspend Modal ────────────────────────────────────────────────────────────

function SuspendModal({
  open, onClose, user, tiers, onConfirm, loading,
}: {
  open: boolean;
  onClose: () => void;
  user: AppUser | null;
  tiers: SuspensionTier[];
  onConfirm: (minutes: number, label: string) => void;
  loading: boolean;
}) {
  const activeTiers = [...tiers]
    .sort((a, b) => a.decline_count_trigger - b.decline_count_trigger);

  const [selected, setSelected] = useState<number | "custom">("custom");
  const [customMin, setCustomMin] = useState(60);

  useEffect(() => {
    if (!open || !user) return;
    // Pre-select the highest tier that the user's decline_count qualifies for
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

  const canConfirm = selected === "custom" ? customMin > 0 : true;

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
            disabled={!canConfirm}
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

// ─── Expanded Row ─────────────────────────────────────────────────────────────

interface ExpandedRowProps {
  user: AppUser;
  colSpan: number;
  applicableTier: SuspensionTier | null;
  suspended: boolean;
  canSuspend: boolean;
  onViewProfile: () => void;
  onSuspend: () => void;
  onLiftSuspension: () => void;
  onBan: () => void;
  onUnban: () => void;
  onDelete: () => void;
  actionLoading: string | null;
  onViewGigs: () => void;
  onViewWorkedGigs: () => void;
}

const ExpandedRow = memo(function ExpandedRow({
  user, colSpan, applicableTier, suspended, canSuspend,
  onViewProfile, onSuspend, onLiftSuspension, onBan, onUnban, onDelete,
  actionLoading, onViewGigs, onViewWorkedGigs,
}: ExpandedRowProps) {
  return (
    <tr>
      <td colSpan={colSpan} style={{ padding: 0, background: "var(--bg-elevated)" }}>
        <style>{`
          .exp-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 12px; padding: 18px 20px 14px; }
          .exp-field { display: flex; flex-direction: column; gap: 3px; }
          .exp-label { font-size: 10px; font-weight: 700; letter-spacing: 0.6px; text-transform: uppercase; color: var(--text-muted); }
          .exp-value { font-size: 12.5px; color: var(--text-primary); }
          .exp-skills { display: flex; flex-wrap: wrap; gap: 5px; padding-top: 2px; }
          .skill-chip { font-size: 11px; font-weight: 600; background: var(--blue-dim); color: var(--blue); border-radius: 20px; padding: 2px 10px; white-space: nowrap; }
          .exp-divider { border: none; border-top: 1px solid var(--border); margin: 0; }
          .exp-actions { display: flex; align-items: center; gap: 8px; padding: 12px 20px 16px; flex-wrap: wrap; }
          .exp-tier-badge { display: inline-flex; align-items: center; gap: 5px; font-size: 11px; font-weight: 600; padding: 3px 10px; border-radius: 20px; background: rgba(249,115,22,0.12); color: var(--orange,#f97316); }
        `}</style>
        <hr className="exp-divider" />
        <div className="exp-grid">
          <div className="exp-field">
            <span className="exp-label">User ID</span>
            <span className="exp-value" style={{ fontFamily: "monospace", fontSize: 11, wordBreak: "break-all" }}>{user.userId || "—"}</span>
          </div>
          <div className="exp-field">
            <span className="exp-label">Role</span>
            <span className="exp-value">{user.role}</span>
          </div>
          <div className="exp-field">
            <span className="exp-label">Sign-in Method</span>
            <span className="exp-value">{user.signInMethod}</span>
          </div>
          <div className="exp-field">
            <span className="exp-label">Acceptance Rate</span>
            <span className="exp-value">{(user.acceptanceRate * (user.acceptanceRate <= 1 ? 100 : 1)).toFixed(1)}%</span>
          </div>
          <div className="exp-field">
            <span className="exp-label">Decline Count</span>
            <span className="exp-value" style={{ display: "flex", alignItems: "center", gap: 6 }}>
              {user.decline_count}
              {applicableTier && (
                <span className="exp-tier-badge">
                  <AlertTriangle size={10} />
                  {applicableTier.tier_label ?? `Tier`} — {applicableTier.suspension_duration_minutes}m
                </span>
              )}
            </span>
          </div>
          <div className="exp-field">
            <span className="exp-label">Daily Declines</span>
            <span className="exp-value">{user.quickGigDailyDeclineCount}</span>
          </div>
          <div className="exp-field">
            <span className="exp-label">Total Declines</span>
            <span className="exp-value">{user.quickGigTotalDeclines}</span>
          </div>
          <div className="exp-field">
            <span className="exp-label">Total Accepted Gigs</span>
            <span className="exp-value">{user.totalGigs}</span>
          </div>
          <div className="exp-field">
            <span className="exp-label">Rating as Host</span>
            <span className="exp-value">{formatRating(user.ratingAsHost)} ({user.ratingCount} ratings)</span>
          </div>
          <div className="exp-field">
            <span className="exp-label">Rating as Worker</span>
            <span className="exp-value">{formatRating(user.ratingAsWorker)}</span>
          </div>
          <div className="exp-field">
            <span className="exp-label">Slot</span>
            <span className="exp-value">{user.slot}</span>
          </div>
          <div className="exp-field">
            <span className="exp-label">Location</span>
            <span className="exp-value">{formatLocation(user.location)}</span>
          </div>
          <div className="exp-field">
            <span className="exp-label">Auto Accept</span>
            <span className="exp-value">{user.autoAccept ? "Yes" : "No"}</span>
          </div>
          <div className="exp-field">
            <span className="exp-label">Available for Gigs</span>
            <span className="exp-value">{user.availableForGigs ? "Yes" : "No"}</span>
          </div>
          <div className="exp-field">
            <span className="exp-label">Seeking Quick Gigs</span>
            <span className="exp-value">{user.seekingQuickGigs ? "Yes" : "No"}</span>
          </div>
          <div className="exp-field">
            <span className="exp-label">Open Gigs Unlocked</span>
            <span className="exp-value">{user.openGigsUnlocked ? "Yes" : "No"}</span>
          </div>
          {suspended && user.suspended_until && (
            <div className="exp-field">
              <span className="exp-label">Suspended Until</span>
              <span className="exp-value" style={{ color: "var(--orange,#f97316)" }}>{formatDate(user.suspended_until)}</span>
            </div>
          )}
        </div>

        {user.skills.length > 0 && (
          <div style={{ padding: "0 20px 12px" }}>
            <div className="exp-label" style={{ marginBottom: 7 }}>Skills</div>
            <div className="exp-skills">
              {user.skills.map((s, i) => (
                <span key={i} className="skill-chip">{s}</span>
              ))}
            </div>
          </div>
        )}

        <hr className="exp-divider" />
        <div className="exp-actions">
          <Button
            variant="secondary" size="sm"
            icon={ExternalLink}
            onClick={onViewProfile}
          >
            View Profile
          </Button>

          {suspended ? (
            <Button
              variant="success" size="sm"
              icon={ShieldCheck}
              loading={actionLoading === "lift"}
              onClick={onLiftSuspension}
            >
              Lift Suspension
            </Button>
          ) : (
            <Button
              variant="secondary" size="sm"
              icon={Clock}
              loading={actionLoading === "suspend"}
              onClick={onSuspend}
              disabled={!canSuspend}
            >
              Suspend
            </Button>
          )}

          {user.isBanned ? (
            <Button
              variant="success" size="sm"
              icon={ShieldOff}
              loading={actionLoading === "unban"}
              onClick={onUnban}
            >
              Unban
            </Button>
          ) : (
            <Button
              variant="danger" size="sm"
              icon={Ban}
              loading={actionLoading === "ban"}
              onClick={onBan}
            >
              Ban User
            </Button>
          )}

          <Button
            variant="secondary" size="sm"
            icon={Briefcase}
            onClick={onViewGigs}
          >
            Gigs Posted
          </Button>

          <Button
            variant="secondary" size="sm"
            icon={CheckCircle}
            onClick={onViewWorkedGigs}
          >
            Gigs Completed
          </Button>

          <Button
            variant="danger" size="sm"
            icon={Trash2}
            loading={actionLoading === "delete"}
            onClick={onDelete}
            style={{ marginLeft: "auto" }}
          >
            Delete User
          </Button>
        </div>

      </td>
    </tr>
  );
});

// ─── Page ─────────────────────────────────────────────────────────────────────

const PAGE_SIZE = 15;

type ConfirmAction = "ban" | "unban" | "lift" | "delete" | null;

export default function UsersPage() {
  const { user: adminUser } = useAuthGuard({ module: "users" });
  const router = useRouter();

  const [users, setUsers]                   = useState<AppUser[]>([]);
  const [loading, setLoading]               = useState(true);
  const [search, setSearch]                 = useState("");
  const [sortField, setSortField]           = useState<SortField | null>(null);
  const [sortDir, setSortDir]               = useState<SortDir>("desc");
  const [expandedId, setExpandedId]         = useState<string | null>(null);
  const [page, setPage]                     = useState(1);
  const [suspensionTiers, setSuspensionTiers] = useState<SuspensionTier[]>([]);
  const [confirmAction, setConfirmAction]   = useState<ConfirmAction>(null);
  const [targetUser, setTargetUser]         = useState<AppUser | null>(null);
  const [actionLoading, setActionLoading]   = useState<string | null>(null);
  const [suspendModalOpen, setSuspendModalOpen] = useState(false);
  const [statusFilter, setStatusFilter]         = useState<StatusFilter>("all");
  const [banReason, setBanReason]               = useState("");
  const [userGigsMap, setUserGigsMap]             = useState<Record<string, UserGig[]>>({});
  const [gigsLoadingId, setGigsLoadingId]         = useState<string | null>(null);
  const [gigsModalUser, setGigsModalUser]         = useState<AppUser | null>(null);
  const [workedGigsMap, setWorkedGigsMap]         = useState<Record<string, UserGig[]>>({});
  const [workedGigsLoadingId, setWorkedGigsLoadingId] = useState<string | null>(null);
  const [workedGigsModalUser, setWorkedGigsModalUser] = useState<AppUser | null>(null);

  const isSorted = sortField !== null;

  const userGigsMapRef    = useRef(userGigsMap);
  const workedGigsMapRef  = useRef(workedGigsMap);
  useEffect(() => { userGigsMapRef.current   = userGigsMap;   }, [userGigsMap]);
  useEffect(() => { workedGigsMapRef.current = workedGigsMap; }, [workedGigsMap]);

  // ── Fetch gigs posted by a user (hostId) ─────────────────────────────────
  const fetchUserGigs = useCallback(async (userId: string) => {
    if (userGigsMapRef.current[userId]) return; // already loaded
    setGigsLoadingId(userId);
    try {
      const types: GigType[] = ["offered", "open", "quick"];
      const snaps = await Promise.all(
        types.map((t) =>
          getDocs(query(collection(db, GIG_COLLECTIONS[t]), where("hostId", "==", userId)))
        )
      );
      const gigs: UserGig[] = snaps.flatMap((snap, i) =>
        snap.docs.map((d) => ({ id: d.id, gigType: types[i], ...d.data() } as UserGig))
      );
      setUserGigsMap((prev) => ({ ...prev, [userId]: gigs }));
    } catch (err) {
      console.error("[UsersPage] fetchUserGigs error:", err);
      setUserGigsMap((prev) => ({ ...prev, [userId]: [] }));
    } finally {
      setGigsLoadingId(null);
    }
  }, []);

  // ── Fetch gigs worked by a user (workerId) ────────────────────────────────
  const fetchWorkedGigs = useCallback(async (userId: string) => {
    if (workedGigsMapRef.current[userId]) return; // already loaded
    setWorkedGigsLoadingId(userId);
    try {
      const types: GigType[] = ["offered", "open", "quick"];
      const snaps = await Promise.all(
        types.map((t) =>
          getDocs(query(collection(db, GIG_COLLECTIONS[t]), where("workerId", "==", userId)))
        )
      );
      const gigs: UserGig[] = snaps.flatMap((snap, i) =>
        snap.docs.map((d) => ({ id: d.id, gigType: types[i], ...d.data() } as UserGig))
      );
      setWorkedGigsMap((prev) => ({ ...prev, [userId]: gigs }));
    } catch (err) {
      console.error("[UsersPage] fetchWorkedGigs error:", err);
      setWorkedGigsMap((prev) => ({ ...prev, [userId]: [] }));
    } finally {
      setWorkedGigsLoadingId(null);
    }
  }, []);

  // ── Load suspension tier config ───────────────────────────────────────────
  useEffect(() => {
    getDoc(doc(db, "quick_gig_config", "decline_suspension")).then((snap) => {
      if (snap.exists()) {
        const data = snap.data();
        const tiers: SuspensionTier[] = Array.isArray(data.suspension_tier_table)
          ? data.suspension_tier_table
          : [];
        setSuspensionTiers(tiers);
      }
    }).catch((err) => console.warn("[UsersPage] Failed to load suspension config:", err));
  }, []);

  // ── Real-time listener ────────────────────────────────────────────────────
  useEffect(() => {
    setLoading(true);
    const q = query(collection(db, "users"));
    const unsub = onSnapshot(
      q,
      (snap) => {
        const parsed = snap.docs.map((d) => toUser(d.id, d.data() as Record<string, any>));
        setUsers(parsed);
        setLoading(false);
      },
      (err) => {
        console.error("[UsersPage] onSnapshot error:", err);
        setLoading(false);
      }
    );
    return () => unsub();
  }, []);

  // ── Action helpers ────────────────────────────────────────────────────────

  const openConfirm = useCallback((action: ConfirmAction, user: AppUser) => {
    setTargetUser(user);
    setConfirmAction(action);
  }, []);

  const closeConfirm = useCallback(() => {
    if (actionLoading) return;
    setConfirmAction(null);
    setTargetUser(null);
    setBanReason("");
  }, [actionLoading]);

  const handleSuspend = useCallback(async (durationMinutes: number, tierLabel: string) => {
    if (!targetUser || !adminUser) return;
    setActionLoading("suspend");
    try {
      const suspendedUntil = Timestamp.fromDate(new Date(Date.now() + durationMinutes * 60 * 1000));
      await updateDoc(doc(db, "users", targetUser.id), {
        suspended_until: suspendedUntil,
        updatedAt: serverTimestamp(),
      });
      await writeLog({
        actorId: adminUser.uid,
        actorName: adminUser.displayName ?? "Unknown",
        actorEmail: adminUser.email ?? "",
        module: "user_management",
        action: "user_suspended",
        description: buildDescription.userSuspended(targetUser.name, durationMinutes),
        targetId: targetUser.id,
        targetName: targetUser.name,
        affectedFiles: [`users/${targetUser.id}`],
        meta: { other: { duration_minutes: durationMinutes, tier: tierLabel } },
      });
      setSuspendModalOpen(false);
      setTargetUser(null);
    } catch (err) {
      console.error("[UsersPage] suspend error:", err);
    } finally {
      setActionLoading(null);
    }
  }, [targetUser, adminUser, suspensionTiers, closeConfirm]);

  const handleLiftSuspension = useCallback(async () => {
    if (!targetUser || !adminUser) return;
    setActionLoading("lift");
    try {
      await updateDoc(doc(db, "users", targetUser.id), {
        suspended_until: null,
        updatedAt: serverTimestamp(),
      });
      await writeLog({
        actorId: adminUser.uid,
        actorName: adminUser.displayName ?? "Unknown",
        actorEmail: adminUser.email ?? "",
        module: "user_management",
        action: "user_unsuspended",
        description: buildDescription.userUnsuspended(targetUser.name),
        targetId: targetUser.id,
        targetName: targetUser.name,
        affectedFiles: [`users/${targetUser.id}`],
      });
      closeConfirm();
    } catch (err) {
      console.error("[UsersPage] lift suspension error:", err);
    } finally {
      setActionLoading(null);
    }
  }, [targetUser, adminUser, closeConfirm]);

  const handleBan = useCallback(async () => {
    if (!targetUser || !adminUser) return;
    setActionLoading("ban");
    try {
      await updateDoc(doc(db, "users", targetUser.id), {
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
        description: buildDescription.userBanned(targetUser.name),
        targetId: targetUser.id,
        targetName: targetUser.name,
        affectedFiles: [`users/${targetUser.id}`],
        meta: banReason.trim() ? { other: { reason: banReason.trim() } } : undefined,
      });
      closeConfirm();
    } catch (err) {
      console.error("[UsersPage] ban error:", err);
    } finally {
      setActionLoading(null);
    }
  }, [targetUser, adminUser, banReason, closeConfirm]);

  const handleUnban = useCallback(async () => {
    if (!targetUser || !adminUser) return;
    setActionLoading("unban");
    try {
      await updateDoc(doc(db, "users", targetUser.id), {
        isBanned: false,
        updatedAt: serverTimestamp(),
      });
      await writeLog({
        actorId: adminUser.uid,
        actorName: adminUser.displayName ?? "Unknown",
        actorEmail: adminUser.email ?? "",
        module: "user_management",
        action: "user_unbanned",
        description: buildDescription.userUnbanned(targetUser.name),
        targetId: targetUser.id,
        targetName: targetUser.name,
        affectedFiles: [`users/${targetUser.id}`],
      });
      closeConfirm();
    } catch (err) {
      console.error("[UsersPage] unban error:", err);
    } finally {
      setActionLoading(null);
    }
  }, [targetUser, adminUser, closeConfirm]);

  const handleDelete = useCallback(async () => {
    if (!targetUser || !adminUser) return;
    setActionLoading("delete");
    try {
      await deleteDoc(doc(db, "users", targetUser.id));
      await writeLog({
        actorId: adminUser.uid,
        actorName: adminUser.displayName ?? "Unknown",
        actorEmail: adminUser.email ?? "",
        module: "user_management",
        action: "user_deleted",
        description: buildDescription.userDeleted(targetUser.name),
        targetId: targetUser.id,
        targetName: targetUser.name,
        affectedFiles: [`users/${targetUser.id}`],
      });
      setExpandedId(null);
      closeConfirm();
    } catch (err) {
      console.error("[UsersPage] delete error:", err);
    } finally {
      setActionLoading(null);
    }
  }, [targetUser, adminUser, closeConfirm]);

  // Dispatch confirm to the right handler
  const handleConfirm = useCallback(() => {
    switch (confirmAction) {
      case "lift":    return handleLiftSuspension();
      case "ban":     return handleBan();
      case "unban":   return handleUnban();
      case "delete":  return handleDelete();
    }
  }, [confirmAction, handleSuspend, handleLiftSuspension, handleBan, handleUnban, handleDelete]);

  // ── Sort handlers ─────────────────────────────────────────────────────────
  const handleSortField = useCallback((field: SortField) => {
    setSortField(field);
    setSortDir("desc");
    setPage(1);
  }, []);

  const handleSortDir = useCallback((dir: SortDir) => {
    setSortDir(dir);
    setPage(1);
  }, []);

  const clearSort = useCallback(() => {
    setSortField(null);
    setSortDir("desc");
    setPage(1);
  }, []);

  // ── Filter + sort ─────────────────────────────────────────────────────────

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let list = q
      ? users.filter((u) =>
          u.name.toLowerCase().includes(q) ||
          u.email.toLowerCase().includes(q) ||
          u.phone.toLowerCase().includes(q) ||
          u.userId.toLowerCase().includes(q)
        )
      : users;

    if (statusFilter !== "all") {
      list = list.filter((u) => {
        const suspended = isCurrentlySuspended(u);
        switch (statusFilter) {
          case "online":    return u.isOnline && !u.isBanned && !suspended;
          case "offline":   return !u.isOnline && !u.isBanned && !suspended;
          case "suspended": return suspended && !u.isBanned;
          case "banned":    return u.isBanned;
        }
      });
    }

    if (sortField) {
      list = [...list].sort((a, b) => {
        let cmp = 0;
        if (sortField === "name") {
          cmp = a.name.localeCompare(b.name);
        } else if (sortField === "balance") {
          cmp = a.balance - b.balance;
        } else {
          const ta = a.createdAt?.toMillis() ?? 0;
          const tb = b.createdAt?.toMillis() ?? 0;
          cmp = ta - tb;
        }
        return sortDir === "asc" ? cmp : -cmp;
      });
    }
    return list;
  }, [users, search, sortField, sortDir, statusFilter]);

  // ── Pagination ────────────────────────────────────────────────────────────
  const totalPages  = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage    = Math.min(page, totalPages);
  const paged       = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);
  const onlineCount = users.filter((u) => u.isOnline).length;

  const COL_SPAN = 8;

  // ── Confirm dialog content ────────────────────────────────────────────────
  const confirmConfig: Record<
    NonNullable<ConfirmAction>,
    { title: string; message: string; label: string; danger: boolean }
  > = {
    lift: {
      title: "Lift Suspension",
      message: `Remove the active suspension for ${targetUser?.name}? They will be able to accept gigs immediately.`,
      label: "Lift Suspension",
      danger: false,
    },
    ban: {
      title: "Ban User",
      message: `Permanently ban ${targetUser?.name}? They will be unable to use the app until unbanned.`,
      label: "Ban User",
      danger: true,
    },
    unban: {
      title: "Unban User",
      message: `Lift the ban on ${targetUser?.name}? They will regain full access to the app.`,
      label: "Unban",
      danger: false,
    },
    delete: {
      title: "Delete User",
      message: `Permanently delete ${targetUser?.name}'s account? This action cannot be undone.`,
      label: "Delete",
      danger: true,
    },
  };

  return (
    <AdminLayout
      title="Users"
      subtitle="Manage all registered users and workers"
    >
      <style>{`
        /* layout */
        .up-wrap { display: flex; flex-direction: column; gap: 14px; }
        .up-card { background: var(--bg-surface); border: 1px solid var(--border); border-radius: var(--radius-lg); overflow: hidden; }

        /* stats bar */
        .up-stats { display: flex; align-items: center; gap: 20px; padding: 14px 20px; border-bottom: 1px solid var(--border); flex-wrap: wrap; }
        .up-stat { display: flex; align-items: center; gap: 6px; font-size: 12.5px; color: var(--text-secondary); }
        .up-stat strong { color: var(--text-primary); font-size: 14px; }

        /* filter bar */
        .up-filter-bar { display: flex; align-items: center; gap: 6px; padding: 10px 16px; border-bottom: 1px solid var(--border); flex-wrap: wrap; }
        .up-filter-btn { display: flex; align-items: center; gap: 5px; padding: 5px 11px; border-radius: 20px; border: 1px solid var(--border); background: var(--bg-elevated); color: var(--text-secondary); font-size: 11.5px; font-family: inherit; cursor: pointer; transition: all 0.15s; white-space: nowrap; }
        .up-filter-btn:hover { background: var(--bg-hover); color: var(--text-primary); }
        .up-filter-btn.active { font-weight: 600; border-color: var(--blue); color: var(--blue); background: var(--blue-dim); }
        .up-filter-count { font-size: 10.5px; background: var(--bg-page); border: 1px solid var(--border-muted); border-radius: 10px; padding: 0 5px; min-width: 18px; text-align: center; color: var(--text-muted); line-height: 1.6; }
        .up-filter-btn.active .up-filter-count { border-color: currentColor; color: inherit; opacity: 0.75; }

        /* toolbar */
        .up-toolbar { display: flex; align-items: center; gap: 8px; padding: 12px 16px; border-bottom: 1px solid var(--border); flex-wrap: wrap; }
        .up-search { display: flex; align-items: center; gap: 7px; background: var(--bg-elevated); border: 1px solid var(--border); border-radius: var(--radius-sm); padding: 7px 10px; flex: 1; min-width: 200px; transition: border-color 0.2s; }
        .up-search:focus-within { border-color: var(--blue); }
        .up-search input { background: none; border: none; outline: none; color: var(--text-primary); font-size: 12.5px; width: 100%; font-family: inherit; }
        .up-search input::placeholder { color: var(--text-muted); }
        .up-sort-wrap { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
        .up-sort-label { font-size: 11px; color: var(--text-muted); white-space: nowrap; font-weight: 600; letter-spacing: 0.3px; }
        .up-field-btn { display: flex; align-items: center; gap: 4px; padding: 5px 10px; border-radius: var(--radius-sm); border: 1px solid var(--border); background: var(--bg-elevated); color: var(--text-secondary); font-size: 11.5px; font-family: inherit; cursor: pointer; transition: all 0.15s; white-space: nowrap; }
        .up-field-btn:hover { background: var(--bg-hover); color: var(--text-primary); border-color: var(--border-muted); }
        .up-field-btn.active { border-color: var(--blue); color: var(--blue); background: var(--blue-dim); font-weight: 600; }
        .up-dir-group { display: flex; border: 1px solid var(--border); border-radius: var(--radius-sm); overflow: hidden; }
        .up-dir-btn { display: flex; align-items: center; gap: 4px; padding: 5px 10px; background: var(--bg-elevated); color: var(--text-muted); font-size: 11px; font-family: inherit; cursor: pointer; border: none; transition: all 0.15s; white-space: nowrap; border-right: 1px solid var(--border); }
        .up-dir-btn:last-child { border-right: none; }
        .up-dir-btn:hover:not(.active) { background: var(--bg-hover); color: var(--text-secondary); }
        .up-dir-btn.active { background: var(--blue); color: #fff; font-weight: 600; }
        .up-clear-btn { display: flex; align-items: center; gap: 4px; padding: 5px 9px; border-radius: var(--radius-sm); border: 1px solid var(--border); background: var(--bg-elevated); color: var(--text-muted); font-size: 11px; font-family: inherit; cursor: pointer; transition: all 0.15s; white-space: nowrap; }
        .up-clear-btn:hover { background: var(--red-dim); color: var(--red); border-color: rgba(239,68,68,0.3); }
        .up-sort-hint { font-size: 11px; color: var(--text-muted); font-style: italic; }

        /* table */
        .up-table { width: 100%; border-collapse: collapse; }
        .up-table thead tr { background: var(--bg-elevated); }
        .up-table th { padding: 9px 14px; text-align: left; font-size: 10px; font-weight: 700; letter-spacing: 0.8px; text-transform: uppercase; color: var(--text-muted); white-space: nowrap; border-bottom: 1px solid var(--border); }
        .up-table tbody tr { border-bottom: 1px solid var(--border-muted); transition: background 0.1s; }
        .up-table tbody tr:last-child { border-bottom: none; }
        .up-table tbody tr.data-row:hover { background: var(--bg-elevated); }
        .up-table td { padding: 11px 14px; font-size: 12.5px; color: var(--text-secondary); vertical-align: middle; }
        .up-name { font-weight: 600; color: var(--text-primary); font-size: 13px; }
        .up-sub { font-size: 11px; color: var(--text-muted); margin-top: 1px; }

        /* expand button */
        .expand-btn { width: 26px; height: 26px; border-radius: 5px; border: 1px solid var(--border); background: var(--bg-elevated); color: var(--text-secondary); display: flex; align-items: center; justify-content: center; cursor: pointer; transition: all 0.15s; }
        .expand-btn:hover { background: var(--bg-hover); color: var(--text-primary); }
        .expand-btn.open { background: var(--blue-dim); border-color: var(--blue); color: var(--blue); }

        /* empty */
        .up-empty { padding: 52px 24px; text-align: center; color: var(--text-muted); font-size: 13px; }

        /* pagination */
        .up-pg { display: flex; align-items: center; justify-content: space-between; padding: 12px 16px; border-top: 1px solid var(--border); gap: 12px; flex-wrap: wrap; }
        .up-pg-info { font-size: 11px; color: var(--text-muted); }
        .up-pg-btns { display: flex; gap: 4px; }
        .up-pg-btn { min-width: 28px; height: 28px; padding: 0 6px; border-radius: 6px; border: 1px solid var(--border); background: var(--bg-elevated); color: var(--text-secondary); font-size: 12px; font-family: inherit; cursor: pointer; display: flex; align-items: center; justify-content: center; transition: all 0.15s; }
        .up-pg-btn:hover:not(:disabled):not(.active) { background: var(--bg-hover); }
        .up-pg-btn:disabled { opacity: 0.35; cursor: not-allowed; }
        .up-pg-btn.active { background: var(--blue); border-color: var(--blue); color: #fff; font-weight: 700; cursor: default; }
      `}</style>

      <div className="up-wrap">
        <div className="up-card">
          {/* Stats bar */}
          <div className="up-stats">
            <div className="up-stat">
              <Users size={14} style={{ color: "var(--blue)" }} />
              <span>Total users: <strong>{users.length}</strong></span>
            </div>
            <div className="up-stat">
              <span
                style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--green)", flexShrink: 0, display: "inline-block" }}
              />
              <span>Online: <strong style={{ color: "var(--green)" }}>{onlineCount}</strong></span>
            </div>
            {search && (
              <div className="up-stat" style={{ marginLeft: "auto" }}>
                <span>{filtered.length} result{filtered.length !== 1 ? "s" : ""} for "{search}"</span>
              </div>
            )}
          </div>

          {/* Status filter bar */}
          <div className="up-filter-bar">
            {(["all", "online", "offline", "suspended", "banned"] as StatusFilter[]).map((f) => {
              const counts: Record<StatusFilter, number> = {
                all:       users.length,
                online:    users.filter((u) => u.isOnline && !u.isBanned && !isCurrentlySuspended(u)).length,
                offline:   users.filter((u) => !u.isOnline && !u.isBanned && !isCurrentlySuspended(u)).length,
                suspended: users.filter((u) => isCurrentlySuspended(u) && !u.isBanned).length,
                banned:    users.filter((u) => u.isBanned).length,
              };
              const labels: Record<StatusFilter, string> = {
                all: "All", online: "Online", offline: "Offline",
                suspended: "Suspended", banned: "Banned",
              };
              const colors: Partial<Record<StatusFilter, string>> = {
                online: "var(--green)", suspended: "var(--orange)", banned: "var(--red)",
              };
              return (
                <button
                  key={f}
                  className={`up-filter-btn${statusFilter === f ? " active" : ""}`}
                  style={statusFilter === f && colors[f] ? { borderColor: colors[f], color: colors[f], background: `color-mix(in srgb, ${colors[f]} 12%, transparent)` } : undefined}
                  onClick={() => { setStatusFilter(f); setPage(1); }}
                >
                  {labels[f]}
                  <span className="up-filter-count">{counts[f]}</span>
                </button>
              );
            })}
          </div>

          {/* Toolbar */}
          <div className="up-toolbar">
            <div className="up-search">
              <Search size={12} style={{ color: "var(--text-muted)", flexShrink: 0 }} />
              <input
                placeholder="Search by name, email, phone, or user ID…"
                value={search}
                onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              />
              {search && (
                <button
                  style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", display: "flex", padding: 0 }}
                  onClick={() => setSearch("")}
                >
                  <X size={11} />
                </button>
              )}
            </div>
            <div className="up-sort-wrap">
              <span className="up-sort-label">Sort by</span>
              {(["name", "balance", "createdAt"] as SortField[]).map((f) => (
                <button
                  key={f}
                  className={`up-field-btn${sortField === f ? " active" : ""}`}
                  onClick={() => handleSortField(f)}
                >
                  {SORT_LABELS[f].label}
                  {sortField === f
                    ? sortDir === "asc" ? <ChevronUp size={11} /> : <ChevronDown size={11} />
                    : <ArrowUpDown size={10} style={{ opacity: 0.3 }} />}
                </button>
              ))}

              {isSorted && (
                <>
                  <div className="up-dir-group">
                    <button
                      className={`up-dir-btn${sortDir === "asc" ? " active" : ""}`}
                      onClick={() => handleSortDir("asc")}
                      title="Ascending"
                    >
                      <ChevronUp size={11} />
                      {sortField ? SORT_LABELS[sortField].asc : "Asc"}
                    </button>
                    <button
                      className={`up-dir-btn${sortDir === "desc" ? " active" : ""}`}
                      onClick={() => handleSortDir("desc")}
                      title="Descending"
                    >
                      <ChevronDown size={11} />
                      {sortField ? SORT_LABELS[sortField].desc : "Desc"}
                    </button>
                  </div>
                  <button className="up-clear-btn" onClick={clearSort} title="Clear sort">
                    <X size={11} /> Clear
                  </button>
                </>
              )}

              {!isSorted && (
                <span className="up-sort-hint">No sort applied</span>
              )}
            </div>
          </div>

          {/* Table */}
          <div style={{ overflowX: "auto" }}>
            <table className="up-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>User ID</th>
                  <th>Phone</th>
                  <th>Balance</th>
                  <th>Joined</th>
                  <th>Status</th>
                  <th style={{ width: 40 }} />
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <TableSkeleton />
                ) : paged.length === 0 ? (
                  <tr>
                    <td colSpan={COL_SPAN} className="up-empty">
                      {search
                        ? `No users match "${search}". Try a different search.`
                        : "No users found in the database."}
                    </td>
                  </tr>
                ) : (
                  paged.map((user) => {
                    const isOpen   = expandedId === user.id;
                    const suspended = isCurrentlySuspended(user);
                    const tier     = getApplicableTier(user.decline_count, suspensionTiers);
                    const isTarget = targetUser?.id === user.id;

                    const statusBadge = user.isBanned
                      ? <Badge variant="red" dot>Banned</Badge>
                      : suspended
                        ? <Badge variant="orange" dot>Suspended</Badge>
                        : user.isOnline
                          ? <Badge variant="green" dot>Online</Badge>
                          : <Badge variant="gray" dot>Offline</Badge>;

                    return (
                      <Fragment key={user.id}>
                        <tr className="data-row">
                          <td>
                            <div className="up-name">{user.name}</div>
                            <div className="up-sub">{user.email}</div>
                          </td>
                          <td>
                            <div className="up-sub" style={{ fontFamily: "monospace", fontSize: "0.75rem" }}>{user.userId}</div>
                          </td>
                          <td>{user.phone}</td>
                          <td style={{ fontWeight: 600, color: "var(--text-primary)" }}>
                            {formatBalance(user.balance)}
                          </td>
                          <td>{formatDate(user.createdAt)}</td>
                          <td>{statusBadge}</td>
                          <td>
                            <button
                              className={`expand-btn${isOpen ? " open" : ""}`}
                              title={isOpen ? "Collapse" : "Expand details"}
                              onClick={() => setExpandedId(isOpen ? null : user.id)}
                            >
                              {isOpen ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                            </button>
                          </td>
                        </tr>
                        {isOpen && (
                          <ExpandedRow
                            key={`exp-${user.id}`}
                            user={user}
                            colSpan={COL_SPAN}
                            applicableTier={tier}
                            suspended={suspended}
                            canSuspend={user.decline_count > 0 && !user.isBanned}
                            onViewProfile={() => router.push(`/users/${user.id}`)}
                            onSuspend={() => { setTargetUser(user); setSuspendModalOpen(true); }}
                            onLiftSuspension={() => openConfirm("lift", user)}
                            onBan={() => openConfirm("ban", user)}
                            onUnban={() => openConfirm("unban", user)}
                            onDelete={() => openConfirm("delete", user)}
                            actionLoading={isTarget ? actionLoading : null}
                            onViewGigs={() => {
                              setGigsModalUser(user);
                              fetchUserGigs(user.id);
                            }}
                            onViewWorkedGigs={() => {
                              setWorkedGigsModalUser(user);
                              fetchWorkedGigs(user.id);
                            }}
                          />
                        )}
                      </Fragment>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {!loading && (
            <div className="up-pg">
              <span className="up-pg-info">
                {(safePage - 1) * PAGE_SIZE + 1}–{Math.min(safePage * PAGE_SIZE, filtered.length)} of {filtered.length} users
              </span>
              <div className="up-pg-btns">
                <button className="up-pg-btn" onClick={() => setPage(1)} disabled={safePage === 1}>«</button>
                <button className="up-pg-btn" onClick={() => setPage((p) => p - 1)} disabled={safePage === 1}>‹</button>
                {Array.from({ length: totalPages }, (_, i) => i + 1)
                  .filter((p) => Math.abs(p - safePage) <= 2 || p === 1 || p === totalPages)
                  .reduce<(number | "…")[]>((acc, p, i, arr) => {
                    if (i > 0 && (p as number) - (arr[i - 1] as number) > 1) acc.push("…");
                    acc.push(p);
                    return acc;
                  }, [])
                  .map((p, i) =>
                    p === "…" ? (
                      <span key={`e${i}`} style={{ padding: "0 4px", color: "var(--text-muted)", fontSize: 12 }}>…</span>
                    ) : (
                      <button
                        key={p}
                        className={`up-pg-btn${p === safePage ? " active" : ""}`}
                        onClick={() => setPage(p as number)}
                        disabled={p === safePage}
                      >
                        {p}
                      </button>
                    )
                  )}
                <button className="up-pg-btn" onClick={() => setPage((p) => p + 1)} disabled={safePage === totalPages}>›</button>
                <button className="up-pg-btn" onClick={() => setPage(totalPages)} disabled={safePage === totalPages}>»</button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Suspend modal */}
      <SuspendModal
        open={suspendModalOpen}
        onClose={() => { if (!actionLoading) { setSuspendModalOpen(false); setTargetUser(null); } }}
        user={targetUser}
        tiers={suspensionTiers}
        onConfirm={handleSuspend}
        loading={actionLoading === "suspend"}
      />

      {/* Confirm dialogs */}
      {confirmAction && (
        <ConfirmDialog
          open
          onClose={closeConfirm}
          onConfirm={handleConfirm}
          title={confirmConfig[confirmAction].title}
          message={confirmConfig[confirmAction].message}
          confirmLabel={confirmConfig[confirmAction].label}
          danger={confirmConfig[confirmAction].danger}
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
      )}

      {/* Gigs Posted modal */}
      {gigsModalUser && (
        <Modal
          open
          onClose={() => setGigsModalUser(null)}
          title={`${gigsModalUser.name} — Gigs Posted`}
          description={`All gigs posted by ${gigsModalUser.email}`}
          size="lg"
        >
          <style>{`
            .ug-list { display: flex; flex-direction: column; gap: 8px; }
            .ug-gig { display: grid; grid-template-columns: 1fr auto auto auto auto; gap: 10px; align-items: center; padding: 10px 14px; border-radius: 8px; border: 1px solid var(--border); background: var(--bg-elevated); }
            .ug-gig-title { font-size: 13px; font-weight: 600; color: var(--text-primary); }
            .ug-gig-cat { font-size: 11px; color: var(--text-muted); margin-top: 1px; }
            .ug-chip { display: inline-flex; align-items: center; padding: 2px 8px; border-radius: 20px; font-size: 11px; font-weight: 600; white-space: nowrap; }
            .ug-chip--offered { background: rgba(245,158,11,0.12); color: var(--amber,#f59e0b); }
            .ug-chip--open    { background: rgba(59,130,246,0.12); color: var(--blue); }
            .ug-chip--quick   { background: rgba(139,92,246,0.12); color: var(--purple,#8b5cf6); }
            .ug-chip--available  { background: rgba(16,185,129,0.12); color: var(--green); }
            .ug-chip--completed  { background: rgba(59,130,246,0.12); color: var(--blue); }
            .ug-chip--cancelled  { background: rgba(239,68,68,0.12); color: var(--red); }
            .ug-chip--other      { background: var(--bg-elevated); color: var(--text-muted); border: 1px solid var(--border); }
            .ug-salary { font-family: 'Space Mono', monospace; font-size: 12px; font-weight: 700; color: var(--text-primary); white-space: nowrap; }
            .ug-date { font-size: 11px; color: var(--text-muted); white-space: nowrap; }
            .ug-empty { padding: 32px 0; text-align: center; color: var(--text-muted); font-size: 13px; }
          `}</style>
          {gigsLoadingId === gigsModalUser.id ? (
            <div className="ug-empty">Loading gigs…</div>
          ) : !userGigsMap[gigsModalUser.id] || userGigsMap[gigsModalUser.id].length === 0 ? (
            <div className="ug-empty">No gigs posted by this user.</div>
          ) : (
            <div className="ug-list">
              {userGigsMap[gigsModalUser.id].map((g) => {
                const statusKey = g.status?.toLowerCase();
                const statusClass =
                  statusKey === "available" ? "ug-chip--available" :
                  statusKey === "completed"  ? "ug-chip--completed"  :
                  statusKey === "cancelled"  ? "ug-chip--cancelled"  : "ug-chip--other";
                const statusLabel =
                  statusKey === "cancelled" && g.cancelledByAdmin ? "Cancelled by Admin" :
                  g.status ? g.status.charAt(0).toUpperCase() + g.status.slice(1) : "Unknown";
                return (
                  <div key={g.id} className="ug-gig">
                    <div>
                      <div className="ug-gig-title">{g.title || "Untitled Gig"}</div>
                      {g.category && <div className="ug-gig-cat">{g.category}</div>}
                    </div>
                    <span className={`ug-chip ug-chip--${g.gigType}`}>{GIG_TYPE_LABELS[g.gigType]}</span>
                    <span className={`ug-chip ${statusClass}`}>{statusLabel}</span>
                    <span className="ug-salary">
                      {g.salary != null && g.salary !== "" ? `₱${g.salary}` : "—"}
                    </span>
                    <span className="ug-date">
                      {g.createdAt ? g.createdAt.toDate().toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" }) : "—"}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </Modal>
      )}

      {/* Gigs Completed (worked) modal */}
      {workedGigsModalUser && (
        <Modal
          open
          onClose={() => setWorkedGigsModalUser(null)}
          title={`${workedGigsModalUser.name} — Gigs Completed`}
          description={`Gigs where ${workedGigsModalUser.email} was the worker`}
          size="lg"
        >
          <style>{`
            .ug-list { display: flex; flex-direction: column; gap: 8px; }
            .ug-gig { display: grid; grid-template-columns: 1fr auto auto auto auto; gap: 10px; align-items: center; padding: 10px 14px; border-radius: 8px; border: 1px solid var(--border); background: var(--bg-elevated); }
            .ug-gig-title { font-size: 13px; font-weight: 600; color: var(--text-primary); }
            .ug-gig-cat { font-size: 11px; color: var(--text-muted); margin-top: 1px; }
            .ug-chip { display: inline-flex; align-items: center; padding: 2px 8px; border-radius: 20px; font-size: 11px; font-weight: 600; white-space: nowrap; }
            .ug-chip--offered { background: rgba(245,158,11,0.12); color: var(--amber,#f59e0b); }
            .ug-chip--open    { background: rgba(59,130,246,0.12); color: var(--blue); }
            .ug-chip--quick   { background: rgba(139,92,246,0.12); color: var(--purple,#8b5cf6); }
            .ug-chip--available  { background: rgba(16,185,129,0.12); color: var(--green); }
            .ug-chip--completed  { background: rgba(59,130,246,0.12); color: var(--blue); }
            .ug-chip--cancelled  { background: rgba(239,68,68,0.12); color: var(--red); }
            .ug-chip--other      { background: var(--bg-elevated); color: var(--text-muted); border: 1px solid var(--border); }
            .ug-salary { font-family: 'Space Mono', monospace; font-size: 12px; font-weight: 700; color: var(--text-primary); white-space: nowrap; }
            .ug-date { font-size: 11px; color: var(--text-muted); white-space: nowrap; }
            .ug-empty { padding: 32px 0; text-align: center; color: var(--text-muted); font-size: 13px; }
          `}</style>
          {workedGigsLoadingId === workedGigsModalUser.id ? (
            <div className="ug-empty">Loading gigs…</div>
          ) : !workedGigsMap[workedGigsModalUser.id] || workedGigsMap[workedGigsModalUser.id].length === 0 ? (
            <div className="ug-empty">No gigs worked by this user.</div>
          ) : (
            <div className="ug-list">
              {workedGigsMap[workedGigsModalUser.id].map((g) => {
                const statusKey = g.status?.toLowerCase();
                const statusClass =
                  statusKey === "available" ? "ug-chip--available" :
                  statusKey === "completed"  ? "ug-chip--completed"  :
                  statusKey === "cancelled"  ? "ug-chip--cancelled"  : "ug-chip--other";
                const statusLabel =
                  statusKey === "cancelled" && g.cancelledByAdmin ? "Cancelled by Admin" :
                  g.status ? g.status.charAt(0).toUpperCase() + g.status.slice(1) : "Unknown";
                return (
                  <div key={g.id} className="ug-gig">
                    <div>
                      <div className="ug-gig-title">{g.title || "Untitled Gig"}</div>
                      {g.category && <div className="ug-gig-cat">{g.category}</div>}
                    </div>
                    <span className={`ug-chip ug-chip--${g.gigType}`}>{GIG_TYPE_LABELS[g.gigType]}</span>
                    <span className={`ug-chip ${statusClass}`}>{statusLabel}</span>
                    <span className="ug-salary">
                      {g.salary != null && g.salary !== "" ? `₱${g.salary}` : "—"}
                    </span>
                    <span className="ug-date">
                      {g.createdAt ? g.createdAt.toDate().toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" }) : "—"}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </Modal>
      )}
    </AdminLayout>
  );
}
