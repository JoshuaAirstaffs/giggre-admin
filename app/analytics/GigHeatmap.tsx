"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { APIProvider, Map, Polygon, InfoWindow, ColorScheme, useMap } from "@vis.gl/react-google-maps";

export type GigType = "quick" | "open" | "offered";

export interface HeatPoint {
  lat: number;
  lng: number;
  gigType: GigType;
}

export const GIG_COLORS: Record<GigType, string> = {
  quick: "#F59E0B",
  open: "#3B82F6",
  offered: "#8B5CF6",
};

type MapTheme = "dark" | "light";

const API_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? "";

// ─── Map styling ──────────────────────────────────────────────────────────────
// A quiet base map so the gig shapes stand out: no businesses/transit, muted
// roads, and place names only when asked for. Spelled out per theme because a
// `styles` array replaces the built-in dark scheme.

type MapStyle = google.maps.MapTypeStyle[];

const BASE_STYLES: Record<MapTheme, MapStyle> = {
  dark: [
    { elementType: "geometry", stylers: [{ color: "#1a2235" }] },
    { elementType: "labels.text.fill", stylers: [{ color: "#94a3b8" }] },
    { elementType: "labels.text.stroke", stylers: [{ color: "#0a0f1e" }] },
    { featureType: "administrative", elementType: "geometry.stroke", stylers: [{ color: "#334155" }] },
    { featureType: "landscape.natural", elementType: "geometry", stylers: [{ color: "#161e2e" }] },
    { featureType: "road", elementType: "geometry", stylers: [{ color: "#243047" }] },
    { featureType: "road", elementType: "geometry.stroke", stylers: [{ visibility: "off" }] },
    { featureType: "water", elementType: "geometry", stylers: [{ color: "#0a0f1e" }] },
  ],
  light: [
    { elementType: "geometry", stylers: [{ color: "#f1f5f9" }] },
    { elementType: "labels.text.fill", stylers: [{ color: "#475569" }] },
    { elementType: "labels.text.stroke", stylers: [{ color: "#ffffff" }] },
    { featureType: "administrative", elementType: "geometry.stroke", stylers: [{ color: "#cbd5e1" }] },
    { featureType: "road", elementType: "geometry", stylers: [{ color: "#ffffff" }] },
    { featureType: "road", elementType: "geometry.stroke", stylers: [{ visibility: "off" }] },
    { featureType: "water", elementType: "geometry", stylers: [{ color: "#cfdbe8" }] },
  ],
};

const QUIET: MapStyle = [
  { featureType: "poi", stylers: [{ visibility: "off" }] },
  { featureType: "transit", stylers: [{ visibility: "off" }] },
  { featureType: "road", elementType: "labels.icon", stylers: [{ visibility: "off" }] },
];

const NO_LABELS: MapStyle = [{ elementType: "labels", stylers: [{ visibility: "off" }] }];

// Philippines center
const DEFAULT_CENTER = { lat: 12.8797, lng: 121.774 };

// ~2km grid cells — groups nearby gigs; each shape sits at the average position
// of its gigs, not the cell centre, so it lands where the gigs actually are
const CELL_DEG = 0.02;

// Absolute size: a single gig is a small blob, busier areas grow with √count
const MIN_RADIUS_M = 350;
const RADIUS_PER_SQRT_GIG_M = 350;
const MAX_RADIUS_M = 3000;

interface Cell {
  id: string;
  lat: number;
  lng: number;
  gigType: GigType;
  count: number;
}

// Fits the view once, on the first data it sees — later filter changes keep
// whatever pan/zoom the admin is on instead of jumping back out.
// ─── Blob shapes ──────────────────────────────────────────────────────────────
// Each area is drawn as an irregular polygon. The "randomness" is seeded by
// the cell's key, so a given area keeps the same shape across re-renders,
// refreshes and filter changes instead of wobbling every time.

const BLOB_VERTICES = 10;
const METERS_PER_DEG_LAT = 111_320;

function seededRandom(seed: string) {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  };
}

function blobPath(key: string, lat: number, lng: number, radiusM: number) {
  const rand = seededRandom(key);
  const rotation = rand() * Math.PI * 2;
  const dLat = radiusM / METERS_PER_DEG_LAT;
  const dLng = radiusM / (METERS_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180));
  return Array.from({ length: BLOB_VERTICES }, (_, i) => {
    const angle = rotation + (i / BLOB_VERTICES) * Math.PI * 2 + (rand() - 0.5) * 0.4;
    const r = 0.65 + rand() * 0.5; // 65%–115% of the radius
    return { lat: lat + Math.sin(angle) * dLat * r, lng: lng + Math.cos(angle) * dLng * r };
  });
}

function FitToCells({ cells }: { cells: Cell[] }) {
  const map = useMap();
  const fitted = useRef(false);
  useEffect(() => {
    if (!map || fitted.current || cells.length === 0) return;
    fitted.current = true;
    const bounds = new google.maps.LatLngBounds();
    cells.forEach((c) => bounds.extend({ lat: c.lat, lng: c.lng }));
    map.fitBounds(bounds, 30);
    // Don't zoom into street level when every gig sits in one cell
    google.maps.event.addListenerOnce(map, "idle", () => {
      if ((map.getZoom() ?? 0) > 12) map.setZoom(12);
    });
  }, [cells, map]);
  return null;
}

export default function GigHeatmap({
  points,
  theme,
  showLabels = false,
}: {
  points: HeatPoint[];
  theme: MapTheme;
  showLabels?: boolean;
}) {
  const [selected, setSelected] = useState<Cell | null>(null);
  // Filters / date range / refresh can remove the area it points at
  useEffect(() => setSelected(null), [points]);
  const styles = useMemo(
    () => [...BASE_STYLES[theme], ...QUIET, ...(showLabels ? [] : NO_LABELS)],
    [theme, showLabels]
  );

  const cells = useMemo(() => {
    const grid = new globalThis.Map<string, Cell & { sumLat: number; sumLng: number }>();
    for (const p of points) {
      // One cell per type, so overlapping types stay visible in their own color
      const id = `${p.gigType}:${Math.round(p.lat / CELL_DEG)},${Math.round(p.lng / CELL_DEG)}`;
      const cell = grid.get(id);
      if (cell) {
        cell.count++;
        cell.sumLat += p.lat;
        cell.sumLng += p.lng;
      } else {
        grid.set(id, { id, lat: 0, lng: 0, gigType: p.gigType, count: 1, sumLat: p.lat, sumLng: p.lng });
      }
    }
    for (const c of grid.values()) {
      c.lat = c.sumLat / c.count;
      c.lng = c.sumLng / c.count;
    }
    // Biggest first, so small areas (often a single gig) are drawn on top
    // instead of disappearing underneath a busier neighbour
    return [...grid.values()].sort((a, b) => b.count - a.count);
  }, [points]);

  const max = cells.reduce((m, c) => Math.max(m, c.count), 1);

  if (!API_KEY) {
    return (
      <div className="an-empty" style={{ textAlign: "center", padding: 16 }}>
        Google Maps API key missing — set NEXT_PUBLIC_GOOGLE_MAPS_API_KEY in .env.local and restart the dev server.
      </div>
    );
  }

  return (
    <APIProvider apiKey={API_KEY}>
      <Map
        // colorScheme is only read on init — remount when the theme flips
        key={theme}
        defaultCenter={DEFAULT_CENTER}
        defaultZoom={6}
        colorScheme={theme === "dark" ? ColorScheme.DARK : ColorScheme.LIGHT}
        styles={styles}
        gestureHandling="cooperative"
        onClick={() => setSelected(null)}
        disableDefaultUI
        zoomControl
        style={{ height: "100%", width: "100%", borderRadius: "var(--radius-md)", overflow: "hidden" }}
      >
        <FitToCells cells={cells} />
        {cells.map((c) => {
          const t = c.count / max;
          const radius = Math.min(MAX_RADIUS_M, Math.max(MIN_RADIUS_M, RADIUS_PER_SQRT_GIG_M * Math.sqrt(c.count)));
          return (
            <Polygon
              key={c.id}
              paths={[blobPath(c.id, c.lat, c.lng, radius)]}
              strokeColor={GIG_COLORS[c.gigType]}
              strokeWeight={1}
              fillColor={GIG_COLORS[c.gigType]}
              fillOpacity={0.25 + t * 0.5}
              onClick={() => setSelected((prev) => (prev?.id === c.id ? null : c))}
            />
          );
        })}
        {selected && (
          <InfoWindow
            position={{ lat: selected.lat, lng: selected.lng }}
            onCloseClick={() => setSelected(null)}
            headerContent={
              <span style={{ color: "#0F172A", fontSize: 13, fontWeight: 600 }}>
                {selected.count} {selected.gigType} gig{selected.count === 1 ? "" : "s"}
              </span>
            }
          />
        )}
      </Map>
    </APIProvider>
  );
}
