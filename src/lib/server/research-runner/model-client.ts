import { z } from 'zod';
import {
	executiveProfileSchema,
	executiveReviewArtifactSchema,
	type ExecutiveProfile,
	type ExecutiveReviewArtifact,
	type ResearchSource
} from '$lib/research/schemas';
import { collectProfileSources } from '$lib/research/validation';
import type {
	DiscoveredSource,
	ResearchCompanyInput,
	ResearchSourceBundle
} from './source-discovery';

const chatCompletionResponseSchema = z.object({
	choices: z
		.array(
			z.object({
				finish_reason: z.string().nullable().optional(),
				message: z.object({ content: z.string().nullable() })
			})
		)
		.min(1),
	usage: z
		.object({
			prompt_tokens: z.number().int().nonnegative().optional(),
			completion_tokens: z.number().int().nonnegative().optional()
		})
		.optional()
});

export interface ModelRequestConfiguration {
	baseUrl: string;
	model: string;
	apiKey: string;
	requestTimeoutMs: number;
	maxOutputTokens: number;
	userId: string;
}

export interface ModelResearchResult {
	artifact: ExecutiveProfile | ExecutiveReviewArtifact;
	promptTokens: number;
	completionTokens: number;
}

export class ModelRequestError extends Error {
	constructor(
		message: string,
		readonly retryable: boolean
	) {
		super(message);
	}
}

export async function requestExecutiveResearch(
	configuration: ModelRequestConfiguration,
	company: ResearchCompanyInput,
	bundle: ResearchSourceBundle,
	now = new Date(),
	fetcher: typeof fetch = globalThis.fetch
): Promise<ModelResearchResult> {
	const endpoint = `${configuration.baseUrl.replace(/\/$/, '')}/chat/completions`;
	let response: Response;
	try {
		response = await fetcher(endpoint, {
			method: 'POST',
			headers: {
				authorization: `Bearer ${configuration.apiKey}`,
				'content-type': 'application/json'
			},
			body: JSON.stringify({
				model: configuration.model,
				messages: buildResearchMessages(company, bundle, now),
				response_format: { type: 'json_object' },
				max_tokens: configuration.maxOutputTokens,
				temperature: 0,
				user: configuration.userId
			}),
			signal: AbortSignal.timeout(configuration.requestTimeoutMs)
		});
	} catch (cause) {
		throw new ModelRequestError(`Model request failed: ${errorMessage(cause)}`, true);
	}

	if (!response.ok) {
		const body = (await response.text()).slice(0, 2_000);
		const retryable =
			response.status === 408 ||
			response.status === 409 ||
			response.status === 429 ||
			response.status >= 500;
		throw new ModelRequestError(
			`Model request returned HTTP ${response.status}${body ? `: ${body}` : ''}`,
			retryable
		);
	}

	let parsedResponse: z.infer<typeof chatCompletionResponseSchema>;
	try {
		parsedResponse = chatCompletionResponseSchema.parse(await response.json());
	} catch (cause) {
		throw new ModelRequestError(`Model response was invalid: ${errorMessage(cause)}`, true);
	}
	const choice = parsedResponse.choices[0]!;
	if (!choice.message.content) {
		throw new ModelRequestError(
			`Model returned no content${choice.finish_reason ? ` (${choice.finish_reason})` : ''}`,
			true
		);
	}

	let json: unknown;
	try {
		json = JSON.parse(stripJsonFence(choice.message.content)) as unknown;
	} catch (cause) {
		throw new ModelRequestError(`Model did not return valid JSON: ${errorMessage(cause)}`, true);
	}
	const profile = executiveProfileSchema.safeParse(json);
	const review = executiveReviewArtifactSchema.safeParse(json);
	if (!profile.success && !review.success) {
		const issue = profile.error.issues[0] ?? review.error.issues[0];
		throw new ModelRequestError(
			`Model artifact failed validation: ${issue?.path.join('.') || 'root'} ${issue?.message ?? 'invalid artifact'}`,
			true
		);
	}
	const artifact = profile.success
		? profile.data
		: review.success
			? review.data
			: (() => {
					throw new ModelRequestError('Model artifact validation state was inconsistent', true);
				})();
	assertArtifactIdentity(artifact, company);
	assertArtifactUsesSuppliedEvidence(artifact, bundle, now.toISOString().slice(0, 10));
	return {
		artifact,
		promptTokens: parsedResponse.usage?.prompt_tokens ?? 0,
		completionTokens: parsedResponse.usage?.completion_tokens ?? 0
	};
}

function assertArtifactUsesSuppliedEvidence(
	artifact: ExecutiveProfile | ExecutiveReviewArtifact,
	bundle: ResearchSourceBundle,
	researchDate: string
): void {
	const suppliedSources = new Map(bundle.sources.map((source) => [source.url, source]));
	const artifactSources =
		'status' in artifact ? artifact.candidate_sources : collectProfileSources(artifact);
	for (const source of artifactSources) {
		const supplied = suppliedSources.get(source.url);
		if (!supplied || !sourceMatches(source, supplied)) {
			throw new ModelRequestError(`Model used unsupplied source ${source.url}`, true);
		}
	}
	if ('status' in artifact) return;
	if (artifact.leadership_as_of !== researchDate) {
		throw new ModelRequestError('Model changed the required leadership research date', true);
	}
	const suppliedPortraits = new Map(
		bundle.portraits.map((portrait) => [portrait.image_url, portrait])
	);
	for (const leader of artifact.leaders) {
		for (const portraitDocument of leader.portraits) {
			const portrait = suppliedPortraits.get(portraitDocument.image_url);
			if (!portrait || portrait.source_url !== portraitDocument.source.url) {
				throw new ModelRequestError(
					`Model used unsupplied portrait ${portraitDocument.image_url}`,
					true
				);
			}
		}
	}
}

function sourceMatches(source: ResearchSource, supplied: DiscoveredSource): boolean {
	return (
		source.title === supplied.title &&
		source.publisher === supplied.publisher &&
		source.kind === supplied.kind &&
		source.retrieved_at === supplied.retrieved_at
	);
}

export function buildResearchMessages(
	company: ResearchCompanyInput,
	bundle: ResearchSourceBundle,
	now = new Date()
) {
	const researchDate = now.toISOString().slice(0, 10);
	const evidence = bundle.sources.map(({ content, ...source }) => ({ source, content }));
	return [
		{
			role: 'system',
			content: [
				'You produce evidence-bound executive research as one JSON object.',
				'Use only the supplied source records and portrait candidates. Never invent a URL, fact, title, source classification, or image.',
				'If the evidence cannot satisfy every requirement, return the needs_review artifact instead of guessing.',
				'Return JSON only, without markdown.'
			].join(' ')
		},
		{
			role: 'user',
			content: `Research the current top executive leadership for this company.

Company identity (copy these fields exactly):
${JSON.stringify(company)}

Research date: ${researchDate}

Valid result A — executive profile:
{
  "schema_version": 2,
  "issuer_key": "${escapePrompt(company.issuerKey)}",
  "canonical_ticker": "${escapePrompt(company.canonicalTicker)}",
  "company_name": "${escapePrompt(company.name)}",
  "leadership_as_of": "${researchDate}",
  "leaders": [{
    "name": "full legal or professional name",
    "title": "current title",
    "role_kind": "ceo | co_ceo | president | executive_chair | managing_director",
    "is_interim": false,
    "summary": "80 to 200 words, with every claim supported by summary_sources",
    "summary_sources": [{ "url": "...", "title": "...", "publisher": "...", "retrieved_at": "${researchDate}", "kind": "..." }],
    "role_source": { "url": "...", "title": "...", "publisher": "...", "retrieved_at": "${researchDate}", "kind": "official_company | sec_filing" },
    "portraits": [{
      "image_url": "an exact HTTPS portrait candidate URL",
      "alt_text": "Portrait of the executive",
      "is_real_person": true,
      "source": { "url": "the source_url associated with that image", "title": "...", "publisher": "...", "retrieved_at": "${researchDate}", "kind": "official_company" }
    }],
    "facts": [{
      "category": "birthplace | upbringing | origin | education | career | achievement | personal | other_notable",
      "value": "one sourced factual statement",
      "sources": [{ "url": "...", "title": "...", "publisher": "...", "retrieved_at": "${researchDate}", "kind": "..." }]
    }]
  }]
}

Use one leader unless the company currently has co-CEOs; if it has co-CEOs, include every co-CEO and use role_kind "co_ceo" for all of them. A president or chair qualifies only when that person is the company's top executive leader. The role source must explicitly establish the current role. Copy every source field exactly from a supplied source descriptor. Include one to three distinct portraits for each leader, ordered strongest first. Use only portraits whose image and alt text identify that executive as a real person. One valid portrait is sufficient; never return needs_review merely because fewer than three are available.

Valid result B — insufficient evidence:
{
  "schema_version": 2,
  "status": "needs_review",
  "issuer_key": "${escapePrompt(company.issuerKey)}",
  "canonical_ticker": "${escapePrompt(company.canonicalTicker)}",
  "company_name": "${escapePrompt(company.name)}",
  "reasons": ["specific missing or conflicting evidence"],
  "candidate_sources": []
}

Supplied evidence:
${JSON.stringify(evidence)}

Supplied portrait candidates:
${JSON.stringify(bundle.portraits)}

Discovery warnings:
${JSON.stringify(bundle.warnings)}`
		}
	] as const;
}

function assertArtifactIdentity(
	artifact: ExecutiveProfile | ExecutiveReviewArtifact,
	company: ResearchCompanyInput
): void {
	if (
		artifact.issuer_key !== company.issuerKey ||
		artifact.canonical_ticker !== company.canonicalTicker ||
		artifact.company_name !== company.name
	) {
		throw new ModelRequestError('Model artifact did not preserve company identity', true);
	}
}

function stripJsonFence(value: string): string {
	const trimmed = value.trim();
	const match = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
	return match?.[1] ?? trimmed;
}

function escapePrompt(value: string): string {
	return value.replaceAll('\\', '\\\\').replaceAll('"', '\\"');
}

function errorMessage(cause: unknown): string {
	return cause instanceof Error ? cause.message : String(cause);
}
