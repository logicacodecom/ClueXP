"use client";

import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../lib/cn";

const badgeVariants = cva(
  "inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-normal tabular-nums transition-colors",
  {
    variants: {
      variant: {
        neutral: "border-border bg-secondary text-secondary-foreground",
        info: "border-info/35 bg-info/12 text-info",
        success: "border-success/35 bg-success/12 text-success",
        warn: "border-warn/40 bg-warn/12 text-warn",
        danger: "border-destructive/40 bg-destructive/12 text-destructive",
        critical: "border-destructive bg-destructive/20 text-destructive",
        outline: "border-border bg-transparent text-muted-foreground"
      }
    },
    defaultVariants: {
      variant: "neutral"
    }
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { badgeVariants };
