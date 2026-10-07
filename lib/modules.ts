export type ModuleKey =
  | "dashboard"
  | "analytics"
  | "users"
  | "live-gigs"
  | "live-map"
  | "admins"
  | "announcements"
  | "reports"
  | "user-reports"
  | "settings"
  | "library-gsin"
  | "user-requests"
  | "quick-gigs"
  | "activity-logs"
  | "content-management"
  | "word-filter"
  | "verification"
  | "referrals";

export interface ModuleMeta {
  key: ModuleKey;
  label: string;
  href: string;
  /** If true, only super_admin sees this regardless of permissions */
  superAdminOnly?: boolean;
}

export const ALL_MODULES: ModuleMeta[] = [
  { key: "dashboard",          label: "Dashboard",               href: "/dashboard" },
  { key: "analytics",          label: "Analytics",               href: "/analytics" },
  { key: "users",              label: "Users",                   href: "/users" },
  { key: "live-gigs",          label: "Live Gigs",               href: "/live-gigs" },
  { key: "live-map",           label: "Live Map",                href: "/live-map" },
  { key: "admins",             label: "Admin Management",        href: "/admins",        superAdminOnly: true },
  { key: "announcements",      label: "Announcements",           href: "/announcements" },
  { key: "reports",            label: "Support",                 href: "/support" },
  { key: "user-reports",       label: "User Reports",            href: "/user-reports" },
  { key: "settings",           label: "Settings",                href: "/settings" },
  { key: "library-gsin",       label: "User Skills",   href: "/user-skills" },
  { key: "user-requests",      label: "User Skill Requests",     href: "/user-requests" },
  { key: "quick-gigs",         label: "Quick Gigs Configuration",  href: "/quick-gigs" },
  { key: "activity-logs",      label: "Activity Logs",           href: "/activity-logs" },
  { key: "content-management", label: "Content Management",      href: "/content-management" },
   { key: "word-filter", label: "Word Filter",      href: "/word-filter" },
  { key: "verification",       label: "Verification Requests",   href: "/verification" },
  { key: "referrals",          label: "Referrals",               href: "/referrals" },
];

/** Modules regular admins can be granted access to (super_admin always has all) */
export const ASSIGNABLE_MODULES = ALL_MODULES.filter((m) => !m.superAdminOnly);