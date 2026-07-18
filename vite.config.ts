import { defineConfig } from 'vite';
import { enPagePlugin } from './scripts/enPagePlugin';

export default defineConfig({
  base: './',
  build: {
    target: 'es2022'
  },
  plugins: [enPagePlugin()]
});
