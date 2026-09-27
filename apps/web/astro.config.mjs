// @ts-check
import { defineConfig } from 'astro/config';

import react from '@astrojs/react';
import partytown from '@astrojs/partytown';
import node from '@astrojs/node';

// https://astro.build/config
export default defineConfig({
  output: 'server',
  adapter: node({ mode: 'standalone' }),
  integrations: [react(), partytown()]
});