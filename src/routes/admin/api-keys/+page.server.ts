import { fail, redirect } from '@sveltejs/kit';
import { z } from 'zod';
import { createMcpApiKey, listMcpApiKeys, revokeMcpApiKey } from '$lib/server/mcp/api-keys';
import type { Actions, PageServerLoad } from './$types';

const createSchema = z.object({
	name: z.string().trim().min(1, 'Name is required').max(100, 'Name must be 100 characters or less')
});

const revokeSchema = z.object({
	id: z.uuid()
});

export const load: PageServerLoad = async ({ url }) => ({
	keys: await listMcpApiKeys(),
	notice: url.searchParams.get('notice')
});

export const actions: Actions = {
	create: async ({ request }) => {
		const form = await request.formData();
		const parsed = createSchema.safeParse({ name: form.get('name') });
		if (!parsed.success) {
			return fail(400, {
				action: 'create',
				message: parsed.error.issues[0]?.message ?? 'Invalid key name',
				name: typeof form.get('name') === 'string' ? form.get('name') : ''
			});
		}
		try {
			const created = await createMcpApiKey(parsed.data.name);
			return {
				action: 'create',
				created: {
					name: created.name,
					prefix: created.prefix,
					token: created.token
				}
			};
		} catch (cause) {
			return fail(500, {
				action: 'create',
				message: cause instanceof Error ? cause.message : 'API key creation failed',
				name: parsed.data.name
			});
		}
	},

	revoke: async ({ request }) => {
		const form = await request.formData();
		const parsed = revokeSchema.safeParse({ id: form.get('id') });
		if (!parsed.success) {
			return fail(400, { action: 'revoke', message: 'Invalid API key' });
		}
		const revoked = await revokeMcpApiKey(parsed.data.id);
		if (!revoked) {
			return fail(409, { action: 'revoke', message: 'API key is already revoked or missing' });
		}
		redirect(303, '/admin/api-keys?notice=key-revoked');
	}
};
