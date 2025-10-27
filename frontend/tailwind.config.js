/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        // Design System Colors using CSS variables
        primary: {
          blue: 'var(--primary-blue)',
          'blue-light': 'var(--primary-blue-light)',
          'blue-dark': 'var(--primary-blue-dark)',
        },
        secondary: {
          green: 'var(--secondary-green)',
          red: 'var(--secondary-red)',
          orange: 'var(--secondary-orange)',
        },
        background: {
          dark: 'var(--background-dark)',
          light: 'var(--background-light)',
        },
        text: {
          light: 'var(--text-light)',
          medium: 'var(--text-medium)',
          dark: 'var(--text-dark)',
        },
        border: {
          color: 'var(--border-color)',
        },
        // Shadcn/ui compatible colors
        card: {
          DEFAULT: 'var(--background-light)',
          foreground: 'var(--text-light)',
        },
        popover: {
          DEFAULT: 'var(--background-light)',
          foreground: 'var(--text-light)',
        },
        primary: {
          DEFAULT: 'var(--primary-blue)',
          foreground: 'var(--text-light)',
        },
        secondary: {
          DEFAULT: 'var(--background-light)',
          foreground: 'var(--text-medium)',
        },
        muted: {
          DEFAULT: 'var(--text-medium)',
          foreground: 'var(--text-dark)',
        },
        accent: {
          DEFAULT: 'var(--primary-blue)',
          foreground: 'var(--text-light)',
        },
        destructive: {
          DEFAULT: 'var(--secondary-red)',
          foreground: 'var(--text-light)',
        },
        input: {
          DEFAULT: 'var(--background-light)',
        },
        ring: {
          DEFAULT: 'var(--primary-blue)',
        },
      },
      fontFamily: {
        sans: ['Inter', 'sans-serif'],
      },
      fontSize: {
        h1: ['2.5rem', { lineHeight: '2.5rem', fontWeight: '700' }],
        h2: ['1.8rem', { lineHeight: '2rem', fontWeight: '600' }],
        h3: ['1.4rem', { lineHeight: '1.75rem', fontWeight: '500' }],
        h4: ['1rem', { lineHeight: '1.5rem', fontWeight: '500' }],
        paragraph: ['1rem', { lineHeight: '1.75rem', fontWeight: '400' }],
        muted: ['0.875rem', { lineHeight: '1.25rem', fontWeight: '400' }],
      },
      boxShadow: {
        sm: 'var(--shadow-sm)',
        md: 'var(--shadow-md)',
      },
      backdropBlur: {
        'xs': '2px',
      },
      keyframes: {
        shimmer: {
          '0%': { backgroundPosition: '-1000px 0' },
          '100%': { backgroundPosition: '1000px 0' },
        },
        shake: {
          '0%, 100%': { transform: 'translateX(0)' },
          '10%, 30%, 50%, 70%, 90%': { transform: 'translateX(-3px)' },
          '20%, 40%, 60%, 80%': { transform: 'translateX(3px)' },
        },
      },
      animation: {
        shimmer: 'shimmer 2s infinite linear',
        shake: 'shake 0.4s ease-in-out',
      },
    },
  },
  plugins: [],
}