import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: '/nightshift-039-podcastdeck/',
  plugins: [react()],
});
