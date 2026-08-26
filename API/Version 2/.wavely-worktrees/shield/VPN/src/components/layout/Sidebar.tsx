import { AnimatePresence, motion } from "framer-motion";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { NAV_ITEMS, type NavItem } from "@/app/nav";
import { useUiStore } from "@/app/store";
import { Tooltip } from "@/components/ui/Tooltip";
import { StatusDot } from "@/components/ui/StatusDot";
import { cn } from "@/lib/utils";

function NavButton({
  item,
  active,
  collapsed,
  onClick,
}: {
  item: NavItem;
  active: boolean;
  collapsed: boolean;
  onClick: () => void;
}) {
  const Icon = item.icon;
  const button = (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "group relative flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-colors",
        active
          ? "text-foreground"
          : "text-muted hover:bg-card-2/70 hover:text-foreground",
        collapsed && "justify-center px-0",
      )}
    >
      {active && (
        <motion.span
          layoutId="nav-active"
          className="absolute inset-0 rounded-xl border border-primary/30 bg-primary/10"
          transition={{ type: "spring", stiffness: 400, damping: 32 }}
        />
      )}
      <Icon
        className={cn(
          "relative z-10 h-[18px] w-[18px] shrink-0 transition-colors",
          active && "text-primary",
        )}
      />
      {!collapsed && (
        <span className="relative z-10 truncate font-medium">{item.label}</span>
      )}
    </button>
  );

  return collapsed ? (
    <Tooltip content={item.label} side="right">
      {button}
    </Tooltip>
  ) : (
    button
  );
}

export function Sidebar() {
  const { route, setRoute, sidebarCollapsed, toggleSidebar } = useUiStore();
  const groups: Array<{ key: NavItem["group"]; label: string }> = [
    { key: "main", label: "Protection" },
    { key: "system", label: "Insights" },
  ];

  return (
    <motion.aside
      animate={{ width: sidebarCollapsed ? 76 : 248 }}
      transition={{ type: "spring", stiffness: 300, damping: 30 }}
      className="relative z-10 flex shrink-0 flex-col border-r border-border/60 bg-background/40 p-3 backdrop-blur"
    >
      <nav className="flex-1 space-y-5 overflow-y-auto">
        {groups.map((group) => (
          <div key={group.key}>
            <AnimatePresence initial={false}>
              {!sidebarCollapsed && (
                <motion.p
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="px-3 pb-2 text-[10px] font-semibold uppercase tracking-widest text-muted/70"
                >
                  {group.label}
                </motion.p>
              )}
            </AnimatePresence>
            <div className="space-y-1">
              {NAV_ITEMS.filter((i) => i.group === group.key).map((item) => (
                <NavButton
                  key={item.id}
                  item={item}
                  active={route === item.id}
                  collapsed={sidebarCollapsed}
                  onClick={() => setRoute(item.id)}
                />
              ))}
            </div>
          </div>
        ))}
      </nav>

      <div className="mt-3 space-y-2 border-t border-border/60 pt-3">
        <div
          className={cn(
            "flex items-center gap-2 rounded-xl bg-card-2/60 px-3 py-2",
            sidebarCollapsed && "justify-center",
          )}
        >
          <StatusDot tone="success" pulse />
          {!sidebarCollapsed && (
            <span className="text-xs text-muted">Protected</span>
          )}
        </div>
        <button
          type="button"
          onClick={toggleSidebar}
          className={cn(
            "flex w-full items-center gap-3 rounded-xl px-3 py-2 text-sm text-muted transition-colors hover:bg-card-2/70 hover:text-foreground",
            sidebarCollapsed && "justify-center px-0",
          )}
        >
          {sidebarCollapsed ? (
            <PanelLeftOpen className="h-[18px] w-[18px]" />
          ) : (
            <>
              <PanelLeftClose className="h-[18px] w-[18px]" />
              <span>Collapse</span>
            </>
          )}
        </button>
      </div>
    </motion.aside>
  );
}
