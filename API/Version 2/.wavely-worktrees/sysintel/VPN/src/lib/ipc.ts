import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import {
  listen,
  type EventCallback,
  type UnlistenFn,
} from "@tauri-apps/api/event";

/**
 * Event channel names emitted by the Rust backend.
 * Keep in sync with `src-tauri/src/common/mod.rs` (`events`).
 */
export const EVENTS = {
  sysTelemetry: "sys://telemetry",
  shieldStatus: "shield://status",
  shieldScanProgress: "shield://scan-progress",
  shieldThreatFound: "shield://threat-found",
  vpnStatus: "vpn://status",
  vpnStats: "vpn://stats",
  vpnError: "vpn://error",
} as const;

/** Strongly-typed wrapper around Tauri's `invoke`. */
export function invoke<T>(
  cmd: string,
  args?: Record<string, unknown>,
): Promise<T> {
  return tauriInvoke<T>(cmd, args);
}

/** Subscribe to a backend event. Returns an unlisten function. */
export function subscribe<T>(
  event: string,
  handler: EventCallback<T>,
): Promise<UnlistenFn> {
  return listen<T>(event, handler);
}
