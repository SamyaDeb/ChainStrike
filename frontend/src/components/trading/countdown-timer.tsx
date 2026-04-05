"use client";

import { useState, useEffect } from "react";
import { Clock } from "lucide-react";

interface CountdownTimerProps {
  expiryTimestamp: number;
  className?: string;
}

export function CountdownTimer({ expiryTimestamp, className = "" }: CountdownTimerProps) {
  const [remaining, setRemaining] = useState(0);

  useEffect(() => {
    const updateRemaining = () => {
      const now = Math.floor(Date.now() / 1000);
      const diff = expiryTimestamp - now;
      setRemaining(Math.max(0, diff));
    };

    // Initial update
    updateRemaining();

    // Update every second
    const interval = setInterval(updateRemaining, 1000);

    return () => clearInterval(interval);
  }, [expiryTimestamp]);

  // Expired
  if (remaining <= 0) {
    return (
      <span className={`text-loss font-medium ${className}`}>
        Expired
      </span>
    );
  }

  // Less than 1 minute - show seconds with pulse animation
  if (remaining < 60) {
    return (
      <span className={`text-warning font-mono animate-pulse inline-flex items-center gap-1 ${className}`}>
        <Clock className="w-3 h-3" />
        {remaining}s
      </span>
    );
  }

  // Less than 5 minutes - show mm:ss
  if (remaining < 300) {
    const minutes = Math.floor(remaining / 60);
    const seconds = remaining % 60;
    return (
      <span className={`text-warning font-mono inline-flex items-center gap-1 ${className}`}>
        <Clock className="w-3 h-3" />
        {minutes}m {seconds}s
      </span>
    );
  }

  // Less than 1 hour - show minutes
  if (remaining < 3600) {
    const minutes = Math.floor(remaining / 60);
    return (
      <span className={`text-gray-300 font-mono inline-flex items-center gap-1 ${className}`}>
        <Clock className="w-3 h-3" />
        {minutes}m
      </span>
    );
  }

  // Less than 1 day - show hours
  if (remaining < 86400) {
    const hours = Math.floor(remaining / 3600);
    return (
      <span className={`text-gray-400 font-mono inline-flex items-center gap-1 ${className}`}>
        <Clock className="w-3 h-3" />
        {hours}h
      </span>
    );
  }

  // 1+ days - show days
  const days = Math.floor(remaining / 86400);
  return (
    <span className={`text-gray-400 font-mono inline-flex items-center gap-1 ${className}`}>
      <Clock className="w-3 h-3" />
      {days}d
    </span>
  );
}
