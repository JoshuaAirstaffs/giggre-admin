"use client";

import { useState } from "react";
import { PlusCircle, Trash2 } from "lucide-react";
// The Edit tab is turned off for now; uncomment it (and its tab below) to bring it back.
// import { Pencil } from "lucide-react";
import AdminLayout from "@/components/layout/AdminLayout";
import { useAuthGuard } from "@/hooks/useAuthGuard";
import BulkGigs from "./BulkGigs";
import DeleteHostGigs from "./DeleteHostGigs";
// import EditGigs from "./EditGigs";
import { BulkStyles } from "./bulkUi";

type Tab = "post" | "edit" | "delete";

const SUBTITLE: Record<Tab, string> = {
  post: "Post many Open Gigs at once from an Excel sheet. Every row gets the same checks as posting in the app.",
  edit: "Change many Open Gigs at once: download them to Excel, edit the cells, upload it back.",
  delete: "Remove Open Gigs of chosen hosts that nobody has applied to yet.",
};

export default function BulkGigsPage() {
  useAuthGuard({ module: "bulk-gigs" });
  const [tab, setTab] = useState<Tab>("post");

  return (
    <AdminLayout title="Bulk Open Gigs" subtitle={SUBTITLE[tab]}>
      <style>{`
        .bgp-tabs { display: flex; gap: 4px; border-bottom: 1px solid var(--border); margin-bottom: 18px; overflow-x: auto; }
        .bgp-tab { display: inline-flex; align-items: center; gap: 7px; padding: 9px 16px; font-size: 13px; font-weight: 600; cursor: pointer; border: none; background: none; color: var(--text-muted); border-bottom: 2px solid transparent; margin-bottom: -1px; white-space: nowrap; transition: color .15s, border-color .15s; }
        .bgp-tab:hover { color: var(--text-primary); }
        .bgp-tab.on { color: var(--blue); border-bottom-color: var(--blue); }
        .bgp-tab.on.danger { color: var(--red); border-bottom-color: var(--red); }
      `}</style>
      <div className="bgp-tabs" role="tablist">
        <button role="tab" aria-selected={tab === "post"} className={`bgp-tab${tab === "post" ? " on" : ""}`} onClick={() => setTab("post")}>
          <PlusCircle size={15} /> Post gigs
        </button>
        {/* Turned off for now.
        <button role="tab" aria-selected={tab === "edit"} className={`bgp-tab${tab === "edit" ? " on" : ""}`} onClick={() => setTab("edit")}>
          <Pencil size={15} /> Edit gigs
        </button>
        */}
        <button role="tab" aria-selected={tab === "delete"} className={`bgp-tab danger${tab === "delete" ? " on" : ""}`} onClick={() => setTab("delete")}>
          <Trash2 size={15} /> Delete gigs
        </button>
      </div>
      {/* Tabs stay mounted so switching tabs doesn't lose an upload in progress. */}
      <div hidden={tab !== "post"}><BulkGigs /></div>
      <BulkStyles />
      {/* Turned off for now. <div hidden={tab !== "edit"}><EditGigs /></div> */}
      <div hidden={tab !== "delete"}><DeleteHostGigs /></div>
    </AdminLayout>
  );
}
