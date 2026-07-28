import postgres from 'postgres';
import sharp from 'sharp';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const databaseUrl = process.env.DATABASE_URL;
const integration = databaseUrl ? describe : describe.skip;
const companyId = '10000000-0000-4000-8000-000000000001';
const personId = '20000000-0000-4000-8000-000000000001';
const slateId = '30000000-0000-4000-8000-000000000001';

integration('atomic portrait batches', () => {
	const sql = postgres(databaseUrl!, { max: 1 });
	let firstImage: Buffer;
	let secondImage: Buffer;
	let thirdImage: Buffer;

	beforeAll(async () => {
		firstImage = await image({ r: 37, g: 96, b: 72 });
		secondImage = await image({ r: 102, g: 73, b: 142 });
		thirdImage = await image({ r: 184, g: 116, b: 48 });
	});

	beforeEach(async () => {
		await sql.unsafe(`
			truncate table
				cohort_state,
				leadership_member,
				portrait,
				leadership_slate,
				person,
				company
			restart identity cascade
		`);
		await sql`
			insert into cohort_state (id, revision, pairing_seed)
			values (1, 1, 'portrait-batch-test')
		`;
		await sql`
			insert into company (
				id, issuer_key, name, canonical_ticker, included, cohort_order
			)
			values (
				${companyId}, 'test:portrait-batch', 'Portrait Batch Company', 'PBC', true, 1
			)
		`;
		await sql`
			insert into person (
				id, canonical_name, slug, summary, leadership_as_of
			)
			values (
				${personId}, 'Pat Portrait', 'pat-portrait', 'Test executive', '2026-07-28'
			)
		`;
		await sql`
			insert into leadership_slate (
				id, company_id, version, status, effective_at
			)
			values (${slateId}, ${companyId}, 1, 'active', '2026-07-28')
		`;
		await sql`
			insert into leadership_member (
				slate_id, person_id, title, role_kind, display_order
			)
			values (${slateId}, ${personId}, 'Chief Executive Officer', 'ceo', 0)
		`;
	});

	afterAll(async () => {
		await sql.end();
	});

	it('saves up to three images with sequential display order and no provenance', async () => {
		const { saveExecutivePortraitBatch } = await import('../arena/admin-service');

		const saved = await saveExecutivePortraitBatch(companyId, [
			{
				personId,
				images: [{ bytes: firstImage }, { bytes: secondImage }, { bytes: thirdImage }]
			}
		]);
		const portraits = await sql<
			Array<{
				displayOrder: number;
				imageUrl: string | null;
				sourceId: string | null;
				altText: string;
			}>
		>`
			select
				display_order as "displayOrder",
				image_url as "imageUrl",
				source_id as "sourceId",
				alt_text as "altText"
			from portrait
			where person_id = ${personId}
			order by display_order
		`;

		expect(saved.portraitIds).toHaveLength(3);
		expect(portraits).toEqual([
			{
				displayOrder: 0,
				imageUrl: null,
				sourceId: null,
				altText: 'Portrait of Pat Portrait'
			},
			{
				displayOrder: 1,
				imageUrl: null,
				sourceId: null,
				altText: 'Portrait of Pat Portrait'
			},
			{
				displayOrder: 2,
				imageUrl: null,
				sourceId: null,
				altText: 'Portrait of Pat Portrait'
			}
		]);
	});

	it('rolls back the whole batch when an incoming image is duplicated', async () => {
		const { saveExecutivePortraitBatch } = await import('../arena/admin-service');

		await expect(
			saveExecutivePortraitBatch(companyId, [
				{
					personId,
					images: [{ bytes: firstImage }, { bytes: firstImage }]
				}
			])
		).rejects.toThrow('same portrait');

		const [{ count }] = await sql<
			Array<{ count: number }>
		>`select count(*)::int as count from portrait`;
		expect(count).toBe(0);
	});

	it('does not write valid images when another image cannot be decoded', async () => {
		const { saveExecutivePortraitBatch } = await import('../arena/admin-service');

		await expect(
			saveExecutivePortraitBatch(companyId, [
				{
					personId,
					images: [{ bytes: firstImage }, { bytes: new Uint8Array([1, 2, 3]) }]
				}
			])
		).rejects.toThrow();

		const [{ count }] = await sql<
			Array<{ count: number }>
		>`select count(*)::int as count from portrait`;
		expect(count).toBe(0);
	});

	it('leaves existing portraits unchanged when a batch exceeds capacity', async () => {
		const { saveExecutivePortraitBatch } = await import('../arena/admin-service');
		await saveExecutivePortraitBatch(companyId, [
			{ personId, images: [{ bytes: firstImage }, { bytes: secondImage }] }
		]);

		await expect(
			saveExecutivePortraitBatch(companyId, [
				{ personId, images: [{ bytes: thirdImage }, { bytes: firstImage }] }
			])
		).rejects.toThrow('at most three portraits');

		const portraits = await sql<
			Array<{ displayOrder: number }>
		>`select display_order as "displayOrder" from portrait order by display_order`;
		expect(portraits).toEqual([{ displayOrder: 0 }, { displayOrder: 1 }]);
	});
});

async function image(background: { r: number; g: number; b: number }): Promise<Buffer> {
	return sharp({
		create: { width: 320, height: 320, channels: 3, background }
	})
		.png()
		.toBuffer();
}
