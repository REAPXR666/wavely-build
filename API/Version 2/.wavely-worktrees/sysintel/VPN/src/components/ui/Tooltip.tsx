import * as React from "react";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import { cn } from "@/lib/utils";

export const TooltipProvider = TooltipPrimitive.Provider;

interface TooltipProps {
  content: React.ReactNode;
  children: React.ReactNode;
  side?: "top" | "right" | "bottom" | "left";
  className?: string;
}

/** Convenience wrapper: `<Tooltip content="...">{trigger}</Tooltip>`. */
export function Tooltip({
  content,
  children,
  side = "top",
  className,
}: TooltipProps) {
  if (content == null || content === "") return <>{children}</>;
  return (
    <TooltipPrimitive.Root>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          side={side}
          sideOffset={8}
          className={cn(
            "z-50 max-w-xs rounded-lg border border-border bg-card-2/95 px-3 py-1.5 text-xs text-foreground shadow-xl backdrop-blur",
            className,
          )}
        >
          {content}
          <TooltipPrimitive.Arrow className="fill-card-2" />
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}
