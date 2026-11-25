import type { Config } from 'tailwindcss';

export default {
  content: ['./*.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bili: { pink: '#FB7299', blue: '#00AEEC', ink: '#18191C' }
      },
      fontFamily: {
        sans: ['-apple-system', 'BlinkMacSystemFont', '"PingFang SC"', '"Microsoft YaHei"', '"Helvetica Neue"', 'Arial', 'sans-serif']
      }
    }
  },
  plugins: []
} satisfies Config;
