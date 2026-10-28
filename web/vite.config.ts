import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { validarEntornoPublico } from './src/config.ts';

export default defineConfig(({ mode }) => {
  // Revisar antes de que Vite pueda incrustar variables privadas en el bundle.
  validarEntornoPublico(loadEnv(mode, process.cwd(), 'VITE_'));
  return {
    plugins: [react()],
    server: { host: '127.0.0.1', port: 5173, strictPort: true },
    preview: { host: '127.0.0.1', port: 4173, strictPort: true },
  };
});
