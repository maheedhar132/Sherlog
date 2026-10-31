import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Relative base so the build works on GitHub Pages under /<repo>/.
  base: './',
  test: {
    include: ['tests/**/*.test.ts'],
  },
});
