import type { Config } from 'tailwindcss';

export default {
  content: ['./index.html', './options.html', './src/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bilibili: {
          pink: '#FB7299',
          blue: '#23ADE5',
          gray: '#F4F5F7',
          dark: '#18191C'
        }
      }
    }
  },
  plugins: []
} satisfies Config;

