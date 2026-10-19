"use client";

import { Suspense } from "react";
import { useState, useEffect, Fragment, useMemo, useRef } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import Link from "next/link";
import AdminLayout from "@/components/layout/AdminLayout";
import { useAuthGuard } from "@/hooks/useAuthGuard";
import {
  collection,
  collectionGroup,
  getDocs,
  getDoc,
  doc,
  updateDoc,
  query,
  orderBy,
  Timestamp,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import {
  Search, RefreshCw,
  GitBranch, Users, ChevronDown, ChevronUp, ExternalLink, X, BadgeCheck,
  Wrench,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface ReferralEntry {
  id: string;
  name: string;
  email: string;
  // from users.referrals map
  referral_code: string | null;
  referral_level: number;
  referrals_count: number;
  verified_referrals: number;
  referredByName: string | null;
  referredByUID: string | null;
  // optional top-level field indicating who referred this user
  referred_by: string | null;
  createdAt: Timestamp | null;
}

interface ReferredUser {
  uid: string;
  name: string;
  email: string;
  referral_code_used: string | null;
  joined_at: Timestamp | null;
  isVerified: string | null;
  /** How many people signed up with THIS referred user's own code */
  referralsCount: number;
  verifiedReferrals: number;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const PAGE_SIZE = 15;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(ts: Timestamp | null): string {
  if (!ts) return "—";
  return ts.toDate().toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function toEntry(id: string, d: Record<string, unknown>): ReferralEntry {
  // referrals is a map field inside the user doc
  const map =
    d.referrals && typeof d.referrals === "object" && !Array.isArray(d.referrals)
      ? (d.referrals as Record<string, unknown>)
      : {};

  return {
    id,
    name: typeof d.name === "string" ? d.name : "No Name",
    email: typeof d.email === "string" ? d.email : "",
    referral_code: typeof map.referral_code === "string" ? map.referral_code : null,
    referral_level: typeof map.referral_level === "number" ? map.referral_level : 0,
    referrals_count: typeof map.referrals_count === "number" ? map.referrals_count : 0,
    verified_referrals: typeof map.verified_referrals === "number" ? map.verified_referrals : 0,
    referredByName: typeof map.referredByName === "string" ? map.referredByName : null,
    referredByUID: typeof map.referredByUID === "string" ? map.referredByUID : null,
    referred_by: typeof d.referred_by === "string" ? d.referred_by : null,
    createdAt: d.createdAt instanceof Timestamp ? d.createdAt : null,
  };
}

// ─── Skeleton ─────────────────────────────────────────────────────────────────

function TableSkeleton() {
  return (
    <>
      {Array.from({ length: 8 }).map((_, i) => (
        <tr key={i} style={{ borderBottom: "1px solid var(--border-muted)" }}>
          {[160, 180, 110, 110, 55, 55, 100].map((w, j) => (
            <td key={j} style={{ padding: "13px 14px" }}>
              <div className="sk" style={{ height: 13, width: w, opacity: 1 - i * 0.09 }} />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}

// ─── Referred Users Panel ─────────────────────────────────────────────────────

function ReferredPanel({
  userId,
  count,
  verifiedCount,
  onNavigate,
  cache,
}: {
  userId: string;
  count: number;
  verifiedCount: number;
  onNavigate: (uid: string) => void;
  cache: { current: Record<string, ReferredUser[]> };
}) {
  const [referredUsers, setReferredUsers] = useState<ReferredUser[]>(() => cache.current[userId] ?? []);
  const [loading, setLoading] = useState(!cache.current[userId]);
  const [verifyFilter, setVerifyFilter] = useState<"all" | "verified" | "unverified">("all");

  useEffect(() => {
    if (cache.current[userId]) return; // already fetched — skip

    setLoading(true);
    const listQuery = query(
      collection(db, "users", userId, "referrals_list"),
      orderBy("joined_at", "desc")
    );
    getDocs(listQuery)
      .catch(() => getDocs(collection(db, "users", userId, "referrals_list")))
      .then(async (snap) => {
        const base = snap.docs.map((d) => {
          const data = d.data() as Record<string, unknown>;
          return {
            uid: d.id,
            name: typeof data.name === "string" ? data.name : d.id,
            email: typeof data.email === "string" ? data.email : "",
            referral_code_used: typeof data.referral_code_used === "string" ? data.referral_code_used : null,
            joined_at: data.joined_at instanceof Timestamp ? data.joined_at : null,
            isVerified: null as string | null,
            referralsCount: 0,
            verifiedReferrals: 0,
          };
        });
        const userDocs = await Promise.all(
          base.map((u) => getDoc(doc(db, "users", u.uid)).catch(() => null))
        );
        userDocs.forEach((snap, i) => {
          if (snap?.exists()) {
            const d = snap.data() as Record<string, unknown>;
            base[i].isVerified = typeof d.isVerified === "string" ? d.isVerified : null;
            const map =
              d.referrals && typeof d.referrals === "object" && !Array.isArray(d.referrals)
                ? (d.referrals as Record<string, unknown>)
                : {};
            base[i].referralsCount = typeof map.referrals_count === "number" ? map.referrals_count : 0;
            base[i].verifiedReferrals = typeof map.verified_referrals === "number" ? map.verified_referrals : 0;
          }
        });
        cache.current[userId] = base;
        setReferredUsers(base);
      })
      .finally(() => setLoading(false));
  }, [userId, cache]);

  const verifColor = (v: string | null) =>
    v === "verified" ? "var(--blue)" :
    v === "pending"  ? "var(--orange)" :
    v === "rejected" ? "var(--red)" : "var(--text-muted)";

  const verifLabel = (v: string | null) =>
    v === "verified" ? "Verified" :
    v === "pending"  ? "Pending" :
    v === "unverified" ? "Unverified" : "—";

  const filterOptions = [
    { key: "all",        label: "All" },
    { key: "verified",   label: "Verified" },
    { key: "unverified", label: "Unverified" },
  ] as const;

  const visibleUsers = useMemo(
    () =>
      verifyFilter === "all"
        ? referredUsers
        : referredUsers.filter((u) =>
            verifyFilter === "unverified"
              ? !u.isVerified || u.isVerified === "unverified"
              : u.isVerified === verifyFilter
          ),
    [referredUsers, verifyFilter]
  );

  return (
    <div style={{
      background: "var(--bg-elevated)",
      borderTop: "1px solid var(--text-muted)",
      borderBottom: "0.3px solid var(--text-muted)",
    }}>
      {/* Panel header: counts + filter */}
      <div style={{
        padding: "10px 18px",
        display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap",
        borderBottom: "1px solid var(--border-muted)",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <span style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.6px", color: "var(--text-muted)", display: "flex", alignItems: "center", gap: 6 }}>
            Referred Users
            {count > 30 && <span style={{ fontWeight: 400, textTransform: "none", letterSpacing: 0 }}>(showing first 30)</span>}
          </span>
          <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 12, color: "var(--text-secondary)" }}>
              <span style={{ fontWeight: 700, color: "var(--text-primary)" }}>{count}</span> total
            </span>
            <span style={{ color: "var(--border)", fontSize: 12 }}>·</span>
            <span style={{ fontSize: 12, color: "var(--text-secondary)", display: "flex", alignItems: "center", gap: 4 }}>
              <BadgeCheck size={12} style={{ color: "var(--blue)" }} />
              <span style={{ fontWeight: 700, color: "var(--blue)" }}>{verifiedCount}</span> verified
            </span>
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <Link
          href={`/referrals/${userId}`}
          style={{
            display: "inline-flex", alignItems: "center", gap: 5,
            padding: "3px 10px", fontSize: 11, fontWeight: 700, borderRadius: 20,
            border: "1px solid var(--blue)", color: "var(--blue)", background: "var(--blue-dim)",
            textDecoration: "none",
          }}
          title="See who joined through this user, as a tree"
        >
          <GitBranch size={12} /> View tree
        </Link>
        {!loading && referredUsers.length > 0 && (
          <div style={{ display: "flex", gap: 4 }}>
            {filterOptions.map(({ key, label }) => (
              <button
                key={key}
                onClick={() => setVerifyFilter(key)}
                style={{
                  padding: "3px 10px", fontSize: 11, fontWeight: 600, borderRadius: 20,
                  border: `1px solid ${verifyFilter === key ? "var(--blue)" : "var(--border)"}`,
                  background: verifyFilter === key ? "var(--blue)" : "var(--bg-surface)",
                  color: verifyFilter === key ? "#fff" : "var(--text-muted)",
                  cursor: "pointer", transition: "all 0.12s",
                }}
              >
                {label}
              </button>
            ))}
          </div>
        )}
        </div>
      </div>

      {loading ? (
        <div style={{ padding: "14px 18px", fontSize: 12, color: "var(--text-muted)" }}>Loading…</div>
      ) : visibleUsers.length === 0 ? (
        <div style={{ padding: "14px 18px", fontSize: 12, color: "var(--text-muted)" }}>
          {referredUsers.length === 0 ? "No referred users found." : `No ${verifyFilter} users.`}
        </div>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              {["Name", "Email", "Code Used", "Their Referrals", "Joined", "Status"].map((h) => (
                <th key={h} style={{
                  padding: "7px 18px", textAlign: "left", fontSize: 10,
                  fontWeight: 700, letterSpacing: "0.5px", textTransform: "uppercase",
                  color: "var(--text-muted)", background: "var(--bg-elevated)",
                  whiteSpace: "nowrap",
                }}>{h}</th>
              ))}
              <th style={{ width: 32 }} />
            </tr>
          </thead>
          <tbody>
            {visibleUsers.map((u, i) => (
              <tr
                key={u.uid}
                style={{
                  borderTop: "1px solid var(--border-muted)",
                  background: i % 2 === 0 ? "var(--bg-surface)" : "var(--bg-elevated)",
                  cursor: "pointer",
                  transition: "background 0.12s",
                }}
                onClick={() => onNavigate(u.uid)}
                onMouseEnter={(e) => { (e.currentTarget as HTMLTableRowElement).style.background = "var(--bg-hover)"; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLTableRowElement).style.background = i % 2 === 0 ? "var(--bg-surface)" : "var(--bg-elevated)"; }}
              >
                <td style={{ padding: "9px 18px", fontSize: 13, fontWeight: 600, color: "var(--text-primary)", whiteSpace: "nowrap" }}>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                    {u.name}
                    <ExternalLink size={11} style={{ opacity: 0.4, flexShrink: 0 }} />
                  </span>
                </td>
                <td style={{ padding: "9px 18px", fontSize: 13, color: "var(--text-muted)" }}>
                  {u.email || "—"}
                </td>
                <td style={{ padding: "9px 18px" }}>
                  {u.referral_code_used
                    ? <span style={{ fontFamily: "'Space Mono', monospace", fontSize: 11, background: "var(--bg-elevated)", border: "1px solid var(--border)", borderRadius: 4, padding: "2px 6px", color: "var(--text-primary)", letterSpacing: "0.5px" }}>{u.referral_code_used}</span>
                    : <span style={{ color: "var(--text-muted)" }}>—</span>}
                </td>
                <td
                  style={{ padding: "9px 18px", fontSize: 12, whiteSpace: "nowrap" }}
                  title={`${u.referralsCount} people signed up with ${u.name}'s referral code (${u.verifiedReferrals} verified)`}
                >
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 5, color: u.referralsCount > 0 ? "var(--text-primary)" : "var(--text-muted)", fontWeight: 600 }}>
                    <Users size={12} style={{ color: u.referralsCount > 0 ? "var(--blue)" : "var(--text-muted)" }} />
                    {u.referralsCount}
                  </span>
                  {u.referralsCount > 0 && (
                    <span style={{ marginLeft: 6, color: "var(--blue)", fontSize: 11 }}>
                      {u.verifiedReferrals} verified
                    </span>
                  )}
                </td>
                <td style={{ padding: "9px 18px", fontSize: 12, color: "var(--text-muted)", whiteSpace: "nowrap" }}>
                  {formatDate(u.joined_at)}
                </td>
                <td style={{ padding: "9px 18px" }}>
                  <span style={{
                    display: "inline-flex", alignItems: "center", gap: 4,
                    fontSize: 11, fontWeight: 700,
                    color: verifColor(u.isVerified),
                    background: "var(--bg-elevated)",
                    border: `1px solid ${verifColor(u.isVerified)}`,
                    borderRadius: 20, padding: "2px 8px",
                    opacity: u.isVerified ? 1 : 0.6,
                  }}>
                    {u.isVerified === "verified" && <BadgeCheck size={10} />}
                    {verifLabel(u.isVerified)}
                  </span>
                </td>
                <td style={{ padding: "9px 14px 9px 0", textAlign: "right" }} />
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

// ─── Top Referrers ────────────────────────────────────────────────────────────

function TopReferrers({ entries, onNavigate }: { entries: ReferralEntry[]; onNavigate: (uid: string) => void }) {
  const [open, setOpen] = useState(true);

  const top5 = useMemo(
    () =>
      [...entries]
        .filter((e) => e.verified_referrals > 0)
        .sort((a, b) => b.verified_referrals - a.verified_referrals)
        .slice(0, 5),
    [entries]
  );

  if (top5.length === 0) return null;

  const max = top5[0].verified_referrals;

  const medals = ["🥇", "🥈", "🥉"];

  return (
    <div style={{
      background: "var(--bg-surface)",
      border: "1px solid var(--border)",
      borderRadius: "var(--radius-md)",
      marginBottom: 16,
      overflow: "hidden",
    }}>
      <button
        onClick={() => setOpen((v) => !v)}
        style={{
          width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "11px 16px", background: "none", border: "none", cursor: "pointer",
          borderBottom: open ? "1px solid var(--border)" : "none",
        }}
      >
        <span style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.6px", color: "var(--text-muted)" }}>
          <Users size={13} style={{ color: "var(--purple)" }} />
          Top Referrers
          <span style={{ fontSize: 11, fontWeight: 400, textTransform: "none", letterSpacing: 0, color: "var(--text-muted)" }}>by verified referrals</span>
        </span>
        {open ? <ChevronUp size={14} style={{ color: "var(--text-muted)" }} /> : <ChevronDown size={14} style={{ color: "var(--text-muted)" }} />}
      </button>

      {open && (
        <div style={{ padding: "12px 16px", display: "flex", flexDirection: "column", gap: 10 }}>
          {top5.map((e, i) => (
            <div key={e.id} style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ fontSize: 16, width: 22, textAlign: "center", flexShrink: 0 }}>
                {medals[i] ?? <span style={{ fontSize: 12, fontWeight: 700, color: "var(--text-muted)" }}>{i + 1}</span>}
              </span>
              <span
                onClick={() => onNavigate(e.id)}
                style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)", cursor: "pointer", minWidth: 130, flexShrink: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 160 }}
                title={e.name}
              >
                {e.name}
              </span>
              {e.referral_code && (
                <span style={{ fontFamily: "'Space Mono', monospace", fontSize: 10, background: "var(--bg-elevated)", border: "1px solid var(--border)", borderRadius: 4, padding: "1px 6px", color: "var(--text-secondary)", letterSpacing: "0.5px", flexShrink: 0 }}>
                  {e.referral_code}
                </span>
              )}
              <div style={{ flex: 1, background: "var(--bg-elevated)", borderRadius: 99, height: 6, overflow: "hidden", minWidth: 60 }}>
                <div style={{
                  height: "100%",
                  width: `${Math.round((e.verified_referrals / max) * 100)}%`,
                  background: i === 0 ? "var(--purple)" : i === 1 ? "var(--blue)" : "var(--green, #22c55e)",
                  borderRadius: 99,
                  transition: "width 0.3s ease",
                }} />
              </div>
              <span style={{ fontSize: 12, fontWeight: 700, color: "var(--purple)", flexShrink: 0, minWidth: 60, textAlign: "right" }}>
                {e.verified_referrals} <span style={{ fontWeight: 400, color: "var(--text-muted)" }}>verified</span>
              </span>
              <span style={{ fontSize: 12, color: "var(--text-muted)", flexShrink: 0 }}>
                / {e.referrals_count} total
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Stats Bar ────────────────────────────────────────────────────────────────

function StatsBar({ entries }: { entries: ReferralEntry[] }) {
  const stats = useMemo(() => ({
    withCode: entries.filter((e) => e.referral_code).length,
    withReferrals: entries.filter((e) => e.referrals_count > 0).length,
    totalReferrals: entries.reduce((s, e) => s + e.referrals_count, 0),
  }), [entries]);

  return (
    <div style={{ display: "flex", gap: 12, marginBottom: 20, flexWrap: "wrap" }}>
      {[
        { label: "With Referral Code", value: stats.withCode, color: "var(--blue)" },
        { label: "Have Referred Others", value: stats.withReferrals, color: "var(--green, #22c55e)" },
        { label: "Total Referrals", value: stats.totalReferrals, color: "var(--purple)" },
      ].map((s) => (
        <div key={s.label} style={{
          flex: "1 1 140px",
          background: "var(--bg-surface)",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius-md)",
          padding: "14px 18px",
        }}>
          <div style={{ fontSize: 22, fontWeight: 700, color: s.color }}>{s.value}</div>
          <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2 }}>{s.label}</div>
        </div>
      ))}
    </div>
  );
}

// ─── Level Badge ──────────────────────────────────────────────────────────────

function LevelBadge({ level }: { level: number }) {
  if (!level) return <span style={{ color: "var(--text-muted)" }}>—</span>;
  const color =
    level >= 3 ? "var(--purple)" :
    level === 2 ? "var(--blue)" :
    "var(--text-secondary)";
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", justifyContent: "center",
      minWidth: 24, height: 22, padding: "0 7px",
      background: "var(--bg-elevated)", border: "1px solid var(--border)",
      borderRadius: 6, fontSize: 12, fontWeight: 700, color,
    }}>
      {level}
    </span>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

function ReferralsPageInner() {
  const { user, loading: authLoading } = useAuthGuard({ module: "referrals" });
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // Initialise from URL so Back navigation restores full state
  const [entries, setEntries] = useState<ReferralEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState(() => searchParams.get("q") ?? "");
  const [debouncedSearch, setDebouncedSearch] = useState(() => searchParams.get("q") ?? "");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const panelCache = useRef<Record<string, ReferredUser[]>>({});
  const [page, setPage] = useState(() => Number(searchParams.get("page") ?? "1"));
  const [expandedId, setExpandedId] = useState<string | null>(() => searchParams.get("expanded"));
  const [tableFilter, setTableFilter] = useState<"all" | "has_referrals" | "no_referrals">(
    () => (searchParams.get("filter") as "all" | "has_referrals" | "no_referrals") ?? "all"
  );
  const [sortOrder, setSortOrder] = useState<"default" | "referrals_asc">(
    () => (searchParams.get("sort") as "default" | "referrals_asc") ?? "default"
  );
  const [dateFrom, setDateFrom] = useState<string>(() => searchParams.get("from") ?? "");
  const [dateTo, setDateTo] = useState<string>(() => searchParams.get("to") ?? "");
  const [referredByMap, setReferredByMap] = useState<Record<string, { name: string; uid: string }>>({});

  // Mirror state into the URL so the browser Back button restores everything
  useEffect(() => {
    const params = new URLSearchParams();
    if (debouncedSearch) params.set("q", debouncedSearch);
    if (page > 1) params.set("page", String(page));
    if (expandedId) params.set("expanded", expandedId);
    if (tableFilter !== "all") params.set("filter", tableFilter);
    if (sortOrder !== "default") params.set("sort", sortOrder);
    if (dateFrom) params.set("from", dateFrom);
    if (dateTo) params.set("to", dateTo);
    const qs = params.toString();
    router.replace(`${pathname}${qs ? "?" + qs : ""}`, { scroll: false });
  }, [debouncedSearch, page, expandedId, tableFilter, sortOrder, dateFrom, dateTo, pathname, router]);

  // Debounce search input
  const handleSearch = (value: string) => {
    setSearch(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => { setDebouncedSearch(value); setPage(1); setExpandedId(null); }, 250);
  };

  useEffect(() => {
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, []);


  // Use stored referredByUID/referredByName from the user doc directly.
  // "none" means self-registered and was already confirmed — skip those too.
  // Only fall back to collectionGroup for entries that have never been resolved.
  // After resolving, write the result (or "none") back so future loads are free.
  const resolveReferredBy = async (loaded: ReferralEntry[]) => {
    const resolved: Record<string, { name: string; uid: string }> = {};
    const needsLookup: ReferralEntry[] = [];

    for (const e of loaded) {
      if (e.referredByUID !== null) {
        // Already stored — "none" means confirmed self-registered
        resolved[e.id] = { name: e.referredByName ?? e.referredByUID, uid: e.referredByUID };
      } else {
        needsLookup.push(e);
      }
    }

    setReferredByMap(resolved);

    if (needsLookup.length === 0) return;

    try {
      // Build reverse-lookup only for the unresolved subset
      const snap = await getDocs(collectionGroup(db, "referrals_list"));
      const referrerUids: Record<string, string> = {};
      snap.docs.forEach((d) => {
        const referrerId = d.ref.parent.parent?.id;
        if (referrerId) referrerUids[d.id] = referrerId;
      });

      const needNameFetch = new Set<string>();
      needsLookup.forEach((e) => {
        const referrerUid = referrerUids[e.id];
        if (referrerUid) needNameFetch.add(referrerUid);
      });

      const nameMap: Record<string, string> = {};
      await Promise.all(
        [...needNameFetch].map((uid) =>
          getDoc(doc(db, "users", uid))
            .then((s) => { nameMap[uid] = s.exists() ? ((s.data().name as string) ?? uid) : uid; })
            .catch(() => { nameMap[uid] = uid; })
        )
      );

      const result = { ...resolved };
      const writes: Promise<void>[] = [];

      needsLookup.forEach((e) => {
        const referrerUid = referrerUids[e.id];
        if (referrerUid) {
          const name = nameMap[referrerUid] ?? referrerUid;
          result[e.id] = { name, uid: referrerUid };
          writes.push(
            updateDoc(doc(db, "users", e.id), {
              "referrals.referredByName": name,
              "referrals.referredByUID": referrerUid,
            }).catch(() => {})
          );
        } else {
          // No referrer found — mark as "none" so this user is never rechecked
          result[e.id] = { name: "none", uid: "none" };
          writes.push(
            updateDoc(doc(db, "users", e.id), {
              "referrals.referredByName": "none",
              "referrals.referredByUID": "none",
            }).catch(() => {})
          );
        }
      });

      await Promise.all(writes);
      setReferredByMap(result);
    } catch {
      // leave resolved data visible if collectionGroup fails
    }
  };

  const fetchAll = async () => {
    setLoading(true);
    try {
      const snap = await getDocs(query(collection(db, "users"), orderBy("createdAt", "desc")));
      const loaded = snap.docs.map((d) => toEntry(d.id, d.data() as Record<string, unknown>));
      setEntries(loaded);
      resolveReferredBy(loaded);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (authLoading || !user) return;
    fetchAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, user]);

  const handleRefresh = () => { setPage(1); setExpandedId(null); panelCache.current = {}; fetchAll(); };

  const filtered = useMemo(
    () =>
      entries
        .filter((e) => {
          if (tableFilter === "has_referrals") return e.referrals_count > 0;
          if (tableFilter === "no_referrals") return e.referrals_count === 0;
          return true;
        })
        .filter((e) => {
          if (!dateFrom && !dateTo) return true;
          if (!e.createdAt) return !dateFrom;
          const d = e.createdAt.toDate();
          if (dateFrom && d < new Date(dateFrom)) return false;
          if (dateTo) {
            const end = new Date(dateTo);
            end.setDate(end.getDate() + 1);
            if (d >= end) return false;
          }
          return true;
        })
        .filter((e) => {
          if (!debouncedSearch.trim()) return true;
          const q = debouncedSearch.toLowerCase();
          const referrerName = referredByMap[e.id]?.uid !== "none" ? (referredByMap[e.id]?.name ?? "") : "";
          return (
            e.name.toLowerCase().includes(q) ||
            e.email.toLowerCase().includes(q) ||
            (e.referral_code ?? "").toLowerCase().includes(q) ||
            referrerName.toLowerCase().includes(q)
          );
        })
        .sort((a, b) =>
          sortOrder === "referrals_asc" ? b.referrals_count - a.referrals_count : 0
        ),
    [entries, tableFilter, debouncedSearch, sortOrder, referredByMap, dateFrom, dateTo]
  );

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage   = Math.min(Math.max(page, 1), totalPages);

  const paged = useMemo(
    () => filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE),
    [filtered, safePage]
  );

  if (authLoading) return null;

  return (
    <AdminLayout>
      <style>{`
        @keyframes skel-pulse { 0%,100%{opacity:.45} 50%{opacity:.9} }
        .sk { background: var(--bg-elevated); border-radius: 5px; animation: skel-pulse 1.4s ease-in-out infinite; }
        .ref-page { padding: 24px 28px; min-height: 100%; background: var(--bg-base); }
        .ref-header { display: flex; align-items: flex-start; justify-content: space-between; margin-bottom: 20px; gap: 12px; flex-wrap: wrap; }
        .ref-header h1 { font-size: 20px; font-weight: 700; color: var(--text-primary); display: flex; align-items: center; gap: 8px; margin: 0; }
        .ref-header p { font-size: 13px; color: var(--text-muted); margin-top: 3px; }
        .ref-controls { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }
        .ref-search-wrap { position: relative; }
        .ref-search-wrap > svg { position: absolute; left: 10px; top: 50%; transform: translateY(-50%); color: var(--text-muted); pointer-events: none; }
        .ref-search { padding: 8px 32px 8px 34px; border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--bg-elevated); color: var(--text-primary); font-size: 13px; width: 250px; outline: none; }
        .ref-search:focus { border-color: var(--blue); }
        .ref-clear { position: absolute; right: 8px; top: 50%; transform: translateY(-50%); background: none; border: none; cursor: pointer; color: var(--text-muted); display: flex; padding: 2px; }
        .ref-clear:hover { color: var(--text-primary); }
        .ref-btn { display: flex; align-items: center; gap: 6px; padding: 8px 14px; border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--bg-elevated); color: var(--text-secondary); font-size: 13px; cursor: pointer; transition: all 0.15s; white-space: nowrap; }
        .ref-btn:hover:not(:disabled) { background: var(--bg-hover); color: var(--text-primary); }
        .ref-btn:disabled { opacity: 0.5; cursor: not-allowed; }
        .ref-table-wrap { background: var(--bg-surface); border: 1px solid var(--border); border-radius: var(--radius-md); overflow: hidden; }
        .ref-table { width: 100%; border-collapse: collapse; }
        .ref-table th { padding: 11px 14px; text-align: left; font-size: 11px; font-weight: 700; letter-spacing: 0.6px; text-transform: uppercase; color: var(--text-muted); background: var(--bg-elevated); border-bottom: 1px solid var(--border); white-space: nowrap; }
        .ref-table td { padding: 13px 14px; font-size: 13px; color: var(--text-secondary); border-bottom: 1px solid var(--border-muted); vertical-align: middle; }
        .ref-table tr:last-child > td { border-bottom: none; }
        .ref-row:hover { background: var(--bg-hover); }
        .ref-name-link { display: inline-flex; align-items: center; gap: 5px; font-weight: 600; color: var(--text-primary); cursor: pointer; transition: color 0.15s; }
        .ref-name-link:hover { color: var(--blue); }
        .ref-code { font-family: 'Space Mono', monospace; font-size: 12px; background: var(--bg-elevated); padding: 3px 8px; border-radius: 4px; border: 1px solid var(--border); color: var(--text-primary); letter-spacing: 0.5px; }
        .ref-by { font-family: 'Space Mono', monospace; font-size: 12px; color: var(--orange); letter-spacing: 0.5px; }
        .ref-count { display: inline-flex; align-items: center; gap: 5px; font-weight: 600; color: var(--text-primary); }
        .ref-expand-btn { background: none; border: none; cursor: pointer; color: var(--text-muted); padding: 3px; display: inline-flex; border-radius: 4px; transition: all 0.15s; }
        .ref-expand-btn:hover { color: var(--text-primary); background: var(--bg-hover); }
        .up-pg { display: flex; align-items: center; justify-content: space-between; padding: 12px 16px; border-top: 1px solid var(--border); gap: 12px; flex-wrap: wrap; }
        .up-pg-info { font-size: 11px; color: var(--text-muted); }
        .up-pg-btns { display: flex; gap: 4px; }
        .up-pg-btn { min-width: 28px; height: 28px; padding: 0 6px; border-radius: 6px; border: 1px solid var(--border); background: var(--bg-elevated); color: var(--text-secondary); font-size: 12px; font-family: inherit; cursor: pointer; display: flex; align-items: center; justify-content: center; transition: all 0.15s; }
        .up-pg-btn:hover:not(:disabled):not(.active) { background: var(--bg-hover); }
        .up-pg-btn:disabled { opacity: 0.35; cursor: not-allowed; }
        .up-pg-btn.active { background: var(--blue); border-color: var(--blue); color: #fff; font-weight: 700; cursor: default; }
        .ref-empty { text-align: center; padding: 60px 20px; color: var(--text-muted); }
        .ref-empty p { margin-top: 10px; font-size: 14px; }
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>

      <div className="ref-page">
        {/* Header */}
        <div className="ref-header">
          <div>
            <h1>
              <GitBranch size={20} style={{ color: "var(--blue)" }} />
              Referrals
            </h1>
            <p>User referral codes and referral activity</p>
          </div>
          <div className="ref-controls">
            <div className="ref-search-wrap">
              <Search size={14} />
              <input
                className="ref-search"
                placeholder="Search name, email, or code…"
                value={search}
                onChange={(e) => handleSearch(e.target.value)}
              />
              {search && (
                <button className="ref-clear" onClick={() => { setSearch(""); setDebouncedSearch(""); }} title="Clear">
                  <X size={13} />
                </button>
              )}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => { setDateFrom(e.target.value); setPage(1); setExpandedId(null); }}
                title="Joined from"
                style={{
                  padding: "7px 10px", fontSize: 12, border: "1px solid var(--border)",
                  borderRadius: "var(--radius-sm)", background: "var(--bg-elevated)",
                  color: dateFrom ? "var(--text-primary)" : "var(--text-muted)", outline: "none",
                  cursor: "pointer",
                }}
              />
              <span style={{ fontSize: 11, color: "var(--text-muted)" }}>–</span>
              <input
                type="date"
                value={dateTo}
                min={dateFrom || undefined}
                onChange={(e) => { setDateTo(e.target.value); setPage(1); setExpandedId(null); }}
                title="Joined to"
                style={{
                  padding: "7px 10px", fontSize: 12, border: "1px solid var(--border)",
                  borderRadius: "var(--radius-sm)", background: "var(--bg-elevated)",
                  color: dateTo ? "var(--text-primary)" : "var(--text-muted)", outline: "none",
                  cursor: "pointer",
                }}
              />
              {(dateFrom || dateTo) && (
                <button
                  className="ref-btn"
                  onClick={() => { setDateFrom(""); setDateTo(""); setPage(1); setExpandedId(null); }}
                  title="Clear date filter"
                  style={{ padding: "7px 8px" }}
                >
                  <X size={13} />
                </button>
              )}
            </div>
            <button className="ref-btn" onClick={handleRefresh} disabled={loading}>
              <RefreshCw size={14} style={loading ? { animation: "spin 1s linear infinite" } : {}} />
              Refresh
            </button>
            <button className="ref-btn" onClick={() => router.push("/referrals/referral-settings")}>
              <Wrench size={14} />
              Referral Settings
            </button>
          </div>
        </div>

        {/* Stats */}
        {!loading && entries.length > 0 && <StatsBar entries={entries} />}

        {/* Top Referrers */}
        {!loading && entries.length > 0 && (
          <TopReferrers entries={entries} onNavigate={(uid) => router.push(`/users/${uid}`)} />
        )}

        {/* Table filters */}
        {!loading && entries.length > 0 && (
          <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
            {(["all", "has_referrals", "no_referrals"] as const).map((key) => {
              const label = key === "all" ? "All Users" : key === "has_referrals" ? "Has Referrals" : "No Referrals";
              const active = tableFilter === key;
              return (
                <button
                  key={key}
                  onClick={() => { setTableFilter(key); setPage(1); setExpandedId(null); }}
                  style={{
                    padding: "5px 14px", fontSize: 12, fontWeight: 600, borderRadius: 20,
                    border: `1px solid ${active ? "var(--blue)" : "var(--border)"}`,
                    background: active ? "var(--blue)" : "var(--bg-elevated)",
                    color: active ? "#fff" : "var(--text-muted)",
                    cursor: "pointer", transition: "all 0.12s",
                  }}
                >
                  {label}
                </button>
              );
            })}
            <button
              onClick={() => { setSortOrder((s) => s === "referrals_asc" ? "default" : "referrals_asc"); setPage(1); setExpandedId(null); }}
              style={{
                marginLeft: 8, padding: "5px 14px", fontSize: 12, fontWeight: 600, borderRadius: 20,
                border: `1px solid ${sortOrder === "referrals_asc" ? "var(--purple)" : "var(--border)"}`,
                background: sortOrder === "referrals_asc" ? "var(--purple)" : "var(--bg-elevated)",
                color: sortOrder === "referrals_asc" ? "#fff" : "var(--text-muted)",
                cursor: "pointer", transition: "all 0.12s", display: "inline-flex", alignItems: "center", gap: 5,
              }}
            >
              <Users size={11} />
              Referrals ↓
            </button>
          </div>
        )}

        {/* Table */}
        <div className="ref-table-wrap">
          <table className="ref-table">
            <thead>
              <tr>
                <th>Username</th>
                <th>Email</th>
                <th>Referral Code</th>
                <th>Referred By</th>
                <th>Level</th>
                <th>Referrals</th>
                <th>Date Joined</th>
                <th style={{ width: 40 }} />
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <TableSkeleton />
              ) : paged.length === 0 ? (
                <tr>
                  <td colSpan={8}>
                    <div className="ref-empty">
                      <GitBranch size={36} style={{ margin: "0 auto 12px", opacity: 0.25, display: "block" }} />
                      <p>{search ? `No results for "${search}"` : "No users found"}</p>
                    </div>
                  </td>
                </tr>
              ) : (
                paged.map((entry) => (
                  <Fragment key={entry.id}>
                    <tr className="ref-row">
                      <td>
                        <span
                          className="ref-name-link"
                          onClick={() => router.push(`/users/${entry.id}`)}
                          role="button"
                          tabIndex={0}
                          onKeyDown={(e) => e.key === "Enter" && router.push(`/users/${entry.id}`)}
                        >
                          {entry.name}
                          <ExternalLink size={11} style={{ opacity: 0.45 }} />
                        </span>
                      </td>
                      <td style={{ color: "var(--text-muted)" }}>{entry.email || "—"}</td>
                      <td>
                        {entry.referral_code
                          ? <span className="ref-code">{entry.referral_code}</span>
                          : <span style={{ color: "var(--text-muted)" }}>—</span>}
                      </td>
                      <td>
                        {referredByMap[entry.id]?.uid === "none" || !referredByMap[entry.id]
                          ? <span style={{ color: "var(--text-muted)", fontStyle: "italic" }}>Self Registered</span>
                          : (
                            <span
                              className="ref-by"
                              style={{ cursor: "pointer" }}
                              onClick={() => router.push(`/users/${referredByMap[entry.id].uid}`)}
                              title="View referrer"
                            >
                              {referredByMap[entry.id].name}
                            </span>
                          )}
                      </td>
                      <td><LevelBadge level={entry.referral_level} /></td>
                      <td>
                        <span className="ref-count">
                          <Users size={13} style={{ color: entry.referrals_count > 0 ? "var(--blue)" : "var(--text-muted)" }} />
                          {entry.referrals_count}
                        </span>
                      </td>
                      <td>{formatDate(entry.createdAt)}</td>
                      <td>
                        {entry.referrals_count > 0 && (
                          <button
                            className="ref-expand-btn"
                            onClick={() => setExpandedId(expandedId === entry.id ? null : entry.id)}
                            title={expandedId === entry.id ? "Collapse" : "View referred users"}
                          >
                            {expandedId === entry.id
                              ? <ChevronUp size={15} />
                              : <ChevronDown size={15} />}
                          </button>
                        )}
                      </td>
                    </tr>

                    {expandedId === entry.id && (
                      <tr>
                        <td colSpan={8} style={{ padding: 0, borderBottom: "1px solid var(--border-muted)" }}>
                          <ReferredPanel
                            userId={entry.id}
                            count={entry.referrals_count}
                            verifiedCount={entry.verified_referrals}
                            onNavigate={(uid) => router.push(`/users/${uid}`)}
                            cache={panelCache}
                          />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))
              )}
            </tbody>
          </table>

          {!loading && (
            <div className="up-pg">
              <span className="up-pg-info">
                {(safePage - 1) * PAGE_SIZE + 1}–{Math.min(safePage * PAGE_SIZE, filtered.length)} of {filtered.length} users
                </span>
              <div className="up-pg-btns">
                <button className="up-pg-btn" onClick={() => { setPage(1); setExpandedId(null); }} disabled={safePage === 1}>«</button>
                <button className="up-pg-btn" onClick={() => { setPage((p) => p - 1); setExpandedId(null); }} disabled={safePage === 1}>‹</button>
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
                        onClick={() => { setPage(p as number); setExpandedId(null); }}
                        disabled={p === safePage}
                      >
                        {p}
                      </button>
                    )
                  )}
                <button className="up-pg-btn" onClick={() => { setPage((p) => p + 1); setExpandedId(null); }} disabled={safePage === totalPages}>›</button>
                <button className="up-pg-btn" onClick={() => { setPage(totalPages); setExpandedId(null); }} disabled={safePage === totalPages}>»</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </AdminLayout>
  );
}

export default function ReferralsPage() {
  return (
    <Suspense>
      <ReferralsPageInner />
    </Suspense>
  );
}
