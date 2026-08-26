// Mirrors src-tauri/src/sysintel/mod.rs (serde camelCase).

export interface Telemetry {
  ts: number;
  cpuUsage: number;
  memUsed: number;
  memTotal: number;
  netRxRate: number;
  netTxRate: number;
}

export interface SystemOverview {
  hostName: string;
  os: string;
  kernel: string;
  cpuBrand: string;
  cpuCores: number;
  memTotal: number;
  uptime: number;
}

export interface ProcessInfo {
  pid: number;
  name: string;
  cpu: number;
  mem: number;
  parent: number | null;
}

export interface StartupItem {
  name: string;
  location: string;
  kind: string;
  risk: "low" | "medium" | "high" | string;
  signed: boolean;
}

export interface NetConnection {
  proto: string;
  local: string;
  remote: string;
  pid: number | null;
  state: string;
}

export interface DiskInfo {
  name: string;
  mount: string;
  total: number;
  available: number;
  kind: string;
}

export interface SoftwareItem {
  name: string;
  version: string;
  publisher: string;
}

export interface DriverItem {
  name: string;
  version: string;
  signed: boolean;
}

export interface AdvancedInfo {
  secureBoot: boolean | null;
  tpmPresent: boolean | null;
  virtualization: boolean | null;
}
