import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    // ส่งต่อ /api ไปยัง Express (server.js) ระหว่างพัฒนา
    proxy: {
      '/api': 'http://localhost:3001',
    },
  },
});
