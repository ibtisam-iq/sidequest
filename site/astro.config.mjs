import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

export default defineConfig({
  site: 'https://sidequest.ibtisam-iq.com',
  output: 'static',
  trailingSlash: 'ignore',
  integrations: [sitemap()],
  vite: {
    server: {
      // Content lives in the repo-root data/ and taxonomy/ dirs, outside this Astro project,
      // so the dev server has to be allowed to read one level up.
      fs: { allow: ['..'] },
    },
  },
});
