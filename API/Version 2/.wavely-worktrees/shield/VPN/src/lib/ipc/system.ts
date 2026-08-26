import { invoke } from "@/lib/ipc";
import type {
  AdvancedInfo,
  DiskInfo,
  DriverItem,
  NetConnection,
  ProcessInfo,
  SoftwareItem,
  StartupItem,
  SystemOverview,
} from "@/types/system";

/** System Intelligence command surface. Implemented by the sysintel engine. */
export const systemApi = {
  getOverview: () => invoke<SystemOverview>("sys_get_overview"),
  getProcesses: () => invoke<ProcessInfo[]>("sys_get_processes"),
  killProcess: (pid: number) => invoke<boolean>("sys_kill_process", { pid }),
  getStartupItems: () => invoke<StartupItem[]>("sys_get_startup_items"),
  getNetworkConnections: () =>
    invoke<NetConnection[]>("sys_get_network_connections"),
  getDisks: () => invoke<DiskInfo[]>("sys_get_disks"),
  getInstalledSoftware: () => invoke<SoftwareItem[]>("sys_get_installed_software"),
  getDrivers: () => invoke<DriverItem[]>("sys_get_drivers"),
  advancedInfo: () => invoke<AdvancedInfo>("sys_advanced_info"),
};
