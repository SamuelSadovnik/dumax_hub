/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Geist', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
        display: ['Bricolage Grotesque', 'Geist', 'system-ui', 'sans-serif'],
      },
      colors: {
        // neutros azul-marinho (texto, bordas, superfícies)
        ink: {
          DEFAULT: '#0D1330',
          950: '#080C22',
          900: '#0D1330',
          800: '#1A2142',
          700: '#2A3254',
          600: '#434B6B',
          500: '#6A7290',
          400: '#9AA1B5',
          300: '#C5CAD6',
          200: '#E3E6EC',
          100: '#EEF0F4',
          50: '#F6F7F9',
        },
        // azul royal Dumax
        brand: {
          DEFAULT: '#2D3FE0',
          50: '#EEF0FE',
          100: '#DCE0FD',
          200: '#B9C1FB',
          300: '#8C99F5',
          400: '#5E6FEC',
          500: '#2D3FE0',
          600: '#2333C2',
          700: '#1C289B',
          800: '#17207A',
        },
        canvas: '#F2F4F8',
        ok: { DEFAULT: '#1F9254', soft: '#E6F4EC' },
        warn: { DEFAULT: '#C77700', soft: '#FDF1DE' },
        bad: { DEFAULT: '#D93036', soft: '#FCE9EA' },
        chat: { bg: '#E9ECF2', out: '#DCE3FF', in: '#FFFFFF' },
      },
      fontSize: {
        '2xs': ['11px', '14px'],
      },
      boxShadow: {
        card: '0 1px 2px rgba(13,19,48,.04), 0 0 0 1px rgba(13,19,48,.02)',
        lift: '0 8px 24px -12px rgba(13,19,48,.18)',
        pop: '0 16px 48px -12px rgba(13,19,48,.28), 0 2px 6px rgba(13,19,48,.06)',
        focus: '0 0 0 3px rgba(45,63,224,.18)',
      },
      keyframes: {
        'slide-in': { from: { transform: 'translateX(100%)' }, to: { transform: 'translateX(0)' } },
        'fade-up': { from: { opacity: '0', transform: 'translateY(4px)' }, to: { opacity: '1', transform: 'none' } },
        pop: { from: { opacity: '0', transform: 'scale(.96)' }, to: { opacity: '1', transform: 'scale(1)' } },
        blink: { '0%,80%,100%': { opacity: '.2' }, '40%': { opacity: '1' } },
      },
      animation: {
        'slide-in': 'slide-in .2s cubic-bezier(.2,.8,.2,1)',
        'fade-up': 'fade-up .18s ease-out',
        pop: 'pop .12s ease-out',
        blink: 'blink 1.2s infinite',
      },
    },
  },
  plugins: [],
};
