export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        primary: { DEFAULT: '#14352A', light: '#1E5740', mid: '#2D7A5A' },
        accent: { DEFAULT: '#C8993E', light: '#DFBA6E' },
        admin: { DEFAULT: '#1A1A2E', accent: '#E94560', bg: '#F5F5FA' },
        surface: { DEFAULT: '#F4F1EB', alt: '#EDE9E0' },
        card: '#FFFFFF',
        text: { DEFAULT: '#151515', sub: '#636B74', muted: '#9CA3AB' },
        border: '#E2DED5',
        stock: { ok: '#0B8A57', low: '#C47F17', out: '#C0392B', info: '#2563EB' },
      },
      fontFamily: {
        sans: ["'Segoe UI'", "'SF Pro Display'", '-apple-system', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
