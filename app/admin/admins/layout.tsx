import { SidebarProvider } from "@/components/ui/sidebar"

export default function AdminsLayout({ children }: { children: React.ReactNode }) {
  return (
    <SidebarProvider>
      {children}
    </SidebarProvider>
  );
}