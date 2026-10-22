import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const targetServer = (env.VITE_SERVER_URL || process.env.VITE_SERVER_URL || 'https://watch-together-hl8e.onrender.com').replace(/\/+$/, '');
  const wsTarget = targetServer.replace(/^http/, 'ws');

  return {
    base: './',
    plugins: [react()],
    server: {
      port: 5173,
      proxy: {
        '/api': {
          target: targetServer,
          changeOrigin: true,
          secure: false,
        },
        '/ws': {
          target: wsTarget,
          ws: true,
          changeOrigin: true,
        },
      },
    },
  };
});
