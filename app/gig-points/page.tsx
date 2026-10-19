"use client";

import { Suspense } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Inbox, HandCoins, Trophy, SlidersHorizontal, AlertTriangle, type LucideIcon } from "lucide-react";
import AdminLayout from "@/components/layout/AdminLayout";
import { useAuthGuard } from "@/hooks/useAuthGuard";
import { useAuth } from "@/context/AuthContext";
import { usePendingGigPointsRequests } from "@/hooks/usePendingGigPointsRequests";
import RequestsTab from "./RequestsTab";
import ManualTab from "./ManualTab";
import RewardsTab from "./RewardsTab";
import LimitsTab from "./LimitsTab";
import IssuesTab from "./IssuesTab";
import { GP_STYLES } from "./styles";

type TabKey = "requests" | "manual" | "rewards" | "limits" | "issues";
const TABS: { key: TabKey; label: string; icon: LucideIcon }[] = [
  { key: "requests", label: "Requests",        icon: Inbox },
  { key: "manual",   label: "Manual actions",  icon: HandCoins },
  { key: "rewards",  label: "Earning rewards", icon: Trophy },
  { key: "limits",   label: "Request limits",  icon: SlidersHorizontal },
  { key: "issues",   label: "Config issues",   icon: AlertTriangle },
];

function GigPointsPage() {
  const { user } = useAuthGuard({ module: "gig-points" });
  const { isSuperAdmin } = useAuth();
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const pending = usePendingGigPointsRequests(!!user);

  const raw = params.get("tab");
  const tab: TabKey = TABS.some((t) => t.key === raw) ? (raw as TabKey) : "requests";
  const setTab = (k: TabKey) => router.replace(`${pathname}?tab=${k}`, { scroll: false });

  if (!user) return null;

  return (
    <AdminLayout title="Gig Points" subtitle="Review deposit, withdraw and transfer requests, and set how many points each gig type earns">
      <style>{GP_STYLES}</style>
      <div className="gp-tabs" role="tablist">
        {TABS.map(({ key, label, icon: Icon }) => (
          <button key={key} role="tab" aria-selected={tab === key}
            className={`gp-tab ${tab === key ? "active" : ""}`} onClick={() => setTab(key)}>
            <Icon size={14} /> {label}
            {key === "requests" && pending > 0 && <span className="gp-count">{pending}</span>}
          </button>
        ))}
      </div>
      {tab === "requests" && <RequestsTab user={user} />}
      {tab === "manual" && <ManualTab />}
      {tab === "rewards" && <RewardsTab user={user} canEdit={isSuperAdmin} />}
      {tab === "limits" && <LimitsTab user={user} canEdit={isSuperAdmin} />}
      {tab === "issues" && <IssuesTab />}
    </AdminLayout>
  );
}

export default function Page() {
  return (
    <Suspense>
      <GigPointsPage />
    </Suspense>
  );
}
