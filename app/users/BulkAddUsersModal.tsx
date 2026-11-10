"use client";

// TEMPORARY — bulk-creates test app users. Remove once no longer needed.

import { useState } from "react";
import { Plus, Shuffle, Trash2, CheckCircle, AlertTriangle, Loader2, Download } from "lucide-react";
import Modal from "@/components/ui/Modal";
import Button from "@/components/ui/Button";
import { auth } from "@/lib/firebase";
import { readApiJson } from "@/lib/apiResponse";
import { downloadXlsx } from "@/lib/xlsx";

const DEFAULT_PASSWORD = "Giggreus@2026";
const EMAIL_DOMAIN = "gmail.com";

// Random points are picked within ~2.5 km of inland anchor points in US
// cities (not a raw bounding box). Each anchor was checked against the US
// shoreline map (us-atlas, Census boundaries) with a 3 km margin beyond the
// jitter radius, and placed away from harbors, bays and wide rivers — so a
// point never lands in the ocean, the Great Lakes, Canada or Mexico.
const US_CITIES: [number, number, string][] = [ // lat, lng, local area code
  [40.7282, -73.7949, "718"],  // Queens, NY (Fresh Meadows)
  [34.0522, -118.2437, "213"], // Los Angeles, CA
  [41.891, -87.6947, "312"],   // Chicago, IL (West Town)
  [29.7604, -95.3698, "713"],  // Houston, TX
  [33.4484, -112.074, "602"],  // Phoenix, AZ
  [40.04, -75.13, "215"],      // Philadelphia, PA (Olney)
  [29.4241, -98.4936, "210"],  // San Antonio, TX
  [32.7767, -117.0717, "619"], // San Diego, CA (College Area)
  [32.82, -96.79, "214"],      // Dallas, TX
  [37.3382, -121.8863, "408"], // San Jose, CA
  [30.31, -97.74, "512"],      // Austin, TX (Hyde Park)
  [30.3, -81.75, "904"],       // Jacksonville, FL (Westside)
  [39.99, -82.95, "614"],      // Columbus, OH
  [35.2271, -80.8431, "704"],  // Charlotte, NC
  [38.5816, -121.4944, "916"], // Sacramento, CA
  [39.7684, -86.1581, "317"],  // Indianapolis, IN
  [47.6588, -117.426, "509"],  // Spokane, WA
  [39.7392, -104.9903, "303"], // Denver, CO
  [38.94, -77.02, "202"],      // Washington, DC (Petworth)
  [42.39, -71.12, "617"],      // Somerville, MA
  [36.13, -86.82, "615"],      // Nashville, TN
  [45.52, -122.58, "503"],     // Portland, OR (Mt Tabor)
  [36.1699, -115.1398, "702"], // Las Vegas, NV
  [42.3814, -83.0458, "313"],  // Detroit, MI
  [33.749, -84.388, "404"],    // Atlanta, GA
  [25.79, -80.3, "305"],       // Miami, FL (Doral)
  [41.26, -96.05, "402"],      // Omaha, NE
  [29.975, -90.1, "504"],      // New Orleans, LA (Mid-City)
  [40.7608, -111.891, "801"],  // Salt Lake City, UT
  [21.3423, -157.8204, "808"], // Honolulu, HI (Manoa)
  [61.1931, -149.8104, "907"], // Anchorage, AK
];
const JITTER_DEG = 0.025; // max offset from the anchor (≈2.5 km)

// Phone matches the app's format (+1 then 10 digits, area code and exchange
// starting 2-9), using the area code of the same city as the location.
const US_PHONE = /^\+1[2-9]\d{2}[2-9]\d{6}$/;

function randomUsContact(): { lat: string; lng: string; phone: string } {
  const [lat, lng, areaCode] = US_CITIES[Math.floor(Math.random() * US_CITIES.length)];
  // Uniform point in a circle (longitude scaled so it's a circle, not an oval).
  const r = JITTER_DEG * Math.sqrt(Math.random());
  const th = Math.random() * 2 * Math.PI;
  const dLat = r * Math.sin(th);
  const dLng = (r * Math.cos(th)) / Math.cos((lat * Math.PI) / 180);
  // 555-0100…0199 is reserved for fictional use, so it never reaches a real person.
  const line = 100 + Math.floor(Math.random() * 100);
  return {
    lat: (lat + dLat).toFixed(6),
    lng: (lng + dLng).toFixed(6),
    phone: `+1${areaCode}5550${line}`,
  };
}

/** "Iker Rosa" → "iker.rosa@gmail.com"; "Juan dela Cruz" → "juan.delacruz@gmail.com" */
function emailFromName(name: string): string {
  const parts = name
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .split(/\s+/)
    .map((p) => p.replace(/[^a-z0-9]/g, ""))
    .filter(Boolean);
  if (parts.length === 0) return "";
  const local = parts.length === 1 ? parts[0] : `${parts[0]}.${parts.slice(1).join("")}`;
  return `${local}@${EMAIL_DOMAIN}`;
}

type RowStatus = { state: "idle" } | { state: "saving" } | { state: "done" } | { state: "error"; message: string };

interface Row {
  key: number;
  name: string;
  email: string;
  emailEdited: boolean;
  password: string;
  phone: string;
  lat: string;
  lng: string;
  status: RowStatus;
}

let nextKey = 1;
function newRow(name = ""): Row {
  return {
    key: nextKey++,
    name,
    email: emailFromName(name),
    emailEdited: false,
    password: DEFAULT_PASSWORD,
    ...randomUsContact(),
    status: { state: "idle" },
  };
}

export default function BulkAddUsersModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [rows, setRows] = useState<Row[]>(() => [newRow()]);
  const [paste, setPaste] = useState("");
  const [running, setRunning] = useState(false);

  const update = (key: number, patch: Partial<Row>) =>
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  const setName = (key: number, name: string) =>
    setRows((rs) => rs.map((r) => (r.key !== key ? r : {
      ...r, name, email: r.emailEdited ? r.email : emailFromName(name), status: { state: "idle" },
    })));

  const addPasted = () => {
    const names = paste.split(/[\n,]/).map((n) => n.trim()).filter(Boolean);
    if (names.length === 0) return;
    setRows((rs) => [...rs.filter((r) => r.name.trim() || r.status.state === "done"), ...names.map((n) => newRow(n))]);
    setPaste("");
  };

  const pending = rows.filter((r) => r.name.trim() && r.status.state !== "done");
  const doneCount = rows.filter((r) => r.status.state === "done").length;

  const createAll = async () => {
    setRunning(true);
    try {
      const token = await auth.currentUser?.getIdToken();
      if (!token) return;
      // Sequential so a duplicate email only fails its own row.
      for (const r of pending) {
        const lat = Number(r.lat), lng = Number(r.lng);
        if (!r.email.trim() || r.password.length < 6) {
          update(r.key, { status: { state: "error", message: "Email and a 6+ character password are required." } });
          continue;
        }
        if (r.phone.trim() && !US_PHONE.test(r.phone.replace(/[\s()-]/g, ""))) {
          update(r.key, { status: { state: "error", message: "Phone must be a US number like +12125551234." } });
          continue;
        }
        if (!r.lat.trim() || !r.lng.trim() || !Number.isFinite(lat) || !Number.isFinite(lng)) {
          update(r.key, { status: { state: "error", message: "Invalid latitude/longitude." } });
          continue;
        }
        update(r.key, { status: { state: "saving" } });
        try {
          const res = await fetch("/api/admin/create-app-user", {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
            body: JSON.stringify({
              name: r.name.trim(),
              email: r.email.trim(),
              password: r.password,
              phone: r.phone.replace(/[\s()-]/g, ""),
              role: "user",
              location: { lat, lng },
            }),
          });
          const data = await readApiJson(res);
          update(r.key, { status: res.ok ? { state: "done" } : { state: "error", message: data.error ?? "Failed to create user." } });
        } catch (err: any) {
          update(r.key, { status: { state: "error", message: err.message ?? "Unexpected error." } });
        }
      }
    } finally {
      setRunning(false);
    }
  };

  const named = rows.filter((r) => r.name.trim());

  const exportExcel = () => {
    const pad = (n: number) => String(n).padStart(2, "0");
    const d = new Date();
    const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
    const statusText = (st: RowStatus) =>
      st.state === "done" ? "Created" : st.state === "error" ? `Error: ${st.message}` : st.state === "saving" ? "Saving" : "Not created";
    return downloadXlsx(
      `giggre-users-${stamp}.xlsx`,
      "Users",
      ["Name", "Email", "Password", "Phone", "Latitude", "Longitude", "Status"],
      named.map((r) => [
        r.name.trim(), r.email.trim(), r.password, r.phone.replace(/[\s()-]/g, ""),
        Number(r.lat), Number(r.lng), statusText(r.status),
      ]),
    );
  };

  const close = () => {
    if (running) return;
    setRows([newRow()]);
    setPaste("");
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={close}
      title="Add Users"
      description={`Temporary bulk tool. Email defaults to first.last@${EMAIL_DOMAIN}, password to ${DEFAULT_PASSWORD}, and phone + location to a random US city. Location changes only via the shuffle button.`}
      size="xl"
      bodyStyle={{ minHeight: "55vh" }}
      footer={
        <>
          <div className="bau-foot-left">
            <Button variant="ghost" size="sm" icon={Download} onClick={exportExcel} disabled={running || named.length === 0}>
              Export Excel
            </Button>
            {doneCount > 0 && <span className="bau-summary">{doneCount} created</span>}
          </div>
          <Button variant="ghost" size="sm" onClick={close} disabled={running}>{doneCount > 0 ? "Done" : "Cancel"}</Button>
          <Button variant="primary" size="sm" loading={running} disabled={pending.length === 0} onClick={createAll}>
            Create {pending.length || ""} user{pending.length === 1 ? "" : "s"}
          </Button>
        </>
      }
    >
      <style>{`
        .bau-paste { display: flex; gap: 8px; margin-bottom: 14px; align-items: stretch; }
        .bau-paste textarea { flex: 1; min-height: 38px; resize: vertical; }
        .bau-input { padding: 7px 9px; border-radius: var(--radius-sm); border: 1px solid var(--border); background: var(--bg-elevated); color: var(--text-primary); font-size: 12.5px; font-family: inherit; outline: none; width: 100%; box-sizing: border-box; min-width: 0; }
        .bau-input:focus { border-color: var(--blue); }
        .bau-input:disabled { opacity: 0.6; }
        .bau-input[readonly] { background: transparent; color: var(--text-secondary); cursor: default; }
        .bau-input[readonly]:focus { border-color: var(--border); }
        .bau-mono { font-family: 'Space Mono', monospace; font-size: 11.5px; }
        .bau-head, .bau-row { display: grid; grid-template-columns: 1.2fr 1.5fr 1fr 1fr 0.8fr 0.8fr auto; gap: 6px; align-items: center; }
        .bau-head { font-size: 11px; font-weight: 600; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.04em; padding: 0 2px 6px; }
        .bau-row { padding: 4px 0; }
        .bau-actions { display: flex; gap: 2px; align-items: center; }
        .bau-icon { background: none; border: none; color: var(--text-muted); cursor: pointer; padding: 5px; display: flex; border-radius: 6px; }
        .bau-icon:hover:not(:disabled) { color: var(--text-primary); background: var(--bg-elevated); }
        .bau-icon:disabled { cursor: default; opacity: 0.4; }
        .bau-msg { grid-column: 1 / -1; font-size: 11.5px; color: var(--red); display: flex; gap: 5px; align-items: center; margin-top: -1px; }
        .bau-ok { color: var(--green); }
        .bau-add { margin-top: 8px; display: inline-flex; gap: 6px; align-items: center; background: none; border: 1px dashed var(--border); color: var(--text-secondary); font-size: 12px; padding: 6px 10px; border-radius: var(--radius-sm); cursor: pointer; }
        .bau-add:hover { color: var(--text-primary); border-color: var(--blue); }
        .bau-foot-left { margin-right: auto; display: flex; align-items: center; gap: 10px; }
        .bau-summary { font-size: 12px; color: var(--green); }
        .bau-spin { animation: bau-spin 0.8s linear infinite; }
        @keyframes bau-spin { to { transform: rotate(360deg); } }
        @media (max-width: 640px) {
          .bau-head { display: none; }
          .bau-row { grid-template-columns: 1fr 1fr; border-bottom: 1px solid var(--border); padding: 8px 0; }
        }
      `}</style>

      <div className="bau-paste">
        <textarea
          className="bau-input"
          placeholder="Paste names, one per line or comma-separated (e.g. Iker Rosa, Jane Doe)"
          value={paste}
          onChange={(e) => setPaste(e.target.value)}
          disabled={running}
        />
        <Button variant="ghost" size="sm" onClick={addPasted} disabled={running || !paste.trim()}>Add names</Button>
      </div>

      <div className="bau-head">
        <span>Name</span><span>Email</span><span>Password</span><span>Phone</span><span>Latitude</span><span>Longitude</span><span />
      </div>

      {rows.map((r) => {
        const locked = running || r.status.state === "done" || r.status.state === "saving";
        return (
          <div key={r.key} className="bau-row">
            <input className="bau-input" placeholder="Full name" value={r.name} disabled={locked}
              onChange={(e) => setName(r.key, e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && r.name.trim()) setRows((rs) => [...rs, newRow()]); }} />
            <input className="bau-input" type="email" placeholder="first.last@gmail.com" value={r.email} disabled={locked}
              onChange={(e) => update(r.key, { email: e.target.value, emailEdited: e.target.value !== "", status: { state: "idle" } })} />
            <input className="bau-input" value={r.password} disabled={locked}
              onChange={(e) => update(r.key, { password: e.target.value, status: { state: "idle" } })} />
            <input className="bau-input bau-mono" value={r.phone} placeholder="+1…" disabled={locked}
              onChange={(e) => update(r.key, { phone: e.target.value, status: { state: "idle" } })} />
            <input className="bau-input bau-mono" value={r.lat} readOnly tabIndex={-1} title="Use the shuffle button to pick a new location" />
            <input className="bau-input bau-mono" value={r.lng} readOnly tabIndex={-1} title="Use the shuffle button to pick a new location" />
            <div className="bau-actions">
              {r.status.state === "saving" ? (
                <span className="bau-icon"><Loader2 size={15} className="bau-spin" /></span>
              ) : r.status.state === "done" ? (
                <span className="bau-icon bau-ok" title="Created"><CheckCircle size={15} /></span>
              ) : (
                <>
                  <button className="bau-icon" title="New random US location" disabled={locked}
                    onClick={() => update(r.key, { ...randomUsContact(), status: { state: "idle" } })}>
                    <Shuffle size={14} />
                  </button>
                  <button className="bau-icon" title="Remove row" disabled={locked || rows.length === 1}
                    onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))}>
                    <Trash2 size={14} />
                  </button>
                </>
              )}
            </div>
            {r.status.state === "error" && (
              <div className="bau-msg"><AlertTriangle size={12} /> {r.status.message}</div>
            )}
          </div>
        );
      })}

      <button className="bau-add" onClick={() => setRows((rs) => [...rs, newRow()])} disabled={running}>
        <Plus size={13} /> Add row
      </button>
    </Modal>
  );
}
