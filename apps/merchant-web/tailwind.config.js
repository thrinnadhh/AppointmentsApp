/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#f0fdf4',
          100: '#dcfce7',
          500: '#10b981',
          600: '#059669',
          700: '#047857',
          900: '#064e3b',
        },
        surface: {
          light: '#f8fafc',
          dark: '#0f172a',
          card: '#ffffff',
          border: '#e2e8f0',
        },
        accent: {
          amber: '#f59e0b',
          rose: '#f43f5e',
          sky: '#0284c7',
        }
      },
    },
  },
  plugins: [],
};
