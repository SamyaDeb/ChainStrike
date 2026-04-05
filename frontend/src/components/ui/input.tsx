"use client";

import { forwardRef, type InputHTMLAttributes } from "react";
import { cn } from "@/lib/utils/cn";

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  hint?: string;
  leftElement?: React.ReactNode;
  rightElement?: React.ReactNode;
}

const Input = forwardRef<HTMLInputElement, InputProps>(
  (
    { className, type, label, error, hint, leftElement, rightElement, ...props },
    ref
  ) => {
    return (
      <div className="w-full">
        {label && (
          <label className="block text-sm font-medium text-gray-300 mb-2">
            {label}
          </label>
        )}
        <div className="relative">
          {leftElement && (
            <div className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">
              {leftElement}
            </div>
          )}
          <input
            type={type}
            className={cn(
              "flex h-11 w-full rounded-xl border bg-dark-800 px-4 py-2 text-sm text-white",
              "border-glass-border placeholder:text-gray-500",
              "focus:outline-none focus:ring-1 focus:ring-neon-green/50 focus:border-neon-green/50",
              "transition-all duration-200",
              "disabled:cursor-not-allowed disabled:opacity-50",
              leftElement && "pl-10",
              rightElement && "pr-10",
              error && "border-loss focus:ring-loss/50 focus:border-loss/50",
              className
            )}
            ref={ref}
            {...props}
          />
          {rightElement && (
            <div className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400">
              {rightElement}
            </div>
          )}
        </div>
        {error && <p className="mt-1.5 text-sm text-loss">{error}</p>}
        {hint && !error && (
          <p className="mt-1.5 text-sm text-gray-500">{hint}</p>
        )}
      </div>
    );
  }
);

Input.displayName = "Input";

export { Input };

// Number input with increment/decrement
export interface NumberInputProps extends Omit<InputProps, "type" | "onChange"> {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
}

export const NumberInput = forwardRef<HTMLInputElement, NumberInputProps>(
  ({ value, onChange, min, max, step = 1, className, ...props }, ref) => {
    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      const newValue = parseFloat(e.target.value);
      if (!isNaN(newValue)) {
        if (min !== undefined && newValue < min) return;
        if (max !== undefined && newValue > max) return;
        onChange(newValue);
      }
    };

    const increment = () => {
      const newValue = value + step;
      if (max !== undefined && newValue > max) return;
      onChange(newValue);
    };

    const decrement = () => {
      const newValue = value - step;
      if (min !== undefined && newValue < min) return;
      onChange(newValue);
    };

    return (
      <div className="relative">
        <Input
          ref={ref}
          type="number"
          value={value}
          onChange={handleChange}
          min={min}
          max={max}
          step={step}
          className={cn("pr-20", className)}
          {...props}
        />
        <div className="absolute right-1 top-1/2 -translate-y-1/2 flex gap-1">
          <button
            type="button"
            onClick={decrement}
            className="h-8 w-8 rounded-lg bg-dark-700 hover:bg-dark-600 flex items-center justify-center text-gray-400 hover:text-white transition-colors"
          >
            -
          </button>
          <button
            type="button"
            onClick={increment}
            className="h-8 w-8 rounded-lg bg-dark-700 hover:bg-dark-600 flex items-center justify-center text-gray-400 hover:text-white transition-colors"
          >
            +
          </button>
        </div>
      </div>
    );
  }
);

NumberInput.displayName = "NumberInput";
