import { AnimatePresence, motion } from "framer-motion";
import type { ComponentType } from "react";
import { useUiStore, type RouteId } from "@/app/store";
import { TitleBar } from "@/components/layout/TitleBar";
import { Sidebar } from "@/components/layout/Sidebar";
import { DashboardPage } from "@/features/dashboard";
import { ShieldPage } from "@/features/shield";
import { VpnPage } from "@/features/vpn";
import { SystemPage } from "@/features/system";
import { AnalyticsPage } from "@/features/analytics";
import { SettingsPage } from "@/features/settings";

const PAGES: Record<RouteId, ComponentType> = {
  dashboard: DashboardPage,
  shield: ShieldPage,
  vpn: VpnPage,
  system: SystemPage,
  analytics: AnalyticsPage,
  settings: SettingsPage,
};

export function AppShell() {
  const route = useUiStore((s) => s.route);
  const Page = PAGES[route];

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background text-foreground">
      <TitleBar />
      <div className="relative flex flex-1 overflow-hidden">
        {/* Ambient background */}
        <div className="pointer-events-none absolute inset-0 overflow-hidden">
          <div className="absolute -left-40 -top-40 h-96 w-96 rounded-full bg-primary/10 blur-[120px]" />
          <div className="absolute -bottom-40 right-0 h-96 w-96 rounded-full bg-accent/10 blur-[120px]" />
        </div>

        <Sidebar />

        <main className="relative flex-1 overflow-y-auto">
          <div className="mx-auto max-w-[1400px] px-6 py-7">
            <AnimatePresence mode="wait">
              <motion.div
                key={route}
                initial={{ opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.28, ease: "easeOut" }}
              >
                <Page />
              </motion.div>
            </AnimatePresence>
          </div>
        </main>
      </div>
    </div>
  );
}
