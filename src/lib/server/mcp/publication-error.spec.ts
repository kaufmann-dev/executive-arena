import { describe, expect, it, vi } from 'vitest';
import {
	databaseFailureMetadata,
	logProfilePublicationFailure,
	ProfilePublicationFailure
} from './publication-error';

describe('profile publication failure diagnostics', () => {
	it('extracts PostgreSQL metadata without logging query parameters or signed URLs', () => {
		const postgresError = Object.assign(
			new Error('duplicate key value violates unique constraint'),
			{
				name: 'PostgresError',
				code: '23505',
				severity: 'ERROR',
				constraint_name: 'source_url_unique_idx',
				schema_name: 'public',
				table_name: 'source',
				column_name: null,
				detail: 'Key (url)=(https://example.com/leader.jpg?token=signed-secret) already exists.'
			}
		);
		const drizzleError = Object.assign(
			new Error(
				'Failed query: insert into research_snapshot (payload) values ($1)\nparams: {"schema_version":4,"leaders":[{"summary":"secret profile payload"}]}'
			),
			{
				name: 'DrizzleQueryError',
				query: 'insert into research_snapshot (payload) values ($1)',
				params: ['secret profile payload'],
				cause: postgresError
			}
		);
		const report = vi.fn();

		logProfilePublicationFailure(
			new ProfilePublicationFailure(
				'profile_import',
				'6f0cb0c0-5ca9-41fb-b54f-f0c1e7383f7b',
				'cik:0000000001',
				drizzleError
			),
			report
		);

		expect(report).toHaveBeenCalledOnce();
		const line = report.mock.calls[0]![0];
		expect(JSON.parse(line)).toEqual({
			event: 'mcp_profile_publication_failed',
			companyId: '6f0cb0c0-5ca9-41fb-b54f-f0c1e7383f7b',
			issuerKey: 'cik:0000000001',
			stage: 'profile_import',
			errorName: 'PostgresError',
			database: {
				code: '23505',
				severity: 'ERROR',
				constraint: 'source_url_unique_idx',
				schema: 'public',
				table: 'source',
				column: null,
				detail: 'Key (url)=(https://example.com/leader.jpg) already exists.',
				message: 'duplicate key value violates unique constraint'
			}
		});
		expect(line).not.toContain('signed-secret');
		expect(line).not.toContain('secret profile payload');
		expect(line).not.toContain('insert into');
		expect(line).not.toContain('params:');
	});

	it('does not classify an ordinary application error as a database failure', () => {
		expect(databaseFailureMetadata(new Error('Company not found'))).toBeNull();
	});
});
