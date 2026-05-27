// CommonJS — no ESM para compatibilidad con Node sin "type": "module"
/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./renderer/**/*.{ts,tsx,html}'],
  theme: {
    extend: {
      colors: {
        severity: {
          low: '#22c55e',
          medium: '#f59e0b',
          high: '#f97316',
          critical: '#ef4444',
        },
      },
    },
  },
  plugins: [],
}
