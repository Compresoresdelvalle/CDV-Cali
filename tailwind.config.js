export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        primary: { DEFAULT: '#14352A', light: '#1E5740', mid: '#2D7A5A', 50: '#EBF5F0' },
        accent:  { DEFAULT: '#C8993E', light: '#DFBA6E', dark: '#A37A28' },
        admin:   { DEFAULT: '#1A1A2E', accent: '#E94560', bg: '#F5F5FA' },
        surface: { DEFAULT: '#F4F1EB', alt: '#EDE9E0' },
        card:    '#FFFFFF',
        text:    { DEFAULT: '#151515', sub: '#636B74', muted: '#9CA3AB' },
        border:  '#E2DED5',
        stock:   { ok: '#0B8A57', low: '#C47F17', out: '#C0392B', info: '#2563EB' },
      },
      fontFamily: {
        sans:    ["'DM Sans'", "'Segoe UI'", 'system-ui', 'sans-serif'],
        brand:   ["'Barlow Condensed'", "'Segoe UI'", 'system-ui', 'sans-serif'],
        display: ["'Barlow Condensed'", 'system-ui', 'sans-serif'],
      },
      backgroundImage: {
        'panel-green': 'linear-gradient(160deg, #14352A 0%, #0D2318 55%, #081910 100%)',
        'panel-admin': 'linear-gradient(160deg, #1A1A2E 0%, #0F0F1F 100%)',
      },
      boxShadow: {
        'pin':  '0 2px 12px 0 rgba(20,53,42,0.15)',
        'card': '0 8px 40px 0 rgba(0,0,0,0.10)',
        'key':  '0 2px 0 0 #C2BAB0',
      },
      keyframes: {
        shake: {
          '0%,100%': { transform: 'translateX(0)' },
          '20%':     { transform: 'translateX(-8px)' },
          '40%':     { transform: 'translateX(8px)' },
          '60%':     { transform: 'translateX(-5px)' },
          '80%':     { transform: 'translateX(5px)' },
        },
        'ping-once': {
          '0%':   { transform: 'scale(1)', opacity: '1' },
          '60%':  { transform: 'scale(1.25)', opacity: '0.7' },
          '100%': { transform: 'scale(1)', opacity: '1' },
        },
        'fade-up': {
          '0%':   { opacity: '0', transform: 'translateY(16px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'fill-dot': {
          '0%':   { transform: 'scale(0.4)', opacity: '0.3' },
          '100%': { transform: 'scale(1)',   opacity: '1' },
        },
      },
      animation: {
        'shake':     'shake 0.4s ease-in-out',
        'ping-once': 'ping-once 0.25s ease-out',
        'fade-up':   'fade-up 0.5s ease-out both',
        'fill-dot':  'fill-dot 0.15s ease-out both',
      },
    },
  },
  plugins: [],
}
