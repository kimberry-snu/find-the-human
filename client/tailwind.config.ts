import type { Config } from 'tailwindcss';

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: {
          950: '#07080b',
          900: '#0d0f14',
          850: '#12151c',
          800: '#181c25',
          700: '#252a36',
        },
        signal: {
          DEFAULT: '#ff5d73',
          soft: '#ff8797',
        },
        electric: {
          DEFAULT: '#67e8d5',
          soft: '#9af3e5',
        },
      },
      fontFamily: {
        sans: [
          'Pretendard Variable',
          'Pretendard',
          'SUIT Variable',
          'SUIT',
          'Inter',
          'system-ui',
          'sans-serif',
        ],
      },
      boxShadow: {
        glow: '0 0 40px rgba(103, 232, 213, 0.12)',
        signal: '0 14px 40px rgba(255, 93, 115, 0.2)',
      },
    },
  },
  plugins: [],
} satisfies Config;
