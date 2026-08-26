import { create } from "zustand";

export type RouteId =
  | "dashboard"
  | "shield"
  | "vpn"
  | "system"
  | "analytics"
  | "settings";

interface UiState {
  route: RouteId;
  setRoute: (route: RouteId) => void;
  sidebarCollapsed: boolean;
  toggleSidebar: () => void;
}

export const useUiStore = create<UiState>((set) => ({
  route: "dashboard",
  setRoute: (route) => set({ route }),
  sidebarCollapsed: false,
  toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
}));
