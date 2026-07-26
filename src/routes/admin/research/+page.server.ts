import { fail, redirect } from '@sveltejs/kit';
import { z } from 'zod';
import {
	createResearchModel,
	createResearchProvider,
	createResearchRun,
	getResearchWorkerStatus,
	listRecentResearchFailures,
	listResearchProviders,
	listResearchRuns,
	modelInputSchema,
	modelUpdateSchema,
	providerInputSchema,
	providerKeyRotationSchema,
	providerUpdateSchema,
	rotateResearchProviderKey,
	setResearchRunStatus,
	updateResearchModel,
	updateResearchProvider
} from '$lib/server/research-runner/configuration';
import type { Actions, PageServerLoad } from './$types';

const idSchema = z.strictObject({ id: z.uuid() });

export const load: PageServerLoad = async ({ url }) => {
	const [providers, runs, worker, failures] = await Promise.all([
		listResearchProviders(),
		listResearchRuns(),
		getResearchWorkerStatus(),
		listRecentResearchFailures()
	]);
	return {
		providers,
		runs,
		worker,
		failures,
		notice: url.searchParams.get('notice')
	};
};

export const actions: Actions = {
	createProvider: async ({ request }) => {
		const form = await request.formData();
		const parsed = providerInputSchema.safeParse({
			name: stringField(form, 'name'),
			baseUrl: stringField(form, 'baseUrl'),
			apiKey: stringField(form, 'apiKey')
		});
		if (!parsed.success) return validationFailure('createProvider', parsed.error);
		try {
			await createResearchProvider(parsed.data);
		} catch (cause) {
			return operationFailure('createProvider', cause);
		}
		redirect(303, '/admin/research?notice=provider-created');
	},

	updateProvider: async ({ request }) => {
		const form = await request.formData();
		const parsed = providerUpdateSchema.safeParse({
			id: stringField(form, 'id'),
			name: stringField(form, 'name'),
			baseUrl: stringField(form, 'baseUrl'),
			enabled: form.get('enabled') === 'on'
		});
		if (!parsed.success) return validationFailure('updateProvider', parsed.error);
		try {
			await updateResearchProvider(parsed.data);
		} catch (cause) {
			return operationFailure('updateProvider', cause);
		}
		redirect(303, '/admin/research?notice=provider-updated');
	},

	rotateKey: async ({ request }) => {
		const form = await request.formData();
		const parsed = providerKeyRotationSchema.safeParse({
			id: stringField(form, 'id'),
			apiKey: stringField(form, 'apiKey')
		});
		if (!parsed.success) return validationFailure('rotateKey', parsed.error);
		try {
			await rotateResearchProviderKey(parsed.data);
		} catch (cause) {
			return operationFailure('rotateKey', cause);
		}
		redirect(303, '/admin/research?notice=key-rotated');
	},

	createModel: async ({ request }) => {
		const form = await request.formData();
		const parsed = modelInputSchema.safeParse(modelFields(form));
		if (!parsed.success) return validationFailure('createModel', parsed.error);
		try {
			await createResearchModel(parsed.data);
		} catch (cause) {
			return operationFailure('createModel', cause);
		}
		redirect(303, '/admin/research?notice=model-created');
	},

	updateModel: async ({ request }) => {
		const form = await request.formData();
		const parsed = modelUpdateSchema.safeParse({
			id: stringField(form, 'id'),
			...modelFields(form)
		});
		if (!parsed.success) return validationFailure('updateModel', parsed.error);
		try {
			await updateResearchModel(parsed.data);
		} catch (cause) {
			return operationFailure('updateModel', cause);
		}
		redirect(303, '/admin/research?notice=model-updated');
	},

	startRun: async ({ request }) => {
		const form = await request.formData();
		const parsed = idSchema.safeParse({ id: stringField(form, 'id') });
		if (!parsed.success) return validationFailure('startRun', parsed.error);
		try {
			await createResearchRun(parsed.data.id);
		} catch (cause) {
			return operationFailure('startRun', cause);
		}
		redirect(303, '/admin/research?notice=run-created');
	},

	pauseRun: runAction('pause'),
	resumeRun: runAction('resume'),
	cancelRun: runAction('cancel')
};

function runAction(action: 'pause' | 'resume' | 'cancel'): Actions[string] {
	return async ({ request }) => {
		const form = await request.formData();
		const parsed = idSchema.safeParse({ id: stringField(form, 'id') });
		if (!parsed.success) return validationFailure(`${action}Run`, parsed.error);
		try {
			await setResearchRunStatus(parsed.data.id, action);
		} catch (cause) {
			return operationFailure(`${action}Run`, cause);
		}
		redirect(303, `/admin/research?notice=run-${action}d`);
	};
}

function modelFields(form: FormData) {
	return {
		providerId: stringField(form, 'providerId'),
		name: stringField(form, 'name'),
		modelId: stringField(form, 'modelId'),
		maxConcurrency: stringField(form, 'maxConcurrency'),
		requestsPerMinute: stringField(form, 'requestsPerMinute'),
		tokensPerMinute: stringField(form, 'tokensPerMinute'),
		requestTimeoutMs: stringField(form, 'requestTimeoutMs'),
		maxOutputTokens: stringField(form, 'maxOutputTokens'),
		maxAttempts: stringField(form, 'maxAttempts'),
		enabled: form.get('enabled') === 'on'
	};
}

function stringField(form: FormData, name: string): string {
	const value = form.get(name);
	return typeof value === 'string' ? value : '';
}

function validationFailure(action: string, error: z.ZodError) {
	return fail(400, {
		action,
		message: error.issues[0]?.message ?? 'The submitted settings are invalid'
	});
}

function operationFailure(action: string, cause: unknown) {
	return fail(400, {
		action,
		message: cause instanceof Error ? cause.message : 'The operation failed'
	});
}
