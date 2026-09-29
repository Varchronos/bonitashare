import type { APIRoute } from 'astro';
import { proxyTus } from '../../../lib/tusProxy';

const forward: APIRoute = ({ request, params }) => proxyTus(request, `/upload/${params.id}`);

export const GET = forward;
export const HEAD = forward;
export const PATCH = forward;
export const DELETE = forward;
export const OPTIONS = forward;
