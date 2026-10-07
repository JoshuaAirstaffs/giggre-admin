"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { APIProvider, Map, AdvancedMarker, InfoWindow, ColorScheme, useMap } from "@vis.gl/react-google-maps";
import { MarkerClusterer, SuperClusterAlgorithm, type Cluster } from "@googlemaps/markerclusterer";
import { Timestamp } from "firebase/firestore";
import { useCurrency } from "@/context/CurrencyContext";
import Modal from "@/components/ui/Modal";
import { MapPin, Calendar, Users, Tag, Copy, Check } from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

export type GigType = "offered" | "open" | "quick";

export interface GigMarker {
  id: string;
  gigType: GigType;
  title: string;
  status: string;
  lat: number;
  lng: number;
  postedBy?: string;
  salary?: string | number;
  category?: string;
  vacancy?: number;
  createdAt?: Timestamp | null;
}

export interface UserMarker {
  id: string;
  name: string;
  role: string;
  isOnline: boolean;
  lat: number;
  lng: number;
  email?: string;
  isBanned?: boolean;
  isSuspended?: boolean;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const GIG_COLORS: Record<GigType, string> = {
  offered: "#F59E0B",
  open: "#3B82F6",
  quick: "#8B5CF6",
};

const GIG_LABELS: Record<GigType, string> = {
  offered: "Offered",
  open: "Open",
  quick: "Quick",
};

// Philippines center
const DEFAULT_CENTER = { lat: 12.8797, lng: 121.774 };
const DEFAULT_ZOOM = 6;

const API_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? "";
// Advanced markers need a map ID. Google's DEMO_MAP_ID works out of the box;
// set NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID to a real one from Cloud Console later.
const MAP_ID = process.env.NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID || "DEMO_MAP_ID";

// ─── Marker content ───────────────────────────────────────────────────────────

function GigDot({ gigType }: { gigType: GigType }) {
  return (
    <div style={{
      width: 14, height: 14, borderRadius: "50%",
      background: GIG_COLORS[gigType], border: "2.5px solid rgba(255,255,255,0.9)",
      boxShadow: "0 1px 6px rgba(0,0,0,0.5)", cursor: "pointer",
    }} />
  );
}

function userColor(u: UserMarker) {
  return u.isBanned ? "#EF4444" : u.isSuspended ? "#F59E0B" : u.isOnline ? "#10B981" : "#64748B";
}

function UserDot({ user }: { user: UserMarker }) {
  const color = userColor(user);
  const pulse = user.isOnline && !user.isBanned && !user.isSuspended;
  return (
    <div style={{ position: "relative", width: 20, height: 20, cursor: "pointer" }}>
      {pulse && (
        <div style={{
          position: "absolute", inset: -4, borderRadius: "50%",
          background: color, opacity: 0.25, animation: "user-pulse 1.8s ease-in-out infinite",
        }} />
      )}
      <div style={{
        position: "relative", width: 20, height: 20, borderRadius: "50%",
        background: color, border: "2.5px solid rgba(255,255,255,0.9)",
        boxShadow: "0 1px 8px rgba(0,0,0,0.5)",
        display: "flex", alignItems: "center", justifyContent: "center",
      }}>
        <svg width="10" height="10" viewBox="0 0 24 24" fill="white" xmlns="http://www.w3.org/2000/svg">
          <path d="M12 12c2.7 0 4.8-2.1 4.8-4.8S14.7 2.4 12 2.4 7.2 4.5 7.2 7.2 9.3 12 12 12zm0 2.4c-3.2 0-9.6 1.6-9.6 4.8v2.4h19.2v-2.4c0-3.2-6.4-4.8-9.6-4.8z"/>
        </svg>
      </div>
    </div>
  );
}

function clusterBubble(count: number, ring: string, theme: MapTheme): HTMLElement {
  const size = count < 10 ? 34 : count < 100 ? 40 : 46;
  const isDark = theme === "dark";
  const el = document.createElement("div");
  el.style.cssText = `
    width:${size}px;height:${size}px;border-radius:50%;cursor:pointer;
    background:${isDark ? "#111827" : "#ffffff"};border:2px solid ${ring};
    display:flex;align-items:center;justify-content:center;
    color:${isDark ? "#F1F5F9" : "#1e293b"};font-family:'Space Mono',monospace;
    font-size:11px;font-weight:700;
    box-shadow:0 2px 8px rgba(0,0,0,${isDark ? "0.5" : "0.2"});
  `;
  el.textContent = String(count);
  return el;
}

// ─── Clustered markers ────────────────────────────────────────────────────────
// Each item is a React-rendered AdvancedMarker; the clusterer only groups the
// underlying marker elements, so markers keep their own click handling.

type MarkerEl = google.maps.marker.AdvancedMarkerElement;

function ClusteredMarkers<T extends { id: string; lat: number; lng: number }>({
  items,
  theme,
  ringColor,
  radius,
  renderContent,
  onItemClick,
  onClusterClick,
}: {
  items: T[];
  theme: MapTheme;
  ringColor: string;
  radius: number;
  renderContent: (item: T) => React.ReactNode;
  onItemClick: (item: T) => void;
  /** Return true to take over the click; otherwise the map zooms into the cluster. */
  onClusterClick?: (position: google.maps.LatLngLiteral, items: T[]) => boolean;
}) {
  const map = useMap();
  const [markers, setMarkers] = useState<Record<string, MarkerEl>>({});

  // Latest props for the clusterer's callbacks, which are created once per map/theme
  const itemsById = useRef(new globalThis.Map<string, T>());
  itemsById.current = new globalThis.Map(items.map((i) => [i.id, i]));
  const idByMarker = useRef(new globalThis.Map<MarkerEl, string>());
  const clusterClickRef = useRef(onClusterClick);
  clusterClickRef.current = onClusterClick;

  const clusterer = useMemo(() => {
    if (!map) return null;
    return new MarkerClusterer({
      map,
      algorithm: new SuperClusterAlgorithm({ radius, maxZoom: 18 }),
      renderer: {
        render: ({ count, position }) =>
          new google.maps.marker.AdvancedMarkerElement({
            position,
            content: clusterBubble(count, ringColor, theme),
            zIndex: 1000 + count,
          }),
      },
      onClusterClick: (_event, cluster: Cluster, m) => {
        const clustered = cluster.markers
          .map((mk) => itemsById.current.get(idByMarker.current.get(mk as MarkerEl) ?? ""))
          .filter((x): x is T => x != null);
        const pos = cluster.position.toJSON();
        if (clusterClickRef.current?.(pos, clustered)) return;
        if (cluster.bounds) m.fitBounds(cluster.bounds, 48);
      },
    });
  }, [map, theme, ringColor, radius]);

  useEffect(() => () => {
    clusterer?.clearMarkers();
    clusterer?.setMap(null);
  }, [clusterer]);

  useEffect(() => {
    if (!clusterer) return;
    clusterer.clearMarkers();
    clusterer.addMarkers(Object.values(markers));
  }, [clusterer, markers]);

  // One stable ref callback per item — an inline arrow would be a new function
  // every render, making React detach/re-attach every marker and loop forever.
  const refCallbacks = useRef(new globalThis.Map<string, (m: MarkerEl | null) => void>());
  const refFor = (id: string) => {
    let cb = refCallbacks.current.get(id);
    if (!cb) {
      cb = (m: MarkerEl | null) => setMarkerRef(m, id);
      refCallbacks.current.set(id, cb);
    }
    return cb;
  };

  const setMarkerRef = useCallback((marker: MarkerEl | null, id: string) => {
    setMarkers((prev) => {
      if ((marker && prev[id] === marker) || (!marker && !prev[id])) return prev;
      if (marker) {
        idByMarker.current.set(marker, id);
        return { ...prev, [id]: marker };
      }
      const next = { ...prev };
      if (next[id]) idByMarker.current.delete(next[id]);
      delete next[id];
      return next;
    });
  }, []);

  return (
    <>
      {items.map((item) => (
        <AdvancedMarker
          key={item.id}
          position={{ lat: item.lat, lng: item.lng }}
          ref={refFor(item.id)}
          onClick={() => onItemClick(item)}
        >
          {renderContent(item)}
        </AdvancedMarker>
      ))}
    </>
  );
}

// ─── Fit Bounds Helper ────────────────────────────────────────────────────────

/** Fits the view once, when the first markers arrive. */
function FitBounds({ points }: { points: { lat: number; lng: number }[] }) {
  const map = useMap();
  const fitted = useRef(false);
  useEffect(() => {
    if (!map || fitted.current || points.length === 0) return;
    fitted.current = true;
    const bounds = new google.maps.LatLngBounds();
    points.forEach((p) => bounds.extend(p));
    map.fitBounds(bounds, 48);
    google.maps.event.addListenerOnce(map, "idle", () => {
      if ((map.getZoom() ?? 0) > 13) map.setZoom(13);
    });
  }, [map, points]);
  return null;
}

// ─── Popup Content ────────────────────────────────────────────────────────────

function GigPopup({ gig, theme }: { gig: GigMarker; theme: MapTheme }) {
  const color = GIG_COLORS[gig.gigType];
  const isAvailable = gig.status?.toLowerCase() === "available";
  const pt = POPUP_THEME[theme];
  const { symbol } = useCurrency();

  return (
    <div style={{ minWidth: 180, fontFamily: "DM Sans, sans-serif" }}>
      <div style={{ marginBottom: 6 }}>
        <span style={{
          display: "inline-flex", alignItems: "center", gap: 5,
          padding: "2px 8px", borderRadius: 20,
          background: `${color}22`, color,
          fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em",
        }}>
          <span style={{ width: 6, height: 6, borderRadius: "50%", background: color, display: "inline-block" }} />
          {GIG_LABELS[gig.gigType]} Gig
        </span>
      </div>
      <div style={{ fontSize: 14, fontWeight: 700, color: pt.title, marginBottom: 6, lineHeight: 1.3 }}>
        {gig.title || "Untitled Gig"}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <PopupRow label="Status" labelColor={pt.label} valueColor={pt.value}>
          <span style={{
            padding: "1px 7px", borderRadius: 10, fontSize: 11, fontWeight: 600,
            background: isAvailable ? "rgba(16,185,129,0.15)" : "rgba(239,68,68,0.15)",
            color: isAvailable ? "#10B981" : "#EF4444",
          }}>
            {gig.status || "Unknown"}
          </span>
        </PopupRow>
        {gig.category && <PopupRow label="Category" labelColor={pt.label} valueColor={pt.value}>{gig.category}</PopupRow>}
        {gig.postedBy && <PopupRow label="Posted by" labelColor={pt.label} valueColor={pt.value}>{gig.postedBy}</PopupRow>}
        {gig.salary !== undefined && gig.salary !== null && gig.salary !== "" && (
          <PopupRow label="Salary" labelColor={pt.label} valueColor={pt.value}>{symbol}{gig.salary}</PopupRow>
        )}
        {gig.vacancy !== undefined && (
          <PopupRow label="Vacancies" labelColor={pt.label} valueColor={pt.value}>{String(gig.vacancy)}</PopupRow>
        )}
        <PopupRow label="Coords" labelColor={pt.label} valueColor={pt.value}>
          {gig.lat.toFixed(4)}, {gig.lng.toFixed(4)}
        </PopupRow>
      </div>
    </div>
  );
}

function PopupRow({ label, labelColor, valueColor, children }: { label: string; labelColor: string; valueColor: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
      <span style={{ fontSize: 10, color: labelColor, textTransform: "uppercase", letterSpacing: "0.04em", fontWeight: 600, flexShrink: 0 }}>
        {label}
      </span>
      <span style={{ fontSize: 12, color: valueColor, textAlign: "right" }}>{children}</span>
    </div>
  );
}

// ─── User Popup ───────────────────────────────────────────────────────────────

function UserPopup({ user, theme }: { user: UserMarker; theme: MapTheme }) {
  const pt = POPUP_THEME[theme];
  const statusColor = user.isBanned
    ? "#EF4444"
    : user.isSuspended
    ? "#F59E0B"
    : user.isOnline
    ? "#10B981"
    : "#64748B";
  const statusLabel = user.isBanned
    ? "Banned"
    : user.isSuspended
    ? "Suspended"
    : user.isOnline
    ? "Online"
    : "Offline";

  return (
    <div style={{ minWidth: 180, fontFamily: "DM Sans, sans-serif" }}>
      <div style={{ marginBottom: 6 }}>
        <span style={{
          display: "inline-flex", alignItems: "center", gap: 5,
          padding: "2px 8px", borderRadius: 20,
          background: `${statusColor}22`, color: statusColor,
          fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em",
        }}>
          <span style={{ width: 6, height: 6, borderRadius: "50%", background: statusColor, display: "inline-block" }} />
          {statusLabel}
        </span>
      </div>
      <div style={{ fontSize: 14, fontWeight: 700, color: pt.title, marginBottom: 6, lineHeight: 1.3 }}>
        {user.name || "Unknown User"}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {user.role && <PopupRow label="Role" labelColor={pt.label} valueColor={pt.value}>{user.role}</PopupRow>}
        {user.email && <PopupRow label="Email" labelColor={pt.label} valueColor={pt.value}>{user.email}</PopupRow>}
        <PopupRow label="Coords" labelColor={pt.label} valueColor={pt.value}>
          {user.lat.toFixed(4)}, {user.lng.toFixed(4)}
        </PopupRow>
      </div>
    </div>
  );
}

// ─── Map View ─────────────────────────────────────────────────────────────────

export type MapTheme = "dark" | "light";

const POPUP_THEME = {
  dark: {
    bg: "#111827", border: "#1E293B", title: "#F1F5F9",
    label: "#475569", value: "#94A3B8", tip: "#111827",
    close: "#475569", closeHover: "#94A3B8",
    itemBg: "#0D1526",
  },
  light: {
    bg: "#ffffff", border: "#e2e8f0", title: "#0f172a",
    label: "#94a3b8", value: "#334155", tip: "#ffffff",
    close: "#94a3b8", closeHover: "#475569",
    itemBg: "#f8fafc",
  },
};

// ─── Cluster Gig List Popup ───────────────────────────────────────────────────

function GigListPopup({ gigs, theme, onSelect }: { gigs: GigMarker[]; theme: MapTheme; onSelect: (gig: GigMarker) => void }) {
  const pt = POPUP_THEME[theme];
  const { symbol } = useCurrency();
  const [showAll, setShowAll] = useState(false);
  const NEEDS_TOGGLE_THRESHOLD = 4;
  const canToggle = gigs.length > NEEDS_TOGGLE_THRESHOLD;

  return (
    <div style={{ fontFamily: "DM Sans, sans-serif", minWidth: 220 }}>
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8,
        marginBottom: 8, paddingBottom: 6,
        borderBottom: `1px solid ${pt.border}`,
      }}>
        <span style={{
          fontSize: 11, fontWeight: 700, color: pt.label,
          textTransform: "uppercase", letterSpacing: "0.06em",
        }}>
          {gigs.length} Gig{gigs.length !== 1 ? "s" : ""} in this area
        </span>
        {canToggle && (
          <button
            onClick={() => setShowAll((v) => !v)}
            style={{
              fontSize: 10, fontWeight: 700, color: "#3B82F6",
              background: "none", border: "none", cursor: "pointer",
              padding: 0, flexShrink: 0,
            }}
          >
            {showAll ? "Collapse" : "Show All"}
          </button>
        )}
      </div>
      <div style={{
        display: "flex", flexDirection: "column", gap: 6,
        maxHeight: showAll ? "none" : 280,
        overflowY: showAll ? "visible" : "auto",
      }}>
        {gigs.map((gig) => {
          const color = GIG_COLORS[gig.gigType];
          const isAvailable = gig.status?.toLowerCase() === "available";
          return (
            <div
              key={gig.id}
              onClick={() => onSelect(gig)}
              style={{
                padding: "7px 8px", borderRadius: 8,
                background: pt.itemBg,
                border: `1px solid ${pt.border}`,
                cursor: "pointer",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                <span style={{ width: 7, height: 7, borderRadius: "50%", background: color, flexShrink: 0 }} />
                <span style={{ fontSize: 13, fontWeight: 700, color: pt.title, lineHeight: 1.2, flex: 1 }}>
                  {gig.title || "Untitled Gig"}
                </span>
                <span style={{
                  fontSize: 10, fontWeight: 600,
                  padding: "1px 6px", borderRadius: 8,
                  background: isAvailable ? "rgba(16,185,129,0.15)" : "rgba(239,68,68,0.15)",
                  color: isAvailable ? "#10B981" : "#EF4444",
                  flexShrink: 0,
                }}>
                  {gig.status || "Unknown"}
                </span>
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <span style={{ fontSize: 10, color, fontWeight: 600 }}>{GIG_LABELS[gig.gigType]}</span>
                {gig.category && <span style={{ fontSize: 10, color: pt.value }}>{gig.category}</span>}
                {gig.salary !== undefined && gig.salary !== null && gig.salary !== "" && (
                  <span style={{ fontSize: 10, color: pt.value }}>{symbol}{gig.salary}</span>
                )}
                {gig.vacancy !== undefined && (
                  <span style={{ fontSize: 10, color: pt.label }}>{gig.vacancy} vacancy</span>
                )}
                {gig.postedBy && <span style={{ fontSize: 10, color: pt.label }}>by {gig.postedBy}</span>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Gig Detail Modal ─────────────────────────────────────────────────────────

function GigDetailModal({ gig, onClose }: { gig: GigMarker; onClose: () => void }) {
  const { symbol } = useCurrency();
  const color = GIG_COLORS[gig.gigType];
  const isAvailable = gig.status?.toLowerCase() === "available";
  const displayId = gig.id.startsWith(`${gig.gigType}_`) ? gig.id.slice(gig.gigType.length + 1) : gig.id;

  return (
    <Modal open onClose={onClose} title="Gig Details" size="md">
      <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 16 }}>
        <div style={{ fontSize: 16, fontWeight: 700, color: "var(--text-primary)" }}>
          {gig.title || "Untitled Gig"}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          <span style={{
            display: "inline-flex", alignItems: "center", gap: 5,
            padding: "2px 8px", borderRadius: 20,
            background: `${color}22`, color,
            fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em",
          }}>
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: color, display: "inline-block" }} />
            {GIG_LABELS[gig.gigType]} Gig
          </span>
          {gig.category && (
            <span style={{
              padding: "2px 8px", borderRadius: 20, fontSize: 10, fontWeight: 700,
              background: "var(--bg-elevated)", color: "var(--text-secondary)",
            }}>
              {gig.category}
            </span>
          )}
          <span style={{
            display: "inline-flex", alignItems: "center", gap: 5,
            padding: "2px 8px", borderRadius: 20,
            background: isAvailable ? "rgba(16,185,129,0.15)" : "rgba(239,68,68,0.15)",
            color: isAvailable ? "#10B981" : "#EF4444",
            fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em",
          }}>
            {gig.status || "Unknown"}
          </span>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
        {gig.postedBy && (
          <DetailField label="Posted by" value={gig.postedBy} />
        )}
        {gig.salary !== undefined && gig.salary !== null && gig.salary !== "" && (
          <DetailField label="Salary" value={`${symbol}${gig.salary}`} />
        )}
        {gig.vacancy !== undefined && (
          <DetailField label="Vacancies" value={String(gig.vacancy)} icon={<Users size={11} />} />
        )}
        {gig.createdAt && (
          <DetailField
            label="Posted"
            value={gig.createdAt.toDate().toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" })}
            icon={<Calendar size={11} />}
          />
        )}
        <DetailField
          label="Coordinates"
          value={`${gig.lat.toFixed(5)}, ${gig.lng.toFixed(5)}`}
          icon={<MapPin size={11} />}
        />
        <CopyableIdField label="Gig ID" value={displayId} />
      </div>
    </Modal>
  );
}

function DetailField({ label, value, icon, mono }: { label: string; value: string; icon?: React.ReactNode; mono?: boolean }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
      <span style={{ fontSize: 10, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.04em", fontWeight: 600 }}>
        {label}
      </span>
      <span style={{
        fontSize: 13, color: "var(--text-primary)", display: "flex", alignItems: "center", gap: 4,
        fontFamily: mono ? "'Space Mono', monospace" : undefined,
        wordBreak: mono ? "break-all" : undefined,
      }}>
        {icon}
        {value}
      </span>
    </div>
  );
}

function CopyableIdField({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
      <span style={{ fontSize: 10, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.04em", fontWeight: 600 }}>
        {label}
      </span>
      <span style={{
        fontSize: 13, color: "var(--text-primary)", display: "flex", alignItems: "center", gap: 5,
        fontFamily: "'Space Mono', monospace", wordBreak: "break-all",
      }}>
        <Tag size={11} style={{ flexShrink: 0, color: "var(--text-muted)" }} />
        {value}
        <button
          onClick={() => {
            navigator.clipboard.writeText(value);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
          title={copied ? "Copied!" : "Copy ID"}
          style={{
            display: "flex", alignItems: "center",
            color: copied ? "#10B981" : "var(--text-muted)",
            background: "none", border: "none", cursor: "pointer",
            padding: 2, flexShrink: 0, transition: "color 0.15s",
          }}
        >
          {copied ? <Check size={11} /> : <Copy size={11} />}
        </button>
      </span>
    </div>
  );
}

type Selected =
  | { kind: "gig"; gig: GigMarker }
  | { kind: "user"; user: UserMarker }
  | { kind: "cluster"; position: google.maps.LatLngLiteral; gigs: GigMarker[] };

export default function MapView({
  markers,
  userMarkers = [],
  showGigs = true,
  showUsers = true,
  theme = "dark",
}: {
  markers: GigMarker[];
  userMarkers?: UserMarker[];
  showGigs?: boolean;
  showUsers?: boolean;
  theme?: MapTheme;
}) {
  const pt = POPUP_THEME[theme];
  const [selected, setSelected] = useState<Selected | null>(null);
  const [selectedGig, setSelectedGig] = useState<GigMarker | null>(null);

  useEffect(() => { setSelected(null); }, [theme, showGigs, showUsers]);

  const allMarkersForBounds = useMemo(() => [
    ...markers.map((m) => ({ lat: m.lat, lng: m.lng })),
    ...userMarkers.map((u) => ({ lat: u.lat, lng: u.lng })),
  ], [markers, userMarkers]);

  if (!API_KEY) {
    return (
      <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", padding: 16, textAlign: "center", color: "var(--text-muted)", fontSize: 13 }}>
        Google Maps API key missing — set NEXT_PUBLIC_GOOGLE_MAPS_API_KEY in .env.local and restart the dev server.
      </div>
    );
  }

  const position =
    selected?.kind === "gig" ? { lat: selected.gig.lat, lng: selected.gig.lng }
    : selected?.kind === "user" ? { lat: selected.user.lat, lng: selected.user.lng }
    : selected?.position;

  return (
    <>
      <style>{`
        .gm-style .gm-style-iw-c {
          background: ${pt.bg} !important;
          border: 1px solid ${pt.border};
          border-radius: 10px !important;
          box-shadow: 0 4px 20px rgba(0,0,0,0.25) !important;
          padding: 0 !important;
        }
        .gm-style .gm-style-iw-d { overflow: auto !important; padding: 0 14px 12px; }
        .gm-style .gm-style-iw-chr { height: 28px; }
        .gm-style .gm-style-iw-tc::after { background: ${pt.bg} !important; }
        .gm-style .gm-ui-hover-effect > span { background-color: ${pt.close} !important; }
        .gm-style .gm-ui-hover-effect:hover > span { background-color: ${pt.closeHover} !important; }
        @keyframes user-pulse {
          0%, 100% { transform: scale(1); opacity: 0.25; }
          50% { transform: scale(1.6); opacity: 0; }
        }
      `}</style>
      <APIProvider apiKey={API_KEY}>
        <Map
          // colorScheme is only read on init — remount when the theme flips
          key={theme}
          mapId={MAP_ID}
          defaultCenter={DEFAULT_CENTER}
          defaultZoom={DEFAULT_ZOOM}
          colorScheme={theme === "dark" ? ColorScheme.DARK : ColorScheme.LIGHT}
          gestureHandling="greedy"
          disableDefaultUI
          zoomControl
          clickableIcons={false}
          onClick={() => setSelected(null)}
          style={{ height: "100%", width: "100%" }}
        >
          <FitBounds points={allMarkersForBounds} />

          {showGigs && (
            <ClusteredMarkers
              items={markers}
              theme={theme}
              ringColor="#3B82F6"
              radius={60}
              renderContent={(gig) => <GigDot gigType={gig.gigType} />}
              onItemClick={(gig) => setSelected({ kind: "gig", gig })}
              onClusterClick={(pos, gigs) => {
                setSelected({ kind: "cluster", position: pos, gigs });
                return true;
              }}
            />
          )}

          {showUsers && (
            <ClusteredMarkers
              items={userMarkers}
              theme={theme}
              ringColor="#10B981"
              radius={50}
              renderContent={(user) => <UserDot user={user} />}
              onItemClick={(user) => setSelected({ kind: "user", user })}
            />
          )}

          {selected && position && (
            <InfoWindow
              position={position}
              pixelOffset={[0, selected.kind === "cluster" ? -18 : -12]}
              maxWidth={320}
              onCloseClick={() => setSelected(null)}
            >
              {selected.kind === "gig" && <GigPopup gig={selected.gig} theme={theme} />}
              {selected.kind === "user" && <UserPopup user={selected.user} theme={theme} />}
              {selected.kind === "cluster" && (
                <GigListPopup gigs={selected.gigs} theme={theme} onSelect={setSelectedGig} />
              )}
            </InfoWindow>
          )}
        </Map>
      </APIProvider>

      {selectedGig && (
        <GigDetailModal gig={selectedGig} onClose={() => setSelectedGig(null)} />
      )}
    </>
  );
}
