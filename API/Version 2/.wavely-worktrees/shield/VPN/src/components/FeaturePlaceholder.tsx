import { motion } from "framer-motion";
import { Check, Hammer, type LucideIcon } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";

/**
 * Branded placeholder for modules that are scaffolded but not yet implemented.
 * Each engine agent replaces the corresponding feature page with the real UI.
 */
export function FeaturePlaceholder({
  icon,
  title,
  subtitle,
  capabilities,
  owner,
}: {
  icon: LucideIcon;
  title: string;
  subtitle: string;
  capabilities: string[];
  owner: string;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: "easeOut" }}
    >
      <PageHeader
        title={title}
        subtitle={subtitle}
        icon={icon}
        actions={
          <Badge tone="primary">
            <Hammer className="h-3 w-3" /> In&nbsp;development
          </Badge>
        }
      />

      <div className="grid gap-5 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardContent className="pt-5">
            <h3 className="mb-1 text-sm font-semibold text-foreground">
              Planned capabilities
            </h3>
            <p className="mb-4 text-xs text-muted">
              This module is wired into the app shell and IPC layer. Real
              functionality lands when the{" "}
              <span className="text-primary">{owner}</span> engine is built.
            </p>
            <ul className="grid gap-2.5 sm:grid-cols-2">
              {capabilities.map((cap) => (
                <li
                  key={cap}
                  className="flex items-start gap-2 rounded-xl border border-border/70 bg-card-2/50 p-3 text-sm text-foreground/90"
                >
                  <Check className="mt-0.5 h-4 w-4 shrink-0 text-success" />
                  <span>{cap}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        <Card className="relative overflow-hidden">
          <div className="bg-grid pointer-events-none absolute inset-0 opacity-40" />
          <CardContent className="relative flex h-full flex-col items-center justify-center gap-3 py-10 text-center">
            <motion.div
              animate={{ y: [0, -8, 0] }}
              transition={{ duration: 5, repeat: Infinity, ease: "easeInOut" }}
              className="flex h-16 w-16 items-center justify-center rounded-2xl border border-border bg-gradient-to-br from-card to-card-2 text-primary glow"
            >
              {(() => {
                const Icon = icon;
                return <Icon className="h-7 w-7" />;
              })()}
            </motion.div>
            <p className="text-sm font-medium text-foreground">{title}</p>
            <p className="text-xs text-muted">
              Connected to backend · awaiting engine
            </p>
          </CardContent>
        </Card>
      </div>
    </motion.div>
  );
}
