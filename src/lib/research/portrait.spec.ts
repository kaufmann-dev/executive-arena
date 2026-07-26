import sharp from 'sharp';
import { describe, expect, it, vi } from 'vitest';
import { MAX_PORTRAIT_INPUT_BYTES, downloadPortrait, transformPortrait } from './portrait';

describe('portrait processing', () => {
	it('auto-orients, fits inside 800px without enlargement, strips metadata, and hashes WebP bytes', async () => {
		const input = await sharp({
			create: {
				width: 300,
				height: 500,
				channels: 3,
				background: '#5271ff'
			}
		})
			.jpeg()
			.withMetadata({ orientation: 6, exif: { IFD0: { Copyright: 'remove me' } } })
			.toBuffer();

		const first = await transformPortrait(input);
		const second = await transformPortrait(input);
		const metadata = await sharp(first.data).metadata();

		expect(first).toMatchObject({
			contentType: 'image/webp',
			width: 500,
			height: 300,
			byteLength: first.data.byteLength
		});
		expect(first.sha256).toMatch(/^[a-f0-9]{64}$/);
		expect(second.sha256).toBe(first.sha256);
		expect(metadata.format).toBe('webp');
		expect(metadata.exif).toBeUndefined();
		expect(metadata.orientation).toBeUndefined();
	});

	it('shrinks large portraits but never enlarges smaller valid portraits', async () => {
		const large = await sharp({
			create: { width: 1600, height: 1200, channels: 3, background: 'white' }
		})
			.png()
			.toBuffer();
		const small = await sharp({
			create: { width: 240, height: 300, channels: 3, background: 'white' }
		})
			.png()
			.toBuffer();

		await expect(transformPortrait(large)).resolves.toMatchObject({ width: 800, height: 600 });
		await expect(transformPortrait(small)).resolves.toMatchObject({ width: 240, height: 300 });
	});

	it('rejects undersized, invalid, and over-limit input', async () => {
		const undersized = await sharp({
			create: { width: 199, height: 300, channels: 3, background: 'white' }
		})
			.jpeg()
			.toBuffer();

		await expect(transformPortrait(undersized)).rejects.toThrow('at least 200px');
		await expect(transformPortrait(Buffer.from('not an image'))).rejects.toThrow();
		await expect(transformPortrait(Buffer.alloc(MAX_PORTRAIT_INPUT_BYTES + 1))).rejects.toThrow(
			'input limit'
		);
	});

	it('enforces HTTPS and the declared content-length before downloading', async () => {
		const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
			expect(init?.signal).toBeInstanceOf(AbortSignal);
			return new Response(null, {
				status: 200,
				headers: { 'content-length': String(MAX_PORTRAIT_INPUT_BYTES + 1) }
			});
		});

		await expect(downloadPortrait('http://example.com/portrait.jpg', fetcher)).rejects.toThrow(
			'use HTTPS'
		);
		await expect(downloadPortrait('https://example.com/portrait.jpg', fetcher)).rejects.toThrow(
			'input limit'
		);
		expect(fetcher).toHaveBeenCalledTimes(1);
	});

	it('rejects a redirect that ends on a non-HTTPS URL', async () => {
		const response = new Response(new Uint8Array([1]), { status: 200 });
		Object.defineProperty(response, 'url', {
			value: 'http://cdn.example.com/portrait.jpg'
		});
		const fetcher = vi.fn(async () => response);

		await expect(downloadPortrait('https://example.com/portrait.jpg', fetcher)).rejects.toThrow(
			'redirect target must use HTTPS'
		);
	});
});
