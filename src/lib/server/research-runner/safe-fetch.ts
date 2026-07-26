import { lookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';

const MAX_REDIRECTS = 5;
const blockedAddresses = createBlockedAddressList();

export interface SafeFetchOptions {
	accept: string;
	maxBytes: number;
	timeoutMs: number;
	userAgent: string;
	fetcher?: typeof fetch;
	resolveAddresses?: (hostname: string) => Promise<string[]>;
}

export async function fetchPublicResource(
	input: string | URL,
	options: SafeFetchOptions
): Promise<{ body: Buffer; contentType: string; finalUrl: URL }> {
	const fetcher = options.fetcher ?? globalThis.fetch;
	const resolveAddresses = options.resolveAddresses ?? resolveHostAddresses;
	let url = new URL(input);

	for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
		await assertPublicHttpUrl(url, resolveAddresses);
		const response = await fetcher(url, {
			headers: {
				accept: options.accept,
				'user-agent': options.userAgent
			},
			redirect: 'manual',
			signal: AbortSignal.timeout(options.timeoutMs)
		});
		if ([301, 302, 303, 307, 308].includes(response.status)) {
			if (redirects === MAX_REDIRECTS) throw new Error('Source redirect limit was exceeded');
			const location = response.headers.get('location');
			if (!location) throw new Error('Source redirect did not include a Location header');
			url = new URL(location, url);
			continue;
		}
		if (!response.ok) throw new Error(`Source request failed with HTTP ${response.status}`);

		const contentLength = response.headers.get('content-length');
		if (
			contentLength !== null &&
			(!/^\d+$/.test(contentLength) || Number(contentLength) > options.maxBytes)
		) {
			throw new Error(`Source exceeds the ${options.maxBytes}-byte input limit`);
		}
		return {
			body: await readLimitedBody(response, options.maxBytes),
			contentType: response.headers.get('content-type')?.split(';')[0]?.trim() ?? '',
			finalUrl: url
		};
	}
	throw new Error('Source redirect limit was exceeded');
}

export async function assertPublicHttpUrl(
	url: URL,
	resolveAddresses: (hostname: string) => Promise<string[]> = resolveHostAddresses
): Promise<void> {
	if (url.protocol !== 'https:' && url.protocol !== 'http:') {
		throw new Error('Source URL must use HTTP or HTTPS');
	}
	if (url.username || url.password) throw new Error('Source URL must not contain credentials');
	if (!url.hostname) throw new Error('Source URL must include a hostname');

	const hostname = url.hostname.replace(/^\[|\]$/g, '');
	const addresses = isIP(hostname) ? [hostname] : await resolveAddresses(hostname);
	if (addresses.length === 0) throw new Error('Source hostname did not resolve');
	for (const address of addresses) {
		const family = isIP(address);
		if (family === 0 || isBlockedAddress(address, family as 4 | 6)) {
			throw new Error('Source URL must not resolve to a private or reserved address');
		}
	}
}

async function readLimitedBody(response: Response, maxBytes: number): Promise<Buffer> {
	if (!response.body) {
		const body = Buffer.from(await response.arrayBuffer());
		if (body.byteLength > maxBytes) throw new Error(`Source exceeds the ${maxBytes}-byte limit`);
		return body;
	}

	const chunks: Buffer[] = [];
	let byteLength = 0;
	const reader = response.body.getReader();
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			byteLength += value.byteLength;
			if (byteLength > maxBytes) {
				await reader.cancel();
				throw new Error(`Source exceeds the ${maxBytes}-byte limit`);
			}
			chunks.push(Buffer.from(value));
		}
	} finally {
		reader.releaseLock();
	}
	return Buffer.concat(chunks, byteLength);
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
