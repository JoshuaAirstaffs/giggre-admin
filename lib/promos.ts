import {
  collection, getDocs, limit, onSnapshot, orderBy, query, where, type Timestamp,
} from "firebase/firestore";
import { getFunctions, httpsCallable } from "firebase/functions";
import app, { db } from "@/lib/firebase";
import { FUNCTIONS_REGION } from "@/lib/gigPoints";

// ── Promotions (admin) ────────────────────────────────────────────────────────
// Mirrors giggre_app functions/src/promos.ts. Codes are saved through callables
// (permission "promotions"); admins read promo_codes / redemptions / vouchers
// directly (firestore.rules: admin read only).

export type PromoType = "gig_points" | "wallet_credit" | "gig_cashback";
/** public: everyone · private: a targeted group · restricted: one user, single use */
export type PromoAccess = "public" | "private" | "restricted";
export type Ccy = "PHP" | "USD";
export type PerCcy = Partial<Record<Ccy, number | null>>;

export interface PromoAudience {
  role: "any" | "worker" | "host";
  region: "any" | "PH" | "US";
  verifiedOnly: boolean;
  newUserDays: number | null;
}

export interface PromoReward {
  points?: number;
  amount?: PerCcy;
  cashbackMode?: "percent" | "fixed";
  percent?: number;
  maxCashback?: PerCcy;
  minGigAmount?: PerCcy;
  voucherDays?: number;
}

export interface PromoCode {
  code: string;
  name: string;
  description: string;
  type: PromoType;
  access: PromoAccess;
  listed: boolean;
  assignedUid: string | null;
  assignedName: string | null;
  assignedUserId: string | null;
  note: string | null;
  sentCount: number;
  lastSentAt: Date | null;
  reward: PromoReward;
  audience: PromoAudience;
  maxRedemptions: number | null;
  redemptionCount: number;
  active: boolean;
  startsAt: Date | null;
  endsAt: Date | null;
  createdAt: Date | null;
  createdByName: string | null;
  lastRedeemedAt: Date | null;
}

export interface PromoRedemption {
  uid: string;
  name: string | null;
  userId: string | null;
  role: string | null;
  currencyCode: string;
  type: PromoType;
  points?: number;
  amount?: number;
  voucherId?: string;
  status: string;
  redeemedAt: Date | null;
}

export interface PromoVoucher {
  id: string;
  uid: string;
  status: "active" | "used";
  currencyCode: string;
  cashbackAmount?: number;
  gigId?: string;
  expiresAt: Date | null;
  usedAt: Date | null;
}

const toDate = (v: unknown): Date | null => (v && typeof (v as Timestamp).toDate === "function" ? (v as Timestamp).toDate() : null);

export const ACCESS_LABEL: Record<PromoAccess, string> = {
  public: "Public",
  private: "Private",
  restricted: "Restricted",
};
export const ACCESS_HINT: Record<PromoAccess, string> = {
  public: "Anyone can use it — share it on social media or the website.",
  private: "Only a targeted group (e.g. new users, verified hosts) can use it. Send it to the group from the list.",
  restricted: "Single-use codes made for specific users — apologies, VIP rewards. Each user gets their own code.",
};

export const TYPE_LABEL: Record<PromoType, string> = {
  gig_points: "Gig Points",
  wallet_credit: "Wallet credit",
  gig_cashback: "Gig cashback",
};

export const sym = (c: string) => (c === "PHP" ? "₱" : "$");
export const fmtMoney = (n: number, c: string) =>
  `${sym(c)}${n.toLocaleString("en-US", { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 })}`;

const perCcyText = (p: PerCcy | undefined) =>
  (["PHP", "USD"] as Ccy[]).filter((c) => (p?.[c] ?? 0) > 0).map((c) => fmtMoney(Number(p![c]), c)).join(" / ") || "—";

/** "+500 Gig Points", "₱100 / $5 wallet credit", "10% cashback (max ₱200 / $5)". */
export function rewardText(p: Pick<PromoCode, "type" | "reward">): string {
  const r = p.reward ?? {};
  if (p.type === "gig_points") return `+${(r.points ?? 0).toLocaleString("en-US")} Gig Points`;
  if (p.type === "wallet_credit") return `${perCcyText(r.amount)} wallet credit`;
  if (r.cashbackMode === "fixed") return `${perCcyText(r.amount)} cashback on next gig`;
  return `${r.percent ?? 0}% cashback (max ${perCcyText(r.maxCashback)})`;
}

export function audienceText(a: PromoAudience | undefined): string {
  if (!a) return "Everyone";
  const parts = [
    a.role === "worker" ? "Workers" : a.role === "host" ? "Hosts" : null,
    a.region === "PH" ? "Philippines" : a.region === "US" ? "US" : null,
    a.verifiedOnly ? "Verified" : null,
    a.newUserDays ? `New (≤${a.newUserDays}d)` : null,
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : "Everyone";
}

export type PromoStatus = "active" | "paused" | "scheduled" | "expired" | "used_up";
export function promoStatus(p: PromoCode, now = Date.now()): PromoStatus {
  if (!p.active) return "paused";
  if (p.maxRedemptions != null && p.redemptionCount >= p.maxRedemptions) return "used_up";
  if (p.endsAt && p.endsAt.getTime() < now) return "expired";
  if (p.startsAt && p.startsAt.getTime() > now) return "scheduled";
  return "active";
}

export function watchPromoCodes(onData: (codes: PromoCode[]) => void, onError: (e: { code?: string }) => void) {
  return onSnapshot(
    query(collection(db, "promo_codes"), orderBy("createdAt", "desc")),
    (snap) => onData(snap.docs.map((d) => {
      const x = d.data();
      return {
        code: d.id,
        name: String(x.name ?? d.id),
        description: String(x.description ?? ""),
        type: x.type as PromoType,
        access: (x.access ?? "public") as PromoAccess,
        listed: x.listed === true,
        assignedUid: (x.assignedUid as string) ?? null,
        assignedName: (x.assignedName as string) ?? null,
        assignedUserId: (x.assignedUserId as string) ?? null,
        note: (x.note as string) ?? null,
        sentCount: Number(x.sentCount ?? 0),
        lastSentAt: toDate(x.lastSentAt),
        reward: (x.reward ?? {}) as PromoReward,
        audience: (x.audience ?? { role: "any", region: "any", verifiedOnly: false, newUserDays: null }) as PromoAudience,
        maxRedemptions: typeof x.maxRedemptions === "number" ? x.maxRedemptions : null,
        redemptionCount: Number(x.redemptionCount ?? 0),
        active: x.active === true,
        startsAt: toDate(x.startsAt),
        endsAt: toDate(x.endsAt),
        createdAt: toDate(x.createdAt),
        createdByName: (x.createdByName as string) ?? null,
        lastRedeemedAt: toDate(x.lastRedeemedAt),
      };
    })),
    onError,
  );
}

export async function fetchRedemptions(code: string): Promise<PromoRedemption[]> {
  const snap = await getDocs(query(collection(db, "promo_codes", code, "redemptions"), orderBy("redeemedAt", "desc"), limit(500)));
  return snap.docs.map((d) => {
    const x = d.data();
    return { ...(x as PromoRedemption), uid: d.id, redeemedAt: toDate(x.redeemedAt) };
  });
}

export async function fetchVouchers(code: string): Promise<Map<string, PromoVoucher>> {
  const snap = await getDocs(query(collection(db, "promo_vouchers"), where("promoCode", "==", code), limit(500)));
  return new Map(snap.docs.map((d) => {
    const x = d.data();
    return [d.id, {
      id: d.id, uid: String(x.uid), status: x.status, currencyCode: String(x.currencyCode ?? ""),
      cashbackAmount: x.cashbackAmount, gigId: x.gigId, expiresAt: toDate(x.expiresAt), usedAt: toDate(x.usedAt),
    } as PromoVoucher];
  }));
}

const call = <Req, Res>(name: string) => async (data: Req): Promise<Res> =>
  (await httpsCallable<Req, Res>(getFunctions(app, FUNCTIONS_REGION), name)(data)).data;

export interface PromoInput {
  code: string;
  editing?: boolean;
  name: string;
  description: string;
  type: PromoType;
  access?: PromoAccess;
  listed?: boolean;
  points?: number | null;
  amount?: PerCcy;
  cashbackMode?: "percent" | "fixed";
  percent?: number | null;
  maxCashback?: PerCcy;
  minGigAmount?: PerCcy;
  voucherDays?: number | null;
  maxRedemptions: number | null;
  startsAt: number | null; // ms
  endsAt: number | null; // ms
  audience: PromoAudience;
}

export const savePromoCode = call<PromoInput, { code: string }>("adminSavePromoCode");
export const setPromoActive = call<{ code: string; active: boolean }, { active: boolean }>("adminSetPromoActive");
export const deletePromoCode = call<{ code: string }, { deleted: boolean }>("adminDeletePromoCode");
export const sendPromoToGroup = call<{ code: string }, { matched: number; sent: number }>("adminSendPromoToGroup");

export interface PromoUser { uid: string; name: string; userId: string | null; email: string | null; role: string | null; currencyCode: string }
export const findPromoUser = call<{ query: string }, PromoUser>("adminFindPromoUser");
export const createRestrictedCodes = call<
  Omit<PromoInput, "code" | "access" | "listed" | "maxRedemptions" | "audience"> & { uids: string[]; prefix: string; note: string },
  { codes: { uid: string; code: string; name: string }[]; batchId: string }
>("adminCreateRestrictedCodes");

/** Random readable code, e.g. GIGGRE-7KQ2XM (no 0/O/1/I). */
export function randomCode(prefix = "GIG"): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < 6; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return `${prefix}-${out}`;
}
