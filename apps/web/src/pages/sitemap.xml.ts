import type { APIRoute } from 'astro';

// The site's own pages. Share pages (/f/<id>) stay out: listing them here would publish every
// shared link to anyone who reads the sitemap. Search engines find them through links instead.
const PAGES = ['/', '/about', '/upload', '/signup', '/login'];

export const GET: APIRoute = ({ site }) => {
	const urls = PAGES.map((path) => `\t<url><loc>${new URL(path, site)}</loc></url>`).join('\n');
	const body = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
	return new Response(body, { headers: { 'Content-Type': 'application/xml; charset=utf-8' } });
};
