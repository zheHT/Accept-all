import type { Metadata } from "next";
import { Header } from "@/components/app-shell/header";
import { Sidebar } from "@/components/app-shell/sidebar";
import { ThemeProvider, THEME_INIT_SCRIPT } from "@/components/theme/theme-provider";
import { ToastProvider } from "@/components/ui/toast";
import { WorkspaceCountsProvider } from "@/components/workspace/workspace-counts";
import "./globals.css";

export const metadata: Metadata = {
  title: "ShipVerify — Shipping Document Verification",
  description:
    "Automated verification of Shipping Instructions against draft Bills of Lading, with discrepancy reporting and human review.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="min-h-screen antialiased">
        <ThemeProvider>
          <ToastProvider>
            <WorkspaceCountsProvider>
              <Sidebar />
              <div className="pl-[264px]">
                <Header />
                <main className="px-8 py-8">
                  <div className="mx-auto max-w-[1360px]">{children}</div>
                </main>
              </div>
            </WorkspaceCountsProvider>
          </ToastProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
