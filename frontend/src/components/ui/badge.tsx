"use client";

import { cn } from "@/lib/utils/cn";

interface BadgeProps {
  variant?: "default" | "success" | "danger" | "warning" | "info";
  size?: "sm" | "md";
  children: React.ReactNode;
  className?: string;
}

export function Badge({
  variant = "default",
  size = "sm",
  children,
  className,
}: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full font-medium",
        {
          "px-2 py-0.5 text-xs": size === "sm",
          "px-2.5 py-1 text-sm": size === "md",
        },
        {
          "bg-glass text-gray-300": variant === "default",
          "bg-profit/20 text-profit": variant === "success",
          "bg-loss/20 text-loss": variant === "danger",
          "bg-warning/20 text-warning": variant === "warning",
          "bg-neon-blue/20 text-neon-blue": variant === "info",
        },
        className
      )}
    >
      {children}
    </span>
  );
}

// Status badge with dot indicator
interface StatusBadgeProps {
  status: "online" | "offline" | "pending" | "error";
  label?: string;
  className?: string;
}

export function StatusBadge({ status, label, className }: StatusBadgeProps) {
  const statusConfig = {
    online: { color: "bg-profit", text: "Online" },
    offline: { color: "bg-gray-500", text: "Offline" },
    pending: { color: "bg-warning", text: "Pending" },
    error: { color: "bg-loss", text: "Error" },
  };

  const config = statusConfig[status];

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 text-sm text-gray-300",
        className
      )}
    >
      <span
        className={cn("h-2 w-2 rounded-full", config.color, {
          "animate-pulse": status === "pending",
        })}
      />
      {label || config.text}
    </span>
  );
}
