import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const port = Number(process.env.WEB_PORT ?? 5190);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`Invalid WEB_PORT: ${process.env.WEB_PORT}`);
const host = process.env.WEB_HOST || '0.0.0.0';
const apiUrl = process.env.API_URL || 'http://127.0.0.1:8790';

// The browser only talks to the web origin; /api is proxied to the API server.
const proxy = { '/api': { target: apiUrl, changeOrigin: true } };

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  server: { port, host, strictPort: true, proxy },
  preview: { port, host, strictPort: true, proxy },
});
