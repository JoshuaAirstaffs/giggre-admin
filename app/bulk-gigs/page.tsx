"use client";

import AdminLayout from "@/components/layout/AdminLayout";
import { useAuthGuard } from "@/hooks/useAuthGuard";
import GigWorkbook from "./GigWorkbook";
import { BulkStyles } from "./bulkUi";

export default function BulkGigsPage() {
  useAuthGuard({ module: "bulk-gigs" });

  return (
    <AdminLayout
      title="Bulk Open Gigs"
      subtitle="One Excel file for everything: post, change and delete gigs, then keep working in the updated file."
    >
      <BulkStyles />
      <GigWorkbook />
    </AdminLayout>
  );
}
