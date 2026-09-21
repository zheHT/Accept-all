import type { Metadata } from "next";
import { AntdRegistry } from "@ant-design/nextjs-registry";
import { Header } from "@/components/app-shell/header";
import { Sidebar } from "@/components/app-shell/sidebar";
import { ThemeProvider, THEME_INIT_SCRIPT } from "@/components/theme/theme-provider";
import { AntdProvider } from "@/components/theme/antd-provider";
import { ToastProvider } from "@/components/ui/toast";
import { WorkspaceCountsProvider } from "@/components/workspace/workspace-counts";
import { AuthProvider } from "@/components/auth/auth-provider";
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
        <AntdRegistry>
          <ThemeProvider>
            <AntdProvider>
              <ToastProvider>
                <AuthProvider>
                  <WorkspaceCountsProvider>
                    <a href="#main-content" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:rounded-lg focus:bg-canvas focus:px-4 focus:py-2">Skip to main content</a>
                    <Sidebar />
                    <div className="pb-20 lg:pl-[264px] lg:pb-0">
                      <Header />
                      <main id="main-content" className="px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
                        <div className="mx-auto max-w-[1360px]">{children}</div>
                      </main>
                    </div>
                  </WorkspaceCountsProvider>
                </AuthProvider>
              </ToastProvider>
            </AntdProvider>
          </ThemeProvider>
        </AntdRegistry>
      </body>
    </html>
  );
}
