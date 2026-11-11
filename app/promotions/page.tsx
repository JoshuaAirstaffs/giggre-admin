"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { Copy, Globe, Lock, Pause, Pencil, Play, Plus, Send, Shuffle, Trash2, UserCheck, UserPlus, Users, X } from "lucide-react";
import AdminLayout from "@/components/layout/AdminLayout";
import Button from "@/components/ui/Button";
import Modal, { ConfirmDialog } from "@/components/ui/Modal";
import { toast } from "@/components/ui/Toaster";
import { useAuthGuard } from "@/hooks/useAuthGuard";
import { callableError } from "@/lib/gigPoints";
import { GP_STYLES } from "../gig-points/styles";
import {
  ACCESS_HINT, ACCESS_LABEL, createRestrictedCodes, findPromoUser, sendPromoToGroup,
  type PromoAccess, type PromoUser,
  audienceText, deletePromoCode, fetchRedemptions, fetchVouchers, fmtMoney, promoStatus, randomCode, rewardText,
  savePromoCode, setPromoActive, TYPE_LABEL, watchPromoCodes,
  type PerCcy, type PromoAudience, type PromoCode, type PromoInput, type PromoRedemption, type PromoStatus,
  type PromoType, type PromoVoucher,
} from "@/lib/promos";

// Promotions — promo codes users redeem in the app / website (Profile →
// Promo code). Three kinds: Gig Points, Gig Wallet credit, and a cashback
// voucher paid on the host's next completed gig. Access levels: public
// (anyone — shared on social media / the website), private (a targeted group — "Send
// to group" delivers it), restricted (single-use, one per chosen user). Server side:
// giggre_app functions/src/promos.ts.

const STATUS_LABEL: Record<PromoStatus, string> = {
  active: "Active", paused: "Paused", scheduled: "Scheduled", expired: "Expired", used_up: "Fully redeemed",
};
const STATUS_COLOR: Record<PromoStatus, string> = {
  active: "var(--green, #22c55e)", paused: "var(--text-muted)", scheduled: "var(--blue)",
  expired: "var(--red)", used_up: "var(--amber, #f59e0b)",
};

const fmtDate = (d: Date | null) =>
  d ? d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : null;

function PromotionsPage() {
  const { user } = useAuthGuard({ module: "promotions" });
  const [codes, setCodes] = useState<PromoCode[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | PromoStatus>("all");
  const [accessFilter, setAccessFilter] = useState<"all" | PromoAccess>("all");
  const [restrictedOpen, setRestrictedOpen] = useState(false);
  const [sending, setSending] = useState<PromoCode | null>(null);
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<PromoCode | "new" | null>(null);
  const [viewing, setViewing] = useState<PromoCode | null>(null);
  const [deleting, setDeleting] = useState<PromoCode | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => watchPromoCodes(
    (c) => { setCodes(c); setLoadError(null); },
    (e) => setLoadError(e.code === "permission-denied"
      ? "Firestore rules don't allow Promotions yet — deploy firestore.rules from giggre_app."
      : `Couldn't load promo codes (${e.code ?? "error"}).`),
  ), []);

  const list = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (codes ?? []).filter((c) =>
      (filter === "all" || promoStatus(c) === filter) &&
      (accessFilter === "all" || c.access === accessFilter) &&
      (!q || `${c.code} ${c.name} ${c.description} ${c.assignedName ?? ""} ${c.assignedUserId ?? ""}`.toLowerCase().includes(q)));
  }, [codes, filter, accessFilter, search]);

  const stats = useMemo(() => {
    const all = codes ?? [];
    return {
      active: all.filter((c) => promoStatus(c) === "active").length,
      redemptions: all.reduce((n, c) => n + c.redemptionCount, 0),
      total: all.length,
    };
  }, [codes]);

  const toggle = async (c: PromoCode) => {
    setBusy(c.code);
    try {
      await setPromoActive({ code: c.code, active: !c.active });
      toast.success(c.active ? `${c.code} paused` : `${c.code} resumed`);
    } catch (e) {
      toast.error("Couldn't update", callableError(e));
    } finally {
      setBusy(null);
    }
  };

  const send = async () => {
    if (!sending) return;
    setBusy(sending.code);
    try {
      const r = await sendPromoToGroup({ code: sending.code });
      toast.success(`Sent to ${r.sent.toLocaleString("en-US")} user${r.sent === 1 ? "" : "s"}`,
        r.matched > r.sent ? `${r.matched - r.sent} already had it.` : undefined);
      setSending(null);
    } catch (e) {
      toast.error("Couldn't send", callableError(e));
    } finally {
      setBusy(null);
    }
  };

  const remove = async () => {
    if (!deleting) return;
    setBusy(deleting.code);
    try {
      await deletePromoCode({ code: deleting.code });
      toast.success(`${deleting.code} deleted`);
      setDeleting(null);
    } catch (e) {
      toast.error("Couldn't delete", callableError(e));
    } finally {
      setBusy(null);
    }
  };

  if (!user) return null;

  return (
    <AdminLayout
      title="Promotions"
      subtitle="Promo codes users redeem in the app and website — Gig Points, Gig Wallet credit or gig cashback"
      actions={
        <div style={{ display: "flex", gap: 8 }}>
          <Button size="sm" variant="secondary" icon={UserPlus} onClick={() => setRestrictedOpen(true)}>Restricted codes</Button>
          <Button size="sm" icon={Plus} onClick={() => setEditing("new")}>New promo code</Button>
        </div>
      }
    >
      <style>{GP_STYLES + `
        .pr-stats { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; margin-bottom: 14px; }
        @media (max-width: 700px) { .pr-stats { grid-template-columns: 1fr; } }
        .pr-stat-v { font-size: 22px; font-weight: 700; color: var(--text-primary); }
        .pr-code { font-family: monospace; font-weight: 700; font-size: 13px; color: var(--text-primary); display: inline-flex; align-items: center; gap: 6px; }
        .pr-copy { background: none; border: none; color: var(--text-muted); cursor: pointer; padding: 2px; display: inline-flex; }
        .pr-copy:hover { color: var(--text-primary); }
        .pr-status { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; font-weight: 600; white-space: nowrap; }
        .pr-dot { width: 7px; height: 7px; border-radius: 50%; }
        .pr-icon { background: none; border: none; color: var(--text-muted); cursor: pointer; padding: 5px; border-radius: 6px; display: inline-flex; }
        .pr-icon:hover { color: var(--text-primary); background: var(--bg-hover); }
        .pr-icon:disabled { opacity: .4; cursor: default; }
        .pr-bar { height: 4px; background: var(--bg-elevated); border-radius: 2px; margin-top: 4px; overflow: hidden; width: 90px; }
        .pr-bar > div { height: 100%; background: var(--blue); }
        .pr-access { display: inline-flex; align-items: center; gap: 4px; font-size: 10.5px; font-weight: 700; text-transform: uppercase; letter-spacing: .4px; padding: 2px 7px; border-radius: 999px; border: 1px solid var(--border); color: var(--text-secondary); margin-top: 4px; }
        .pr-access.public { color: var(--green, #22c55e); border-color: color-mix(in srgb, var(--green, #22c55e) 40%, transparent); }
        .pr-access.private { color: var(--blue); border-color: color-mix(in srgb, var(--blue) 40%, transparent); }
        .pr-access.restricted { color: var(--amber, #f59e0b); border-color: color-mix(in srgb, var(--amber, #f59e0b) 40%, transparent); }
        .pr-users { display: flex; flex-wrap: wrap; gap: 6px; }
        .pr-user { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; padding: 4px 6px 4px 10px; border-radius: 999px; background: var(--bg-elevated); border: 1px solid var(--border); color: var(--text-primary); }
      `}</style>

      <div className="pr-stats">
        <div className="gp-card"><div className="gp-sub">Active codes</div><div className="pr-stat-v">{stats.active}</div></div>
        <div className="gp-card"><div className="gp-sub">Total redemptions</div><div className="pr-stat-v">{stats.redemptions.toLocaleString("en-US")}</div></div>
        <div className="gp-card"><div className="gp-sub">All codes</div><div className="pr-stat-v">{stats.total}</div></div>
      </div>

      <div className="gp-card">
        <div className="gp-toolbar" style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          {(["all", "active", "scheduled", "paused", "expired", "used_up"] as const).map((f) => (
            <button key={f} className={`gp-chip ${filter === f ? "active" : ""}`} onClick={() => setFilter(f)}>
              {f === "all" ? "All" : STATUS_LABEL[f]}
            </button>
          ))}
          <span style={{ width: 1, height: 20, background: "var(--border)", margin: "0 4px" }} />
          {(["all", "public", "private", "restricted"] as const).map((f) => (
            <button key={f} className={`gp-chip ${accessFilter === f ? "active" : ""}`} onClick={() => setAccessFilter(f)}>
              {f === "all" ? "Any access" : ACCESS_LABEL[f]}
            </button>
          ))}
          <span style={{ flex: 1 }} />
          <input className="gp-input" style={{ maxWidth: 240 }} placeholder="Search code, name or user…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>

        {loadError ? <div className="gp-empty" style={{ color: "var(--red)" }}>{loadError}</div>
          : codes == null ? <div className="gp-empty">Loading promo codes…</div>
          : list.length === 0 ? (
            <div className="gp-empty">
              {codes.length === 0 ? "No promo codes yet — create your first one." : "No codes match."}
            </div>
          ) : (
            <div className="gp-table-wrap">
              <table className="gp-table">
                <thead>
                  <tr><th>Code</th><th>Reward</th><th>Who</th><th>Valid</th><th>Redeemed</th><th>Status</th><th /></tr>
                </thead>
                <tbody>
                  {list.map((c) => {
                    const st = promoStatus(c);
                    const pct = c.maxRedemptions ? Math.min(100, (c.redemptionCount / c.maxRedemptions) * 100) : 0;
                    return (
                      <tr key={c.code}>
                        <td>
                          <span className="pr-code">
                            {c.code}
                            <button className="pr-copy" title="Copy code" onClick={() => { navigator.clipboard?.writeText(c.code); toast.success("Copied"); }}>
                              <Copy size={12} />
                            </button>
                          </span>
                          <div className="gp-sub">{c.name}</div>
                          <span className={`pr-access ${c.access}`}>
                            {c.access === "public" ? <Globe size={10} /> : c.access === "private" ? <Users size={10} /> : <Lock size={10} />}
                            {ACCESS_LABEL[c.access]}
                          </span>
                        </td>
                        <td>
                          <div style={{ fontSize: 13, color: "var(--text-primary)" }}>{rewardText(c)}</div>
                          <div className="gp-sub">{TYPE_LABEL[c.type]}</div>
                        </td>
                        <td>
                          {c.access === "restricted" ? (
                            <span className="gp-sub" style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                              <UserCheck size={12} /> {c.assignedName ?? "User"}{c.assignedUserId ? ` · ${c.assignedUserId}` : ""}
                            </span>
                          ) : (
                            <span className="gp-sub">{audienceText(c.audience)}</span>
                          )}
                          {c.access === "private" && c.sentCount > 0 && (
                            <div className="gp-sub">Sent to {c.sentCount.toLocaleString("en-US")}</div>
                          )}
                        </td>
                        <td>
                          <span className="gp-sub">
                            {c.startsAt || c.endsAt
                              ? `${fmtDate(c.startsAt) ?? "Now"} → ${fmtDate(c.endsAt) ?? "No end"}`
                              : "Always"}
                          </span>
                        </td>
                        <td>
                          <span style={{ fontSize: 13, color: "var(--text-primary)" }}>
                            {c.redemptionCount.toLocaleString("en-US")}{c.maxRedemptions ? ` / ${c.maxRedemptions.toLocaleString("en-US")}` : ""}
                          </span>
                          {c.maxRedemptions != null && <div className="pr-bar"><div style={{ width: `${pct}%` }} /></div>}
                        </td>
                        <td>
                          <span className="pr-status" style={{ color: STATUS_COLOR[st] }}>
                            <span className="pr-dot" style={{ background: STATUS_COLOR[st] }} />{STATUS_LABEL[st]}
                          </span>
                        </td>
                        <td style={{ whiteSpace: "nowrap", textAlign: "right" }}>
                          {c.access === "private" && (
                            <button className="pr-icon" title="Send to the group (For you + notification)" disabled={busy === c.code || st !== "active"} onClick={() => setSending(c)}>
                              <Send size={15} />
                            </button>
                          )}
                          <button className="pr-icon" title="Redemptions" onClick={() => setViewing(c)}><Users size={15} /></button>
                          <button className="pr-icon" title="Edit" onClick={() => setEditing(c)}><Pencil size={15} /></button>
                          <button className="pr-icon" title={c.active ? "Pause" : "Resume"} disabled={busy === c.code} onClick={() => toggle(c)}>
                            {c.active ? <Pause size={15} /> : <Play size={15} />}
                          </button>
                          <button className="pr-icon" title={c.redemptionCount ? "Has redemptions — pause it instead" : "Delete"}
                            disabled={c.redemptionCount > 0 || busy === c.code} onClick={() => setDeleting(c)}>
                            <Trash2 size={15} />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
      </div>

      {editing && <PromoEditor initial={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
      {restrictedOpen && <PromoEditor initial={null} restricted onClose={() => setRestrictedOpen(false)} />}
      <ConfirmDialog open={!!sending} onClose={() => setSending(null)} onConfirm={send} loading={!!busy}
        title="Send to the group?" confirmLabel="Send"
        message={`Everyone matching ${sending ? audienceText(sending.audience) : ""} gets ${sending?.code ?? ""} in "For you", plus a notification and push. Users who already have it are skipped.`} />
      {viewing && <RedemptionsModal promo={viewing} onClose={() => setViewing(null)} />}
      <ConfirmDialog open={!!deleting} onClose={() => setDeleting(null)} onConfirm={remove} loading={!!busy} danger
        title="Delete promo code?" confirmLabel="Delete" message={`Delete ${deleting?.code ?? ""}? Nobody has redeemed it yet.`} />
    </AdminLayout>
  );
}

// ── Create / edit ────────────────────────────────────────────────────────────

const toInputDate = (d: Date | null) => {
  if (!d) return "";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};
const numOrNull = (s: string) => (s.trim() === "" ? null : Number(s));
const ccyStr = (p: PerCcy | undefined, c: "PHP" | "USD") => (p?.[c] != null ? String(p[c]) : "");

function CcyPair({ label, hint, php, usd, setPhp, setUsd }: {
  label: string; hint?: string; php: string; usd: string; setPhp: (v: string) => void; setUsd: (v: string) => void;
}) {
  return (
    <div>
      <label className="gp-label">{label}</label>
      <div className="gp-row" style={{ gridTemplateColumns: "1fr 1fr" }}>
        <div style={{ position: "relative" }}>
          <input className="gp-input" type="number" min={0} step="0.01" placeholder="₱ (Philippines)" value={php} onChange={(e) => setPhp(e.target.value)} />
        </div>
        <div>
          <input className="gp-input" type="number" min={0} step="0.01" placeholder="$ (US)" value={usd} onChange={(e) => setUsd(e.target.value)} />
        </div>
      </div>
      {hint && <div className="gp-sub" style={{ marginTop: 4 }}>{hint}</div>}
    </div>
  );
}

function PromoEditor({ initial, restricted = false, onClose }: { initial: PromoCode | null; restricted?: boolean; onClose: () => void }) {
  const editing = !!initial;
  // Restricted: making new per-user codes, or editing one of them.
  const isRestricted = restricted || initial?.access === "restricted";
  const [access, setAccess] = useState<PromoAccess>(initial?.access ?? "public");
  const [prefix, setPrefix] = useState("VIP");
  const [note, setNote] = useState("");
  const [users, setUsers] = useState<PromoUser[]>([]);
  const [userQuery, setUserQuery] = useState("");
  const [finding, setFinding] = useState(false);
  const [created, setCreated] = useState<{ uid: string; code: string; name: string }[] | null>(null);
  const r = initial?.reward ?? {};
  const locked = editing && (initial?.redemptionCount ?? 0) > 0;
  const [code, setCode] = useState(initial?.code ?? randomCode());
  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [type, setType] = useState<PromoType>(initial?.type ?? "gig_points");
  const [points, setPoints] = useState(r.points != null ? String(r.points) : "100");
  const [amtPhp, setAmtPhp] = useState(ccyStr(r.amount, "PHP"));
  const [amtUsd, setAmtUsd] = useState(ccyStr(r.amount, "USD"));
  const [mode, setMode] = useState<"percent" | "fixed">(r.cashbackMode ?? "percent");
  const [percent, setPercent] = useState(r.percent != null ? String(r.percent) : "10");
  const [maxPhp, setMaxPhp] = useState(ccyStr(r.maxCashback, "PHP"));
  const [maxUsd, setMaxUsd] = useState(ccyStr(r.maxCashback, "USD"));
  const [minPhp, setMinPhp] = useState(ccyStr(r.minGigAmount, "PHP"));
  const [minUsd, setMinUsd] = useState(ccyStr(r.minGigAmount, "USD"));
  const [voucherDays, setVoucherDays] = useState(r.voucherDays != null ? String(r.voucherDays) : "30");
  const [maxRedemptions, setMaxRedemptions] = useState(initial?.maxRedemptions != null ? String(initial.maxRedemptions) : "");
  const [startsAt, setStartsAt] = useState(toInputDate(initial?.startsAt ?? null));
  const [endsAt, setEndsAt] = useState(toInputDate(initial?.endsAt ?? null));
  const [audience, setAudience] = useState<PromoAudience>(initial?.audience ?? { role: "any", region: "any", verifiedOnly: false, newUserDays: null });
  const [saving, setSaving] = useState(false);

  // Region limits which currency needs a value.
  const needPhp = isRestricted || audience.region !== "US";
  const needUsd = isRestricted || audience.region !== "PH";

  const addUser = async () => {
    const q = userQuery.trim();
    if (!q) return;
    setFinding(true);
    try {
      const u = await findPromoUser({ query: q });
      if (users.some((x) => x.uid === u.uid)) toast.info?.(`${u.name} is already added`);
      else setUsers([...users, u]);
      setUserQuery("");
    } catch (e) {
      toast.error("User not found", callableError(e));
    } finally {
      setFinding(false);
    }
  };

  const save = async () => {
    const input: PromoInput = {
      code: code.trim().toUpperCase(), editing, name: name.trim(), description: description.trim(), type,
      access: isRestricted ? "restricted" : access, listed: false,
      maxRedemptions: numOrNull(maxRedemptions),
      startsAt: startsAt ? new Date(startsAt).getTime() : null,
      endsAt: endsAt ? new Date(endsAt).getTime() : null,
      audience,
    };
    const pair = (php: string, usd: string): PerCcy => ({ PHP: needPhp ? numOrNull(php) : null, USD: needUsd ? numOrNull(usd) : null });
    if (type === "gig_points") input.points = numOrNull(points);
    if (type === "wallet_credit") input.amount = pair(amtPhp, amtUsd);
    if (type === "gig_cashback") {
      input.cashbackMode = mode;
      if (mode === "percent") {
        input.percent = numOrNull(percent);
        input.maxCashback = pair(maxPhp, maxUsd);
      } else {
        input.amount = pair(amtPhp, amtUsd);
      }
      input.minGigAmount = pair(minPhp, minUsd);
      input.voucherDays = numOrNull(voucherDays);
    }
    setSaving(true);
    try {
      if (restricted) {
        if (!users.length) throw Object.assign(new Error("Add at least one user."), { code: "invalid" });
        const { code: _c, editing: _e, access: _a, listed: _l, maxRedemptions: _m, audience: _au, ...rest } = input;
        void _c; void _e; void _a; void _l; void _m; void _au;
        const res = await createRestrictedCodes({ ...rest, uids: users.map((u) => u.uid), prefix, note });
        setCreated(res.codes);
        toast.success(`${res.codes.length} restricted code${res.codes.length === 1 ? "" : "s"} created and sent`);
        return;
      }
      const res = await savePromoCode(input);
      toast.success(editing ? "Promo code updated" : "Promo code created", res.code);
      onClose();
    } catch (e) {
      toast.error("Couldn't save", callableError(e));
    } finally {
      setSaving(false);
    }
  };

  const regionHint = isRestricted
    ? "Fill ₱ and $ — each user gets the amount in their own wallet currency."
    : audience.region === "any"
    ? "Fill ₱ for Philippine users and $ for US users. Leave one empty to make the code unavailable in that region."
    : undefined;

  if (created) {
    return (
      <Modal open onClose={onClose} size="md" title={`${created.length} restricted code${created.length === 1 ? "" : "s"} sent`}
        footer={<Button onClick={onClose}>Done</Button>}>
        <div className="gp-sub" style={{ marginBottom: 10 }}>
          Each user got their code in Promo Code → For you, plus a notification and push. Only they can use it, once.
        </div>
        <div className="gp-table-wrap" style={{ maxHeight: 360, overflowY: "auto" }}>
          <table className="gp-table">
            <thead><tr><th>User</th><th>Code</th></tr></thead>
            <tbody>
              {created.map((c) => (
                <tr key={c.code}>
                  <td>{c.name}</td>
                  <td>
                    <span className="pr-code">
                      {c.code}
                      <button className="pr-copy" title="Copy" onClick={() => { navigator.clipboard?.writeText(c.code); toast.success("Copied"); }}><Copy size={12} /></button>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Modal>
    );
  }

  const title = restricted ? "Restricted codes — for specific users" : editing ? `Edit ${initial!.code}` : "New promo code";

  return (
    <Modal open onClose={saving ? () => {} : onClose} size="lg" title={title}
      footer={<>
        <Button variant="ghost" onClick={onClose} disabled={saving}>Cancel</Button>
        <Button onClick={save} loading={saving} disabled={saving || (restricted && users.length === 0)}>
          {restricted ? `Create & send ${users.length || ""} code${users.length === 1 ? "" : "s"}` : editing ? "Save changes" : "Create code"}
        </Button>
      </>}>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {!isRestricted && (
          <div>
            <label className="gp-label">Access</label>
            <div style={{ display: "flex", gap: 6 }}>
              {(["public", "private"] as const).map((a) => (
                <button key={a} className={`gp-chip ${access === a ? "active" : ""}`} onClick={() => setAccess(a)}>
                  {a === "public" ? <Globe size={12} /> : <Users size={12} />} {ACCESS_LABEL[a]}
                </button>
              ))}
            </div>
            <div className="gp-sub" style={{ marginTop: 4 }}>{ACCESS_HINT[access]}</div>
          </div>
        )}
        {restricted && (
          <>
            <div className="gp-note">{ACCESS_HINT.restricted}</div>
            <div>
              <label className="gp-label">Users ({users.length})</label>
              <div style={{ display: "flex", gap: 6 }}>
                <input className="gp-input" placeholder="Giggre ID, phone or email" value={userQuery}
                  onChange={(e) => setUserQuery(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addUser(); } }} />
                <Button size="sm" variant="secondary" icon={UserPlus} onClick={addUser} loading={finding} disabled={finding || !userQuery.trim()}>Add</Button>
              </div>
              {users.length > 0 && (
                <div className="pr-users" style={{ marginTop: 8 }}>
                  {users.map((u) => (
                    <span key={u.uid} className="pr-user" title={u.email ?? undefined}>
                      {u.name}{u.userId ? ` · ${u.userId}` : ""} · {u.currencyCode === "PHP" ? "₱" : "$"}
                      <button className="pr-copy" title="Remove" onClick={() => setUsers(users.filter((x) => x.uid !== u.uid))}><X size={12} /></button>
                    </span>
                  ))}
                </div>
              )}
            </div>
            <div className="gp-row" style={{ gridTemplateColumns: "1fr 2fr" }}>
              <div>
                <label className="gp-label">Code prefix</label>
                <input className="gp-input" style={{ fontFamily: "monospace" }} maxLength={10} value={prefix}
                  onChange={(e) => setPrefix(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))} />
                <div className="gp-sub" style={{ marginTop: 4 }}>Codes look like {prefix || "VIP"}-7KQ2XM.</div>
              </div>
              <div>
                <label className="gp-label">Message to the user (optional)</label>
                <input className="gp-input" maxLength={200} placeholder="e.g. Sorry about your cancelled gig yesterday" value={note} onChange={(e) => setNote(e.target.value)} />
              </div>
            </div>
          </>
        )}
        {!restricted && (
        <div className="gp-row" style={{ gridTemplateColumns: "1fr 1fr" }}>
          <div>
            <label className="gp-label">Code</label>
            <div style={{ display: "flex", gap: 6 }}>
              <input className="gp-input" style={{ fontFamily: "monospace", textTransform: "uppercase" }} maxLength={24}
                value={code} disabled={editing} onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9_-]/g, ""))} />
              {!editing && (
                <button className="pr-icon" title="Random code" onClick={() => setCode(randomCode())}><Shuffle size={15} /></button>
              )}
            </div>
            <div className="gp-sub" style={{ marginTop: 4 }}>4–24 letters/numbers. Users type this; it can&apos;t change later.</div>
          </div>
          <div>
            <label className="gp-label">Name (shown to users)</label>
            <input className="gp-input" maxLength={80} placeholder="e.g. Holiday welcome bonus" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
        </div>
        )}
        {restricted && (
          <div>
            <label className="gp-label">Name (shown to users)</label>
            <input className="gp-input" maxLength={80} placeholder="e.g. VIP thank-you" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
        )}
        <div>
          <label className="gp-label">Description (internal note, optional)</label>
          <input className="gp-input" maxLength={300} value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>

        <div>
          <label className="gp-label">Reward</label>
          <div className="gp-seg" style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {(["gig_points", "wallet_credit", "gig_cashback"] as PromoType[]).map((t) => (
              <button key={t} className={`gp-chip ${type === t ? "active" : ""}`} disabled={locked && type !== t} onClick={() => setType(t)}>
                {TYPE_LABEL[t]}
              </button>
            ))}
          </div>
          {locked && <div className="gp-sub" style={{ marginTop: 4 }}>This code has redemptions — its type is fixed.</div>}
        </div>

        {type === "gig_points" && (
          <div style={{ maxWidth: 240 }}>
            <label className="gp-label">Gig Points to give</label>
            <input className="gp-input" type="number" min={1} max={100000} value={points} onChange={(e) => setPoints(e.target.value)} />
          </div>
        )}
        {type === "wallet_credit" && (
          <CcyPair label="Wallet credit" hint={regionHint}
            php={needPhp ? amtPhp : ""} usd={needUsd ? amtUsd : ""} setPhp={setAmtPhp} setUsd={setAmtUsd} />
        )}
        {type === "gig_cashback" && (
          <>
            <div className="gp-note">
              The user gets a voucher. When they complete their next gig <b>as a host</b> (posted after redeeming, same
              currency), Giggre credits the cashback to their Gig Wallet — hosts pay workers directly, so this is how a
              gig is &quot;discounted&quot;.
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              <button className={`gp-chip ${mode === "percent" ? "active" : ""}`} onClick={() => setMode("percent")}>% of gig pay</button>
              <button className={`gp-chip ${mode === "fixed" ? "active" : ""}`} onClick={() => setMode("fixed")}>Fixed amount</button>
            </div>
            {mode === "percent" ? (
              <>
                <div style={{ maxWidth: 240 }}>
                  <label className="gp-label">Cashback %</label>
                  <input className="gp-input" type="number" min={1} max={100} value={percent} onChange={(e) => setPercent(e.target.value)} />
                </div>
                <CcyPair label="Maximum cashback" hint={regionHint} php={needPhp ? maxPhp : ""} usd={needUsd ? maxUsd : ""} setPhp={setMaxPhp} setUsd={setMaxUsd} />
              </>
            ) : (
              <CcyPair label="Cashback amount" hint={regionHint} php={needPhp ? amtPhp : ""} usd={needUsd ? amtUsd : ""} setPhp={setAmtPhp} setUsd={setAmtUsd} />
            )}
            <CcyPair label="Minimum gig pay (optional)" php={needPhp ? minPhp : ""} usd={needUsd ? minUsd : ""} setPhp={setMinPhp} setUsd={setMinUsd} />
            <div style={{ maxWidth: 240 }}>
              <label className="gp-label">Voucher valid for (days)</label>
              <input className="gp-input" type="number" min={1} max={365} value={voucherDays} onChange={(e) => setVoucherDays(e.target.value)} />
            </div>
          </>
        )}

        <div className="gp-row" style={{ gridTemplateColumns: isRestricted ? "1fr 1fr" : "1fr 1fr 1fr" }}>
          {!isRestricted && (
          <div>
            <label className="gp-label">Total redemptions limit</label>
            <input className="gp-input" type="number" min={1} placeholder="Unlimited" value={maxRedemptions} onChange={(e) => setMaxRedemptions(e.target.value)} />
            <div className="gp-sub" style={{ marginTop: 4 }}>Each user can redeem a code once.</div>
          </div>
          )}
          <div>
            <label className="gp-label">Starts</label>
            <input className="gp-input" type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} />
          </div>
          <div>
            <label className="gp-label">Ends</label>
            <input className="gp-input" type="datetime-local" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} />
          </div>
        </div>

        {!isRestricted && access === "public" && (
          <div style={{ maxWidth: 320 }}>
            <label className="gp-label">Region</label>
            <select className="gp-select gp-input" value={audience.region} onChange={(e) => setAudience({ ...audience, region: e.target.value as PromoAudience["region"] })}>
              <option value="any">All regions</option>
              <option value="PH">Philippines (₱ wallet)</option>
              <option value="US">United States ($ wallet)</option>
            </select>
          </div>
        )}
        {!isRestricted && access === "private" && (
        <div>
          <label className="gp-label">Who can redeem (the targeted group — pick at least one)</label>
          <div className="gp-row" style={{ gridTemplateColumns: "1fr 1fr 1fr" }}>
            <select className="gp-select gp-input" value={audience.role} onChange={(e) => setAudience({ ...audience, role: e.target.value as PromoAudience["role"] })}>
              <option value="any">Workers &amp; hosts</option>
              <option value="worker">Workers only</option>
              <option value="host">Hosts only</option>
            </select>
            <select className="gp-select gp-input" value={audience.region} onChange={(e) => setAudience({ ...audience, region: e.target.value as PromoAudience["region"] })}>
              <option value="any">All regions</option>
              <option value="PH">Philippines (₱ wallet)</option>
              <option value="US">United States ($ wallet)</option>
            </select>
            <input className="gp-input" type="number" min={1} max={365} placeholder="New accounts: any age"
              value={audience.newUserDays ?? ""} onChange={(e) => setAudience({ ...audience, newUserDays: numOrNull(e.target.value) })} />
          </div>
          <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8, fontSize: 13, color: "var(--text-secondary)" }}>
            <input type="checkbox" checked={audience.verifiedOnly} onChange={(e) => setAudience({ ...audience, verifiedOnly: e.target.checked })} />
            Verified accounts only
          </label>
          <div className="gp-sub" style={{ marginTop: 4 }}>
            &quot;New accounts&quot; = account created within that many days. Worker/host follows the mode the user is in when redeeming.
          </div>
        </div>
        )}
      </div>
    </Modal>
  );
}

// ── Redemptions ──────────────────────────────────────────────────────────────

function RedemptionsModal({ promo, onClose }: { promo: PromoCode; onClose: () => void }) {
  const [rows, setRows] = useState<PromoRedemption[] | null>(null);
  const [vouchers, setVouchers] = useState<Map<string, PromoVoucher>>(new Map());
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    Promise.all([
      fetchRedemptions(promo.code),
      promo.type === "gig_cashback" ? fetchVouchers(promo.code) : Promise.resolve(new Map<string, PromoVoucher>()),
    ]).then(([r, v]) => { if (alive) { setRows(r); setVouchers(v); } })
      .catch((e) => { if (alive) setError(String(e?.code ?? e)); });
    return () => { alive = false; };
  }, [promo.code, promo.type]);

  const voucherText = (r: PromoRedemption) => {
    const v = r.voucherId ? vouchers.get(r.voucherId) : undefined;
    if (!v) return "—";
    if (v.status === "used") return `Paid ${fmtMoney(Number(v.cashbackAmount ?? 0), v.currencyCode)}`;
    if (v.expiresAt && v.expiresAt.getTime() < Date.now()) return "Expired unused";
    return `Waiting for a gig (until ${fmtDate(v.expiresAt)})`;
  };
  const rewardFor = (r: PromoRedemption) =>
    r.points != null ? `+${r.points.toLocaleString("en-US")} pts`
      : r.amount != null ? fmtMoney(r.amount, r.currencyCode)
      : voucherText(r);

  return (
    <Modal open onClose={onClose} size="lg" title={`${promo.code} · ${promo.redemptionCount} redemption${promo.redemptionCount === 1 ? "" : "s"}`}>
      {error ? <div className="gp-empty" style={{ color: "var(--red)" }}>Couldn&apos;t load redemptions ({error}).</div>
        : rows == null ? <div className="gp-empty">Loading…</div>
        : rows.length === 0 ? <div className="gp-empty">Nobody has redeemed this code yet.</div>
        : (
          <div className="gp-table-wrap" style={{ maxHeight: 460, overflowY: "auto" }}>
            <table className="gp-table">
              <thead><tr><th>User</th><th>Mode</th><th>Reward</th><th>Redeemed</th></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.uid}>
                    <td>
                      <div style={{ fontSize: 13, color: "var(--text-primary)" }}>{r.name ?? "—"}</div>
                      <div className="gp-sub" style={{ fontFamily: "monospace" }}>{r.userId ?? r.uid}</div>
                    </td>
                    <td><span className="gp-sub">{r.role === "gighost" ? "Host" : r.role === "gigworker" ? "Worker" : "—"}</span></td>
                    <td>
                      <span style={{ fontSize: 13 }}>{rewardFor(r)}</span>
                      {r.status !== "granted" && <div className="gp-sub" style={{ color: "var(--amber, #f59e0b)" }}>{r.status}</div>}
                    </td>
                    <td><span className="gp-sub">{r.redeemedAt?.toLocaleString("en-US") ?? "—"}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
    </Modal>
  );
}

export default function Page() {
  return (
    <Suspense>
      <PromotionsPage />
    </Suspense>
  );
}
