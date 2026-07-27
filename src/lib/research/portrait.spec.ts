import sharp from 'sharp';
import { describe, expect, it, vi } from 'vitest';
import {
	MAX_PORTRAIT_INPUT_BYTES,
	downloadPortrait,
	transformPortrait,
	validatePortraitCandidate
} from './portrait';

const resolvePublicAddress = async () => ['93.184.216.34'];

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

	it('accepts and normalizes a usable 150x182 portrait without enlargement', async () => {
		const input = await sharp({
			create: { width: 150, height: 182, channels: 3, background: 'white' }
		})
			.jpeg()
			.toBuffer();

		const transformed = await transformPortrait(input);

		expect(transformed).toMatchObject({
			contentType: 'image/webp',
			width: 150,
			height: 182,
			originalWidth: 150,
			originalHeight: 182,
			originalFormat: 'jpeg'
		});
		await expect(sharp(transformed.data).metadata()).resolves.toMatchObject({
			format: 'webp',
			width: 150,
			height: 182
		});
	});

	it('rejects unusable resolution, invalid image data, and over-limit input with stable codes', async () => {
		const undersized = await sharp({
			create: { width: 32, height: 32, channels: 3, background: 'white' }
		})
			.jpeg()
			.toBuffer();

		await expect(transformPortrait(undersized)).rejects.toMatchObject({
			code: 'portrait_unusable_resolution',
			diagnostic: {
				stage: 'normalize',
				originalWidth: 32,
				originalHeight: 32,
				format: 'jpeg'
			}
		});
		await expect(transformPortrait(Buffer.from('not an image'))).rejects.toMatchObject({
			code: 'portrait_invalid_image'
		});
		await expect(
			transformPortrait(Buffer.alloc(MAX_PORTRAIT_INPUT_BYTES + 1))
		).rejects.toMatchObject({
			code: 'portrait_input_too_large'
		});
	});

	it('normalizes safe raster formats and rejects SVG input', async () => {
		const raster = await sharp({
			create: { width: 150, height: 182, channels: 3, background: '#5271ff' }
		})
			.png()
			.toBuffer();
		const avif = await sharp(raster).avif().toBuffer();
		const gif = await sharp(raster).gif().toBuffer();
		const tiff = await sharp(raster).tiff().toBuffer();
		const svg = Buffer.from(
			'<svg xmlns="http://www.w3.org/2000/svg" width="150" height="182"><rect width="150" height="182"/></svg>'
		);

		await expect(transformPortrait(avif)).resolves.toMatchObject({ originalFormat: 'avif' });
		await expect(transformPortrait(gif)).resolves.toMatchObject({ originalFormat: 'gif' });
		await expect(transformPortrait(tiff)).resolves.toMatchObject({ originalFormat: 'tiff' });
		await expect(transformPortrait(svg)).rejects.toMatchObject({
			code: 'portrait_invalid_image'
		});
	});

	it('validates AVIF end-to-end and sanitizes the final asset location', async () => {
		const source = await sharp({
			create: { width: 240, height: 300, channels: 3, background: '#5271ff' }
		})
			.avif()
			.toBuffer();
		const fetcher = vi.fn(async () => {
			return new Response(source, {
				status: 200,
				headers: { 'content-type': 'image/avif; charset=binary' }
			});
		});

		await expect(
			validatePortraitCandidate(
				'https://cdn.example.com/portrait.avif?token=secret#private',
				fetcher,
				resolvePublicAddress
			)
		).resolves.toEqual({
			status: 'accepted',
			rejectionCode: null,
			message: null,
			stage: 'normalize',
			httpStatus: 200,
			contentType: 'image/avif',
			format: 'avif',
			width: 240,
			height: 300,
			finalLocation: 'https://cdn.example.com/portrait.avif'
		});
		expect(fetcher).toHaveBeenCalledWith(
			expect.objectContaining({
				origin: 'https://cdn.example.com',
				pathname: '/portrait.avif'
			}),
			expect.objectContaining({
				headers: {
					accept: expect.stringContaining('image/avif')
				}
			})
		);
	});

	it('returns sanitized rejection details for HTML and HTTP failures', async () => {
		const htmlFetcher = vi.fn(
			async () =>
				new Response('<html>leadership page</html>', {
					status: 200,
					headers: { 'content-type': 'text/html; charset=utf-8' }
				})
		);
		await expect(
			validatePortraitCandidate(
				'https://example.com/leadership?session=secret',
				htmlFetcher,
				resolvePublicAddress
			)
		).resolves.toEqual({
			status: 'rejected',
			rejectionCode: 'portrait_invalid_image',
			message: 'Portrait could not be decoded as an image',
			stage: 'decode',
			httpStatus: 200,
			contentType: 'text/html',
			format: null,
			width: null,
			height: null,
			finalLocation: 'https://example.com/leadership'
		});

		const missingFetcher = vi.fn(
			async () =>
				new Response(null, {
					status: 404,
					headers: { 'content-type': 'text/html' }
				})
		);
		await expect(
			validatePortraitCandidate(
				'https://example.com/missing.jpg?token=secret',
				missingFetcher,
				resolvePublicAddress
			)
		).resolves.toMatchObject({
			status: 'rejected',
			rejectionCode: 'portrait_download_failed',
			httpStatus: 404,
			contentType: 'text/html',
			finalLocation: 'https://example.com/missing.jpg'
		});
	});

	it('enforces HTTPS and the declared content-length before downloading', async () => {
		const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
			expect(init?.signal).toBeInstanceOf(AbortSignal);
			return new Response(null, {
				status: 200,
				headers: { 'content-length': String(MAX_PORTRAIT_INPUT_BYTES + 1) }
			});
		});

		await expect(
			downloadPortrait('http://example.com/portrait.jpg', fetcher, resolvePublicAddress)
		).rejects.toMatchObject({ code: 'portrait_not_https' });
		await expect(
			downloadPortrait('https://example.com/portrait.jpg', fetcher, resolvePublicAddress)
		).rejects.toMatchObject({ code: 'portrait_input_too_large' });
		expect(fetcher).toHaveBeenCalledTimes(1);
	});

	it('rejects a redirect that ends on a non-HTTPS URL', async () => {
		const fetcher = vi.fn(
			async () =>
				new Response(null, {
					status: 302,
					headers: { location: 'http://cdn.example.com/portrait.jpg' }
				})
		);

		await expect(
			downloadPortrait('https://example.com/portrait.jpg', fetcher, resolvePublicAddress)
		).rejects.toMatchObject({ code: 'portrait_not_https' });
		expect(fetcher).toHaveBeenCalledOnce();
	});

	it.each([
		['IPv4 loopback', '127.0.0.1'],
		['IPv4 private', '10.1.2.3'],
		['IPv4 link-local', '169.254.169.254'],
		['IPv6 loopback', '::1'],
		['IPv6 private', 'fd00::1'],
		['IPv6 link-local', 'fe80::1'],
		['IPv4-mapped IPv6 loopback', '::ffff:7f00:1'],
		['documentation address', '203.0.113.10']
	])('rejects a hostname resolving to %s', async (_label, address) => {
		const fetcher = vi.fn();

		await expect(
			downloadPortrait('https://images.example.com/person.jpg', fetcher, async () => [address])
		).rejects.toMatchObject({ code: 'portrait_unsafe_url' });
		expect(fetcher).not.toHaveBeenCalled();
	});
});
