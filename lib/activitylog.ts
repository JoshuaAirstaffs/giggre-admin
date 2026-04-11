import { collection, addDoc, serverTimestamp } from "firebase/firestore";
import { db } from "@/lib/firebase";

// ─── Action Types ─────────────────────────────────────────────────────────────

export type AdminLogAction =
  | "created_admin"
  | "updated_admin"
  | "deleted_admin"
  | "updated_permissions"
  | "toggled_admin_status"
  | "changed_role"
  | "admin_login";

export type ContentLogAction =
  | "content_created"
  | "content_updated"
  | "content_deleted"
  | "content_reordered"
  | "content_published"
  | "content_unpublished"
  | "content_settings_updated"
  | "category_added"
  | "category_updated"
  | "category_deleted"
  | "categories_saved";

export type UserLogAction =
  | "user_created"
  | "user_updated"
  | "user_deleted"
  | "user_banned"
  | "user_unbanned"
  | "user_suspended"
  | "user_unsuspended"
  | "user_skills_updated";

export type GigLogAction =
  | "gig_created"
  | "gig_updated"
  | "gig_deleted"
  | "gig_closed"
  | "gig_cancelled";

export type QuickGigLogAction = "config_updated";

export type SkillLogAction =
  | "skill_created"
  | "skill_updated"
  | "skill_deleted";

export type SettingsLogAction = "settings_updated";

export type LogAction =
  | AdminLogAction
  | ContentLogAction
  | UserLogAction
  | GigLogAction
  | QuickGigLogAction
  | SkillLogAction
  | SettingsLogAction;

export type LogModule =
  | "admin_management"
  | "content_management"
  | "user_management"
  | "gig_management"
  | "reports"
  | "settings"
  | "announcements"
  | "library"
  | "quick_gig_config";

export type ContentSectionKey =
  | "carousel_items"
  | "updates"
  | "about_giggre"
  | "terms_and_conditions"
  | "privacy"
  | "help_faq";

// ─── Unified Log Params ───────────────────────────────────────────────────────

export interface WriteLogParams {
  // Who
  actorId: string;
  actorName: string;
  actorEmail?: string;

  // What
  module: LogModule;
  action: LogAction;
  description: string;

  // Where
  targetSection?: ContentSectionKey | null;
  targetId?: string | null;
  targetName?: string | null;
  affectedFiles?: string[];

  // Detail
  meta?: {
    from?: unknown;
    to?: unknown;
    other?: Record<string, unknown>;
  };
}

export type LogPayload = Omit<WriteLogParams, "actorId" | "actorName" | "actorEmail">;

// ─── Description builders ─────────────────────────────────────────────────────
export const buildDescription = {
  // ── Admin management ─────────────────────────────────────────────────────
  createdAdmin: (targetName: string, email: string, authMethod: "email_password" | "google_oauth") =>
    `Created admin account for ${targetName} (${email}) — sign-in via ${authMethod === "email_password" ? "email & password" : "Google OAuth"}`,

  updatedAdmin: (actorName: string, targetName: string) =>
    `${actorName} updated profile details for ${targetName}`,

  deletedAdmin: (targetName: string) =>
    `Permanently deleted admin account for ${targetName}`,

  updatedPermissions: (targetName: string, modules: string[]) =>
    modules.length === 0
      ? `Removed all module permissions from ${targetName}`
      : `Updated module access for ${targetName} → [${modules.join(", ")}]`,

  toggledAdminStatus: (targetName: string, nowActive: boolean) =>
    nowActive
      ? `Activated admin account for ${targetName}`
      : `Deactivated admin account for ${targetName}`,

  changedRole: (targetName: string, from: string, to: string) =>
    `Changed role of ${targetName} from ${from} to ${to}`,

  adminLogin: (actorName: string) =>
    `${actorName} signed in to the admin console`,

  // ── Content management ────────────────────────────────────────────────────

  contentCreated: (sectionLabel: string, itemTitle: string) =>
    `Created "${itemTitle}" in ${sectionLabel}`,

  contentUpdated: (sectionLabel: string, itemTitle: string) =>
    `Updated "${itemTitle}" in ${sectionLabel}`,

  contentDeleted: (sectionLabel: string, itemTitle: string) =>
    `Deleted "${itemTitle}" from ${sectionLabel}`,

  contentReordered: (sectionLabel: string) =>
    `Reordered items in ${sectionLabel}`,

  contentPublished: (sectionLabel: string, itemTitle: string) =>
    `Published "${itemTitle}" in ${sectionLabel}`,

  contentUnpublished: (sectionLabel: string, itemTitle: string) =>
    `Unpublished "${itemTitle}" in ${sectionLabel}`,

  contentSettingsUpdated: (sectionLabel: string) =>
    `Updated display settings for ${sectionLabel}`,

  categoryAdded: (sectionLabel: string, categoryName: string) =>
    `Added category "${categoryName}" to ${sectionLabel}`,

  categoryUpdated: (sectionLabel: string, from: string, to: string) =>
    `Renamed category "${from}" to "${to}" in ${sectionLabel}`,

  categoryDeleted: (sectionLabel: string, categoryName: string) =>
    `Deleted category "${categoryName}" from ${sectionLabel}`,

  categoriesSaved: (sectionLabel: string) =>
    `Updated categories list for ${sectionLabel}`,

  configUpdated: (section: string) =>
    `Updated Quick Gig configuration — ${section}`,

  // ── Skills library ────────────────────────────────────────────────────────

  skillCreated: (skillId: string, skillName: string) =>
    `Added skill ${skillId} — "${skillName}"`,

  skillUpdated: (skillId: string, oldName: string, newName: string) =>
    `Renamed skill ${skillId} from "${oldName}" to "${newName}"`,

  skillDeleted: (skillId: string, skillName: string) =>
    `Deleted skill ${skillId} — "${skillName}"`,

  // ── User management ───────────────────────────────────────────────────────

  userDeleted: (targetName: string) =>
    `Permanently deleted user account for ${targetName}`,

  userBanned: (targetName: string) =>
    `Banned user ${targetName}`,

  userUnbanned: (targetName: string) =>
    `Lifted ban on user ${targetName}`,

  userSuspended: (targetName: string, minutes: number) =>
    `Suspended user ${targetName} for ${minutes} minutes`,

  userUnsuspended: (targetName: string) =>
    `Lifted suspension on user ${targetName}`,

  userSkillsUpdated: (targetName: string) =>
    `Updated skills for user ${targetName}`,

  // ── Gig management ────────────────────────────────────────────────────────

  gigCancelled: (gigTitle: string, gigType: string) =>
    `Cancelled ${gigType} gig "${gigTitle}"`,

  // ── Settings ──────────────────────────────────────────────────────────────

  settingsUpdated: (section: string) =>
    `Updated platform settings — ${section}`,
};

// ─── writeLog ────────────────────────────────────────────────────────────────

/**
 * Writes a structured activity-log entry to the `activityLogs` Firestore
 * collection.  Never throws — failures are silently warned so a log error
 * never blocks the primary operation.
 *
 * @example
 *   await writeLog({
 *     actorId:     user.uid,
 *     actorName:   user.displayName ?? "Unknown",
 *     actorEmail:  user.email ?? "",
 *     module:      "admin_management",
 *     action:      "toggled_admin_status",
 *     description: buildDescription.toggledAdminStatus(adminName, nextState),
 *     targetId:    adminId,
 *     targetName:  adminName,
 *     affectedFiles: [`admins/${adminId}`],
 *     meta: { from: true, to: false },
 *   });
 */
export async function writeLog(params: WriteLogParams): Promise<void> {
  try {
    await addDoc(collection(db, "activityLogs"), {
      actorId:    params.actorId,
      actorName:  params.actorName,
      actorEmail: params.actorEmail ?? null,

      module:      params.module,
      action:      params.action,
      description: params.description,

      targetSection: params.targetSection ?? null,
      targetId:      params.targetId      ?? null,
      targetName:    params.targetName    ?? null,
      affectedFiles: params.affectedFiles ?? [],

      meta: {
        from:  params.meta?.from  ?? null,
        to:    params.meta?.to    ?? null,
        other: params.meta?.other ?? {},
      },

      createdAt: serverTimestamp(),
    });
  } catch (err) {
    console.warn("[activityLog] Failed to write log:", err);
  }
}