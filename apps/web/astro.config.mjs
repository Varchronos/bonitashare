// @ts-check
import { defineConfig } from 'astro/config';

import react from '@astrojs/react';
import partytown from '@astrojs/partytown';
import node from '@astrojs/node';

// https://astro.build/config
export default defineConfig({
  output: 'server',
  adapter: node({ mode: 'standalone' }),
  integrations: [react(), partytown()],
  security: {
    // Behind the Cloudflare tunnel node only sees plain HTTP. Without this, Astro trusts neither Host nor
    // X-Forwarded-Proto, builds every request URL as http://localhost:4321, and its origin check then
    // rejects same-site non-GET requests (e.g. tus's upload-creation POST) with a 403.
    allowedDomains: [
      { hostname: 'bonitashare.dhruvrajak.dev', protocol: 'https' },
      { hostname: 'bonitashare.com', protocol: 'https' },
      { hostname: 'www.bonitashare.com', protocol: 'https' },
    ],
  },
});