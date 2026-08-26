import { create } from "zustand";
import { LazyStore } from "@tauri-apps/plugin-store";

export type RouteId =
  | "dashboard"
  | "shield"
  | "vpn"
  | "system"
  | "analytics"
  | "settings";

export type Theme = "dark" | "light";

/**
 * Shared persisted preference store (Control Hub).
 *
 * Backed by `@tauri-apps/plugin-store`; the same file is reused by the Settings
 * page for all user preferences. `autoSave` is disabled so writes are explicit.
 */
export const SETTINGS_STORE_FILE = "wavely-settings.json";
export const settingsStore = new LazyStore(SETTINGS_STORE_FILE, {
  autoSave: false,
  defaults: {},
});

const THEME_KEY = "appearance.theme";

/** Apply the active theme to the document root (dark is the default baseline). */
function applyThemeToDom(theme: Theme) {
  if (typeof document !== "undefined") {
    document.documentElement.dataset.theme = theme;
  }
}

interface UiState {
  route: RouteId;
  setRoute: (route: RouteId) => void;
  sidebarCollapsed: boolean;
  toggleSidebar: () => void;
  /** Active color theme. Dark is the default, unchanged baseline. */
  theme: Theme;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
}

export const useUiStore = create<UiState>((set, get) => ({
  route: "dashboard",
  setRoute: (route) => set({ route }),
  sidebarCollapsed: false,
  toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
  theme: "dark",
  setTheme: (theme) => {
    applyThemeToDom(theme);
    set({ theme });
    void persistTheme(theme);
  },
  toggleTheme: () => get().setTheme(get().theme === "dark" ? "light" : "dark"),
}));

async function persistTheme(theme: Theme) {
  try {
    await settingsStore.set(THEME_KEY, theme);
    await settingsStore.save();
  } catch {
    /* best-effort (e.g. running outside Tauri) */
  }
}

// Apply the default immediately, then hydrate the persisted theme (if any).
applyThemeToDom("dark");
void (async () => {
  try {
    const saved = await settingsStore.get<Theme>(THEME_KEY);
    if (saved === "light" || saved === "dark") {
      applyThemeToDom(saved);
      useUiStore.setState({ theme: saved });
    }
  } catch {
    /* ignore — keep dark default */
  }
})();
