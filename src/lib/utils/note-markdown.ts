/**
 * Tiny, dependency-free markdown subset for owner notices.
 *
 * We intentionally do NOT emit raw HTML and never use `{@html}`: the input comes
 * from a signed Nostr event, but the UI renders it as a token tree so a
 * compromised/key-less author can never inject script or markup. Only these
 * constructs are honoured:
 *
 *   block:  # … ###### headings · bullet and 1. lists · > quotes · code fences ·
 *           --- rules · paragraphs (blank-line separated)
 *   inline: `code` · **bold** · _/_italic_ · [text](url) · ![alt](url) ·
 *           bare http(s) URLs · #hashtags · line breaks
 *
 * Image/video URLs (by extension) render inline; `#tag` renders as a chip.
 * Links are restricted to http(s) and same-origin `/` paths.
 */

export type MediaKind = 'image' | 'video';

export type Span =
	| { type: 'text'; value: string }
	| { type: 'strong'; value: string }
	| { type: 'em'; value: string }
	| { type: 'code'; value: string }
	| { type: 'link'; value: string; href: string; external: boolean }
	| { type: 'tag'; value: string }
	| { type: 'media'; kind: MediaKind; url: string; alt: string }
	| { type: 'break' };

/** A parsed inline media item (image or video) — used by grids + the lightbox. */
export type MediaSpan = Extract<Span, { type: 'media' }>;

export type Block =
	| { type: 'heading'; level: number; text: string }
	| { type: 'paragraph'; text: string }
	| { type: 'list'; ordered: boolean; items: string[] }
	| { type: 'quote'; text: string }
	| { type: 'code'; lang?: string; code: string }
	| { type: 'hr' };

const IMAGE_EXT = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'bmp', 'svg']);
const VIDEO_EXT = new Set(['mp4', 'webm', 'mov', 'm4v', 'ogv']);

/** Detect an image/video kind from a URL's file extension. */
export function mediaKindFromUrl(url: string): MediaKind | null {
	let path = url.split(/[?#]/)[0];
	try {
		path = new URL(url).pathname;
	} catch {
		/* relative / malformed — use the raw path */
	}
	const ext = path.split('.').pop()?.toLowerCase() ?? '';
	if (IMAGE_EXT.has(ext)) return 'image';
	if (VIDEO_EXT.has(ext)) return 'video';
	return null;
}

/** Accept only http(s) URLs and same-origin `/` paths; reject everything else. */
export function safeUrl(raw: string): string | null {
	const url = raw.trim();
	if (!url) return null;
	if (url.startsWith('/') && !url.startsWith('//')) return url;
	if (/^https?:\/\//i.test(url)) return url;
	return null;
}

const INLINE_PATTERN = [
	'(`[^`]+`)', // 1 code
	'(!\\[[^\\]]*\\]\\([^)\\s]+\\))', // 2 image
	'(\\[[^\\]]+\\]\\([^)\\s]+\\))', // 3 link
	'(\\*\\*[^*]+\\*\\*)', // 4 bold *
	'(__[^_]+__)', // 5 bold _
	'(\\*[^*]+\\*)', // 6 italic *
	'(_[^_]+_)', // 7 italic _
	'((?:https?:\\/\\/)[^\\s<>"\')]+)', // 8 bare url
	'(#[\\p{L}\\p{N}_-]{1,64})', // 9 hashtag
	'(\\n)' // 10 line break
].join('|');

const WORDISH = /[\p{L}\p{N}_#/]/u;

function parseImage(token: string): Span {
	const m = token.match(/^!\[([^\]]*)\]\(([^)\s]+)\)$/);
	if (!m) return { type: 'text', value: token };
	const url = safeUrl(m[2]);
	if (!url) return { type: 'text', value: token };
	const kind = mediaKindFromUrl(url);
	if (kind) return { type: 'media', kind, url, alt: m[1] };
	return { type: 'link', value: m[1] || url, href: url, external: !url.startsWith('/') };
}

function parseLink(token: string): Span {
	const m = token.match(/^\[([^\]]+)\]\(([^)\s]+)\)$/);
	if (!m) return { type: 'text', value: token };
	const url = safeUrl(m[2]);
	if (!url) return { type: 'text', value: m[1] };
	return { type: 'link', value: m[1], href: url, external: !url.startsWith('/') };
}

/** Parse a single text run into inline spans. Not recursive beyond one level. */
export function parseInline(text: string): Span[] {
	const spans: Span[] = [];
	const re = new RegExp(INLINE_PATTERN, 'gu');
	let last = 0;
	let m: RegExpExecArray | null;
	while ((m = re.exec(text))) {
		if (m.index > last) spans.push({ type: 'text', value: text.slice(last, m.index) });
		const before = m.index > 0 ? text[m.index - 1] : '';

		if (m[1]) spans.push({ type: 'code', value: m[1].slice(1, -1) });
		else if (m[2]) spans.push(parseImage(m[2]));
		else if (m[3]) spans.push(parseLink(m[3]));
		else if (m[4]) spans.push({ type: 'strong', value: m[4].slice(2, -2) });
		else if (m[5]) spans.push({ type: 'strong', value: m[5].slice(2, -2) });
		else if (m[6]) spans.push({ type: 'em', value: m[6].slice(1, -1) });
		else if (m[7]) spans.push({ type: 'em', value: m[7].slice(1, -1) });
		else if (m[8]) {
			const href = safeUrl(m[8]);
			if (!href) spans.push({ type: 'text', value: m[8] });
			else {
				const kind = mediaKindFromUrl(href);
				spans.push(
					kind
						? { type: 'media', kind, url: href, alt: '' }
						: { type: 'link', value: m[8], href, external: true }
				);
			}
		} else if (m[9]) {
			// `C#` / `a/#b` are not tags.
			if (before && WORDISH.test(before)) spans.push({ type: 'text', value: m[9] });
			else spans.push({ type: 'tag', value: m[9].slice(1) });
		} else if (m[10]) {
			spans.push({ type: 'break' });
		}
		last = re.lastIndex;
	}
	if (last < text.length) spans.push({ type: 'text', value: text.slice(last) });
	return spans;
}

export interface NoteSummary {
	/** Plain-text preview with media removed and markdown markers flattened. */
	text: string;
	/** Media items found anywhere in the note, in reading order. */
	media: MediaSpan[];
}

function spanText(s: Span): string | null {
	switch (s.type) {
		case 'text':
		case 'strong':
		case 'em':
		case 'code':
			return s.value;
		case 'link':
			return s.value;
		case 'tag':
			return `#${s.value}`;
		case 'break':
			return ' ';
		default:
			return null;
	}
}

/**
 * Build a compact preview for list rows: drops media (returned separately),
 * flattens inline markdown to text, and collapses whitespace. Long alerts that
 * are just a wall of image URLs become a short `text` plus a `media` list.
 */
const summaryCache = new Map<string, NoteSummary>();
const SUMMARY_CACHE_LIMIT = 300;

export function summarizeNote(content: string, maxChars = 140): NoteSummary {
	const cacheKey = `${maxChars}\u0000${content}`;
	const cached = summaryCache.get(cacheKey);
	if (cached) return cached;

	const media: MediaSpan[] = [];
	const parts: string[] = [];

	const scan = (text: string) => {
		let line = '';
		for (const s of parseInline(text)) {
			if (s.type === 'media') {
				media.push(s);
				continue;
			}
			line += spanText(s) ?? '';
		}
		const trimmed = line.replace(/\s+/g, ' ').trim();
		if (trimmed) parts.push(trimmed);
	};

	for (const block of parseNote(content)) {
		if (block.type === 'heading') scan(block.text);
		else if (block.type === 'paragraph' || block.type === 'quote') scan(block.text);
		else if (block.type === 'list') for (const item of block.items) scan(item);
	}

	let text = parts.join(' ').trim();
	if (text.length > maxChars) text = `${text.slice(0, maxChars).trimEnd()}…`;
	const summary = { text, media };

	// Notifications re-render often; identical descriptions reuse the parse.
	if (summaryCache.size >= SUMMARY_CACHE_LIMIT) {
		summaryCache.delete(summaryCache.keys().next().value!);
	}
	summaryCache.set(cacheKey, summary);
	return summary;
}

/** Parse notice content into block-level nodes. */
export function parseNote(content: string): Block[] {
	const src = content.replace(/\r\n?/g, '\n').trim();
	if (!src) return [];
	const lines = src.split('\n');
	const blocks: Block[] = [];
	let para: string[] = [];
	let i = 0;

	const flush = () => {
		if (para.length) {
			blocks.push({ type: 'paragraph', text: para.join('\n') });
			para = [];
		}
	};

	while (i < lines.length) {
		const line = lines[i];
		const fence = line.match(/^```(\w+)?\s*$/);
		if (fence) {
			flush();
			const buf: string[] = [];
			i += 1;
			while (i < lines.length && !/^```\s*$/.test(lines[i])) {
				buf.push(lines[i]);
				i += 1;
			}
			i += 1;
			blocks.push({ type: 'code', lang: fence[1], code: buf.join('\n') });
			continue;
		}

		const heading = line.match(/^(#{1,6})\s+(.*)$/);
		if (heading) {
			flush();
			blocks.push({ type: 'heading', level: heading[1].length, text: heading[2].trim() });
			i += 1;
			continue;
		}

		if (/^(-{3,}|\*{3,}|_{3,})$/.test(line.trim())) {
			flush();
			blocks.push({ type: 'hr' });
			i += 1;
			continue;
		}

		if (/^>\s?/.test(line)) {
			flush();
			const buf: string[] = [];
			while (i < lines.length && /^>\s?/.test(lines[i])) {
				buf.push(lines[i].replace(/^>\s?/, ''));
				i += 1;
			}
			blocks.push({ type: 'quote', text: buf.join('\n') });
			continue;
		}

		const ul = line.match(/^\s*[-*+]\s+(.*)$/);
		const ol = line.match(/^\s*\d+[.)]\s+(.*)$/);
		if (ul || ol) {
			flush();
			const ordered = !!ol;
			const items: string[] = [];
			while (i < lines.length) {
				const m = ordered
					? lines[i].match(/^\s*\d+[.)]\s+(.*)$/)
					: lines[i].match(/^\s*[-*+]\s+(.*)$/);
				if (!m) break;
				items.push(m[1]);
				i += 1;
			}
			blocks.push({ type: 'list', ordered, items });
			continue;
		}

		if (line.trim() === '') {
			flush();
			i += 1;
			continue;
		}

		para.push(line);
		i += 1;
	}
	flush();
	return blocks;
}
