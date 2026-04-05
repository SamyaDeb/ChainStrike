"use client";

/**
 * Official Algorand logo SVG component.
 * Renders the Algorand triangle mark with optional glow effect.
 */
export function AlgorandLogo({
  size = 24,
  className = "",
  withGlow = false,
}: {
  size?: number;
  className?: string;
  withGlow?: boolean;
}) {
  return (
    <div
      className={`relative inline-flex items-center justify-center ${className}`}
      style={{ width: size, height: size }}
    >
      {withGlow && (
        <div
          className="absolute inset-0 bg-neon-green/20 rounded-full blur-md animate-pulse-glow"
          style={{ width: size * 1.5, height: size * 1.5, top: -(size * 0.25), left: -(size * 0.25) }}
        />
      )}
      <svg
        viewBox="0 0 400 400"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        width={size}
        height={size}
        className="relative z-10"
      >
        <path
          d="M280.12 346.5H328.54L265.85 195.66L296.68 134.08L382.42 346.5H331.24H280.12Z"
          fill="currentColor"
        />
        <path
          d="M204.24 346.5L228.85 259.44L177.72 346.5H131.13L218.02 195.66L228.85 153.36L106.38 346.5H59.79L224.29 53.5H272.71L257.32 117.62L244.27 170.97L295.4 346.5H247.88H204.24Z"
          fill="currentColor"
        />
      </svg>
    </div>
  );
}

/**
 * Algorand coin badge — shows the logo + "ALGO" text.
 */
export function AlgoCoinBadge({
  size = "md",
  showName = true,
  showSubtitle = false,
}: {
  size?: "sm" | "md" | "lg";
  showName?: boolean;
  showSubtitle?: boolean;
}) {
  const sizeMap = {
    sm: { logo: 14, icon: 24, text: "text-xs", sub: "text-[10px]" },
    md: { logo: 18, icon: 32, text: "text-sm", sub: "text-xs" },
    lg: { logo: 24, icon: 40, text: "text-base", sub: "text-xs" },
  };
  const s = sizeMap[size];

  return (
    <div className="flex items-center gap-2">
      <div
        className="rounded-full bg-dark-700 border border-glass-border flex items-center justify-center text-white"
        style={{ width: s.icon, height: s.icon }}
      >
        <AlgorandLogo size={s.logo} />
      </div>
      {showName && (
        <div className="flex flex-col">
          <span className={`${s.text} font-semibold text-white leading-tight`}>ALGO</span>
          {showSubtitle && (
            <span className={`${s.sub} text-gray-500 leading-tight`}>Algorand</span>
          )}
        </div>
      )}
    </div>
  );
}
