<script lang="ts">
	import { ArrowLeft, Building2, FileJson2, ShieldAlert } from '@lucide/svelte';
	import { resolve } from '$app/paths';

	let { form } = $props();
</script>

<svelte:head><title>Add company · Executive Arena</title></svelte:head>

<a class="back-link" href={resolve('/admin/companies')}><ArrowLeft size={16} /> All companies</a>

<section class="page-heading">
	<div>
		<p class="eyebrow">Explicit cohort change</p>
		<h1>Add a company</h1>
		<p class="lede">
			Use this only for an eligible active U.S. common-stock issuer missing from the imported
			Massive universe. A complete profile is required in the same operation.
		</p>
	</div>
</section>

{#if form?.message}
	<p class="notice"><ShieldAlert size={17} /> {form.message}</p>
{/if}

<form class="panel create-form" method="POST">
	<section>
		<header>
			<Building2 size={20} />
			<h2>Issuer record</h2>
		</header>
		<div class="field-grid">
			<label>
				<span>Issuer key</span>
				<input
					name="issuerKey"
					required
					maxlength="100"
					value={form?.values?.issuerKey ?? ''}
					placeholder="cik:0000320193"
				/>
			</label>
			<label>
				<span>CIK</span>
				<input
					name="cik"
					inputmode="numeric"
					pattern="[0-9]{10}"
					maxlength="10"
					value={form?.values?.cik ?? ''}
					placeholder="0000320193"
				/>
			</label>
			<label>
				<span>Company name</span>
				<input name="name" required maxlength="300" value={form?.values?.name ?? ''} />
			</label>
			<label>
				<span>Canonical ticker</span>
				<input
					name="canonicalTicker"
					required
					maxlength="32"
					value={form?.values?.canonicalTicker ?? ''}
				/>
			</label>
			<label>
				<span>Primary exchange</span>
				<input
					name="primaryExchange"
					maxlength="100"
					value={form?.values?.primaryExchange ?? ''}
					placeholder="XNAS"
				/>
			</label>
			<label>
				<span>Market cap (USD)</span>
				<input
					name="marketCap"
					type="number"
					min="0"
					step="1"
					value={form?.values?.marketCap ?? ''}
				/>
			</label>
			<label class="wide">
				<span>Homepage</span>
				<input
					name="homepageUrl"
					type="url"
					maxlength="500"
					value={form?.values?.homepageUrl ?? ''}
				/>
			</label>
			<label class="wide">
				<span>Description</span>
				<textarea name="description" rows="6" maxlength="10000"
					>{form?.values?.description ?? ''}</textarea
				>
			</label>
		</div>
	</section>

	<section>
		<header>
			<FileJson2 size={20} />
			<h2>Complete executive profile</h2>
		</header>
		<p>
			The profile must use schema version 1 and exactly match the issuer key, company name, and
			ticker above.
		</p>
		<label>
			<span>Profile JSON</span>
			<textarea
				class="code-input"
				name="profileJson"
				rows="18"
				required
				maxlength="2000000"
				spellcheck="false"
				placeholder={'{"schema_version":1,"issuer_key":"…"}'}
				>{form?.values?.profileJson ?? ''}</textarea
			>
		</label>
	</section>

	<footer>
		<a class="secondary-button" href={resolve('/admin/companies')}>Cancel</a>
		<button class="primary-button" type="submit">
			<Building2 size={16} /> Validate and add company
		</button>
	</footer>
</form>

<style>
	.back-link {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		margin-bottom: 1rem;
		color: var(--muted);
		font-size: 0.8rem;
		font-weight: 700;
		text-decoration: none;
	}

	.notice {
		display: flex;
		align-items: center;
		gap: 0.55rem;
		margin-bottom: 1rem;
		padding: 0.85rem 1rem;
		border-radius: 12px;
		color: #7f312d;
		background: #f7e3e1;
		font-size: 0.82rem;
		font-weight: 700;
	}

	.create-form {
		overflow: hidden;
	}

	.create-form > section {
		padding: 1.35rem;
		border-bottom: 1px solid var(--line);
	}

	header {
		display: flex;
		align-items: center;
		gap: 0.55rem;
		margin-bottom: 1rem;
		color: var(--accent);
	}

	h2 {
		margin: 0;
		color: var(--ink);
		font-family: Georgia, 'Times New Roman', serif;
		font-size: 1.45rem;
		font-weight: 500;
	}

	section > p {
		max-width: 760px;
		color: var(--muted);
		font-size: 0.82rem;
		line-height: 1.6;
	}

	.field-grid {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 0.9rem;
	}

	label {
		display: grid;
		gap: 0.4rem;
	}

	label > span {
		color: var(--muted);
		font-size: 0.69rem;
		font-weight: 800;
		letter-spacing: 0.06em;
		text-transform: uppercase;
	}

	.wide {
		grid-column: 1 / -1;
	}

	input,
	textarea {
		width: 100%;
		padding: 0.72rem 0.8rem;
		border: 1px solid #d4dbd5;
		border-radius: 10px;
		color: var(--ink);
		background: #fbfcfa;
		line-height: 1.5;
	}

	textarea {
		resize: vertical;
	}

	.code-input {
		font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
		font-size: 0.74rem;
	}

	footer {
		display: flex;
		justify-content: flex-end;
		gap: 0.65rem;
		padding: 1rem 1.35rem;
		background: #f8faf7;
	}

	@media (max-width: 680px) {
		.field-grid {
			grid-template-columns: 1fr;
		}

		.wide {
			grid-column: auto;
		}

		footer {
			align-items: stretch;
			flex-direction: column-reverse;
		}
	}
</style>
