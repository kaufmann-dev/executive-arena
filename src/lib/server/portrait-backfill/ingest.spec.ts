import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TransformedPortrait } from '$lib/research/portrait';
import type { BravePortraitCandidate } from './brave';

const mocks = vi.hoisted(() => {
	const queryChain = {
		from: vi.fn(),
		innerJoin: vi.fn(),
		where: vi.fn(),
		limit: vi.fn(async () => [{ name: 'Ada Lovelace' }])
	};
	queryChain.from.mockReturnValue(queryChain);
	queryChain.innerJoin.mockReturnValue(queryChain);
	queryChain.where.mockReturnValue(queryChain);
	return {
		download: vi.fn(),
		save: vi.fn(),
		insertValues: vi.fn(async () => undefined),
		queryChain
	};
});

vi.mock('$lib/research/portrait', async (importOriginal) => {
	const original = await importOriginal<typeof import('$lib/research/portrait')>();
	return { ...original, downloadAndTransformPortrait: mocks.download };
});

vi.mock('$lib/server/arena/admin-service', () => ({
	DuplicatePortraitError: class DuplicatePortraitError extends Error {},
	savePreparedExecutivePortrait: mocks.save
}));

vi.mock('$lib/server/db', () => ({
	db: {
		insert: vi.fn(() => ({ values: mocks.insertValues })),
		select: vi.fn(() => mocks.queryChain)
	}
}));

import { PortraitValidationError } from '$lib/research/portrait';
import { ingestBravePortrait } from './service';

const COMPANY_ID = '7f0cb0c0-5ca9-41fb-b54f-f0c1e7383f7b';
const PERSON_ID = '8f0cb0c0-5ca9-41fb-b54f-f0c1e7383f7b';
const NOW = new Date('2026-07-28T00:00:00.000Z');

describe('Brave portrait ingestion', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('records a blocked original and saves the validated Brave thumbnail fallback', async () => {
		const transformed = portrait();
		mocks.download
			.mockRejectedValueOnce(
				new PortraitValidationError(
					'portrait_download_failed',
					'Portrait download failed with HTTP 403',
					diagnostic('download', 403, 'text/html')
				)
			)
			.mockResolvedValueOnce(transformed);
		mocks.save.mockResolvedValueOnce({ portraitId: 'portrait-1', readinessStatus: 'ready' });

		await expect(ingestBravePortrait(COMPANY_ID, PERSON_ID, candidate(), NOW)).resolves.toEqual({
			personId: PERSON_ID,
			portraitId: 'portrait-1',
			usedThumbnailFallback: true
		});

		expect(mocks.download).toHaveBeenNthCalledWith(
			1,
			'https://media.example.com/ada.jpg',
			undefined,
			undefined,
			{ sourcePageUrl: 'https://example.com/leadership/ada' }
		);
		expect(mocks.download).toHaveBeenNthCalledWith(
			2,
			'https://imgs.search.brave.com/ada',
			undefined,
			undefined,
			{ sourcePageUrl: 'https://example.com/leadership/ada' }
		);
		expect(mocks.save).toHaveBeenCalledWith(
			COMPANY_ID,
			expect.objectContaining({
				personId: PERSON_ID,
				portrait: transformed,
				imageUrl: 'https://media.example.com/ada.jpg',
				sourceUrl: 'https://example.com/leadership/ada'
			}),
			NOW
		);
		expect(mocks.insertValues).toHaveBeenNthCalledWith(
			1,
			expect.objectContaining({
				retrievalKind: 'original',
				outcome: 'rejected',
				host: 'media.example.com',
				httpStatus: 403,
				contentType: 'text/html'
			})
		);
		expect(mocks.insertValues).toHaveBeenNthCalledWith(
			2,
			expect.objectContaining({
				retrievalKind: 'brave_thumbnail',
				outcome: 'saved',
				host: 'imgs.search.brave.com'
			})
		);
	});

	it('does not replace an original that decoded correctly but is too small', async () => {
		mocks.download.mockRejectedValueOnce(
			new PortraitValidationError(
				'portrait_unusable_resolution',
				'Portrait is too small',
				diagnostic('normalize', 200, 'image/jpeg')
			)
		);

		await expect(
			ingestBravePortrait(COMPANY_ID, PERSON_ID, candidate(), NOW)
		).rejects.toMatchObject({ code: 'portrait_unusable_resolution' });

		expect(mocks.download).toHaveBeenCalledOnce();
		expect(mocks.save).not.toHaveBeenCalled();
		expect(mocks.insertValues).toHaveBeenCalledWith(
			expect.objectContaining({
				retrievalKind: 'original',
				outcome: 'rejected',
				validationCode: 'portrait_unusable_resolution'
			})
		);
	});
});

function candidate(): BravePortraitCandidate {
	return {
		title: 'Ada Lovelace portrait',
		sourcePageUrl: 'https://example.com/leadership/ada',
		publisher: 'Example Company',
		confidence: 'high',
		originalUrl: 'https://media.example.com/ada.jpg',
		originalWidth: 1200,
		originalHeight: 1600,
		thumbnailUrl: 'https://imgs.search.brave.com/ada',
		thumbnailWidth: 300,
		thumbnailHeight: 400
	};
}

function portrait(): TransformedPortrait {
	return {
		data: Buffer.from('portrait'),
		contentType: 'image/webp',
		width: 300,
		height: 400,
		byteLength: 8,
		sha256: 'ab'.repeat(32),
		originalWidth: 300,
		originalHeight: 400,
		originalFormat: 'jpeg',
		sourceHttpStatus: 200,
		sourceContentType: 'image/jpeg',
		sourceFinalLocation: 'https://imgs.search.brave.com/ada'
	};
}

function diagnostic(stage: 'download' | 'normalize', httpStatus: number, contentType: string) {
	return {
		stage,
		originalWidth: null,
		originalHeight: null,
		format: null,
		httpStatus,
		contentType,
		finalLocation: null
	};
}
