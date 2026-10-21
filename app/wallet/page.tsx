"use client";

import { Suspense } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Inbox, Coins, SlidersHorizontal, type LucideIcon } from "lucide-react";
import AdminLayout from "@/components/layout/AdminLayout";
import { useAuthGuard } from "@/hooks/useAuthGuard";
import { useAuth } from "@/context/AuthContext";
import { usePendingWalletRequests } from "@/hooks/usePendingGigPointsRequests";
import { GP_STYLES } from "../gig-points/styles";
import WalletRequestsTab from "./WalletRequestsTab";
import AdjustBalanceTab from "./AdjustBalanceTab";
import WalletSettingsTab from "./WalletSettingsTab";

type TabKey = "requests" | "adjust" | "settings";
const TABS: { key: TabKey; label: string; icon: LucideIcon }[] = [
  { key: "requests", label: "Requests",       icon: Inbox },
  { key: "adjust",   label: "Adjust balance", icon: Coins },
  { key: "settings", label: "Settings",       icon: SlidersHorizontal },
];

function WalletPage() {
  const { user } = useAuthGuard({ module: "wallet" });
  const { isSuperAdmin } = useAuth();
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const pending = usePendingWalletRequests(!!user);

  const raw = params.get("tab");
  const tab: TabKey = TABS.some((t) => t.key === raw) ? (raw as TabKey) : "requests";
  const setTab = (k: TabKey) => router.replace(`${pathname}?tab=${k}`, { scroll: false });

  if (!user) return null;

  return (
    <AdminLayout title="Gig Wallet" subtitle="Review top up and send requests, adjust a user's GigCash, and set wallet limits">
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
      {tab === "requests" && <WalletRequestsTab />}
      {tab === "adjust" && <AdjustBalanceTab />}
      {tab === "settings" && <WalletSettingsTab user={user} canEdit={isSuperAdmin} />}
    </AdminLayout>
  );
}

export default function Page() {
  return (
    <Suspense>
      <WalletPage />
    </Suspense>
  );
}
