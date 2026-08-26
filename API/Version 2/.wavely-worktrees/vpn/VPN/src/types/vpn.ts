// Mirrors src-tauri/src/vpn/mod.rs (serde camelCase).

export interface VpnStatus {
  connected: boolean;
  serverId: string | null;
  killSwitch: boolean;
  mode: "demo" | "real" | string;
  since: number | null;
}

export interface VpnServer {
  id: string;
  country: string;
  city: string;
  flag: string;
  pingMs: number;
  load: number;
  demo: boolean;
}

export interface VpnStats {
  rxBytes: number;
  txBytes: number;
  rxRate: number;
  txRate: number;
  lastHandshake: number | null;
}
