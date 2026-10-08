import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    // Puerto fijo: el servidor solo acepta este origen por defecto (ALLOWED_ORIGINS).
    port: 5173,
    strictPort: true,
  },
});
