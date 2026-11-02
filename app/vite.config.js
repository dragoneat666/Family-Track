import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Relative paths: the same build is served by the server and packed into the Android app.
  base: './',
  server: {
    proxy: { '/api': process.env.API_URL || 'http://localhost:8080' }
  }
});
