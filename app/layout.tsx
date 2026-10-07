import type { Metadata } from "next";
import { AuthProvider } from "@/context/AuthContext";
import { ThemeProvider } from "@/context/ThemeContext";
import { CurrencyProvider } from "@/context/CurrencyContext";
import { DevModeProvider } from "@/context/DevModeContext";
import Toaster from "@/components/ui/Toaster";
import IdleLogout from "@/components/IdleLogout";
import "./globals.css";

export const metadata: Metadata = {
  title: "Giggre Admin",
  description: "Giggre Admin Console",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Space+Mono:wght@400;700&family=DM+Sans:opsz,wght@9..40,300;9..40,400;9..40,500;9..40,600;9..40,700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body suppressHydrationWarning>
        {/* ThemeProvider must wrap AuthProvider so theme is available everywhere */}
        <ThemeProvider>
          <CurrencyProvider>
            <DevModeProvider>
              <AuthProvider>
                {children}
                <IdleLogout />
              </AuthProvider>
            </DevModeProvider>
          </CurrencyProvider>
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  );
}