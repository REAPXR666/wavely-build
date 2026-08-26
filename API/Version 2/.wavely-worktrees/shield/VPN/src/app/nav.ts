import {
  BarChart3,
  Cpu,
  Globe2,
  LayoutDashboard,
  Settings,
  ShieldCheck,
  type LucideIcon,
} from "lucide-react";
import type { RouteId } from "@/app/store";

export interface NavItem {
  id: RouteId;
  label: string;
  icon: LucideIcon;
  description: string;
  group: "main" | "system";
}

export const NAV_ITEMS: NavItem[] = [
  {
    id: "dashboard",
    label: "Dashboard",
    icon: LayoutDashboard,
    description: "Unified overview of every Wavely engine",
    group: "main",
  },
  {
    id: "shield",
    label: "Security",
    icon: ShieldCheck,
    description: "Antivirus, real-time protection & quarantine",
    group: "main",
  },
  {
    id: "vpn",
    label: "VPN",
    icon: Globe2,
    description: "Encrypted WireGuard tunnel & servers",
    group: "main",
  },
  {
    id: "system",
    label: "System",
    icon: Cpu,
    description: "Live diagnostics, processes & startup",
    group: "main",
  },
  {
    id: "analytics",
    label: "Analytics",
    icon: BarChart3,
    description: "Threat history & performance trends",
    group: "system",
  },
  {
    id: "settings",
    label: "Settings",
    icon: Settings,
    description: "Preferences & app configuration",
    group: "system",
  },
];
