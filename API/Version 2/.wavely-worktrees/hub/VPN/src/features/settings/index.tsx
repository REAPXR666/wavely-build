import { useMemo, type ReactNode } from "react";
import { motion } from "framer-motion";
import {
  Bell,
  Check,
  Globe2,
  Info,
  Moon,
  Palette,
  Power,
  RotateCcw,
  Settings as SettingsIcon,
  ShieldCheck,
  Sun,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";
import { useUiStore, type Theme } from "@/app/store";
import { PageHeader } from "@/components/PageHeader";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Skeleton } from "@/components/ui/Skeleton";
import { Spinner } from "@/components/ui/Spinner";
import { Switch } from "@/components/ui/Switch";
import { Tooltip } from "@/components/ui/Tooltip";
import { shieldApi } from "@/lib/ipc/shield";
import { vpnApi } from "@/lib/ipc/vpn";
import { cn } from "@/lib/utils";
import {
  usePreferences,
  type Preferences,
} from "@/features/settings/usePreferences";

/** App identity — bump in lockstep with package.json / tauri.conf.json. */
const APP_NAME = "Wavely Protection";
const APP_VERSION = "0.1.0";

const LIMITATIONS: string[] = [
  "Protection runs at the user level — there is no kernel driver, so real-time scanning is best-effort and not a replacement for a certified anti-virus engine.",
  "Threat signatures and rules are illustrative; detections shown in Analytics reflect whatever the Shield engine reports.",
  "The VPN ships with demo servers for evaluation. Import your own WireGuard configuration for a real encrypted tunnel.",
  "Launch-at-startup, tray and notification preferences are saved locally and applied by the OS integration where the platform supports it.",
  "All preferences and analytics history are stored locally on this device only — nothing is synced to the cloud.",
];

function SettingsSection({
  icon: Icon,
  title,
  description,
  children,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <motion.div whileHover={{ y: -2 }} transition={{ duration: 0.2 }}>
      <Card className="h-full">
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-border bg-card-2 text-primary">
              <Icon className="h-5 w-5" />
            </div>
            <div>
              <CardTitle>{title}</CardTitle>
              <CardDescription>{description}</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="pt-1">
          <div className="divide-y divide-border/60">{children}</div>
        </CardContent>
      </Card>
    </motion.div>
  );
}

function SettingRow({
  label,
  description,
  info,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  description?: string;
  info?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-3.5 first:pt-1.5 last:pb-1.5">
      <div className="min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="text-sm font-medium text-foreground">{label}</span>
          {info && (
            <Tooltip content={info}>
              <Info className="app-no-drag h-3.5 w-3.5 cursor-help text-muted" />
            </Tooltip>
          )}
        </div>
        {description && (
          <p className="mt-0.5 text-xs text-muted">{description}</p>
        )}
      </div>
      <Switch
        checked={checked}
        onCheckedChange={onChange}
        disabled={disabled}
        aria-label={label}
      />
    </div>
  );
}

function ThemeOption({
  active,
  icon: Icon,
  label,
  onClick,
}: {
  active: boolean;
  icon: LucideIcon;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "app-no-drag flex flex-1 items-center justify-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition-all",
        active
          ? "border-primary/50 bg-primary/10 text-primary"
          : "border-border bg-card-2 text-muted hover:text-foreground",
      )}
    >
      <Icon className="h-4 w-4" />
      {label}
    </button>
  );
}

export function SettingsPage() {
  const { prefs, update, reset, loaded, saveState } = usePreferences();
  const theme = useUiStore((s) => s.theme);
  const setTheme = useUiStore((s) => s.setTheme);

  // Toggle a preference, optionally invoking a backend command so the choice
  // takes effect immediately (best-effort — engines may still be initializing).
  const set = <K extends keyof Preferences>(key: K) => (value: Preferences[K]) => {
    update(key, value);
    if (key === "realtimeProtection") {
      shieldApi.setRealtime(Boolean(value)).catch(() => {});
    } else if (key === "killSwitch") {
      vpnApi.setKillSwitch(Boolean(value)).catch(() => {});
    }
  };

  const chooseTheme = (t: Theme) => {
    setTheme(t);
    toast.success(`${t === "dark" ? "Dark" : "Light"} theme applied`);
  };

  const saveIndicator = useMemo(() => {
    if (saveState === "saving") {
      return (
        <Badge tone="neutral">
          <Spinner className="h-3 w-3" /> Saving…
        </Badge>
      );
    }
    if (saveState === "saved") {
      return (
        <Badge tone="success">
          <Check className="h-3 w-3" /> Saved
        </Badge>
      );
    }
    return (
      <Badge tone="neutral">
        <Check className="h-3 w-3" /> All changes saved
      </Badge>
    );
  }, [saveState]);

  if (!loaded) {
    return (
      <div>
        <PageHeader
          title="Settings"
          subtitle="Preferences & app configuration"
          icon={SettingsIcon}
        />
        <div className="grid gap-5 lg:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-64 w-full rounded-2xl" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Settings"
        subtitle="Preferences & app configuration"
        icon={SettingsIcon}
        actions={
          <>
            {saveIndicator}
            <Button variant="secondary" size="sm" onClick={reset}>
              <RotateCcw className="h-3.5 w-3.5" /> Reset defaults
            </Button>
          </>
        }
      />

      <div className="grid gap-5 lg:grid-cols-2">
        {/* Appearance */}
        <SettingsSection
          icon={Palette}
          title="Appearance"
          description="Theme and visual preferences"
        >
          <div className="py-3.5 first:pt-1.5">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-sm font-medium text-foreground">Theme</p>
                <p className="mt-0.5 text-xs text-muted">
                  Dark is the default. Light mode is fully supported.
                </p>
              </div>
            </div>
            <div className="mt-3 flex gap-2">
              <ThemeOption
                active={theme === "dark"}
                icon={Moon}
                label="Dark"
                onClick={() => chooseTheme("dark")}
              />
              <ThemeOption
                active={theme === "light"}
                icon={Sun}
                label="Light"
                onClick={() => chooseTheme("light")}
              />
            </div>
          </div>
        </SettingsSection>

        {/* Protection */}
        <SettingsSection
          icon={ShieldCheck}
          title="Protection"
          description="Security engine defaults"
        >
          <SettingRow
            label="Real-time protection"
            description="Monitor files as they are accessed"
            info="Applied to the Shield engine immediately. User-level monitoring only."
            checked={prefs.realtimeProtection}
            onChange={set("realtimeProtection")}
          />
          <SettingRow
            label="Scan on startup"
            description="Run a quick scan when the app launches"
            checked={prefs.scanOnStartup}
            onChange={set("scanOnStartup")}
          />
          <SettingRow
            label="Scan removable drives"
            description="Automatically scan USB and external drives"
            checked={prefs.scanRemovableDrives}
            onChange={set("scanRemovableDrives")}
          />
          <SettingRow
            label="Auto-quarantine threats"
            description="Isolate detected threats without prompting"
            checked={prefs.autoQuarantine}
            onChange={set("autoQuarantine")}
          />
        </SettingsSection>

        {/* VPN */}
        <SettingsSection
          icon={Globe2}
          title="VPN"
          description="Tunnel connection defaults"
        >
          <SettingRow
            label="Auto-connect on launch"
            description="Establish the tunnel when Wavely starts"
            checked={prefs.autoConnectVpn}
            onChange={set("autoConnectVpn")}
          />
          <SettingRow
            label="Kill switch"
            description="Block traffic if the VPN disconnects"
            info="Applied to the VPN engine immediately."
            checked={prefs.killSwitch}
            onChange={set("killSwitch")}
          />
          <SettingRow
            label="Block LAN while connected"
            description="Disallow local network access over the tunnel"
            checked={prefs.blockLanWhileConnected}
            onChange={set("blockLanWhileConnected")}
          />
        </SettingsSection>

        {/* Notifications */}
        <SettingsSection
          icon={Bell}
          title="Notifications"
          description="What Wavely alerts you about"
        >
          <SettingRow
            label="Threat detections"
            description="Notify when a threat is found"
            checked={prefs.notifyThreats}
            onChange={set("notifyThreats")}
          />
          <SettingRow
            label="VPN status changes"
            description="Notify on connect / disconnect"
            checked={prefs.notifyVpnChanges}
            onChange={set("notifyVpnChanges")}
          />
          <SettingRow
            label="Scan completion"
            description="Notify when a scan finishes"
            checked={prefs.notifyScanComplete}
            onChange={set("notifyScanComplete")}
          />
          <SettingRow
            label="Sound alerts"
            description="Play a sound for important events"
            checked={prefs.soundAlerts}
            onChange={set("soundAlerts")}
          />
        </SettingsSection>

        {/* Startup & tray */}
        <SettingsSection
          icon={Power}
          title="Startup & Tray"
          description="Launch and background behavior"
        >
          <SettingRow
            label="Launch at startup"
            description="Start Wavely when you sign in"
            info="Saved here and applied by the OS integration where supported."
            checked={prefs.launchAtStartup}
            onChange={set("launchAtStartup")}
          />
          <SettingRow
            label="Start minimized"
            description="Launch hidden in the system tray"
            checked={prefs.startMinimized}
            onChange={set("startMinimized")}
          />
          <SettingRow
            label="Minimize to tray"
            description="Keep running in the tray when minimized"
            checked={prefs.minimizeToTray}
            onChange={set("minimizeToTray")}
          />
          <SettingRow
            label="Close to tray"
            description="Keep running in the tray when the window is closed"
            checked={prefs.closeToTray}
            onChange={set("closeToTray")}
          />
        </SettingsSection>

        {/* About */}
        <SettingsSection
          icon={Info}
          title="About"
          description="Version & honest limitations"
        >
          <div className="py-3.5 first:pt-1.5">
            <div className="flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-border bg-gradient-to-br from-card to-card-2 text-primary glow">
                <ShieldCheck className="h-6 w-6" />
              </div>
              <div>
                <p className="text-sm font-semibold text-foreground">
                  {APP_NAME}
                </p>
                <p className="text-xs text-muted">
                  Version {APP_VERSION} · Local desktop build
                </p>
              </div>
              <Badge tone="primary" className="ml-auto">
                Up to date
              </Badge>
            </div>
            <div className="mt-4">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">
                Acknowledged limitations
              </p>
              <ul className="space-y-2">
                {LIMITATIONS.map((l) => (
                  <li
                    key={l}
                    className="flex items-start gap-2 text-xs leading-relaxed text-foreground/80"
                  >
                    <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
                    <span>{l}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </SettingsSection>
      </div>

      <p className="mt-6 text-center text-[11px] text-muted">
        Preferences are saved automatically to local storage on this device.
      </p>
    </div>
  );
}
