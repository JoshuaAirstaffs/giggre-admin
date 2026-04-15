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
import { RefreshCw, MapPin } from "lucide-react";
import { useAuthGuard } from "@/hooks/useAuthGuard";
import { useTheme } from "@/context/ThemeContext";
import type { GigMarker, GigType } from "./MapView";

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
  // Firestore GeoPoint or plain {latitude, longitude}
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
  // Firestore GeoPoint accessed via toJSON()
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

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function LiveMapPage() {
  useAuthGuard({ module: "live-map" });

  const [rawGigs, setRawGigs] = useState<{
    offered: RawGig[];
    open: RawGig[];
    quick: RawGig[];
  }>({ offered: [], open: [], quick: [] });

  const [loaded, setLoaded] = useState({
    offered: false,
    open: false,
    quick: false,
  });

  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const { theme: mapTheme } = useTheme();
  const unsubs = useRef<Unsubscribe[]>([]);

  const isLoading = !loaded.offered || !loaded.open || !loaded.quick;

  // ── Subscribe to all three collections ───────────────────────────────────────

  const subscribe = useCallback(() => {
    // Tear down existing listeners
    unsubs.current.forEach((u) => u());
    unsubs.current = [];

    setLoaded({ offered: false, open: false, quick: false });

    const configs: { key: keyof typeof rawGigs; col: string }[] = [
      { key: "offered", col: "offered_gigs" },
      { key: "open", col: "open_gigs" },
      { key: "quick", col: "quick_gigs" },
    ];

    configs.forEach(({ key, col }) => {
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
          // Mark as loaded even on error so UI doesn't hang
          setLoaded((prev) => ({ ...prev, [key]: true }));
        }
      );
      unsubs.current.push(unsub);
    });
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

  const stats = useMemo(() => {
    const total = markers.length;
    const offered = markers.filter((m) => m.gigType === "offered").length;
    const open = markers.filter((m) => m.gigType === "open").length;
    const quick = markers.filter((m) => m.gigType === "quick").length;
    const skipped =
      rawGigs.offered.length +
      rawGigs.open.length +
      rawGigs.quick.length -
      total;
    return { total, offered, open, quick, skipped };
  }, [markers, rawGigs]);

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <AdminLayout
      title="Live Map"
      subtitle="Real-time gig locations across all collections"
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
        @media (max-width: 768px) { .lm-stats { grid-template-columns: repeat(2, 1fr); } }
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

        /* Legend */
        .lm-legend {
          display: flex; align-items: center; gap: 16px;
          padding: 10px 16px; border-radius: var(--radius-md);
          background: var(--bg-surface); border: 1px solid var(--border);
          flex-wrap: wrap;
        }
        .lm-legend-label { font-size: 11px; font-weight: 600; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.05em; }
        .lm-legend-item { display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--text-secondary); font-weight: 500; }
        .lm-legend-dot { width: 10px; height: 10px; border-radius: 50%; flex-shrink: 0; border: 2px solid rgba(255,255,255,0.25); }
        .lm-legend-sep { width: 1px; height: 14px; background: var(--border); }

        .lm-meta { font-size: 11px; color: var(--text-muted); margin-left: auto; }

        /* Map container */
        .lm-map-card {
          flex: 1; min-height: 480px;
          border-radius: var(--radius-md); overflow: hidden;
          border: 1px solid var(--border); position: relative;
        }

        /* Skeleton */
        .lm-skeleton { background: var(--bg-elevated); border-radius: 6px; animation: lm-pulse 1.4s ease-in-out infinite; }
        @keyframes lm-pulse { 0%,100%{opacity:0.4}50%{opacity:0.9} }
      `}</style>

      <div className="lm-wrap">

        {/* ── Stats ── */}
        <div className="lm-stats">
          <StatCard
            value={isLoading ? null : stats.total}
            label="Total Gigs"
            color="var(--blue)"
          />
          <StatCard
            value={isLoading ? null : stats.offered}
            label="Offered Gigs"
            color="var(--amber)"
          />
          <StatCard
            value={isLoading ? null : stats.open}
            label="Open Gigs"
            color="var(--blue)"
          />
          <StatCard
            value={isLoading ? null : stats.quick}
            label="Quick Gigs"
            color="var(--purple)"
          />
        </div>

        {/* ── Legend + meta ── */}
        <div className="lm-legend">
          <span className="lm-legend-label">Types</span>
          <span className="lm-legend-sep" />
          <span className="lm-legend-item">
            <span className="lm-legend-dot" style={{ background: "#F59E0B" }} />
            Offered
          </span>
          <span className="lm-legend-item">
            <span className="lm-legend-dot" style={{ background: "#3B82F6" }} />
            Open
          </span>
          <span className="lm-legend-item">
            <span className="lm-legend-dot" style={{ background: "#8B5CF6" }} />
            Quick
          </span>
          {!isLoading && stats.skipped > 0 && (
            <>
              <span className="lm-legend-sep" />
              <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
                {stats.skipped} gig{stats.skipped !== 1 ? "s" : ""} skipped (no location)
              </span>
            </>
          )}
          {lastUpdated && (
            <span className="lm-meta">
              Updated {lastUpdated.toLocaleTimeString("en-PH", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
            </span>
          )}
        </div>

        {/* ── Map ── */}
        <div className="lm-map-card">
          {isLoading ? (
            <MapPlaceholder label="Connecting to Firebase…" />
          ) : markers.length === 0 ? (
            <EmptyMapState />
          ) : (
            <MapView markers={markers} theme={mapTheme} />
          )}
        </div>

      </div>
    </AdminLayout>
  );
}

// ─── Stat Card ────────────────────────────────────────────────────────────────

function StatCard({ value, label, color }: { value: number | null; label: string; color: string }) {
  return (
    <div className="lm-stat" style={{ borderLeft: `3px solid ${color}` }}>
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
        No gigs available
      </div>
      <div style={{ fontSize: 12 }}>
        Gigs with valid location data will appear as markers on the map.
      </div>
    </div>
  );
}
