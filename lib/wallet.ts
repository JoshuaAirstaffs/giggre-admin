import { doc, type Timestamp } from "firebase/firestore";
import { getFunctions, httpsCallable } from "firebase/functions";
import app, { db } from "@/lib/firebase";
import { FUNCTIONS_REGION, fmtMoney } from "@/lib/gigPoints";

// ── Gig Wallet (admin side) ───────────────────────────────────────────────────
// Every balance change goes through the giggre_app Cloud Functions
// (functions/src/wallet.ts + walletRequests.ts). This panel only reads
// requests and calls the callables below, and writes the config doc
// general_config/wallet_requests (super admins; validated by firestore.rules).

export { fmtMoney };

const call = <Req, Res>(name: string) => async (data: Req): Promise<Res> =>
  (await httpsCallable<Req, Res>(getFunctions(app, FUNCTIONS_REGION), name)(data)).data;

export const WALLET_CONFIG_DOC = doc(db, "general_config", "wallet_requests");

export const WALLET_TYPES = ["deposit", "transfer"] as const;
export type WalletType = (typeof WALLET_TYPES)[number];
export type WalletStatus = "pending" | "approved" | "rejected" | "cancelled";
export const WALLET_TYPE_LABEL: Record<WalletType, string> = { deposit: "Top up", transfer: "Send" };

export interface WalletRequest {
  id: string;
  type: WalletType;
  status: WalletStatus;
  amount: number;
  currencyCode: string;
  note: string | null;
  method: string | null;
  reference: string | null;
  proofUrl: string | null;
  userId: string;
  userName: string;
  userCode: string | null;
  recipientId: string | null;
  recipientName: string | null;
  recipientCode: string | null;
  createdAt: Date | null;
  decidedAt: Date | null;
  decidedByName: string | null;
  decisionNote: string | null;
}

const toDate = (v: unknown) => (v as Timestamp | undefined)?.toDate?.() ?? null;
const s = (v: unknown) => (typeof v === "string" && v ? v : null);

export function parseWalletRequest(id: string, d: Record<string, unknown>): WalletRequest {
  return {
    id,
    type: d.type === "transfer" ? "transfer" : "deposit",
    status: (d.status as WalletStatus) ?? "pending",
    amount: typeof d.amount === "number" ? d.amount : 0,
    currencyCode: s(d.currencyCode) ?? "PHP",
    note: s(d.note), method: s(d.method), reference: s(d.reference), proofUrl: s(d.proofUrl),
    userId: s(d.userId) ?? "", userName: s(d.userName) ?? "Giggre user", userCode: s(d.userCode),
    recipientId: s(d.recipientId), recipientName: s(d.recipientName), recipientCode: s(d.recipientCode),
    createdAt: toDate(d.createdAt), decidedAt: toDate(d.decidedAt),
    decidedByName: s(d.decidedByName), decisionNote: s(d.decisionNote),
  };
}

// ── Config ────────────────────────────────────────────────────────────────────

export interface AmountLimits { enabled: boolean; min: number | null; max: number | null; dailyMax: number | null }
export interface DepositAccount { method: string; accountName: string; accountNumber: string }
export interface WalletConfig {
  enabled: boolean;
  deposit: AmountLimits;
  transfer: AmountLimits;
  depositAccounts: DepositAccount[];
  depositNote: string;
}

const pos = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.round(v * 100) / 100 : null);

export function parseWalletConfig(d: Record<string, unknown> | undefined): WalletConfig {
  const t = (k: WalletType): AmountLimits => {
    const r = (d?.[k] ?? {}) as Record<string, unknown>;
    return { enabled: r.enabled === true, min: pos(r.min), max: pos(r.max), dailyMax: pos(r.dailyMax) };
  };
  const accounts = Array.isArray(d?.depositAccounts) ? (d!.depositAccounts as Record<string, unknown>[]) : [];
  return {
    enabled: !!d && d.enabled !== false,
    deposit: t("deposit"),
    transfer: t("transfer"),
    depositAccounts: accounts.map((a) => ({ method: s(a?.method) ?? "", accountName: s(a?.accountName) ?? "", accountNumber: s(a?.accountNumber) ?? "" })),
    depositNote: s(d?.depositNote) ?? "",
  };
}

// ── Callables ─────────────────────────────────────────────────────────────────

export const decideWalletRequest = call<
  { requestId: string; decision: "approve" | "reject"; note?: string },
  { status: WalletStatus }
>("decideWalletRequest");

export interface FoundWalletUser {
  uid: string; name: string; code: string | null; photoUrl: string | null;
  phone: string | null; email: string | null; isVerified: string | null;
  walletBalance: number; currencyCode: string;
}
export const adminFindWalletUser = call<{ query: string }, FoundWalletUser>("adminFindWalletUser");

export const adminAdjustWallet = call<
  { uid: string; amount: number; reason: string; requestId: string },
  { txId: string; balance: number; duplicate: boolean }
>("adminAdjustWallet");

export const newRequestId = () =>
  Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(16).padStart(2, "0")).join("");
