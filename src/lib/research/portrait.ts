import { createHash } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';
import sharp, { type Metadata, type OutputInfo } from 'sharp';

export const MAX_PORTRAIT_INPUT_BYTES = 20 * 1024 * 1024;
export const MAX_PORTRAIT_INPUT_PIXELS = 64_000_000;
export const MAX_PORTRAIT_DIMENSION = 800;
export const MIN_PORTRAIT_SIDE = 100;
export const MIN_PORTRAIT_PIXELS = 15_000;
export const PORTRAIT_DOWNLOAD_TIMEOUT_MS = 20_000;
export const MAX_PORTRAIT_REDIRECTS = 5;

const allowedInputFormats = new Set(['jpeg', 'png', 'webp', 'heif', 'gif', 'tiff']);
const blockedAddresses = createBlockedAddressList();

export type PortraitValidationCode =
	| 'portrait_missing'
	| 'portrait_not_https'
	| 'portrait_unattributable'
	| 'portrait_unusable_resolution'
	| 'portrait_invalid_image'
	| 'portrait_duplicate'
	| 'portrait_download_failed'
	| 'portrait_unsafe_url'
	| 'portrait_input_too_large';

export interface PortraitFailureDiagnostic {
	stage: 'validation' | 'download' | 'decode' | 'normalize';
	originalWidth: number | null;
	originalHeight: number | null;
	format: string | null;
}

export class PortraitValidationError extends Error {
	constructor(
		readonly code: PortraitValidationCode,
		message: string,
		readonly diagnostic: PortraitFailureDiagnostic,
		options?: ErrorOptions
	) {
		super(message, options);
		this.name = 'PortraitValidationError';
	}
}

export interface TransformedPortrait {
	data: Buffer;
	contentType: 'image/webp';
	width: number;
	height: number;
	byteLength: number;
	sha256: string;
	originalWidth: number;
	originalHeight: number;
	originalFormat: string;
}

export type PortraitFetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
export type PortraitAddressResolver = (hostname: string) => Promise<string[]>;

export async function downloadPortrait(
	urlValue: string | URL,
	fetcher: PortraitFetcher = globalThis.fetch,
	resolveAddresses: PortraitAddressResolver = resolveHostAddresses
): Promise<Buffer> {
	let url: URL;
	try {
		url = new URL(urlValue);
	} catch (cause) {
		throw portraitError(
			'portrait_download_failed',
			'Portrait URL is invalid',
			'download',
			undefined,
			cause
		);
	}
	let response: Response | null = null;
	for (let redirectCount = 0; redirectCount <= MAX_PORTRAIT_REDIRECTS; redirectCount += 1) {
		await assertSafePortraitUrl(url, resolveAddresses);
		try {
			response = await fetcher(url, {
				headers: {
					accept: 'image/avif, image/gif, image/jpeg, image/png, image/tiff, image/webp'
				},
				redirect: 'manual',
				signal: AbortSignal.timeout(PORTRAIT_DOWNLOAD_TIMEOUT_MS)
			});
		} catch (cause) {
			throw portraitError(
				'portrait_download_failed',
				'Portrait download failed',
				'download',
				undefined,
				cause
			);
		}
		if (![301, 302, 303, 307, 308].includes(response.status)) break;
		if (redirectCount === MAX_PORTRAIT_REDIRECTS) {
			throw portraitError(
				'portrait_download_failed',
				`Portrait redirect limit of ${MAX_PORTRAIT_REDIRECTS} was exceeded`,
				'download'
			);
		}
		const location = response.headers.get('location');
		if (!location) {
			throw portraitError(
				'portrait_download_failed',
				'Portrait redirect did not include a Location header',
				'download'
			);
		}
		try {
			url = new URL(location, url);
		} catch (cause) {
			throw portraitError(
				'portrait_download_failed',
				'Portrait redirect URL is invalid',
				'download',
				undefined,
				cause
			);
		}
	}
	if (!response) {
		throw portraitError(
			'portrait_download_failed',
			'Portrait download did not return a response',
			'download'
		);
	}
	if (!response.ok) {
		throw portraitError(
			'portrait_download_failed',
			`Portrait download failed with HTTP ${response.status}`,
			'download'
		);
	}

	const contentLength = response.headers.get('content-length');
	if (
		contentLength !== null &&
		(!/^\d+$/.test(contentLength) || Number(contentLength) > MAX_PORTRAIT_INPUT_BYTES)
	) {
		throw portraitError(
			'portrait_input_too_large',
			`Portrait exceeds the ${MAX_PORTRAIT_INPUT_BYTES}-byte input limit`,
			'download'
		);
	}

	if (!response.body) {
		let data: Buffer;
		try {
			data = Buffer.from(await response.arrayBuffer());
		} catch (cause) {
			throw portraitError(
				'portrait_download_failed',
				'Portrait response body could not be read',
				'download',
				undefined,
				cause
			);
		}
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
				throw portraitError(
					'portrait_input_too_large',
					`Portrait exceeds the ${MAX_PORTRAIT_INPUT_BYTES}-byte input limit`,
					'download'
				);
			}
			chunks.push(Buffer.from(value));
		}
	} catch (cause) {
		if (cause instanceof PortraitValidationError) throw cause;
		throw portraitError(
			'portrait_download_failed',
			'Portrait response body could not be read',
			'download',
			undefined,
			cause
		);
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
	let inputMetadata: Metadata;
	try {
		inputMetadata = await image.metadata();
	} catch (cause) {
		throw portraitError(
			'portrait_invalid_image',
			'Portrait could not be decoded as an image',
			'decode',
			undefined,
			cause
		);
	}
	if (!inputMetadata.format || !allowedInputFormats.has(inputMetadata.format)) {
		throw portraitError(
			'portrait_invalid_image',
			'Portrait must be a supported raster image',
			'decode',
			inputMetadata
		);
	}
	if (!inputMetadata.width || !inputMetadata.height) {
		throw portraitError(
			'portrait_invalid_image',
			'Portrait dimensions could not be decoded',
			'decode',
			inputMetadata
		);
	}
	if (inputMetadata.width * inputMetadata.height > MAX_PORTRAIT_INPUT_PIXELS) {
		throw portraitError(
			'portrait_input_too_large',
			`Portrait exceeds the ${MAX_PORTRAIT_INPUT_PIXELS}-pixel input limit`,
			'decode',
			inputMetadata
		);
	}

	let normalized: { data: Buffer; info: OutputInfo };
	try {
		normalized = await image
			.rotate()
			.resize({
				width: MAX_PORTRAIT_DIMENSION,
				height: MAX_PORTRAIT_DIMENSION,
				fit: 'inside',
				withoutEnlargement: true
			})
			.webp({
				quality: 85,
				smartSubsample: true,
				preset: 'photo',
				effort: 4
			})
			.toBuffer({ resolveWithObject: true });
	} catch (cause) {
		throw portraitError(
			'portrait_invalid_image',
			'Portrait could not be normalized',
			'normalize',
			inputMetadata,
			cause
		);
	}
	const { data, info } = normalized;

	if (
		info.width < MIN_PORTRAIT_SIDE ||
		info.height < MIN_PORTRAIT_SIDE ||
		info.width * info.height < MIN_PORTRAIT_PIXELS
	) {
		throw portraitError(
			'portrait_unusable_resolution',
			`Portrait must be at least ${MIN_PORTRAIT_SIDE}px on each side and ${MIN_PORTRAIT_PIXELS} total pixels after orientation`,
			'normalize',
			inputMetadata
		);
	}

	return {
		data,
		contentType: 'image/webp',
		width: info.width,
		height: info.height,
		byteLength: data.byteLength,
		sha256: createHash('sha256').update(data).digest('hex'),
		originalWidth: inputMetadata.width,
		originalHeight: inputMetadata.height,
		originalFormat: inputMetadata.format
	};
}

export async function downloadAndTransformPortrait(
	url: string | URL,
	fetcher?: PortraitFetcher,
	resolveAddresses?: PortraitAddressResolver
): Promise<TransformedPortrait> {
	return transformPortrait(await downloadPortrait(url, fetcher, resolveAddresses));
}

function assertInputSize(byteLength: number): void {
	if (byteLength === 0) {
		throw portraitError('portrait_invalid_image', 'Portrait input is empty', 'decode');
	}
	if (byteLength > MAX_PORTRAIT_INPUT_BYTES) {
		throw portraitError(
			'portrait_input_too_large',
			`Portrait exceeds the ${MAX_PORTRAIT_INPUT_BYTES}-byte input limit`,
			'decode'
		);
	}
}

async function assertSafePortraitUrl(
	url: URL,
	resolveAddresses: PortraitAddressResolver
): Promise<void> {
	if (url.protocol !== 'https:') {
		throw portraitError('portrait_not_https', 'Portrait URL must use HTTPS', 'download');
	}
	if (url.username || url.password) {
		throw portraitError(
			'portrait_unsafe_url',
			'Portrait URL must not contain credentials',
			'download'
		);
	}
	if (!url.hostname) {
		throw portraitError('portrait_unsafe_url', 'Portrait URL must include a hostname', 'download');
	}

	const hostname = url.hostname.replace(/^\[|\]$/g, '');
	let addresses: string[];
	try {
		addresses = isIP(hostname) ? [hostname] : await resolveAddresses(hostname);
	} catch (cause) {
		throw portraitError(
			'portrait_download_failed',
			'Portrait hostname could not be resolved',
			'download',
			undefined,
			cause
		);
	}
	if (addresses.length === 0) {
		throw portraitError(
			'portrait_download_failed',
			'Portrait hostname did not resolve',
			'download'
		);
	}
	for (const address of addresses) {
		const family = isIP(address);
		if (family === 0) {
			throw portraitError(
				'portrait_unsafe_url',
				'Portrait hostname resolved to an invalid IP address',
				'download'
			);
		}
		if (isBlockedAddress(address, family as 4 | 6)) {
			throw portraitError(
				'portrait_unsafe_url',
				'Portrait URL must not resolve to a private or reserved address',
				'download'
			);
		}
	}
}

function portraitError(
	code: PortraitValidationCode,
	message: string,
	stage: PortraitFailureDiagnostic['stage'],
	metadata?: Pick<Metadata, 'width' | 'height' | 'format'>,
	cause?: unknown
): PortraitValidationError {
	return new PortraitValidationError(
		code,
		message,
		{
			stage,
			originalWidth: metadata?.width ?? null,
			originalHeight: metadata?.height ?? null,
			format: metadata?.format ?? null
		},
		cause === undefined ? undefined : { cause }
	);
}

async function resolveHostAddresses(hostname: string): Promise<string[]> {
	return (await lookup(hostname, { all: true, verbatim: true })).map((entry) => entry.address);
}

function isBlockedAddress(address: string, family: 4 | 6): boolean {
	if (family === 6) {
		const mapped = mappedIpv4Address(address);
		if (mapped) return blockedAddresses.check(mapped, 'ipv4');
	}
	return blockedAddresses.check(address, family === 4 ? 'ipv4' : 'ipv6');
}

function mappedIpv4Address(address: string): string | null {
	const dotted = /^(?:::ffff:|0:0:0:0:0:ffff:)(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(address);
	if (dotted && isIP(dotted[1]!) === 4) return dotted[1]!;
	const hexadecimal = /^(?:::ffff:|0:0:0:0:0:ffff:)([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i.exec(address);
	if (!hexadecimal) return null;
	const high = Number.parseInt(hexadecimal[1]!, 16);
	const low = Number.parseInt(hexadecimal[2]!, 16);
	return [high >> 8, high & 0xff, low >> 8, low & 0xff].join('.');
}

function createBlockedAddressList(): BlockList {
	const list = new BlockList();
	for (const [network, prefix] of [
		['0.0.0.0', 8],
		['10.0.0.0', 8],
		['100.64.0.0', 10],
		['127.0.0.0', 8],
		['169.254.0.0', 16],
		['172.16.0.0', 12],
		['192.0.0.0', 24],
		['192.0.2.0', 24],
		['192.88.99.0', 24],
		['192.168.0.0', 16],
		['198.18.0.0', 15],
		['198.51.100.0', 24],
		['203.0.113.0', 24],
		['224.0.0.0', 4],
		['240.0.0.0', 4]
	] as const) {
		list.addSubnet(network, prefix, 'ipv4');
	}
	for (const [network, prefix] of [
		['::', 128],
		['::1', 128],
		['2001:db8::', 32],
		['fc00::', 7],
		['fe80::', 10],
		['ff00::', 8]
	] as const) {
		list.addSubnet(network, prefix, 'ipv6');
	}
	return list;
}
