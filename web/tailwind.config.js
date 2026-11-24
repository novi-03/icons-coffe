import path from 'node:path';

const here = path.dirname(new URL(import.meta.url).pathname);

/** @type {import('tailwindcss').Config} */
export default {
  content: [path.join(here, 'index.html'), path.join(here, 'src/**/*.{ts,tsx}')],
  theme: {
    extend: {
      colors: {
        ink: { 950: '#05050a', 900: '#08080f', 850: '#0c0d18' },
        navy: { 900: '#0d1126', 800: '#121834', 700: '#1a2247', 600: '#253060', 500: '#34407a' },
        silver: { 50: '#f4f5f7', 100: '#e5e7eb', 200: '#d1d4db', 300: '#b8bcc8', 400: '#9196a6', 500: '#6f7486', 600: '#525769' },
        brand: { 300: '#c4b5fd', 400: '#a78bfa', 500: '#8b5cf6', 600: '#7c3aed', 700: '#6d28d9', glow: '#a855f7' },
      },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        display: ['Sora', 'Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        glow: '0 0 0 1px rgba(139,92,246,.35), 0 8px 30px -6px rgba(139,92,246,.45)',
        card: '0 1px 0 0 rgba(255,255,255,.04) inset, 0 10px 30px -12px rgba(0,0,0,.6)',
      },
      keyframes: {
        'pulse-ring': { '0%': { boxShadow: '0 0 0 0 rgba(239,68,68,.55)' }, '100%': { boxShadow: '0 0 0 14px rgba(239,68,68,0)' } },
        'slide-up': { from: { transform: 'translateY(16px)', opacity: 0 }, to: { transform: 'translateY(0)', opacity: 1 } },
        'pop': { '0%': { transform: 'scale(.96)', opacity: 0 }, '100%': { transform: 'scale(1)', opacity: 1 } },
        'flash': { '0%,100%': { backgroundColor: 'rgba(139,92,246,0)' }, '50%': { backgroundColor: 'rgba(139,92,246,.18)' } },
      },
      animation: {
        'pulse-ring': 'pulse-ring 1.4s ease-out infinite',
        'slide-up': 'slide-up .25s ease-out',
        pop: 'pop .18s ease-out',
        flash: 'flash 1s ease-in-out 3',
      },
    },
  },
  plugins: [],
};
