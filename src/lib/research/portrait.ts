import { createHash } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';
import sharp from 'sharp';

export const MAX_PORTRAIT_INPUT_BYTES = 20 * 1024 * 1024;
export const MAX_PORTRAIT_INPUT_PIXELS = 64_000_000;
export const MAX_PORTRAIT_DIMENSION = 800;
export const MIN_PORTRAIT_DIMENSION = 200;
export const PORTRAIT_DOWNLOAD_TIMEOUT_MS = 20_000;
export const MAX_PORTRAIT_REDIRECTS = 5;

const allowedInputFormats = new Set(['jpeg', 'png', 'webp']);
const blockedAddresses = createBlockedAddressList();

export interface TransformedPortrait {
	data: Buffer;
	contentType: 'image/webp';
	width: number;
	height: number;
	byteLength: number;
	sha256: string;
}

export type PortraitFetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
export type PortraitAddressResolver = (hostname: string) => Promise<string[]>;

export async function downloadPortrait(
	urlValue: string | URL,
	fetcher: PortraitFetcher = globalThis.fetch,
	resolveAddresses: PortraitAddressResolver = resolveHostAddresses
): Promise<Buffer> {
	let url = new URL(urlValue);
	let response: Response | null = null;
	for (let redirectCount = 0; redirectCount <= MAX_PORTRAIT_REDIRECTS; redirectCount += 1) {
		await assertSafePortraitUrl(url, resolveAddresses);
		response = await fetcher(url, {
			headers: { accept: 'image/jpeg, image/png, image/webp' },
			redirect: 'manual',
			signal: AbortSignal.timeout(PORTRAIT_DOWNLOAD_TIMEOUT_MS)
		});
		if (![301, 302, 303, 307, 308].includes(response.status)) break;
		if (redirectCount === MAX_PORTRAIT_REDIRECTS) {
			throw new Error(`Portrait redirect limit of ${MAX_PORTRAIT_REDIRECTS} was exceeded`);
		}
		const location = response.headers.get('location');
		if (!location) throw new Error('Portrait redirect did not include a Location header');
		url = new URL(location, url);
	}
	if (!response) throw new Error('Portrait download did not return a response');
	if (!response.ok) {
		throw new Error(`Portrait download failed with HTTP ${response.status}`);
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
	fetcher?: PortraitFetcher,
	resolveAddresses?: PortraitAddressResolver
): Promise<TransformedPortrait> {
	return transformPortrait(await downloadPortrait(url, fetcher, resolveAddresses));
}

function assertInputSize(byteLength: number): void {
	if (byteLength === 0) throw new Error('Portrait input is empty');
	if (byteLength > MAX_PORTRAIT_INPUT_BYTES) {
		throw new Error(`Portrait exceeds the ${MAX_PORTRAIT_INPUT_BYTES}-byte input limit`);
	}
}

async function assertSafePortraitUrl(
	url: URL,
	resolveAddresses: PortraitAddressResolver
): Promise<void> {
	if (url.protocol !== 'https:') throw new Error('Portrait URL must use HTTPS');
	if (url.username || url.password) throw new Error('Portrait URL must not contain credentials');
	if (!url.hostname) throw new Error('Portrait URL must include a hostname');

	const hostname = url.hostname.replace(/^\[|\]$/g, '');
	const addresses = isIP(hostname) ? [hostname] : await resolveAddresses(hostname);
	if (addresses.length === 0) throw new Error('Portrait hostname did not resolve');
	for (const address of addresses) {
		const family = isIP(address);
		if (family === 0) throw new Error('Portrait hostname resolved to an invalid IP address');
		if (isBlockedAddress(address, family as 4 | 6)) {
			throw new Error('Portrait URL must not resolve to a private or reserved address');
		}
	}
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
