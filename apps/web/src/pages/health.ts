import type { APIRoute } from 'astro';

// Docker healthcheck target. Must not render a page that calls getSession(),
// otherwise every probe (cookieless) mints a new anonymous user in the API.
export const GET: APIRoute = () => new Response('ok');
