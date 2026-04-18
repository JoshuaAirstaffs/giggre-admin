"use client";

import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import dynamic from "next/dynamic";
import AdminLayout from "@/components/layout/AdminLayout";
import Button from "@/components/ui/Button";
import {
  collection,
  onSnapshot,
  Timestamp,
  type Unsubscribe,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { RefreshCw, MapPin, Briefcase, Users, Wifi, WifiOff, ShieldOff, Ban } from "lucide-react";
import { useAuthGuard } from "@/hooks/useAuthGuard";
import { useTheme } from "@/context/ThemeContext";
import type { GigMarker, GigType, UserMarker } from "./MapView";

// ─── Dynamic import (Leaflet requires browser APIs — no SSR) ──────────────────

const MapView = dynamic(() => import("./MapView"), {
  ssr: false,
  loading: () => <MapPlaceholder label="Loading map…" />,
});

// ─── Types ────────────────────────────────────────────────────────────────────

interface RawGig {
  id: string;
  title?: string;
  status?: string;
  category?: string;
  postedBy?: string;
  salary?: string | number;
  vacancy?: number;
  location?: unknown;
  createdAt?: Timestamp | null;
}

interface RawUser {
  id: string;
  name?: string;
  email?: string;
  role?: string;
  isOnline?: boolean;
  isBanned?: boolean;
  suspended_until?: Timestamp | null;
  location?: unknown;
}

interface GigTypeRawGig extends RawGig {
  gigType: GigType;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

interface GeoPoint {
  latitude: number;
  longitude: number;
}

function extractLatLng(location: unknown): { lat: number; lng: number } | null {
  if (!location) return null;
  if (
    typeof location === "object" &&
    location !== null &&
    "latitude" in location &&
    "longitude" in location
  ) {
    const gp = location as GeoPoint;
    const lat = Number(gp.latitude);
    const lng = Number(gp.longitude);
    if (isFinite(lat) && isFinite(lng)) return { lat, lng };
  }
  if (
    typeof location === "object" &&
    location !== null &&
    typeof (location as { toJSON?: () => unknown }).toJSON === "function"
  ) {
    const json = (location as { toJSON: () => unknown }).toJSON() as GeoPoint;
    const lat = Number(json.latitude);
    const lng = Number(json.longitude);
    if (isFinite(lat) && isFinite(lng)) return { lat, lng };
  }
  return null;
}

function toGigMarker(gig: GigTypeRawGig): GigMarker | null {
  const coords = extractLatLng(gig.location);
  if (!coords) return null;
  return {
    id: `${gig.gigType}_${gig.id}`,
    gigType: gig.gigType,
    title: gig.title ?? "Untitled Gig",
    status: gig.status ?? "unknown",
    lat: coords.lat,
    lng: coords.lng,
    postedBy: gig.postedBy,
    salary: gig.salary,
    category: gig.category,
    vacancy: gig.vacancy,
    createdAt: gig.createdAt ?? null,
  };
}

function toUserMarker(user: RawUser): UserMarker | null {
  const coords = extractLatLng(user.location);
  if (!coords) return null;
  const isSuspended =
    user.suspended_until != null &&
    user.suspended_until.toDate() > new Date();
  return {
    id: user.id,
    name: user.name ?? "Unknown User",
    role: user.role ?? "user",
    isOnline: user.isOnline ?? false,
    lat: coords.lat,
    lng: coords.lng,
    email: user.email,
    isBanned: user.isBanned ?? false,
    isSuspended,
  };
}

// ─── Page ─────────────────────────────────────────────────────────────────────

type UserListFilter = "all" | "online" | "offline" | "no-location";

export default function LiveMapPage() {
  useAuthGuard({ module: "live-map" });

  const [rawGigs, setRawGigs] = useState<{
    offered: RawGig[];
    open: RawGig[];
    quick: RawGig[];
  }>({ offered: [], open: [], quick: [] });

  const [rawUsers, setRawUsers] = useState<RawUser[]>([]);

  const [loaded, setLoaded] = useState({
    offered: false,
    open: false,
    quick: false,
    users: false,
  });

  const [activeLayer, setActiveLayer] = useState<"gigs" | "users">("gigs");
  const showGigs = activeLayer === "gigs";
  const showUsers = activeLayer === "users";
  const [userListFilter, setUserListFilter] = useState<UserListFilter>("all");
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const { theme: mapTheme } = useTheme();
  const unsubs = useRef<Unsubscribe[]>([]);

  const isLoading = !loaded.offered || !loaded.open || !loaded.quick || !loaded.users;

  // ── Subscribe to all collections ─────────────────────────────────────────────

  const subscribe = useCallback(() => {
    unsubs.current.forEach((u) => u());
    unsubs.current = [];

    setLoaded({ offered: false, open: false, quick: false, users: false });

    const gigConfigs: { key: "offered" | "open" | "quick"; col: string }[] = [
      { key: "offered", col: "offered_gigs" },
      { key: "open", col: "open_gigs" },
      { key: "quick", col: "quick_gigs" },
    ];

    gigConfigs.forEach(({ key, col }) => {
      const unsub = onSnapshot(
        collection(db, col),
        (snapshot) => {
          const docs = snapshot.docs.map((doc) => ({
            id: doc.id,
            ...doc.data(),
          })) as RawGig[];
          setRawGigs((prev) => ({ ...prev, [key]: docs }));
          setLoaded((prev) => ({ ...prev, [key]: true }));
          setLastUpdated(new Date());
        },
        (err) => {
          console.error(`[live-map] onSnapshot error (${col}):`, err);
          setLoaded((prev) => ({ ...prev, [key]: true }));
        }
      );
      unsubs.current.push(unsub);
    });

    const userUnsub = onSnapshot(
      collection(db, "users"),
      (snapshot) => {
        const docs = snapshot.docs.map((doc) => ({
          id: doc.id,
          ...doc.data(),
        })) as RawUser[];
        setRawUsers(docs);
        setLoaded((prev) => ({ ...prev, users: true }));
        setLastUpdated(new Date());
      },
      (err) => {
        console.error("[live-map] onSnapshot error (users):", err);
        setLoaded((prev) => ({ ...prev, users: true }));
      }
    );
    unsubs.current.push(userUnsub);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    subscribe();
    return () => unsubs.current.forEach((u) => u());
  }, [subscribe]);

  // ── Derive markers ────────────────────────────────────────────────────────────

  const markers = useMemo<GigMarker[]>(() => {
    const tagged: GigTypeRawGig[] = [
      ...rawGigs.offered.map((g) => ({ ...g, gigType: "offered" as const })),
      ...rawGigs.open.map((g) => ({ ...g, gigType: "open" as const })),
      ...rawGigs.quick.map((g) => ({ ...g, gigType: "quick" as const })),
    ];
    return tagged.flatMap((g) => {
      const m = toGigMarker(g);
      return m ? [m] : [];
    });
  }, [rawGigs]);

  const userMarkers = useMemo<UserMarker[]>(() => {
    return rawUsers.flatMap((u) => {
      const m = toUserMarker(u);
      return m ? [m] : [];
    });
  }, [rawUsers]);

  // All users enriched with derived fields for the list
  const enrichedUsers = useMemo(() => {
    return rawUsers.map((u) => {
      const isSuspended =
        u.suspended_until != null &&
        u.suspended_until.toDate() > new Date();
      const hasLocation = extractLatLng(u.location) !== null;
      return { ...u, isSuspended, hasLocation };
    });
  }, [rawUsers]);

  const filteredUserList = useMemo(() => {
    return enrichedUsers.filter((u) => {
      if (userListFilter === "online") return u.isOnline && !u.isBanned && !u.isSuspended;
      if (userListFilter === "offline") return !u.isOnline;
      if (userListFilter === "no-location") return !u.hasLocation;
      return true;
    });
  }, [enrichedUsers, userListFilter]);

  const gigStats = useMemo(() => {
    const total = markers.length;
    const offered = markers.filter((m) => m.gigType === "offered").length;
    const open = markers.filter((m) => m.gigType === "open").length;
    const quick = markers.filter((m) => m.gigType === "quick").length;
    const skipped =
      rawGigs.offered.length + rawGigs.open.length + rawGigs.quick.length - total;
    return { total, offered, open, quick, skipped };
  }, [markers, rawGigs]);

  const userStats = useMemo(() => {
    const total = rawUsers.length;
    const online = enrichedUsers.filter((u) => u.isOnline && !u.isBanned && !u.isSuspended).length;
    const onMap = userMarkers.length;
    const noLocation = total - onMap;
    return { total, online, onMap, noLocation };
  }, [rawUsers, enrichedUsers, userMarkers]);

  const hasAnyMarkers = markers.length > 0 || userMarkers.length > 0;

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <AdminLayout
      title="Live Map"
      subtitle="Real-time gig & user locations"
      actions={
        <Button
          variant="ghost"
          size="sm"
          icon={RefreshCw}
          onClick={subscribe}
          disabled={isLoading}
        >
          Refresh
        </Button>
      }
    >
      <style>{`
        .lm-wrap { display: flex; flex-direction: column; gap: 16px; padding: 24px; height: 100%; }

        /* Stats */
        .lm-stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; }
        @media (max-width: 600px) { .lm-stats { grid-template-columns: repeat(2, 1fr); } }
        .lm-stat {
          padding: 12px 16px; border-radius: var(--radius-md);
          background: var(--bg-surface); border: 1px solid var(--border);
          display: flex; flex-direction: column; gap: 3;
        }
        .lm-stat-val {
          font-size: 20px; font-weight: 700; font-family: 'Space Mono', monospace;
          line-height: 1.2;
        }
        .lm-stat-label {
          font-size: 11px; color: var(--text-muted); font-weight: 500;
          text-transform: uppercase; letter-spacing: 0.05em;
        }

        /* Legend / controls bar */
        .lm-legend {
          display: flex; align-items: center; gap: 14px;
          padding: 10px 16px; border-radius: var(--radius-md);
          background: var(--bg-surface); border: 1px solid var(--border);
          flex-wrap: wrap;
        }
        .lm-legend-label { font-size: 11px; font-weight: 600; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.05em; }
        .lm-legend-item { display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--text-secondary); font-weight: 500; }
        .lm-legend-dot { width: 10px; height: 10px; border-radius: 50%; flex-shrink: 0; border: 2px solid rgba(255,255,255,0.25); }
        .lm-legend-sep { width: 1px; height: 14px; background: var(--border); flex-shrink: 0; }
        .lm-meta { font-size: 11px; color: var(--text-muted); margin-left: auto; }

        /* Layer toggles */
        .lm-toggle {
          display: inline-flex; align-items: center; gap: 5px;
          padding: 4px 10px; border-radius: 20px; font-size: 11px; font-weight: 600;
          cursor: pointer; border: 1px solid var(--border);
          background: var(--bg-elevated); color: var(--text-muted);
          transition: all 0.15s ease; user-select: none;
        }
        .lm-toggle-dot { width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0; }

        /* Content row: map + user list */
        .lm-content { display: flex; gap: 12px; flex: 1; min-height: 520px; }
        .lm-map-card {
          flex: 1; min-height: 480px;
          border-radius: var(--radius-md); overflow: hidden;
          border: 1px solid var(--border); position: relative;
        }

        /* User list panel */
        .lm-user-panel {
          width: 260px; flex-shrink: 0;
          border: 1px solid var(--border); border-radius: var(--radius-md);
          background: var(--bg-surface);
          display: flex; flex-direction: column; overflow: hidden;
        }
        .lm-user-panel-header {
          padding: 12px 14px; border-bottom: 1px solid var(--border);
          display: flex; flex-direction: column; gap: 8px;
        }
        .lm-user-panel-title {
          font-size: 12px; font-weight: 700; color: var(--text-primary);
          display: flex; align-items: center; gap: 6px;
        }
        .lm-user-filters {
          display: flex; gap: 4px; flex-wrap: wrap;
        }
        .lm-filter-btn {
          padding: 2px 8px; border-radius: 12px; font-size: 10px; font-weight: 600;
          cursor: pointer; border: 1px solid var(--border);
          background: var(--bg-elevated); color: var(--text-muted);
          transition: all 0.12s ease; user-select: none;
        }
        .lm-filter-btn.active { background: var(--bg-elevated); color: var(--text-primary); border-color: var(--text-muted); }
        .lm-user-list { flex: 1; overflow-y: auto; padding: 6px; }
        .lm-user-row {
          display: flex; align-items: center; gap: 8px;
          padding: 7px 8px; border-radius: 8px;
          border-bottom: 1px solid var(--border);
          transition: background 0.1s ease;
        }
        .lm-user-row:hover { background: var(--bg-elevated); }
        .lm-user-row:last-child { border-bottom: none; }
        .lm-user-avatar {
          width: 28px; height: 28px; border-radius: 50%; flex-shrink: 0;
          display: flex; align-items: center; justify-content: center;
          font-size: 11px; font-weight: 700; color: white;
          position: relative;
        }
        .lm-user-status-dot {
          position: absolute; bottom: 0; right: 0;
          width: 8px; height: 8px; border-radius: 50%;
          border: 1.5px solid var(--bg-surface);
        }
        .lm-user-info { flex: 1; min-width: 0; }
        .lm-user-name { font-size: 12px; font-weight: 600; color: var(--text-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .lm-user-meta { font-size: 10px; color: var(--text-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .lm-no-loc-badge {
          font-size: 9px; font-weight: 700; padding: 1px 5px; border-radius: 6px;
          background: rgba(100,116,139,0.15); color: var(--text-muted);
          flex-shrink: 0;
        }

        /* Skeleton */
        .lm-skeleton { background: var(--bg-elevated); border-radius: 6px; animation: lm-pulse 1.4s ease-in-out infinite; }
        @keyframes lm-pulse { 0%,100%{opacity:0.4}50%{opacity:0.9} }

        @media (max-width: 900px) {
          .lm-content { flex-direction: column; }
          .lm-user-panel { width: 100%; max-height: 260px; }
        }
      `}</style>

      <div className="lm-wrap">

        {/* ── Stats ── */}
        <div className="lm-stats">
          <StatCard value={isLoading ? null : gigStats.total}   label="Total Gigs"   color="var(--blue)"  icon="gig" />
          <StatCard value={isLoading ? null : userStats.total}  label="Total Users"  color="#10B981"      icon="user" />
          <StatCard value={isLoading ? null : userStats.online} label="Online Now"   color="#10B981"      icon="user" pulse />
          <StatCard value={isLoading ? null : userStats.onMap}  label="Users on Map" color="#8B5CF6"      icon="user" />
        </div>

        {/* ── Controls bar ── */}
        <div className="lm-legend">
          <span className="lm-legend-label">Layers</span>
          <span className="lm-legend-sep" />
          <button
            className="lm-toggle"
            style={showGigs ? { color: "var(--blue)", borderColor: "var(--blue)", background: "rgba(59,130,246,0.08)" } : {}}
            onClick={() => setActiveLayer("gigs")}
          >
            <span className="lm-toggle-dot" style={{ background: showGigs ? "var(--blue)" : "var(--text-muted)" }} />
            <Briefcase size={10} />
            Gigs ({isLoading ? "…" : gigStats.total})
          </button>
          <button
            className="lm-toggle"
            style={showUsers ? { color: "#10B981", borderColor: "#10B981", background: "rgba(16,185,129,0.08)" } : {}}
            onClick={() => setActiveLayer("users")}
          >
            <span className="lm-toggle-dot" style={{ background: showUsers ? "#10B981" : "var(--text-muted)" }} />
            <Users size={10} />
            Users on map ({isLoading ? "…" : userStats.onMap})
          </button>

          <span className="lm-legend-sep" />
          <span className="lm-legend-item"><span className="lm-legend-dot" style={{ background: "#F59E0B" }} />Offered</span>
          <span className="lm-legend-item"><span className="lm-legend-dot" style={{ background: "#3B82F6" }} />Open</span>
          <span className="lm-legend-item"><span className="lm-legend-dot" style={{ background: "#8B5CF6" }} />Quick</span>
          <span className="lm-legend-sep" />
          <span className="lm-legend-item"><span className="lm-legend-dot" style={{ background: "#10B981" }} />Online</span>
          <span className="lm-legend-item"><span className="lm-legend-dot" style={{ background: "#64748B" }} />Offline</span>

          {lastUpdated && (
            <span className="lm-meta">
              Updated {lastUpdated.toLocaleTimeString("en-PH", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
            </span>
          )}
        </div>

        {/* ── Map + User list side by side ── */}
        <div className="lm-content">

          {/* Map */}
          <div className="lm-map-card">
            {isLoading ? (
              <MapPlaceholder label="Connecting to Firebase…" />
            ) : !hasAnyMarkers ? (
              <EmptyMapState />
            ) : (
              <MapView
                markers={markers}
                userMarkers={userMarkers}
                showGigs={showGigs}
                showUsers={showUsers}
                theme={mapTheme}
              />
            )}
          </div>

          {/* User list panel — ALL users */}
          <div className="lm-user-panel">
            <div className="lm-user-panel-header">
              <div className="lm-user-panel-title">
                <Users size={13} />
                All Users
                <span style={{
                  marginLeft: "auto", fontSize: 11, fontWeight: 700,
                  fontFamily: "'Space Mono', monospace",
                  color: "var(--text-muted)",
                }}>
                  {isLoading ? "…" : filteredUserList.length}
                </span>
              </div>
              <div className="lm-user-filters">
                {(["all", "online", "offline", "no-location"] as UserListFilter[]).map((f) => (
                  <button
                    key={f}
                    className={`lm-filter-btn${userListFilter === f ? " active" : ""}`}
                    onClick={() => setUserListFilter(f)}
                  >
                    {f === "all" ? "All" : f === "online" ? "Online" : f === "offline" ? "Offline" : "No Location"}
                  </button>
                ))}
              </div>
            </div>

            <div className="lm-user-list">
              {isLoading ? (
                Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className="lm-user-row">
                    <div className="lm-skeleton" style={{ width: 28, height: 28, borderRadius: "50%" }} />
                    <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 4 }}>
                      <div className="lm-skeleton" style={{ height: 11, width: "65%" }} />
                      <div className="lm-skeleton" style={{ height: 9, width: "45%" }} />
                    </div>
                  </div>
                ))
              ) : filteredUserList.length === 0 ? (
                <div style={{ padding: "20px 12px", textAlign: "center", fontSize: 12, color: "var(--text-muted)" }}>
                  No users match this filter
                </div>
              ) : (
                filteredUserList.map((u) => {
                  const isBanned = u.isBanned ?? false;
                  const isSuspended = u.isSuspended;
                  const isOnline = u.isOnline ?? false;
                  const statusColor = isBanned
                    ? "#EF4444"
                    : isSuspended
                    ? "#F59E0B"
                    : isOnline
                    ? "#10B981"
                    : "#64748B";
                  const avatarColor = isBanned ? "#EF4444" : isSuspended ? "#F59E0B" : isOnline ? "#10B981" : "#475569";
                  const initials = (u.name ?? "?").split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase();
                  return (
                    <div key={u.id} className="lm-user-row">
                      <div className="lm-user-avatar" style={{ background: avatarColor }}>
                        {initials}
                        <span className="lm-user-status-dot" style={{ background: statusColor }} />
                      </div>
                      <div className="lm-user-info">
                        <div className="lm-user-name">{u.name ?? "Unknown"}</div>
                        <div className="lm-user-meta">
                          {isBanned ? "Banned" : isSuspended ? "Suspended" : isOnline ? "Online" : "Offline"}
                          {u.role && u.role !== "N/A" && ` · ${u.role}`}
                        </div>
                      </div>
                      {!u.hasLocation && (
                        <span className="lm-no-loc-badge">No GPS</span>
                      )}
                      {isBanned && <Ban size={12} style={{ color: "#EF4444", flexShrink: 0 }} />}
                      {isSuspended && !isBanned && <ShieldOff size={12} style={{ color: "#F59E0B", flexShrink: 0 }} />}
                      {isOnline && !isBanned && !isSuspended && <Wifi size={11} style={{ color: "#10B981", flexShrink: 0 }} />}
                      {!isOnline && !isBanned && !isSuspended && <WifiOff size={11} style={{ color: "#64748B", flexShrink: 0, opacity: 0.5 }} />}
                    </div>
                  );
                })
              )}
            </div>
          </div>

        </div>

      </div>
    </AdminLayout>
  );
}

// ─── Stat Card ────────────────────────────────────────────────────────────────

function StatCard({
  value, label, color, icon, pulse,
}: {
  value: number | null;
  label: string;
  color: string;
  icon?: "gig" | "user";
  pulse?: boolean;
}) {
  return (
    <div className="lm-stat" style={{ borderLeft: `3px solid ${color}` }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }}>
        {icon === "gig" ? (
          <Briefcase size={12} style={{ color, opacity: 0.7 }} />
        ) : (
          <div style={{ position: "relative", display: "flex", alignItems: "center" }}>
            {pulse && (
              <span style={{
                position: "absolute", inset: -3, borderRadius: "50%",
                background: color, opacity: 0.2,
                animation: "lm-pulse 1.8s ease-in-out infinite",
              }} />
            )}
            <Users size={12} style={{ color, opacity: 0.7 }} />
          </div>
        )}
      </div>
      {value === null ? (
        <div className="lm-skeleton" style={{ height: 22, width: "45%", marginBottom: 4 }} />
      ) : (
        <div className="lm-stat-val" style={{ color }}>{value}</div>
      )}
      <div className="lm-stat-label">{label}</div>
    </div>
  );
}

// ─── Map Placeholder ─────────────────────────────────────────────────────────

function MapPlaceholder({ label }: { label: string }) {
  return (
    <div
      style={{
        height: "100%",
        minHeight: 480,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 12,
        background: "var(--bg-elevated)",
        color: "var(--text-muted)",
      }}
    >
      <RefreshCw size={24} style={{ opacity: 0.4, animation: "spin 1.2s linear infinite" }} />
      <span style={{ fontSize: 13, fontWeight: 500 }}>{label}</span>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

// ─── Empty State ──────────────────────────────────────────────────────────────

function EmptyMapState() {
  return (
    <div
      style={{
        height: "100%",
        minHeight: 480,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 12,
        background: "var(--bg-elevated)",
        color: "var(--text-muted)",
      }}
    >
      <div style={{ opacity: 0.25 }}>
        <MapPin size={40} />
      </div>
      <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text-secondary)" }}>
        No data with location
      </div>
      <div style={{ fontSize: 12 }}>
        Gigs and users with valid location data will appear as markers.
      </div>
    </div>
  );
}
