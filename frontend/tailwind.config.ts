import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: ["class"],
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        neon: {
          green: "#00FF88",
          cyan: "#00E5FF",
          blue: "#3B82F6",
          purple: "#A855F7",
          pink: "#EC4899",
          yellow: "#FBBF24",
          orange: "#F97316",
          mint: "#00D68F",
        },
        dark: {
          950: "#050507",
          900: "#0A0A0F",
          800: "#12121A",
          700: "#1A1A25",
          600: "#242430",
          500: "#2E2E3A",
        },
        glass: {
          DEFAULT: "rgba(255, 255, 255, 0.04)",
          light: "rgba(255, 255, 255, 0.08)",
          border: "rgba(255, 255, 255, 0.08)",
        },
        profit: "#00FF88",
        loss: "#FF4757",
        warning: "#FFB800",
        brand: {
          primary: "#00FF88",
          secondary: "#00E5FF",
        },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      backgroundImage: {
        "gradient-radial": "radial-gradient(var(--tw-gradient-stops))",
        "hero-glow": "radial-gradient(ellipse at center, rgba(0, 255, 136, 0.12) 0%, transparent 70%)",
        "card-gradient": "linear-gradient(135deg, rgba(0, 255, 136, 0.08) 0%, rgba(0, 229, 255, 0.08) 100%)",
      },
      boxShadow: {
        neon: "0 0 5px rgba(0, 255, 136, 0.4), 0 0 20px rgba(0, 255, 136, 0.2), 0 0 40px rgba(0, 255, 136, 0.1)",
        "neon-cyan": "0 0 5px rgba(0, 229, 255, 0.4), 0 0 20px rgba(0, 229, 255, 0.2)",
        "neon-green": "0 0 5px rgba(0, 255, 136, 0.4), 0 0 20px rgba(0, 255, 136, 0.2)",
        "neon-blue": "0 0 5px rgba(59, 130, 246, 0.4), 0 0 20px rgba(59, 130, 246, 0.2)",
        glass: "0 8px 32px rgba(0, 0, 0, 0.4)",
        "glow-lg": "0 0 15px rgba(0, 255, 136, 0.3), 0 0 45px rgba(0, 255, 136, 0.15), 0 0 80px rgba(0, 229, 255, 0.1)",
      },
      animation: {
        "pulse-slow": "pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite",
        float: "float 6s ease-in-out infinite",
        "gradient-shift": "gradient-shift 3s ease infinite",
        glow: "glow 2s ease-in-out infinite alternate",
        "slide-up": "slide-up 0.5s ease-out",
        "slide-down": "slide-down 0.5s ease-out",
        "fade-in": "fade-in 0.3s ease-out",
        ticker: "ticker 30s linear infinite",
        "pulse-glow": "pulse-glow 2s ease-in-out infinite",
      },
      keyframes: {
        float: {
          "0%, 100%": { transform: "translateY(0)" },
          "50%": { transform: "translateY(-10px)" },
        },
        "gradient-shift": {
          "0%, 100%": { backgroundPosition: "0% 50%" },
          "50%": { backgroundPosition: "100% 50%" },
        },
        glow: {
          "0%": { boxShadow: "0 0 5px rgba(0, 255, 136, 0.4)" },
          "100%": { boxShadow: "0 0 20px rgba(0, 255, 136, 0.6), 0 0 40px rgba(0, 229, 255, 0.3)" },
        },
        "slide-up": {
          "0%": { transform: "translateY(10px)", opacity: "0" },
          "100%": { transform: "translateY(0)", opacity: "1" },
        },
        "slide-down": {
          "0%": { transform: "translateY(-10px)", opacity: "0" },
          "100%": { transform: "translateY(0)", opacity: "1" },
        },
        "fade-in": {
          "0%": { opacity: "0" },
          "100%": { opacity: "1" },
        },
        ticker: {
          "0%": { transform: "translateX(0)" },
          "100%": { transform: "translateX(-50%)" },
        },
        "pulse-glow": {
          "0%, 100%": { opacity: "0.4" },
          "50%": { opacity: "1" },
        },
      },
      fontFamily: {
        sans: ["var(--font-inter)", "system-ui", "sans-serif"],
        mono: ["var(--font-jetbrains)", "monospace"],
      },
      backdropBlur: {
        xs: "2px",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
};

export default config;
