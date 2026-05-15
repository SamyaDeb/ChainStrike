import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: { 50: '#eff6ff', 500: '#3b82f6', 600: '#2563eb', 700: '#1d4ed8' },
        surface: { DEFAULT: '#0F1117', card: '#1A1D27', border: '#2A2D3A' },
      },
    },
  },
  plugins: [],
};

export default config;
