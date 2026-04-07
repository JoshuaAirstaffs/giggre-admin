export type ModuleKey =
  | "dashboard"
  | "users"
  | "live-gigs"
  | "live-map"
  | "admins"
  | "announcements"
  | "reports"
  | "settings"
  | "library-gsin"
  | "quick-gigs"
  | "activity-logs"
  | "content-management";

export interface ModuleMeta {
  key: ModuleKey;
  label: string;
  href: string;
  /** If true, only super_admin sees this regardless of permissions */
  superAdminOnly?: boolean;
}

export const ALL_MODULES: ModuleMeta[] = [
  { key: "dashboard",          label: "Dashboard",               href: "/dashboard" },
  { key: "users",              label: "Users",                   href: "/users" },
  { key: "live-gigs",          label: "Live Gigs",               href: "/live-gigs" },
  { key: "live-map",           label: "Live Map",                href: "/live-map" },
  { key: "admins",             label: "Admin Management",        href: "/admins",        superAdminOnly: true },
  { key: "announcements",      label: "Announcements",           href: "/announcements" },
  { key: "reports",            label: "Reports",                 href: "/reports" },
  { key: "settings",           label: "Settings",                href: "/settings" },
  { key: "library-gsin",       label: "Skills (GSIN Library)",   href: "/library-gsin" },
  { key: "quick-gigs",         label: "Quick Gigs Configuration",  href: "/quick-gigs" },
  { key: "activity-logs",      label: "Activity Logs",           href: "/activity-logs" },
  { key: "content-management", label: "Content Management",      href: "/content-management" },
];

/** Modules regular admins can be granted access to (super_admin always has all) */
export const ASSIGNABLE_MODULES = ALL_MODULES.filter((m) => !m.superAdminOnly);