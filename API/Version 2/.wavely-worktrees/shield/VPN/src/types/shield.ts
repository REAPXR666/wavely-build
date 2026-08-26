// Mirrors src-tauri/src/shield/mod.rs (serde camelCase).

export interface ShieldStatus {
  realtimeEnabled: boolean;
  lastScan: number | null;
  threatsFound: number;
  quarantined: number;
  protectionLevel: string;
}

export interface ScanResult {
  id: string;
  scanned: number;
  threats: number;
  durationMs: number;
  cancelled: boolean;
}

export interface ThreatEntry {
  id: string;
  path: string;
  name: string;
  severity: "low" | "medium" | "high" | "critical" | string;
  detectedAt: number;
  action: "quarantined" | "removed" | "allowed" | "detected" | string;
  hash: string;
}

export interface QuarantineItem {
  id: string;
  originalPath: string;
  name: string;
  quarantinedAt: number;
  severity: string;
  threat: string;
}

/** Payload for the `shield://scan-progress` event (emitted by the Shield agent). */
export interface ScanProgress {
  id: string;
  current: number;
  total: number;
  path: string;
}
