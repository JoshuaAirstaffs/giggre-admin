"use client";

import { useEffect, useMemo, useState } from "react";
import { MapContainer, TileLayer, Marker, Popup, useMap } from "react-leaflet";
import MarkerClusterGroup from "react-leaflet-cluster";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "react-leaflet-cluster/dist/assets/MarkerCluster.css";
import "react-leaflet-cluster/dist/assets/MarkerCluster.Default.css";
import { Timestamp } from "firebase/firestore";

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
const DEFAULT_CENTER: [number, number] = [12.8797, 121.774];
const DEFAULT_ZOOM = 6;

// ─── Icon Factories ───────────────────────────────────────────────────────────

function createGigIcon(gigType: GigType): L.DivIcon {
  const color = GIG_COLORS[gigType];
  return L.divIcon({
    html: `<div style="
      width:14px;height:14px;border-radius:50%;
      background:${color};border:2.5px solid rgba(255,255,255,0.9);
      box-shadow:0 1px 6px rgba(0,0,0,0.5);
    "></div>`,
    className: "",
    iconSize: [14, 14],
    iconAnchor: [7, 7],
    popupAnchor: [0, -12],
  });
}

function createUserIcon(isOnline: boolean, isBanned?: boolean, isSuspended?: boolean): L.DivIcon {
  const color = isBanned ? "#EF4444" : isSuspended ? "#F59E0B" : isOnline ? "#10B981" : "#64748B";
  const pulse = isOnline && !isBanned && !isSuspended;
  return L.divIcon({
    html: `<div style="position:relative;width:20px;height:20px;">
      ${pulse ? `<div style="
        position:absolute;inset:-4px;border-radius:50%;
        background:${color};opacity:0.25;
        animation:user-pulse 1.8s ease-in-out infinite;
      "></div>` : ""}
      <div style="
        position:relative;width:20px;height:20px;border-radius:50%;
        background:${color};border:2.5px solid rgba(255,255,255,0.9);
        box-shadow:0 1px 8px rgba(0,0,0,0.5);
        display:flex;align-items:center;justify-content:center;
      ">
        <svg width="10" height="10" viewBox="0 0 24 24" fill="white" xmlns="http://www.w3.org/2000/svg">
          <path d="M12 12c2.7 0 4.8-2.1 4.8-4.8S14.7 2.4 12 2.4 7.2 4.5 7.2 7.2 9.3 12 12 12zm0 2.4c-3.2 0-9.6 1.6-9.6 4.8v2.4h19.2v-2.4c0-3.2-6.4-4.8-9.6-4.8z"/>
        </svg>
      </div>
    </div>`,
    className: "",
    iconSize: [20, 20],
    iconAnchor: [10, 10],
    popupAnchor: [0, -14],
  });
}


// ─── Fit Bounds Helper ────────────────────────────────────────────────────────

function FitBounds({ points }: { points: { lat: number; lng: number }[] }) {
  const map = useMap();
  useEffect(() => {
    if (points.length === 0) return;
    const bounds = L.latLngBounds(points.map((p) => [p.lat, p.lng]));
    map.fitBounds(bounds, { padding: [48, 48], maxZoom: 13 });
  // Only fit on initial load
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [points.length > 0 ? "has-points" : "no-points"]);
  return null;
}

// ─── Popup Content ────────────────────────────────────────────────────────────

function GigPopup({ gig, theme }: { gig: GigMarker; theme: MapTheme }) {
  const color = GIG_COLORS[gig.gigType];
  const isAvailable = gig.status?.toLowerCase() === "available";
  const pt = POPUP_THEME[theme];

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
          <PopupRow label="Salary" labelColor={pt.label} valueColor={pt.value}>₱{gig.salary}</PopupRow>
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

const TILE_URLS: Record<MapTheme, string> = {
  dark:  "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
  light: "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
};

const MAP_BG: Record<MapTheme, string> = {
  dark:  "#0A0F1E",
  light: "#e8e8e8",
};

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

function GigListPopup({ gigs, theme }: { gigs: GigMarker[]; theme: MapTheme }) {
  const pt = POPUP_THEME[theme];
  return (
    <div style={{ fontFamily: "DM Sans, sans-serif", minWidth: 220 }}>
      <div style={{
        fontSize: 11, fontWeight: 700, color: pt.label,
        textTransform: "uppercase", letterSpacing: "0.06em",
        marginBottom: 8, paddingBottom: 6,
        borderBottom: `1px solid ${pt.border}`,
      }}>
        {gigs.length} Gig{gigs.length !== 1 ? "s" : ""} in this area
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 280, overflowY: "auto" }}>
        {gigs.map((gig) => {
          const color = GIG_COLORS[gig.gigType];
          const isAvailable = gig.status?.toLowerCase() === "available";
          return (
            <div key={gig.id} style={{
              padding: "7px 8px", borderRadius: 8,
              background: pt.itemBg,
              border: `1px solid ${pt.border}`,
            }}>
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
                  <span style={{ fontSize: 10, color: pt.value }}>₱{gig.salary}</span>
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

function createClusterIconThemed(cluster: any, theme: MapTheme): L.DivIcon { // eslint-disable-line @typescript-eslint/no-explicit-any
  const count = cluster.getChildCount();
  const size = count < 10 ? 34 : count < 100 ? 40 : 46;
  const isDark = theme === "dark";
  return L.divIcon({
    html: `<div style="
      width:${size}px;height:${size}px;border-radius:50%;
      background:${isDark ? "#111827" : "#ffffff"};border:2px solid #3B82F6;
      display:flex;align-items:center;justify-content:center;
      color:${isDark ? "#F1F5F9" : "#1e293b"};font-family:'Space Mono',monospace;
      font-size:11px;font-weight:700;
      box-shadow:0 2px 8px rgba(0,0,0,${isDark ? "0.5" : "0.2"});
    ">${count}</div>`,
    className: "",
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

interface ClusterPopupState {
  position: [number, number];
  gigs: GigMarker[];
}

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
  const memoMarkers = useMemo(() => markers, [markers]);
  const memoUsers = useMemo(() => userMarkers, [userMarkers]);
  const pt = POPUP_THEME[theme];
  const [clusterPopup, setClusterPopup] = useState<ClusterPopupState | null>(null);

  useEffect(() => { setClusterPopup(null); }, [theme]);

  const allMarkersForBounds = useMemo(() => {
    const gigPoints = memoMarkers.map((m) => ({ lat: m.lat, lng: m.lng }));
    const userPoints = memoUsers.map((u) => ({ lat: u.lat, lng: u.lng }));
    return [...gigPoints, ...userPoints];
  }, [memoMarkers, memoUsers]);

  function handleClusterClick(e: any) { // eslint-disable-line @typescript-eslint/no-explicit-any
    const childMarkers: L.Marker[] = e.layer.getAllChildMarkers();
    const latlng: L.LatLng = e.layer.getLatLng();
    const clusterGigs = childMarkers
      .map((m) => {
        const pos = m.getLatLng();
        return memoMarkers.find(
          (g) => Math.abs(g.lat - pos.lat) < 0.00001 && Math.abs(g.lng - pos.lng) < 0.00001
        );
      })
      .filter(Boolean) as GigMarker[];
    setClusterPopup({ position: [latlng.lat, latlng.lng], gigs: clusterGigs });
  }

  return (
    <>
      <style>{`
        .leaflet-popup-content-wrapper {
          background: ${pt.bg} !important;
          border: 1px solid ${pt.border} !important;
          border-radius: 10px !important;
          box-shadow: 0 4px 20px rgba(0,0,0,0.25) !important;
          color: ${pt.title} !important;
          padding: 0 !important;
        }
        .leaflet-popup-content {
          margin: 12px 14px !important;
        }
        .leaflet-popup-tip {
          background: ${pt.bg} !important;
        }
        .leaflet-popup-close-button {
          color: ${pt.close} !important;
          font-size: 16px !important;
        }
        .leaflet-popup-close-button:hover {
          color: ${pt.closeHover} !important;
        }
        .marker-cluster-small,
        .marker-cluster-medium,
        .marker-cluster-large {
          background: transparent !important;
        }
        .marker-cluster-small div,
        .marker-cluster-medium div,
        .marker-cluster-large div {
          background: transparent !important;
        }
        .leaflet-container {
          font-family: 'DM Sans', sans-serif;
        }
        .leaflet-tile {
          margin-right: -1px;
          margin-bottom: -1px;
        }
        @keyframes user-pulse {
          0%, 100% { transform: scale(1); opacity: 0.25; }
          50% { transform: scale(1.6); opacity: 0; }
        }
      `}</style>
      <MapContainer
        center={DEFAULT_CENTER}
        zoom={DEFAULT_ZOOM}
        style={{ height: "100%", width: "100%", background: MAP_BG[theme] }}
        zoomControl={true}
      >
        <TileLayer
          url={TILE_URLS[theme]}
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
          subdomains="abcd"
          maxZoom={20}
          tileSize={512}
          zoomOffset={-1}
          detectRetina
        />

        {allMarkersForBounds.length > 0 && (
          <FitBounds points={allMarkersForBounds} />
        )}

        {/* Gig markers cluster */}
        {showGigs && (
          <MarkerClusterGroup
            key={`gigs-${theme}`}
            chunkedLoading
            iconCreateFunction={(cluster: any) => createClusterIconThemed(cluster, theme)} // eslint-disable-line @typescript-eslint/no-explicit-any
            maxClusterRadius={50}
            zoomToBoundsOnClick={false}
            spiderfyOnMaxZoom={false}
            showCoverageOnHover={false}
            eventHandlers={{ clusterclick: handleClusterClick }}
          >
            {memoMarkers.map((gig) => (
              <Marker
                key={gig.id}
                position={[gig.lat, gig.lng]}
                icon={createGigIcon(gig.gigType)}
              >
                <Popup>
                  <GigPopup gig={gig} theme={theme} />
                </Popup>
              </Marker>
            ))}
          </MarkerClusterGroup>
        )}

        {/* User markers cluster */}
        {showUsers && (
          <MarkerClusterGroup
            key={`users-${theme}`}
            chunkedLoading
            iconCreateFunction={(cluster: any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
              const count = cluster.getChildCount();
              const size = count < 10 ? 34 : count < 100 ? 40 : 46;
              const isDark = theme === "dark";
              return L.divIcon({
                html: `<div style="
                  width:${size}px;height:${size}px;border-radius:50%;
                  background:${isDark ? "#111827" : "#ffffff"};border:2px solid #10B981;
                  display:flex;align-items:center;justify-content:center;
                  color:${isDark ? "#F1F5F9" : "#1e293b"};font-family:'Space Mono',monospace;
                  font-size:11px;font-weight:700;
                  box-shadow:0 2px 8px rgba(0,0,0,${isDark ? "0.5" : "0.2"});
                ">${count}</div>`,
                className: "",
                iconSize: [size, size],
                iconAnchor: [size / 2, size / 2],
              });
            }}
            maxClusterRadius={40}
            zoomToBoundsOnClick={true}
            spiderfyOnMaxZoom={true}
            showCoverageOnHover={false}
          >
            {memoUsers.map((user) => (
              <Marker
                key={user.id}
                position={[user.lat, user.lng]}
                icon={createUserIcon(user.isOnline, user.isBanned, user.isSuspended)}
              >
                <Popup>
                  <UserPopup user={user} theme={theme} />
                </Popup>
              </Marker>
            ))}
          </MarkerClusterGroup>
        )}

        {clusterPopup && (
          <Popup
            position={clusterPopup.position}
            eventHandlers={{ remove: () => setClusterPopup(null) }}
            maxWidth={320}
          >
            <GigListPopup gigs={clusterPopup.gigs} theme={theme} />
          </Popup>
        )}
      </MapContainer>
    </>
  );
}
