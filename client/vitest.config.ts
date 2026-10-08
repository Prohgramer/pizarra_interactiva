import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

/**
 * Pruebas del cliente: componentes y lógica de navegador, con Vitest y jsdom.
 * Las del servidor viven aparte (node:test) porque no necesitan un DOM.
 */
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./test/setup.ts'],
    include: ['test/**/*.test.ts', 'test/**/*.test.tsx'],
    globals: false,
    restoreMocks: true,
  },
});
