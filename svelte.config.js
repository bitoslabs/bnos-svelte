import adapter from '@sveltejs/adapter-auto';
import staticAdapter from '@sveltejs/adapter-static';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	preprocess: vitePreprocess(),
	kit: {
		// adapter-auto only supports some environments, see
		// https://svelte.dev/docs/kit/adapter-auto for a list.
		// Switch to a specific adapter when you settle on a deploy target.
		adapter:
			process.env.BNOS_DESKTOP === '1'
				? staticAdapter({
						pages: 'desktop-build',
						assets: 'desktop-build',
						fallback: 'index.html',
						strict: false
					})
				: adapter(),
		alias: {
			$nostr: 'src/lib/nostr'
		}
	}
};

export default config;
