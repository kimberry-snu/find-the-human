import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, repositoryRoot, '');

  return {
    base: env.VITE_BASE_PATH || '/',
    envDir: repositoryRoot,
    plugins: [react()],
    server: {
      host: true,
      port: 5173,
      proxy: {
        '/socket.io': {
          target: env.VITE_SOCKET_PROXY_TARGET || 'http://localhost:3000',
          changeOrigin: true,
          ws: true,
        },
      },
    },
  };
});
