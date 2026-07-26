import { createHash } from 'node:crypto';
import sharp from 'sharp';

export const MAX_PORTRAIT_INPUT_BYTES = 20 * 1024 * 1024;
export const MAX_PORTRAIT_INPUT_PIXELS = 64_000_000;
export const MAX_PORTRAIT_DIMENSION = 800;
export const MIN_PORTRAIT_DIMENSION = 200;
export const PORTRAIT_DOWNLOAD_TIMEOUT_MS = 20_000;

const allowedInputFormats = new Set(['jpeg', 'png', 'webp']);

export interface TransformedPortrait {
	data: Buffer;
	contentType: 'image/webp';
	width: number;
	height: number;
	byteLength: number;
	sha256: string;
}

export type PortraitFetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export async function downloadPortrait(
	urlValue: string | URL,
	fetcher: PortraitFetcher = globalThis.fetch
): Promise<Buffer> {
	const url = new URL(urlValue);
	if (url.protocol !== 'https:') throw new Error('Portrait URL must use HTTPS');
	if (url.username || url.password) throw new Error('Portrait URL must not contain credentials');

	const response = await fetcher(url, {
		headers: { accept: 'image/jpeg, image/png, image/webp' },
		redirect: 'follow',
		signal: AbortSignal.timeout(PORTRAIT_DOWNLOAD_TIMEOUT_MS)
	});
	if (!response.ok) {
		throw new Error(`Portrait download failed with HTTP ${response.status}`);
	}

	const finalUrl = response.url ? new URL(response.url) : url;
	if (finalUrl.protocol !== 'https:') {
		throw new Error('Portrait redirect target must use HTTPS');
	}
	if (finalUrl.username || finalUrl.password) {
		throw new Error('Portrait redirect target must not contain credentials');
	}

	const contentLength = response.headers.get('content-length');
	if (
		contentLength !== null &&
		(!/^\d+$/.test(contentLength) || Number(contentLength) > MAX_PORTRAIT_INPUT_BYTES)
	) {
		throw new Error(`Portrait exceeds the ${MAX_PORTRAIT_INPUT_BYTES}-byte input limit`);
	}

	if (!response.body) {
		const data = Buffer.from(await response.arrayBuffer());
		assertInputSize(data.byteLength);
		return data;
	}

	const chunks: Buffer[] = [];
	let byteLength = 0;
	const reader = response.body.getReader();
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			byteLength += value.byteLength;
			if (byteLength > MAX_PORTRAIT_INPUT_BYTES) {
				await reader.cancel();
				throw new Error(`Portrait exceeds the ${MAX_PORTRAIT_INPUT_BYTES}-byte input limit`);
			}
			chunks.push(Buffer.from(value));
		}
	} finally {
		reader.releaseLock();
	}
	return Buffer.concat(chunks, byteLength);
}

export async function transformPortrait(input: Uint8Array): Promise<TransformedPortrait> {
	assertInputSize(input.byteLength);

	const image = sharp(input, {
		failOn: 'error',
		limitInputPixels: MAX_PORTRAIT_INPUT_PIXELS,
		pages: 1
	});
	const inputMetadata = await image.metadata();
	if (!inputMetadata.format || !allowedInputFormats.has(inputMetadata.format)) {
		throw new Error('Portrait must be a JPEG, PNG, or WebP image');
	}
	if (!inputMetadata.width || !inputMetadata.height) {
		throw new Error('Portrait dimensions could not be decoded');
	}
	if (inputMetadata.width * inputMetadata.height > MAX_PORTRAIT_INPUT_PIXELS) {
		throw new Error(`Portrait exceeds the ${MAX_PORTRAIT_INPUT_PIXELS}-pixel input limit`);
	}

	const { data, info } = await image
		.rotate()
		.resize({
			width: MAX_PORTRAIT_DIMENSION,
			height: MAX_PORTRAIT_DIMENSION,
			fit: 'inside',
			withoutEnlargement: true
		})
		.webp({ quality: 80 })
		.toBuffer({ resolveWithObject: true });

	if (info.width < MIN_PORTRAIT_DIMENSION || info.height < MIN_PORTRAIT_DIMENSION) {
		throw new Error(
			`Portrait must be at least ${MIN_PORTRAIT_DIMENSION}px in both dimensions after orientation`
		);
	}

	return {
		data,
		contentType: 'image/webp',
		width: info.width,
		height: info.height,
		byteLength: data.byteLength,
		sha256: createHash('sha256').update(data).digest('hex')
	};
}

export async function downloadAndTransformPortrait(
	url: string | URL,
	fetcher?: PortraitFetcher
): Promise<TransformedPortrait> {
	return transformPortrait(await downloadPortrait(url, fetcher));
}

function assertInputSize(byteLength: number): void {
	if (byteLength === 0) throw new Error('Portrait input is empty');
	if (byteLength > MAX_PORTRAIT_INPUT_BYTES) {
		throw new Error(`Portrait exceeds the ${MAX_PORTRAIT_INPUT_BYTES}-byte input limit`);
	}
}
