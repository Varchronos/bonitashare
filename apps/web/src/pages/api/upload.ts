import type { APIRoute } from 'astro';
import { proxyTus } from '../../lib/tusProxy';

// The API is only reachable inside the docker network, so the browser talks
// tus to us and we proxy every method through to it (see lib/tusProxy).
export const POST: APIRoute = ({ request }) => proxyTus(request, '/upload');
export const OPTIONS: APIRoute = ({ request }) => proxyTus(request, '/upload');
