"use client";

import { cn } from "@/lib/utils/cn";

interface PriceDisplayProps {
  price: number;
  change?: number;
  size?: "sm" | "md" | "lg";
  showChange?: boolean;
  prefix?: string;
  className?: string;
}

export function PriceDisplay({
  price,
  change,
  size = "md",
  showChange = true,
  prefix = "$",
  className,
}: PriceDisplayProps) {
  const isPositive = change !== undefined && change >= 0;

  const sizeClasses = {
    sm: "text-sm",
    md: "text-lg",
    lg: "text-2xl",
  };

  const changeSizeClasses = {
    sm: "text-xs",
    md: "text-sm",
    lg: "text-base",
  };

  return (
    <div className={cn("flex items-baseline gap-2", className)}>
      <span className={cn("font-bold text-white", sizeClasses[size])}>
        {prefix}
        {price.toLocaleString(undefined, {
          minimumFractionDigits: 4,
          maximumFractionDigits: 4,
        })}
      </span>
      {showChange && change !== undefined && (
        <span
          className={cn(
            "font-medium",
            changeSizeClasses[size],
            isPositive ? "text-profit" : "text-loss"
          )}
        >
          {isPositive ? "+" : ""}
          {change.toFixed(2)}%
        </span>
      )}
    </div>
  );
}

interface PnLDisplayProps {
  value: number;
  percent?: number;
  size?: "sm" | "md" | "lg";
  showPercent?: boolean;
  className?: string;
}

export function PnLDisplay({
  value,
  percent,
  size = "md",
  showPercent = true,
  className,
}: PnLDisplayProps) {
  const isPositive = value >= 0;

  const sizeClasses = {
    sm: "text-sm",
    md: "text-base",
    lg: "text-xl",
  };

  return (
    <div
      className={cn(
        "font-semibold",
        sizeClasses[size],
        isPositive ? "text-profit" : "text-loss",
        className
      )}
    >
      {isPositive ? "+" : ""}${Math.abs(value).toLocaleString(undefined, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })}
      {showPercent && percent !== undefined && (
        <span className="ml-1 text-sm opacity-80">
          ({isPositive ? "+" : ""}
          {percent.toFixed(2)}%)
        </span>
      )}
    </div>
  );
}
