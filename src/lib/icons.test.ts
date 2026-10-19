import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { resolveIcon } from './icons';
import { LUCIDE_SUBSET } from './icons-subset.generated';

const SOURCE_DIR = fileURLToPath(new URL('..', import.meta.url));
const ICON_RE = /(?:i-lucide-([a-z0-9-]+)|lucide:([a-z0-9-]+))/g;

function walk(dir: string, out: string[] = []): string[] {
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) {
			if (!['node_modules', '.svelte-kit', 'vendor'].includes(entry.name)) walk(path, out);
		} else if (/\.(svelte|ts)$/.test(entry.name) && !entry.name.endsWith('.generated.ts')) {
			out.push(path);
		}
	}
	return out;
}

describe('generated Lucide subset', () => {
	it('contains every lucide icon referenced in source (after fallbacks)', () => {
		const subset = LUCIDE_SUBSET as {
			icons: Record<string, unknown>;
			aliases?: Record<string, unknown>;
		};
		const missing: string[] = [];

		for (const file of walk(SOURCE_DIR)) {
			const source = readFileSync(file, 'utf8');
			for (const match of source.matchAll(ICON_RE)) {
				const name = match[1] ?? match[2];
				if (!name || name === 'foo') continue;
				const resolved = resolveIcon(`lucide:${name}`);
				if (!resolved.startsWith('lucide:')) continue;
				const key = resolved.slice('lucide:'.length);
				if (!Object.hasOwn(subset.icons, key) && !Object.hasOwn(subset.aliases ?? {}, key)) {
					missing.push(`${name} (${file.replace(SOURCE_DIR, 'src')})`);
				}
			}
		}

		expect(missing).toEqual([]);
	});
});
