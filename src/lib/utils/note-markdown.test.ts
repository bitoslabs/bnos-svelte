import { describe, expect, it } from 'vitest';
import { mediaKindFromUrl, parseInline, parseNote, safeUrl, summarizeNote } from './note-markdown';

describe('safeUrl', () => {
	it('keeps http(s) and same-origin paths', () => {
		expect(safeUrl('https://example.com/a.png')).toBe('https://example.com/a.png');
		expect(safeUrl('http://example.com')).toBe('http://example.com');
		expect(safeUrl('/orders')).toBe('/orders');
	});

	it('rejects dangerous or scheme-relative URLs', () => {
		expect(safeUrl('javascript:alert(1)')).toBeNull();
		expect(safeUrl('data:image/svg+xml,<svg/>')).toBeNull();
		expect(safeUrl('//evil.example.com')).toBeNull();
		expect(safeUrl('ftp://example.com')).toBeNull();
	});
});

describe('mediaKindFromUrl', () => {
	it('detects images and videos, ignoring query strings', () => {
		expect(mediaKindFromUrl('https://x.test/a.PNG')).toBe('image');
		expect(mediaKindFromUrl('https://x.test/clip.mp4?token=1')).toBe('video');
		expect(mediaKindFromUrl('https://x.test/file.pdf')).toBeNull();
	});
});

describe('parseInline', () => {
	it('renders hashtags as tag spans, including at the start', () => {
		expect(parseInline('#bnos hello')).toEqual([
			{ type: 'tag', value: 'bnos' },
			{ type: 'text', value: ' hello' }
		]);
	});

	it('does not treat word-embedded hashes as tags', () => {
		expect(parseInline('C# 12')).toEqual([{ type: 'text', value: 'C# 12' }]);
	});

	it('parses bold, italic and code', () => {
		expect(parseInline('**a** _b_ `c`')).toEqual([
			{ type: 'strong', value: 'a' },
			{ type: 'text', value: ' ' },
			{ type: 'em', value: 'b' },
			{ type: 'text', value: ' ' },
			{ type: 'code', value: 'c' }
		]);
	});

	it('turns image markdown into a media span', () => {
		expect(parseInline('![shot](https://x.test/a.jpg)')).toEqual([
			{ type: 'media', kind: 'image', url: 'https://x.test/a.jpg', alt: 'shot' }
		]);
	});

	it('turns bare media URLs into media spans and other URLs into links', () => {
		expect(parseInline('https://x.test/v.webm')).toEqual([
			{ type: 'media', kind: 'video', url: 'https://x.test/v.webm', alt: '' }
		]);
		expect(parseInline('https://x.test/page')).toEqual([
			{ type: 'link', value: 'https://x.test/page', href: 'https://x.test/page', external: true }
		]);
	});

	it('drops unsafe link targets down to plain text', () => {
		expect(parseInline('[x](javascript:void)')).toEqual([{ type: 'text', value: 'x' }]);
		expect(parseInline('[y](data:image/svg+xml,x)')).toEqual([{ type: 'text', value: 'y' }]);
	});
});

describe('parseNote', () => {
	it('parses headings, lists, quotes, code fences and rules', () => {
		const blocks = parseNote(
			['# Title', '', '- one', '- two', '', '> note', '', '```js', 'a()', '```', '', '---'].join(
				'\n'
			)
		);
		expect(blocks).toEqual([
			{ type: 'heading', level: 1, text: 'Title' },
			{ type: 'list', ordered: false, items: ['one', 'two'] },
			{ type: 'quote', text: 'note' },
			{ type: 'code', lang: 'js', code: 'a()' },
			{ type: 'hr' }
		]);
	});

	it('groups consecutive lines into one paragraph', () => {
		expect(parseNote('line one\nline two')).toEqual([
			{ type: 'paragraph', text: 'line one\nline two' }
		]);
	});

	it('returns no blocks for empty content', () => {
		expect(parseNote('   \n  ')).toEqual([]);
	});
});

describe('summarizeNote', () => {
	it('extracts media and leaves no URLs in the preview text', () => {
		const summary = summarizeNote(
			[
				'pos #pos #nostr #nostrdevs #bnos',
				'https://image.nostr.build/a.jpg https://image.nostr.build/b.png'
			].join('\n')
		);
		expect(summary.media).toHaveLength(2);
		expect(summary.text).toBe('pos #pos #nostr #nostrdevs #bnos');
	});

	it('flattens markdown and keeps hashtags readable', () => {
		const summary = summarizeNote('# Title\n\n**bold** text with #tag and [link](https://x.test)');
		expect(summary.text).toBe('Title bold text with #tag and link');
		expect(summary.media).toHaveLength(0);
	});

	it('truncates long previews', () => {
		const summary = summarizeNote('a'.repeat(300), 20);
		expect(summary.text).toBe(`${'a'.repeat(20)}…`);
	});
});
