// CommonJS — no ESM para compatibilidad con Node sin "type": "module"
/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./renderer/**/*.{ts,tsx,html}'],
  theme: {
    extend: {
      fontFamily: {
        mono: ['"Iosevka Nerd Font Mono"', '"Iosevka Nerd Font"', 'monospace'],
        sans: ['"Iosevka Nerd Font Mono"', '"Iosevka Nerd Font"', 'monospace'],
      },
      colors: {
        om: {
          base:    '#101315',
          surface: '#141719',
          raised:  '#1c2124',
          code:    '#0d1013',
          dim:     '#343d41',
          muted:   '#4b4e55',
          fg:      '#cacccc',
          fgmuted: '#798186',
          fgdim:   '#9fa5a9',
          accent:  '#798186',
          border:  '#5d6367',
          red:     '#de6145',
          cream:   '#c9c2b4',
          warm:    '#d9dbdc',
        },
      },
    },
  },
  plugins: [],
}
