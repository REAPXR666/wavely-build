import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "framer-motion";
import {
  Activity,
  ArrowDown,
  ArrowUp,
  Clock,
  FileUp,
  Globe2,
  Loader2,
  Lock,
  Power,
  RefreshCw,
  ShieldCheck,
  Signal,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/PageHeader";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/Card";
import { Skeleton } from "@/components/ui/Skeleton";
import { StatusDot } from "@/components/ui/StatusDot";
import { Switch } from "@/components/ui/Switch";
import { Tooltip, TooltipProvider } from "@/components/ui/Tooltip";
import { Sparkline } from "@/components/telemetry/Sparkline";
import { EVENTS, subscribe } from "@/lib/ipc";
import { vpnApi } from "@/lib/ipc/vpn";
import type { VpnServer, VpnStats, VpnStatus } from "@/types/vpn";
import { cn, formatBytes, formatRate } from "@/lib/utils";

const MAX_POINTS = 60;
const EMPTY_STATS: VpnStats = {
  rxBytes: 0,
  txBytes: 0,
  rxRate: 0,
  txRate: 0,
  lastHandshake: null,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Literal classes (kept whole so Tailwind's JIT can detect them).
function loadBarClass(load: number): string {
  if (load < 50) return "bg-success";
  if (load < 80) return "bg-warning";
  return "bg-danger";
}

function pingTextClass(ping: number): string {
  if (ping < 60) return "text-success";
  if (ping < 150) return "text-warning";
  return "text-danger";
}

function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

function formatHandshake(ts: number | null): string {
  if (!ts) return "—";
  const secs = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (secs < 5) return "just now";
  if (secs < 60) return `${secs}s ago`;
  const m = Math.floor(secs / 60);
  return `${m}m ${secs % 60}s ago`;
}

// ---------------------------------------------------------------------------
// Live VPN hook: bridges react-query cache with backend events.
// ---------------------------------------------------------------------------

function useVpnLive() {
  const qc = useQueryClient();
  const [stats, setStats] = useState<VpnStats>(EMPTY_STATS);
  const rxHistory = useRef<number[]>([]);
  const txHistory = useRef<number[]>([]);
  const [series, setSeries] = useState<{ rx: number[]; tx: number[] }>({
    rx: [],
    tx: [],
  });

  useEffect(() => {
    const unsubs: Array<() => void> = [];

    subscribe<VpnStatus>(EVENTS.vpnStatus, (e) => {
      qc.setQueryData(["vpn", "status"], e.payload);
      if (!e.payload.connected) {
        setStats(EMPTY_STATS);
        rxHistory.current = [];
        txHistory.current = [];
        setSeries({ rx: [], tx: [] });
      }
    }).then((fn) => unsubs.push(fn));

    subscribe<VpnStats>(EVENTS.vpnStats, (e) => {
      setStats(e.payload);
      rxHistory.current = [...rxHistory.current, e.payload.rxRate].slice(
        -MAX_POINTS,
      );
      txHistory.current = [...txHistory.current, e.payload.txRate].slice(
        -MAX_POINTS,
      );
      setSeries({ rx: rxHistory.current, tx: txHistory.current });
    }).then((fn) => unsubs.push(fn));

    subscribe<string>(EVENTS.vpnError, (e) => {
      toast.error("VPN", { description: e.payload });
    }).then((fn) => unsubs.push(fn));

    return () => unsubs.forEach((fn) => fn());
  }, [qc]);

  return { stats, series };
}

// ---------------------------------------------------------------------------
// Server list
// ---------------------------------------------------------------------------

function ServerRow({
  server,
  selected,
  active,
  onSelect,
}: {
  server: VpnServer;
  selected: boolean;
  active: boolean;
  onSelect: () => void;
}) {
  return (
    <motion.button
      whileHover={{ y: -2 }}
      transition={{ duration: 0.18 }}
      onClick={onSelect}
      className={cn(
        "app-no-drag w-full rounded-xl border p-3 text-left transition-colors",
        active
          ? "border-success/40 bg-success/5"
          : selected
            ? "border-primary/50 bg-primary/5"
            : "border-border/70 bg-card-2/30 hover:border-primary/30",
      )}
    >
      <div className="flex items-center gap-3">
        <span className="text-2xl leading-none">{server.flag}</span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="truncate text-sm font-medium text-foreground">
              {server.city}
            </p>
            {active && (
              <Badge tone="success" className="px-1.5 py-0">
                <StatusDot tone="success" pulse /> Active
              </Badge>
            )}
          </div>
          <p className="truncate text-xs text-muted">{server.country}</p>
        </div>
        <div className="flex flex-col items-end gap-1.5">
          <Tooltip content={`Latency to ${server.city}`}>
            <span className="flex items-center gap-1 text-xs tabular-nums text-muted">
              <Signal className={cn("h-3 w-3", pingTextClass(server.pingMs))} />
              {server.pingMs} ms
            </span>
          </Tooltip>
          <Tooltip content={`Server load ${server.load}%`}>
            <div className="h-1.5 w-16 overflow-hidden rounded-full bg-card-2">
              <div
                className={cn("h-full rounded-full", loadBarClass(server.load))}
                style={{ width: `${server.load}%` }}
              />
            </div>
          </Tooltip>
        </div>
      </div>
    </motion.button>
  );
}

function ServerList({
  servers,
  loading,
  selectedId,
  activeId,
  onSelect,
  onRefresh,
  refreshing,
}: {
  servers: VpnServer[];
  loading: boolean;
  selectedId: string | null;
  activeId: string | null;
  onSelect: (id: string) => void;
  onRefresh: () => void;
  refreshing: boolean;
}) {
  return (
    <Card className="h-full">
      <CardHeader>
        <div>
          <CardTitle className="flex items-center gap-2">
            <Globe2 className="h-4 w-4 text-primary" /> Server locations
          </CardTitle>
          <CardDescription>
            Curated demo nodes · live ping &amp; load
          </CardDescription>
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={onRefresh}
          aria-label="Refresh servers"
        >
          <RefreshCw className={cn("h-4 w-4", refreshing && "animate-spin")} />
        </Button>
      </CardHeader>
      <CardContent className="space-y-2">
        {loading ? (
          Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-[58px] w-full rounded-xl" />
          ))
        ) : servers.length === 0 ? (
          <div className="py-10 text-center text-sm text-muted">
            No servers available.
          </div>
        ) : (
          servers.map((s) => (
            <ServerRow
              key={s.id}
              server={s}
              selected={selectedId === s.id}
              active={activeId === s.id}
              onSelect={() => onSelect(s.id)}
            />
          ))
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Connection control
// ---------------------------------------------------------------------------

function ConnectionPanel({
  status,
  selected,
  connecting,
  onToggle,
}: {
  status: VpnStatus | undefined;
  selected: VpnServer | null;
  connecting: boolean;
  onToggle: () => void;
}) {
  const connected = !!status?.connected;
  const [elapsed, setElapsed] = useState("00:00");

  useEffect(() => {
    if (!connected || !status?.since) {
      setElapsed("00:00");
      return;
    }
    const tick = () => setElapsed(formatElapsed(Date.now() - status.since!));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [connected, status?.since]);

  return (
    <Card className="relative overflow-hidden">
      {/* Ambient glow when connected */}
      <AnimatePresence>
        {connected && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="pointer-events-none absolute -top-24 left-1/2 h-64 w-64 -translate-x-1/2 rounded-full bg-success/20 blur-[90px]"
          />
        )}
      </AnimatePresence>

      <CardContent className="relative flex flex-col items-center gap-5 p-7">
        <div className="flex items-center gap-2">
          <Badge tone={connected ? "success" : "neutral"}>
            <StatusDot tone={connected ? "success" : "muted"} pulse={connected} />
            {connected ? "Connected" : "Disconnected"}
          </Badge>
          {status?.mode === "demo" && (
            <Tooltip content="Simulated tunnel: synthetic throughput, no OS network changes.">
              <span>
                <Badge tone="warning">Demo mode</Badge>
              </span>
            </Tooltip>
          )}
          {status?.mode === "real" && <Badge tone="primary">Real tunnel</Badge>}
        </div>

        {/* Power toggle */}
        <motion.button
          whileTap={{ scale: 0.95 }}
          onClick={onToggle}
          disabled={connecting}
          aria-label={connected ? "Disconnect" : "Connect"}
          className={cn(
            "app-no-drag relative flex h-36 w-36 items-center justify-center rounded-full border-2 transition-colors disabled:opacity-70",
            connected
              ? "border-success/60 bg-success/10 text-success shadow-lg shadow-success/20"
              : "border-border bg-card-2 text-muted hover:border-primary/50 hover:text-primary",
          )}
        >
          {connected && (
            <motion.span
              className="absolute inset-0 rounded-full border-2 border-success/40"
              animate={{ scale: [1, 1.18], opacity: [0.6, 0] }}
              transition={{ duration: 2, repeat: Infinity, ease: "easeOut" }}
            />
          )}
          {connecting ? (
            <Loader2 className="h-12 w-12 animate-spin" />
          ) : (
            <Power className="h-12 w-12" />
          )}
        </motion.button>

        <div className="text-center">
          {connected ? (
            <>
              <p className="flex items-center justify-center gap-1.5 text-2xl font-semibold tabular-nums text-foreground">
                <Clock className="h-4 w-4 text-success" /> {elapsed}
              </p>
              <p className="mt-0.5 text-xs text-muted">
                {selected
                  ? `${selected.flag} ${selected.city}, ${selected.country}`
                  : "Secure tunnel active"}
              </p>
            </>
          ) : (
            <>
              <p className="text-sm font-medium text-foreground">
                {selected
                  ? `Ready to connect — ${selected.city}`
                  : "Select a server to begin"}
              </p>
              <p className="mt-0.5 text-xs text-muted">
                Your traffic is not protected
              </p>
            </>
          )}
        </div>

        <Button
          variant={connected ? "danger" : "primary"}
          size="lg"
          className="w-full"
          onClick={onToggle}
          disabled={connecting}
        >
          {connecting ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" /> Working…
            </>
          ) : connected ? (
            "Disconnect"
          ) : (
            "Connect"
          )}
        </Button>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Throughput
// ---------------------------------------------------------------------------

function ThroughputPanel({
  stats,
  series,
  connected,
}: {
  stats: VpnStats;
  series: { rx: number[]; tx: number[] };
  connected: boolean;
}) {
  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle className="flex items-center gap-2">
            <Activity className="h-4 w-4 text-primary" /> Live throughput
          </CardTitle>
          <CardDescription>Real-time tunnel rates · last 60s</CardDescription>
        </div>
        {connected && (
          <Tooltip content="Last WireGuard handshake">
            <span className="flex items-center gap-1.5 text-xs text-muted">
              <ShieldCheck className="h-3.5 w-3.5 text-success" />
              {formatHandshake(stats.lastHandshake)}
            </span>
          </Tooltip>
        )}
      </CardHeader>
      <CardContent className="grid grid-cols-2 gap-3">
        <div className="rounded-xl border border-border/70 bg-card-2/40 p-3">
          <div className="flex items-center gap-1.5 text-xs text-muted">
            <ArrowDown className="h-3.5 w-3.5 text-success" /> Download
          </div>
          <p className="mt-1 text-xl font-semibold tabular-nums text-foreground">
            {formatRate(stats.rxRate)}
          </p>
          <p className="text-[11px] text-muted">{formatBytes(stats.rxBytes)} total</p>
          <div className="mt-2 h-10">
            <Sparkline data={series.rx} color="var(--color-success)" height={40} />
          </div>
        </div>
        <div className="rounded-xl border border-border/70 bg-card-2/40 p-3">
          <div className="flex items-center gap-1.5 text-xs text-muted">
            <ArrowUp className="h-3.5 w-3.5 text-primary" /> Upload
          </div>
          <p className="mt-1 text-xl font-semibold tabular-nums text-foreground">
            {formatRate(stats.txRate)}
          </p>
          <p className="text-[11px] text-muted">{formatBytes(stats.txBytes)} total</p>
          <div className="mt-2 h-10">
            <Sparkline data={series.tx} color="var(--color-primary)" height={40} />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Settings: kill switch + DNS leak protection
// ---------------------------------------------------------------------------

const DEFAULT_DNS = ["1.1.1.1", "1.0.0.1"];

function SettingsPanel({
  status,
  onImport,
}: {
  status: VpnStatus | undefined;
  onImport: () => void;
}) {
  const [killSwitch, setKillSwitch] = useState(false);
  const [dnsLeak, setDnsLeak] = useState(true);

  useEffect(() => {
    if (status) setKillSwitch(status.killSwitch);
  }, [status]);

  const toggleKill = async (v: boolean) => {
    setKillSwitch(v);
    try {
      await vpnApi.setKillSwitch(v);
      toast.success(`Kill switch ${v ? "enabled" : "disabled"}`, {
        description: "Stored preference (simulated in demo mode).",
      });
    } catch (e) {
      setKillSwitch(!v);
      toast.error("Failed to update kill switch", { description: String(e) });
    }
  };

  const toggleDns = async (v: boolean) => {
    setDnsLeak(v);
    try {
      await vpnApi.setDns(v ? DEFAULT_DNS : []);
      toast.success(`DNS-leak protection ${v ? "enabled" : "disabled"}`, {
        description: v
          ? `Routing DNS via ${DEFAULT_DNS.join(", ")} (simulated).`
          : "Using system DNS.",
      });
    } catch (e) {
      setDnsLeak(!v);
      toast.error("Failed to update DNS", { description: String(e) });
    }
  };

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle className="flex items-center gap-2">
            <Lock className="h-4 w-4 text-primary" /> Protection
          </CardTitle>
          <CardDescription>Kill switch, DNS &amp; configuration</CardDescription>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <ToggleRow
          title="Kill switch"
          desc="Block all traffic if the tunnel drops."
          checked={killSwitch}
          onChange={toggleKill}
          simulated
        />
        <ToggleRow
          title="DNS-leak protection"
          desc={`Force DNS through ${DEFAULT_DNS.join(", ")}.`}
          checked={dnsLeak}
          onChange={toggleDns}
          simulated
        />
        <div className="rounded-xl border border-border/70 bg-card-2/30 p-3">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-medium text-foreground">
                WireGuard config
              </p>
              <p className="text-xs text-muted">
                Import your own .conf for a real tunnel.
              </p>
            </div>
            <Button variant="secondary" size="sm" onClick={onImport}>
              <FileUp className="h-4 w-4" /> Import
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function ToggleRow({
  title,
  desc,
  checked,
  onChange,
  simulated,
}: {
  title: string;
  desc: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  simulated?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-border/70 bg-card-2/30 p-3">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <p className="text-sm font-medium text-foreground">{title}</p>
          {simulated && (
            <Tooltip content="Best-effort: stored preference, not enforced on the OS in demo mode.">
              <span>
                <Badge tone="warning" className="px-1.5 py-0 text-[10px]">
                  Simulated
                </Badge>
              </span>
            </Tooltip>
          )}
        </div>
        <p className="text-xs text-muted">{desc}</p>
      </div>
      <Switch checked={checked} onCheckedChange={onChange} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Import dialog (paste or pick a file)
// ---------------------------------------------------------------------------

function ImportDialog({
  open,
  onClose,
  onImported,
}: {
  open: boolean;
  onClose: () => void;
  onImported: () => void;
}) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  const pickFile = async () => {
    try {
      const { open: openDialog } = await import("@tauri-apps/plugin-dialog");
      const { readTextFile } = await import("@tauri-apps/plugin-fs");
      const selected = await openDialog({
        multiple: false,
        filters: [{ name: "WireGuard config", extensions: ["conf"] }],
      });
      if (typeof selected === "string") {
        setText(await readTextFile(selected));
      }
    } catch (e) {
      toast.error("Could not open file", { description: String(e) });
    }
  };

  const submit = async () => {
    if (!text.trim()) {
      toast.error("Paste or load a configuration first");
      return;
    }
    setBusy(true);
    try {
      const summary = await vpnApi.importConfig(text);
      toast.success("Configuration imported", { description: summary });
      setText("");
      onImported();
      onClose();
    } catch (e) {
      toast.error("Invalid configuration", { description: String(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
          onClick={onClose}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 12 }}
            transition={{ duration: 0.2 }}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-lg"
          >
            <Card>
              <CardHeader>
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <FileUp className="h-4 w-4 text-primary" /> Import WireGuard
                    config
                  </CardTitle>
                  <CardDescription>
                    Paste the .conf contents or load a file. Validated locally.
                  </CardDescription>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={onClose}
                  aria-label="Close"
                >
                  <X className="h-4 w-4" />
                </Button>
              </CardHeader>
              <CardContent className="space-y-3">
                <textarea
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  spellCheck={false}
                  placeholder={"[Interface]\nPrivateKey = ...\nAddress = 10.0.0.2/32\nDNS = 1.1.1.1\n\n[Peer]\nPublicKey = ...\nEndpoint = vpn.example.com:51820\nAllowedIPs = 0.0.0.0/0"}
                  className="app-no-drag h-52 w-full resize-none rounded-xl border border-border bg-card-2/50 p-3 font-mono text-xs text-foreground outline-none focus-visible:border-primary/50 focus-visible:ring-2 focus-visible:ring-primary/40"
                />
                <div className="flex items-center justify-between gap-2">
                  <Button variant="secondary" size="sm" onClick={pickFile}>
                    <FileUp className="h-4 w-4" /> Load file…
                  </Button>
                  <div className="flex gap-2">
                    <Button variant="ghost" size="sm" onClick={onClose}>
                      Cancel
                    </Button>
                    <Button size="sm" onClick={submit} disabled={busy}>
                      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                      Import
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export function VpnPage() {
  const qc = useQueryClient();
  const { stats, series } = useVpnLive();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);

  const statusQuery = useQuery({
    queryKey: ["vpn", "status"],
    queryFn: vpnApi.getStatus,
  });
  const serversQuery = useQuery({
    queryKey: ["vpn", "servers"],
    queryFn: vpnApi.listServers,
    refetchInterval: 15000,
  });

  const status = statusQuery.data;
  const connected = !!status?.connected;
  const servers = serversQuery.data ?? [];

  // Default selection follows the active server, else the first/lowest ping.
  useEffect(() => {
    if (selectedId) return;
    if (status?.serverId) setSelectedId(status.serverId);
    else if (servers.length) setSelectedId(servers[0].id);
  }, [status?.serverId, servers, selectedId]);

  const selectedServer = useMemo(
    () => servers.find((s) => s.id === selectedId) ?? null,
    [servers, selectedId],
  );

  const connectMut = useMutation({
    mutationFn: (id: string | undefined) => vpnApi.connect(id),
    onSuccess: (s) => qc.setQueryData(["vpn", "status"], s),
    onError: (e) =>
      toast.error("Failed to connect", { description: String(e) }),
  });
  const disconnectMut = useMutation({
    mutationFn: () => vpnApi.disconnect(),
    onSuccess: () => statusQuery.refetch(),
    onError: (e) =>
      toast.error("Failed to disconnect", { description: String(e) }),
  });

  const busy = connectMut.isPending || disconnectMut.isPending;

  const toggle = () => {
    if (connected) disconnectMut.mutate();
    else connectMut.mutate(selectedId ?? undefined);
  };

  return (
    <TooltipProvider delayDuration={200}>
      <PageHeader
        title="VPN"
        subtitle="Encrypted WireGuard tunnel & global servers"
        icon={Globe2}
        actions={
          <Badge tone={connected ? "success" : "neutral"}>
            <StatusDot tone={connected ? "success" : "muted"} pulse={connected} />
            {connected ? "Protected" : "Unprotected"}
          </Badge>
        }
      />

      <div className="grid gap-4 lg:grid-cols-3">
        {/* Left: servers */}
        <div className="lg:col-span-1">
          <ServerList
            servers={servers}
            loading={serversQuery.isLoading}
            selectedId={selectedId}
            activeId={connected ? (status?.serverId ?? null) : null}
            onSelect={setSelectedId}
            onRefresh={() => serversQuery.refetch()}
            refreshing={serversQuery.isFetching}
          />
        </div>

        {/* Right: control + telemetry + settings */}
        <div className="space-y-4 lg:col-span-2">
          <ConnectionPanel
            status={status}
            selected={selectedServer}
            connecting={busy}
            onToggle={toggle}
          />
          <div className="grid gap-4 md:grid-cols-2">
            <ThroughputPanel
              stats={connected ? stats : EMPTY_STATS}
              series={series}
              connected={connected}
            />
            <SettingsPanel status={status} onImport={() => setImportOpen(true)} />
          </div>
        </div>
      </div>

      <ImportDialog
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onImported={() => qc.invalidateQueries({ queryKey: ["vpn", "status"] })}
      />
    </TooltipProvider>
  );
}
