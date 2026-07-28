import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createNormalizedUniverseSnapshot, type NormalizedIssuer } from '../../research/universe';

const databaseUrl = process.env.DATABASE_URL;
const integration = databaseUrl ? describe : describe.skip;

integration('universe exclusion and archive persistence', () => {
	const cleanup = postgres(databaseUrl!, { max: 1 });

	beforeAll(async () => {
		await cleanup.unsafe(`
			truncate table
				cohort_state,
				research_snapshot,
				security_listing,
				company
			restart identity cascade
		`);
	});

	afterAll(async () => {
		await cleanup.end();
	});

	it('archives absent companies, unarchives reappearing companies, and preserves manual overlap exclusions', async () => {
		const { connectResearchDatabase, createDatabaseResearchImportService } =
			await import('../research-import');
		const connection = connectResearchDatabase(databaseUrl!);
		const importer = createDatabaseResearchImportService(connection.database);
		const alpha = issuer('cik:0000000101', 'ALFA');
		const beta = issuer('cik:0000000102', 'BETA');

		try {
			await importer.importUniverse(snapshot([alpha, beta]));
			const [alphaRow, betaRow] = await cleanup<Array<{ id: string; issuerKey: string }>>`
				select id, issuer_key as "issuerKey"
				from company
				order by issuer_key
			`;
			expect(alphaRow?.issuerKey).toBe(alpha.issuerKey);
			expect(betaRow?.issuerKey).toBe(beta.issuerKey);

			await cleanup`
				update company
				set
					included = false,
					manual_exclusion_reason = 'overlapping_executive_coverage',
					exclusion_reference_company_id = ${alphaRow!.id}
				where id = ${betaRow!.id}
			`;
			await expect(
				cleanup`
					update company
					set included = true
					where id = ${betaRow!.id}
				`
			).rejects.toThrow('company_included_matches_state');
			await expect(
				cleanup`
					update company
					set exclusion_reference_company_id = null
					where id = ${betaRow!.id}
				`
			).rejects.toThrow('company_exclusion_reference_valid');

			await expect(importer.importUniverse(snapshot([alpha]))).resolves.toMatchObject({
				issuerCount: 1,
				includedCount: 1,
				excludedCount: 0
			});
			const [archived] = await cleanup<
				Array<{
					included: boolean;
					universeExclusionReason: string | null;
					manualExclusionReason: string | null;
					exclusionReferenceCompanyId: string | null;
					archivedAt: Date | null;
				}>
			>`
				select
					included,
					universe_exclusion_reason as "universeExclusionReason",
					manual_exclusion_reason as "manualExclusionReason",
					exclusion_reference_company_id as "exclusionReferenceCompanyId",
					archived_at as "archivedAt"
				from company
				where id = ${betaRow!.id}
			`;
			expect(archived).toMatchObject({
				included: false,
				universeExclusionReason: null,
				manualExclusionReason: 'overlapping_executive_coverage',
				exclusionReferenceCompanyId: alphaRow!.id
			});
			expect(archived?.archivedAt).toBeInstanceOf(Date);
			const { includeCompany } = await import('../arena/admin-service');
			const { getAdminCompany, getReadinessSummary, listCompanies } =
				await import('../arena/read-model');
			await expect(listCompanies('', 1, 50, 'all')).resolves.toMatchObject({
				total: 1,
				rows: [expect.objectContaining({ id: alphaRow!.id })]
			});
			await expect(getAdminCompany(betaRow!.id)).resolves.toBeNull();
			await expect(getReadinessSummary()).resolves.toMatchObject({
				total: 1,
				excluded: 0
			});

			const universeExcludedBeta: NormalizedIssuer = {
				...beta,
				included: false,
				universeExclusionReason: 'blank_check_or_shell_company'
			};
			await expect(
				importer.importUniverse(snapshot([alpha, universeExcludedBeta]))
			).resolves.toMatchObject({
				issuerCount: 2,
				includedCount: 1,
				excludedCount: 1
			});
			const [locked] = await cleanup<
				Array<{
					universeExclusionReason: string | null;
					manualExclusionReason: string | null;
				}>
			>`
				select
					universe_exclusion_reason as "universeExclusionReason",
					manual_exclusion_reason as "manualExclusionReason"
				from company
				where id = ${betaRow!.id}
			`;
			expect(locked).toEqual({
				universeExclusionReason: 'blank_check_or_shell_company',
				manualExclusionReason: 'overlapping_executive_coverage'
			});
			await expect(includeCompany(betaRow!.id)).rejects.toThrow('Universe-managed');

			await expect(importer.importUniverse(snapshot([alpha, beta]))).resolves.toMatchObject({
				issuerCount: 2,
				includedCount: 1,
				excludedCount: 1
			});
			const [restored] = await cleanup<
				Array<{
					included: boolean;
					manualExclusionReason: string | null;
					exclusionReferenceCompanyId: string | null;
					archivedAt: Date | null;
				}>
			>`
				select
					included,
					manual_exclusion_reason as "manualExclusionReason",
					exclusion_reference_company_id as "exclusionReferenceCompanyId",
					archived_at as "archivedAt"
				from company
				where id = ${betaRow!.id}
			`;
			expect(restored).toEqual({
				included: false,
				manualExclusionReason: 'overlapping_executive_coverage',
				exclusionReferenceCompanyId: alphaRow!.id,
				archivedAt: null
			});
		} finally {
			await connection.close();
		}
	});
});

function issuer(issuerKey: string, ticker: string): NormalizedIssuer {
	return {
		issuerKey,
		cik: issuerKey.slice(4),
		name: `${ticker} Corporation`,
		description: `${ticker} manufactures durable products.`,
		homepageUrl: `https://example.com/${ticker.toLowerCase()}`,
		sicCode: '3571',
		sicDescription: 'Electronic Computers',
		canonicalTicker: ticker,
		marketCap: 1_000_000_000,
		included: true,
		universeExclusionReason: null,
		listings: [
			{
				ticker,
				name: `${ticker} Corporation`,
				primaryExchange: 'XNAS',
				type: 'CS',
				active: true,
				compositeFigi: `BBG${ticker}`,
				shareClassFigi: `BBG${ticker}SHARE`,
				marketCap: 1_000_000_000,
				lastUpdatedAt: '2026-07-28T10:00:00Z',
				isCanonical: true
			}
		]
	};
}

function snapshot(issuers: NormalizedIssuer[]) {
	return createNormalizedUniverseSnapshot(
		issuers,
		'2026-07-28',
		new Date('2026-07-28T12:00:00.000Z')
	);
}
