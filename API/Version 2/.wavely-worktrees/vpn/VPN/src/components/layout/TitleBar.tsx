import { getCurrentWindow } from "@tauri-apps/api/window";
import { Minus, ShieldCheck, Square, X } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

const appWindow = getCurrentWindow();

function ControlButton({
  onClick,
  label,
  danger,
  children,
}: {
  onClick: () => void;
  label: string;
  danger?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className={cn(
        "app-no-drag flex h-7 w-9 items-center justify-center rounded-md text-muted transition-colors hover:text-foreground",
        danger ? "hover:bg-danger hover:text-white" : "hover:bg-card-2",
      )}
    >
      {children}
    </button>
  );
}

export function TitleBar() {
  return (
    <header className="app-drag relative z-20 flex h-11 shrink-0 items-center justify-between border-b border-border/60 bg-background/60 px-3 backdrop-blur">
      <div className="flex items-center gap-2.5">
        <div className="flex h-6 w-6 items-center justify-center rounded-lg bg-gradient-to-br from-primary to-accent shadow shadow-primary/30">
          <ShieldCheck className="h-3.5 w-3.5 text-background" />
        </div>
        <span className="text-xs font-semibold tracking-wide text-foreground/90">
          Wavely <span className="text-muted">Protection</span>
        </span>
      </div>

      <div className="app-no-drag flex items-center gap-1">
        <ControlButton onClick={() => appWindow.minimize()} label="Minimize">
          <Minus className="h-3.5 w-3.5" />
        </ControlButton>
        <ControlButton
          onClick={() => appWindow.toggleMaximize()}
          label="Maximize"
        >
          <Square className="h-3 w-3" />
        </ControlButton>
        <ControlButton onClick={() => appWindow.close()} label="Close" danger>
          <X className="h-3.5 w-3.5" />
        </ControlButton>
      </div>
    </header>
  );
}
