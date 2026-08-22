import type { APIRoute } from 'astro';
import { getCardItems } from '../../lib/data';

/**
 * The whole dataset as one static JSON file.
 *
 * Prerendered, so it is a plain file in dist/ and needs no server - GitHub Pages can serve it.
 * The browse pages render their cards server-side and filter the DOM, so they don't depend on
 * this; it exists as a public, stable read API for anyone (or any agent) who wants the directory
 * as data rather than HTML.
 */
export const prerender = true;

export const GET: APIRoute = async () => {
  const items = await getCardItems();

  return new Response(
    JSON.stringify(
      {
        source: 'https://github.com/ibtisam-iq/sidequest',
        license: 'MIT',
        count: items.length,
        entries: items,
      },
      null,
      2,
    ),
    {
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'public, max-age=3600',
      },
    },
  );
};
