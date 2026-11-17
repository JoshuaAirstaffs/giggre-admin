"use client";

import AdminLayout from "@/components/layout/AdminLayout";
import { useAuthGuard } from "@/hooks/useAuthGuard";
import BulkGigs from "./BulkGigs";

export default function BulkGigsPage() {
  useAuthGuard({ module: "bulk-gigs" });

  return (
    <AdminLayout
      title="Bulk Open Gigs"
      subtitle="Post many Open Gigs at once from an Excel sheet. Every row gets the same checks as posting in the app."
    >
      <BulkGigs />
    </AdminLayout>
  );
}
