/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['Fira Code', 'ui-monospace', 'monospace'],
      },
      animation: {
        'expand': 'expand 0.7s ease-out'
      },
      keyframes: {
        expand: {
          '0%': { width: '20%' },
          '100%': { width: '100%' }
        }
      }
    },
  },
  plugins: [],
}
