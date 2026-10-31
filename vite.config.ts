import { defineConfig, type Plugin } from 'vitest/config';
import react from '@vitejs/plugin-react';

/**
 * Link previews on LinkedIn, X and Slack need absolute URLs. SITE_URL wins if set;
 * otherwise Vercel's production domain is used, so the first deploy gets correct previews.
 */
function siteUrl(): Plugin {
  const host = process.env.SITE_URL ?? (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : '');
  const url = host.replace(/\/$/, '');
  return {
    name: 'site-url',
    transformIndexHtml: (html) => html.replaceAll('%SITE_URL%', url),
  };
}

export default defineConfig({
  plugins: [react(), siteUrl()],
  // Relative base so the build works at any path (Vercel root, a subfolder, or a fork's preview).
  base: './',
  test: {
    include: ['tests/**/*.test.ts'],
  },
});
