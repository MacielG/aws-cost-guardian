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
          primary: {
            DEFAULT: '#2563eb', // azul profissional
            dark: '#1e40af',
            light: '#3b82f6',
          },
          secondary: {
            DEFAULT: '#6b7280', // cinza
            dark: '#374151',
            light: '#d1d5db',
          },
          accent: {
            green: '#22c55e',
            yellow: '#facc15',
            orange: '#fb923c',
            red: '#ef4444',
          },
          status: {
            success: '#22c55e',
            warning: '#facc15',
            destructive: '#ef4444',
          },
        },
        fontFamily: {
          sans: ['Inter', 'sans-serif'],
        },
        fontSize: {
          h1: ['2.25rem', { lineHeight: '2.5rem', fontWeight: '700' }],
          h2: ['1.5rem', { lineHeight: '2rem', fontWeight: '600' }],
          h3: ['1.25rem', { lineHeight: '1.75rem', fontWeight: '500' }],
          h4: ['1rem', { lineHeight: '1.5rem', fontWeight: '500' }],
          paragraph: ['1rem', { lineHeight: '1.75rem', fontWeight: '400' }],
          muted: ['0.875rem', { lineHeight: '1.25rem', fontWeight: '400', color: '#6b7280' }],
        },
      },
  },
  plugins: [],
}