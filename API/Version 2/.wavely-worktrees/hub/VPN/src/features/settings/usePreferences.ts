import { useEffect, useRef, useState } from "react";
import { settingsStore } from "@/app/store";

/** All persisted user preferences (theme is handled by the UI store). */
export interface Preferences {
  // Protection defaults
  realtimeProtection: boolean;
  scanOnStartup: boolean;
  scanRemovableDrives: boolean;
  autoQuarantine: boolean;
  // VPN defaults
  autoConnectVpn: boolean;
  killSwitch: boolean;
  blockLanWhileConnected: boolean;
  // Notifications
  notifyThreats: boolean;
  notifyVpnChanges: boolean;
  notifyScanComplete: boolean;
  soundAlerts: boolean;
  // Startup & tray
  launchAtStartup: boolean;
  startMinimized: boolean;
  minimizeToTray: boolean;
  closeToTray: boolean;
}

export const DEFAULT_PREFERENCES: Preferences = {
  realtimeProtection: true,
  scanOnStartup: false,
  scanRemovableDrives: true,
  autoQuarantine: true,
  autoConnectVpn: false,
  killSwitch: true,
  blockLanWhileConnected: false,
  notifyThreats: true,
  notifyVpnChanges: true,
  notifyScanComplete: true,
  soundAlerts: false,
  launchAtStartup: false,
  startMinimized: false,
  minimizeToTray: true,
  closeToTray: true,
};

const PREFS_KEY = "preferences";

type SaveState = "idle" | "saving" | "saved";

/**
 * Loads preferences from the shared plugin-store on mount and persists every
 * change. Returns the current values plus a typed `update` mutator.
 */
export function usePreferences() {
  const [prefs, setPrefs] = useState<Preferences>(DEFAULT_PREFERENCES);
  const [loaded, setLoaded] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const savedTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const saved = await settingsStore.get<Partial<Preferences>>(PREFS_KEY);
        if (!cancelled && saved && typeof saved === "object") {
          setPrefs({ ...DEFAULT_PREFERENCES, ...saved });
        }
      } catch {
        /* keep defaults */
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
      if (savedTimer.current) clearTimeout(savedTimer.current);
    };
  }, []);

  const persist = async (next: Preferences) => {
    setSaveState("saving");
    try {
      await settingsStore.set(PREFS_KEY, next);
      await settingsStore.save();
      setSaveState("saved");
      if (savedTimer.current) clearTimeout(savedTimer.current);
      savedTimer.current = setTimeout(() => setSaveState("idle"), 1800);
    } catch {
      setSaveState("idle");
    }
  };

  const update = <K extends keyof Preferences>(key: K, value: Preferences[K]) => {
    setPrefs((prev) => {
      const next = { ...prev, [key]: value };
      void persist(next);
      return next;
    });
  };

  const reset = () => {
    setPrefs(DEFAULT_PREFERENCES);
    void persist(DEFAULT_PREFERENCES);
  };

  return { prefs, update, reset, loaded, saveState };
}
