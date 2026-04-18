"use client";

import AdminLayout from "@/components/layout/AdminLayout";
import { useAuthGuard } from "@/hooks/useAuthGuard";
import { MessageSquare, TicketCheck, Sparkles, ClipboardList } from "lucide-react"; // adjust path as needed
import { useState } from "react";
import TicketsTab from "./components/tickets";
import Messages from "./components/messages";
import AutoReply from "./components/autoReply";
import CreateTicket from "./components/createTicket";
import UserRequests from "./components/userRequests";

type TabKey = "messages" | "tickets" | "autoReply" | "createTicket" | "userRequests";

const TABS: { key: TabKey; label: string; icon: React.ElementType }[] = [
  { key: "messages",     label: "Messages",       icon: MessageSquare },
  { key: "tickets",      label: "Tickets",         icon: TicketCheck },
  { key: "createTicket", label: "Create Ticket",   icon: TicketCheck },
  { key: "autoReply",    label: "Auto Reply",       icon: Sparkles },
  { key: "userRequests", label: "User Requests",   icon: ClipboardList },
];

export default function SupportPage() {
  useAuthGuard({ module: "reports" });

  const [activeTab, setActiveTab] = useState<TabKey>("messages");

  return (
    <AdminLayout
      title="Support"
      subtitle="Manage tickets and user requests"
    >
      <style>{`
        .rp-tabs        { display: flex; gap: 4px; border-bottom: 1px solid var(--border); margin-bottom: 20px; }
        .rp-tab-btn     { display: flex; align-items: center; gap: 8px; padding: 10px 16px; border-radius: var(--radius-sm) var(--radius-sm) 0 0; font-size: 14px; font-weight: 500; color: var(--text-secondary); background: none; border: 1px solid transparent; border-bottom: none; cursor: pointer; position: relative; bottom: -1px; transition: color 0.15s, background 0.15s; }
        .rp-tab-btn:hover { color: var(--text-primary); background: var(--bg-hover); }
        .rp-tab-btn.active { color: var(--blue); background: var(--bg-surface); border-color: var(--border); border-bottom-color: var(--bg-surface); }
        .rp-tab-btn svg { width: 16px; height: 16px; }
        .rp-panel       { background: var(--bg-surface); border: 1px solid var(--border); border-radius: var(--radius-lg); padding: 24px; min-height: 320px; }
        .rp-empty       { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px; min-height: 220px; color: var(--text-muted); }
        .rp-empty svg   { width: 32px; height: 32px; opacity: 0.4; }
        .rp-empty p     { font-size: 14px; }
      `}</style>

      {/* Tab bar */}
      <div className="rp-tabs">
        {TABS.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            className={`rp-tab-btn${activeTab === key ? " active" : ""}`}
            onClick={() => setActiveTab(key)}
          >
            <Icon />
            {label}
          </button>
        ))}
      </div>

      {/* Tab panels */}
      <div className="rp-panel">
        {activeTab === "messages"     && <Messages />}
        {activeTab === "tickets"      && <TicketsTab />}
        {activeTab === "createTicket" && <CreateTicket />}
        {activeTab === "autoReply"    && <AutoReply />}
        {activeTab === "userRequests" && <UserRequests />}
      </div>
    </AdminLayout>
  );
}