
export type BadgeVariant =
  | "blue"
  | "green"
  | "red"
  | "amber"
  | "purple"
  | "orange"
  | "gray"
  | "teal"
  | "pink"
  | "indigo";

// ─── Module Config ────────────────────────────────────────────────────────────

export interface ModuleConfig {
  label: string;
  variant: BadgeVariant;
  accentColor: string;
}

export const MODULE_CONFIG: Record<string, ModuleConfig> = {
  admin_management: {
    label: "Admin",
    variant: "purple",
    accentColor: "var(--purple)",
  },
  content_management: {
    label: "Content",
    variant: "blue",
    accentColor: "var(--blue)",
  },
  user_management: {
    label: "Users",
    variant: "green",
    accentColor: "var(--green)",
  },
  gig_management: {
    label: "Gigs",
    variant: "orange",
    accentColor: "var(--orange)",
  },
  reports: {
    label: "Reports",
    variant: "teal",
    accentColor: "var(--teal, #0d9488)",
  },
  settings: {
    label: "Settings",
    variant: "gray",
    accentColor: "var(--text-muted)",
  },
  announcements: {
    label: "Announcements",
    variant: "pink",
    accentColor: "var(--pink, #ec4899)",
  },
  library: {
    label: "Library",
    variant: "indigo",
    accentColor: "var(--indigo, #6366f1)",
  },
} satisfies Record<string, ModuleConfig>;

// ─── Action Config ────────────────────────────────────────────────────────────

export interface ActionConfig {
  label: string;
  variant: BadgeVariant;
}

export const ACTION_CONFIG: Record<string, ActionConfig> = {
  // ── admin_management  (module variant: purple) ────────────────────────────
  created_admin:        { label: "Created Admin",        variant: "purple" },
  updated_admin:        { label: "Updated Admin",        variant: "purple" },
  deleted_admin:        { label: "Deleted Admin",        variant: "red"    },
  updated_permissions:  { label: "Updated Permissions",  variant: "purple" },
  toggled_admin_status: { label: "Toggled Status",       variant: "amber"  },
  changed_role:         { label: "Changed Role",         variant: "purple" },
  admin_login:          { label: "Admin Login",          variant: "purple" },

  // ── content_management  (module variant: blue) ────────────────────────────
  content_created:          { label: "Content Created",   variant: "blue"  },
  content_updated:          { label: "Content Updated",   variant: "blue"  },
  content_deleted:          { label: "Content Deleted",   variant: "red"   },
  content_reordered:        { label: "Content Reordered", variant: "blue"  },
  content_published:        { label: "Published",         variant: "blue"  },
  content_unpublished:      { label: "Unpublished",       variant: "amber" },
  content_settings_updated: { label: "Settings Updated",  variant: "blue"  },

  // ── user_management  (module variant: green) ──────────────────────────────
  user_created:  { label: "User Created",  variant: "green" },
  user_updated:  { label: "User Updated",  variant: "green" },
  user_deleted:  { label: "User Deleted",  variant: "red"   },
  user_banned:   { label: "User Banned",   variant: "red"   },
  user_unbanned: { label: "User Unbanned", variant: "amber" },

  // ── gig_management  (module variant: orange) ──────────────────────────────
  gig_created: { label: "Gig Created", variant: "orange" },
  gig_updated: { label: "Gig Updated", variant: "orange" },
  gig_deleted: { label: "Gig Deleted", variant: "red"    },
  gig_closed:  { label: "Gig Closed",  variant: "amber"  },
} satisfies Record<string, ActionConfig>;

// ─── Accessors ────────────────────────────────────────────────────────────────

/** Returns the ModuleConfig for a given key, falling back to a safe default. */
export function getModuleConfig(module: string | undefined): ModuleConfig {
  if (!module) return { label: "System", variant: "gray", accentColor: "var(--text-muted)" };
  return MODULE_CONFIG[module] ?? { label: module, variant: "gray", accentColor: "var(--text-muted)" };
}

/** Returns the ActionConfig for a given key, falling back to a safe default. */
export function getActionConfig(action: string): ActionConfig {
  return ACTION_CONFIG[action] ?? { label: action, variant: "gray" };
}