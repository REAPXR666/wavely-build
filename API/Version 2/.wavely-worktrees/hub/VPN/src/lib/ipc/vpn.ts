import { invoke } from "@/lib/ipc";
import type { VpnServer, VpnStats, VpnStatus } from "@/types/vpn";

/** VPN Core command surface. Implemented by the vpn engine. */
export const vpnApi = {
  getStatus: () => invoke<VpnStatus>("vpn_get_status"),
  listServers: () => invoke<VpnServer[]>("vpn_list_servers"),
  importConfig: (config: string) =>
    invoke<string>("vpn_import_config", { config }),
  connect: (serverId?: string) =>
    invoke<VpnStatus>("vpn_connect", { serverId: serverId ?? null }),
  disconnect: () => invoke<void>("vpn_disconnect"),
  setKillSwitch: (enabled: boolean) =>
    invoke<void>("vpn_set_killswitch", { enabled }),
  setDns: (servers: string[]) => invoke<void>("vpn_set_dns", { servers }),
  getStats: () => invoke<VpnStats>("vpn_get_stats"),
};
