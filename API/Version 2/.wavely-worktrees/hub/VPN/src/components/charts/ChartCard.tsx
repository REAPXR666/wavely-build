import { motion } from "framer-motion";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Card, CardContent } from "@/components/ui/Card";
import { cn } from "@/lib/utils";

/**
 * Consistent framed container for a chart or visualization. Provides the title
 * row (icon + title + optional hint/actions) and a fixed-height plot area so
 * every analytics card lines up. Hover-lift matches the Dashboard.
 */
export function ChartCard({
  title,
  icon: Icon,
  hint,
  actions,
  children,
  className,
  bodyClassName,
  lift = true,
}: {
  title: string;
  icon?: LucideIcon;
  /** Small right-aligned text (e.g. "session only", "last 24h"). */
  hint?: ReactNode;
  /** Right-aligned interactive controls. */
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
  lift?: boolean;
}) {
  return (
    <motion.div
      whileHover={lift ? { y: -3 } : undefined}
      transition={{ duration: 0.2 }}
      className="h-full"
    >
      <Card className={cn("h-full", className)}>
        <CardContent className="flex h-full flex-col p-5">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              {Icon && <Icon className="h-4 w-4 text-primary" />}
              <h3 className="text-sm font-semibold text-foreground">{title}</h3>
            </div>
            <div className="flex items-center gap-2">
              {actions}
              {hint && <span className="text-xs text-muted">{hint}</span>}
            </div>
          </div>
          <div className={cn("flex-1", bodyClassName)}>{children}</div>
        </CardContent>
      </Card>
    </motion.div>
  );
}
