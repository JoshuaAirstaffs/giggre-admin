"use client";

import AdminLayout from "@/components/layout/AdminLayout";
import { useAuthGuard } from "@/hooks/useAuthGuard";
import BulkGigs from "./BulkGigs";
import DeleteHostGigs from "./DeleteHostGigs";

export default function BulkGigsPage() {
  useAuthGuard({ module: "bulk-gigs" });

  return (
    <AdminLayout
      title="Bulk Open Gigs"
      subtitle="Post many Open Gigs at once from an Excel sheet. Every row gets the same checks as posting in the app."
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <BulkGigs />
        <DeleteHostGigs />
      </div>
    </AdminLayout>
  );
}
