import adapter from '@sveltejs/adapter-auto';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	preprocess: vitePreprocess(),
	kit: {
		// adapter-auto only supports some environments, see
		// https://svelte.dev/docs/kit/adapter-auto for a list.
		// Switch to a specific adapter when you settle on a deploy target.
		adapter: adapter(),
		alias: {
			$nostr: 'src/lib/nostr'
		}
	}
};

export default config;
