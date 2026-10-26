import { doc, type Timestamp } from "firebase/firestore";
import { getFunctions, httpsCallable } from "firebase/functions";
import app, { db } from "@/lib/firebase";

// ── Gig Points (admin side) ───────────────────────────────────────────────────
// Every balance change goes through the giggre_app Cloud Functions
// (functions/src/gigPoints.ts + gigPointsRequests.ts). This panel only:
//   • reads requests / balances / config issues
//   • calls the callables below to decide requests or act directly
//   • writes the two config docs (super admins; validated by firestore.rules)

/** Callables run in the same region as the project's Firestore triggers
 *  (giggre_app/functions/src/region.ts): dev asia-east2, prod us-central1. */
const DEV_PROJECT_ID = "simpleproject-8ff7a";
export const FUNCTIONS_REGION =
  process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID === DEV_PROJECT_ID ? "asia-east2" : "us-central1";

const fns = () => getFunctions(app, FUNCTIONS_REGION);
const call = <Req, Res>(name: string) => async (data: Req): Promise<Res> =>
  (await httpsCallable<Req, Res>(fns(), name)(data)).data;

export const GIG_POINTS_CONFIG_DOC = doc(db, "general_config", "gig_points");
export const GIG_POINTS_LIMITS_DOC = doc(db, "general_config", "gig_points_requests");

// ── Types ─────────────────────────────────────────────────────────────────────

export const REQUEST_TYPES = ["to_cash", "to_points"] as const;
export type RequestType = (typeof REQUEST_TYPES)[number];
export type RequestStatus = "pending" | "approved" | "rejected" | "cancelled";

export const REQUEST_TYPE_LABEL: Record<RequestType, string> = {
  to_cash: "Points → GigCash",
  to_points: "GigCash → Points",
};

/** Same rule as the app: ₱ for PHP, $ for USD and everything else. */
export const currencySymbol = (ccy: string | null | undefined) => (ccy === "PHP" ? "₱" : "$");

/** Amount in a user's wallet currency, e.g. $12.50 / ₱12.50 (default USD). */
export const fmtMoney = (n: number, ccy = "USD") =>
  `${currencySymbol(ccy)}${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export const GIG_TYPES = [
  { key: "quick",   label: "Quick Gig",   hint: "Instant gigs matched on the spot (quick_gigs)" },
  { key: "open",    label: "Posted Gig",  hint: "Gigs a host posts for workers to apply to (open_gigs)" },
  { key: "offered", label: "Offered Gig", hint: "Gigs a host offers directly to a worker (offered_gigs)" },
] as const;
export type GigTypeKey = (typeof GIG_TYPES)[number]["key"];

export interface PointsRequest {
  id: string;
  /** null for old deposit/withdraw/transfer requests (can only be rejected). */
  type: RequestType | null;
  legacyType: string | null;
  cash: number;
  currencyCode: string;
  rate: number | null;
  /** Wallet units per US$1 locked on the request (1 for USD wallets). */
  fxRate: number | null;
  status: RequestStatus;
  points: number;
  note: string | null;
  userId: string;
  userName: string;
  userCode: string | null;
  recipientId: string | null;
  recipientName: string | null;
  recipientCode: string | null;
  source: "app" | "admin";
  createdAt: Date | null;
  decidedAt: Date | null;
  decidedByName: string | null;
  decisionNote: string | null;
  reference: string | null;
}

const toDate = (v: unknown) => (v as Timestamp | undefined)?.toDate?.() ?? null;
const s = (v: unknown) => (typeof v === "string" && v ? v : null);

export function parseRequest(id: string, d: Record<string, unknown>): PointsRequest {
  return {
    id,
    type: (REQUEST_TYPES as readonly string[]).includes(d.type as string) ? (d.type as RequestType) : null,
    legacyType: (REQUEST_TYPES as readonly string[]).includes(d.type as string) ? null : s(d.type),
    cash: typeof d.cash === "number" ? d.cash : 0,
    currencyCode: s(d.currencyCode) ?? "USD",
    rate: typeof d.rate === "number" ? d.rate : null,
    fxRate: typeof d.fxRate === "number" ? d.fxRate : null,
    status: (d.status as RequestStatus) ?? "pending",
    points: typeof d.points === "number" ? d.points : 0,
    note: s(d.note),
    userId: s(d.userId) ?? "",
    userName: s(d.userName) ?? "Giggre user",
    userCode: s(d.userCode),
    recipientId: s(d.recipientId),
    recipientName: s(d.recipientName),
    recipientCode: s(d.recipientCode),
    source: d.source === "admin" ? "admin" : "app",
    createdAt: toDate(d.createdAt),
    decidedAt: toDate(d.decidedAt),
    decidedByName: s(d.decidedByName),
    decisionNote: s(d.decisionNote),
    reference: s(d.reference),
  };
}

// ── Reward config (general_config/gig_points) ─────────────────────────────────

export interface RewardConfig {
  enabled: boolean;
  pointsByGigType: Partial<Record<GigTypeKey, number>>;
  maxPointsPerGig: number | null;
}

/** Same rule as rewardInt() in the functions / isValidReward() in the rules. */
export const isValidReward = (v: unknown): v is number =>
  typeof v === "number" && Number.isInteger(v) && v >= 0;

export function parseRewardConfig(d: Record<string, unknown> | undefined): RewardConfig {
  const raw = (d?.pointsByGigType ?? {}) as Record<string, unknown>;
  const pointsByGigType: RewardConfig["pointsByGigType"] = {};
  for (const t of GIG_TYPES) if (isValidReward(raw[t.key])) pointsByGigType[t.key] = raw[t.key] as number;
  return {
    enabled: d?.enabled !== false,
    pointsByGigType,
    maxPointsPerGig: isValidReward(d?.maxPointsPerGig) ? (d!.maxPointsPerGig as number) : null,
  };
}

// ── Conversion (general_config/gig_points_requests) ───────────────────────────

export interface TypeLimits { enabled: boolean; min: number | null; max: number | null; dailyMax: number | null }
export interface ConversionConfig {
  enabled: boolean;
  /** Points per US$1 — toCash when cashing out, toPoints when buying points.
   *  Peso wallets are converted at the live rate (general_config/fx_rates). */
  rates: { toCash: number | null; toPoints: number | null };
  toCash: TypeLimits;
  toPoints: TypeLimits;
}
export const DIRECTION_KEY: Record<RequestType, "toCash" | "toPoints"> = { to_cash: "toCash", to_points: "toPoints" };

const posInt = (v: unknown) => (typeof v === "number" && Number.isInteger(v) && v > 0 ? v : null);

/** Mirrors parseConversionConfig() in gigPointsRequests.ts — missing doc = closed. */
export function parseConversion(d: Record<string, unknown> | undefined): ConversionConfig {
  const t = (k: "toCash" | "toPoints"): TypeLimits => {
    const r = (d?.[k] ?? {}) as Record<string, unknown>;
    return { enabled: r.enabled === true, min: posInt(r.min), max: posInt(r.max), dailyMax: posInt(r.dailyMax) };
  };
  const rates = (d?.rates ?? {}) as Record<string, unknown>;
  return {
    enabled: !!d && d.enabled !== false,
    rates: { toCash: posInt(rates.toCash), toPoints: posInt(rates.toPoints) },
    toCash: t("toCash"),
    toPoints: t("toPoints"),
  };
}

// ── Callables ─────────────────────────────────────────────────────────────────

export const decideGigPointsRequest = call<
  { requestId: string; decision: "approve" | "reject"; note?: string; reference?: string },
  { status: RequestStatus }
>("decideGigPointsRequest");

/** Manual add (+) / remove (−) of points — adjustGigPoints in gigPoints.ts. */
export const adjustGigPoints = call<
  { userId: string; points: number; reason: string },
  { balance: number; transactionId: string }
>("adjustGigPoints");

export interface FoundUser {
  uid: string; name: string; code: string | null; photoUrl: string | null;
  phone: string | null; email: string | null;
  balance: number; heldPoints: number; pendingPoints: number; lifetimeEarned: number;
  walletBalance: number; currencyCode: string;
}
export const adminFindGigPointsUser = call<{ query: string }, FoundUser>("adminFindGigPointsUser");

export const retryGigPointsAwards = call<
  { issueId: string },
  { awarded: number; pending: number; stillBlocked: number; notApplicable: number }
>("retryGigPointsAwards");

/** Readable message from a callable error. */
export function callableError(err: unknown): string {
  const e = err as { code?: string; message?: string };
  if (e?.code === "functions/permission-denied") return e.message || "You don't have permission to do that.";
  if (e?.code === "functions/unavailable" || e?.code === "functions/internal") return "The server couldn't be reached. Try again.";
  return e?.message || "Something went wrong.";
}
