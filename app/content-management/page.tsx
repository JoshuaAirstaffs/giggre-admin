"use client";

import AdminLayout from "@/components/layout/AdminLayout";
import { useAuthGuard } from "@/hooks/useAuthGuard";

export default function AnnouncementsPage() {
  useAuthGuard({ module: "content-management" });
  return (
    <AdminLayout
      title="Content Management"
    >
      <></>
    </AdminLayout>
  );
}
