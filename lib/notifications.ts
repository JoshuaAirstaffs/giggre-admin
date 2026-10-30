import type { ModuleKey } from "@/lib/modules";

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * Extend this union as new notification types are added (e.g. "skill_request",
 * "account_request"). Keep NOTIFICATION_TYPE_PERMISSIONS below in sync, and
 * mirror the same required-permission literal in functions/index.js — the
 * Cloud Functions codebase doesn't share this package.
 */
export type AdminNotificationType =
  | "verification_request"
  | "gig_points_request"
  | "gig_points_config_issue"
  | "wallet_request"
  | "skill_request";

export interface AdminNotification {
  id: string;
  type: AdminNotificationType;
  requiredPermission: ModuleKey;
  title: string;
  message: string;
  link: string;
  sourceCollection: string;
  sourceId: string;
  meta: { userId: string | null; name: string | null; email: string | null };
  createdAt: Date | null;
  readBy: Record<string, true>;
}

// ─── Permission mapping ───────────────────────────────────────────────────────

export const NOTIFICATION_TYPE_PERMISSIONS: Record<AdminNotificationType, ModuleKey> = {
  verification_request: "verification",
  gig_points_request: "gig-points",
  gig_points_config_issue: "gig-points",
  wallet_request: "wallet",
  skill_request: "library-gsin",
};
