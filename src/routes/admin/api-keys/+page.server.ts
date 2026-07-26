import { fail, redirect } from '@sveltejs/kit';
import { z } from 'zod';
import { createMcpApiKey, deleteMcpApiKey, listMcpApiKeys } from '$lib/server/mcp/api-keys';
import type { Actions, PageServerLoad } from './$types';

const createSchema = z.object({
	name: z.string().trim().min(1, 'Name is required').max(100, 'Name must be 100 characters or less')
});

const deleteSchema = z.object({
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

	delete: async ({ request }) => {
		const form = await request.formData();
		const parsed = deleteSchema.safeParse({ id: form.get('id') });
		if (!parsed.success) {
			return fail(400, { action: 'delete', message: 'Invalid API key' });
		}
		const deleted = await deleteMcpApiKey(parsed.data.id);
		if (!deleted) {
			return fail(404, { action: 'delete', message: 'API key no longer exists' });
		}
		redirect(303, '/admin/api-keys?notice=key-deleted');
	}
};
