import { invoke } from "@/lib/ipc";
import type {
  QuarantineItem,
  ScanResult,
  ShieldStatus,
  ThreatEntry,
} from "@/types/shield";

/** Shield (antivirus) command surface. Implemented by the shield engine. */
export const shieldApi = {
  getStatus: () => invoke<ShieldStatus>("shield_get_status"),
  setRealtime: (enabled: boolean) =>
    invoke<void>("shield_set_realtime", { enabled }),
  quickScan: () => invoke<ScanResult>("shield_quick_scan"),
  fullScan: () => invoke<ScanResult>("shield_full_scan"),
  scanPath: (path: string) => invoke<ScanResult>("shield_scan_path", { path }),
  cancelScan: (id: string) => invoke<void>("shield_cancel_scan", { id }),
  listQuarantine: () => invoke<QuarantineItem[]>("shield_list_quarantine"),
  quarantineRestore: (id: string) =>
    invoke<void>("shield_quarantine_restore", { id }),
  quarantineDelete: (id: string) =>
    invoke<void>("shield_quarantine_delete", { id }),
  getThreatLog: () => invoke<ThreatEntry[]>("shield_get_threat_log"),
  updateRules: () => invoke<number>("shield_update_rules"),
};
