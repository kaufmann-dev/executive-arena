<script lang="ts">
	import { ArrowLeft, CheckCircle2, FileJson2, Save, ShieldAlert } from '@lucide/svelte';
	import { resolve } from '$app/paths';
	import { formatDataLabel } from '$lib/format-label';

	let { data, form } = $props();
	let updateValues = $derived(form?.values && 'name' in form.values ? form.values : undefined);
	let exclusionValues = $derived(form?.values && 'reason' in form.values ? form.values : undefined);

	const notices: Record<string, string> = {
		'metadata-updated': 'Company metadata updated. Existing comparisons were preserved.',
		'profile-created': 'Leadership profile created and marked ready.',
		'profile-updated': 'Profile content updated. Existing comparisons were preserved.',
		'profile-replaced':
			'Leadership changed. A new slate and cohort revision were created, then the ranking was refit.',
		'company-excluded':
			'Company excluded, current portrait bytes purged, and the active ranking was refit.'
	};
</script>

<svelte:head><title>{data.record.name} · Admin · Executive Arena</title></svelte:head>

<a class="back-link" href={resolve('/admin/companies')}><ArrowLeft size={16} /> All companies</a>

<section class="page-heading">
	<div>
		<p class="eyebrow">{data.record.canonicalTicker} · {data.record.issuerKey}</p>
		<h1>{data.record.name}</h1>
		<p class="lede">
			Edit descriptive content without disturbing votes, or import a complete profile to replace the
			leadership slate.
		</p>
	</div>
	<span class={`pill ${data.record.included ? data.record.readinessStatus : 'excluded'}`}>
		{formatDataLabel(data.record.included ? data.record.readinessStatus : 'excluded')}
	</span>
</section>

{#if data.notice && notices[data.notice]}
	<p class="notice success"><CheckCircle2 size={17} /> {notices[data.notice]}</p>
{/if}
{#if form?.message}
	<p class="notice error"><ShieldAlert size={17} /> {form.message}</p>
{/if}

<div class="admin-grid">
	<div class="stack">
		<section class="panel form-panel">
			<header>
				<div>
					<p class="eyebrow">Company record</p>
					<h2>Metadata</h2>
				</div>
			</header>
			<form method="POST" action="?/update">
				<label>
					<span>Company name</span>
					<input
						name="name"
						required
						maxlength="300"
						value={updateValues?.name ?? data.record.name}
					/>
				</label>
				<label>
					<span>Homepage</span>
					<input
						name="homepageUrl"
						type="url"
						maxlength="500"
						value={updateValues?.homepageUrl ?? data.record.homepageUrl ?? ''}
					/>
				</label>
				<label>
					<span>Description</span>
					<textarea name="description" rows="7" maxlength="10000"
						>{updateValues?.description ?? data.record.description}</textarea
					>
				</label>
				<button class="primary-button" type="submit"><Save size={16} /> Save metadata</button>
			</form>
		</section>

		<section class="panel form-panel">
			<header>
				<div>
					<p class="eyebrow">Validated replacement</p>
					<h2>Executive profile JSON</h2>
				</div>
				{#if data.record.card}
					<a
						class="secondary-button"
						href={resolve('/admin/companies/[id]/profile.json', { id: data.record.id })}
					>
						<FileJson2 size={15} /> Download current JSON
					</a>
				{:else}
					<FileJson2 size={21} />
				{/if}
			</header>
			<p class="form-help">
				Paste one schema-version 3 profile. Portraits are downloaded, converted to WebP, and stored
				privately. A changed leader creates a new slate and cohort revision; content-only edits
				retain every vote.
			</p>
			<form method="POST" action="?/profile">
				<label>
					<span>Profile</span>
					<textarea
						class="code-input"
						name="profileJson"
						rows="16"
						required
						maxlength="2000000"
						spellcheck="false"
						placeholder={'{"schema_version":2,"issuer_key":"…"}'}
						>{form?.action === 'profile' ? form.profileJson : ''}</textarea
					>
				</label>
				<button class="primary-button" type="submit">
					<FileJson2 size={16} /> Validate and import
				</button>
			</form>
		</section>

		{#if data.record.included}
			<section class="panel danger-panel">
				<div>
					<p class="eyebrow">Destructive cohort change</p>
					<h2>Exclude company</h2>
					<p>
						Retires its active slate and removes stored portrait bytes. Historical votes stay
						auditable but no longer affect the active ranking.
					</p>
				</div>
				<form method="POST" action="?/exclude">
					<label>
						<span>Required reason</span>
						<input
							name="reason"
							required
							minlength="10"
							maxlength="500"
							value={exclusionValues?.reason ?? ''}
							placeholder="Why this issuer does not belong in the cohort"
						/>
					</label>
					<label class="confirm">
						<input name="confirmation" type="checkbox" required />
						<span>
							I understand this permanently removes every stored portrait for this company.
						</span>
					</label>
					<button class="danger-button" type="submit">
						<ShieldAlert size={16} /> Exclude and purge portraits
					</button>
				</form>
			</section>
		{/if}
	</div>

	<aside class="stack">
		<section class="panel facts-panel">
			<p class="eyebrow">Universe identity</p>
			<h2>Listings</h2>
			<dl>
				<div>
					<dt>CIK</dt>
					<dd>{data.record.cik ?? '—'}</dd>
				</div>
				<div>
					<dt>SIC</dt>
					<dd>{data.record.sicCode ?? '—'}</dd>
				</div>
				<div>
					<dt>Industry</dt>
					<dd>{data.record.sicDescription ?? '—'}</dd>
				</div>
			</dl>
			<ul>
				{#each data.record.listings as listing (listing.id)}
					<li>
						<strong>{listing.ticker}</strong>
						<span>{listing.primaryExchange ?? 'Exchange unavailable'}</span>
						{#if listing.isCanonical}<small>canonical</small>{/if}
					</li>
				{/each}
			</ul>
		</section>

		{#if data.record.card}
			<section class="panel preview-panel">
				<p class="eyebrow">Current active slate</p>
				<h2>{data.record.card.leaders.length > 1 ? 'Leadership team' : 'Executive'}</h2>
				{#each data.record.card.leaders as leader (leader.id)}
					{@const primaryPortrait = leader.portraits[0]}
					<article>
						{#if primaryPortrait}
							<img src={`/media/portraits/${primaryPortrait.id}`} alt={primaryPortrait.altText} />
						{/if}
						<div>
							<h3>{leader.name}</h3>
							<p>{leader.isInterim ? 'Interim ' : ''}{leader.title}</p>
							<small>{leader.summary}</small>
						</div>
					</article>
				{/each}
			</section>
		{:else}
			<section class="panel empty-state">
				<h2>No active profile</h2>
				<p>Import a complete profile to create or restore this company’s leadership slate.</p>
			</section>
		{/if}
	</aside>
</div>

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
		font-size: 0.82rem;
		font-weight: 700;
	}

	.notice.success {
		color: #09533c;
		background: var(--accent-pale);
	}

	.notice.error {
		color: #7f312d;
		background: #f7e3e1;
	}

	.admin-grid {
		display: grid;
		grid-template-columns: minmax(0, 1.55fr) minmax(280px, 0.85fr);
		gap: 1rem;
		align-items: start;
	}

	.stack {
		display: grid;
		gap: 1rem;
	}

	.form-panel,
	.facts-panel,
	.danger-panel {
		padding: 1.3rem;
	}

	.form-panel header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		margin-bottom: 1rem;
	}

	h2 {
		margin-bottom: 0;
		font-family: Georgia, 'Times New Roman', serif;
		font-size: 1.45rem;
		font-weight: 500;
	}

	form {
		display: grid;
		gap: 0.9rem;
	}

	label {
		display: grid;
		gap: 0.4rem;
	}

	label > span,
	dt {
		color: var(--muted);
		font-size: 0.69rem;
		font-weight: 800;
		letter-spacing: 0.06em;
		text-transform: uppercase;
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

	form button {
		justify-self: start;
	}

	.form-help,
	.danger-panel p {
		color: var(--muted);
		font-size: 0.82rem;
		line-height: 1.6;
	}

	.facts-panel dl {
		display: grid;
		gap: 0.7rem;
		margin: 1rem 0;
	}

	.facts-panel dl div {
		display: grid;
		grid-template-columns: 70px 1fr;
		gap: 0.7rem;
	}

	dd {
		margin: 0;
		font-size: 0.8rem;
		overflow-wrap: anywhere;
	}

	.facts-panel ul {
		margin: 0;
		padding: 0;
		border-top: 1px solid var(--line);
		list-style: none;
	}

	.facts-panel li {
		display: grid;
		grid-template-columns: 70px 1fr auto;
		gap: 0.6rem;
		padding: 0.72rem 0;
		border-bottom: 1px solid var(--line);
		font-size: 0.76rem;
	}

	.facts-panel li strong {
		color: var(--accent);
	}

	.facts-panel li small {
		color: var(--muted);
	}

	.danger-panel {
		border-color: #e6c5c2;
		background: #fffafa;
	}

	.danger-panel form {
		margin-top: 1rem;
	}

	.confirm {
		grid-template-columns: auto 1fr;
		align-items: start;
	}

	.confirm input {
		width: 1rem;
		height: 1rem;
		margin-top: 0.1rem;
		accent-color: var(--danger);
	}

	.confirm span {
		letter-spacing: 0;
		line-height: 1.45;
		text-transform: none;
	}

	.preview-panel {
		padding: 1.3rem;
	}

	.preview-panel article {
		display: grid;
		grid-template-columns: 72px 1fr;
		gap: 0.85rem;
		padding: 1rem 0;
		border-bottom: 1px solid var(--line);
	}

	.preview-panel img {
		width: 72px;
		height: 88px;
		object-fit: cover;
		border-radius: 12px;
		background: #e8ece8;
	}

	.preview-panel h3 {
		margin-bottom: 0.2rem;
		font-size: 1rem;
	}

	.preview-panel article p {
		margin-bottom: 0.5rem;
		color: var(--accent);
		font-size: 0.75rem;
		font-weight: 750;
	}

	.preview-panel small {
		display: -webkit-box;
		overflow: hidden;
		color: var(--muted);
		font-size: 0.73rem;
		line-height: 1.5;
		-webkit-box-orient: vertical;
		-webkit-line-clamp: 4;
		line-clamp: 4;
	}

	@media (max-width: 900px) {
		.admin-grid {
			grid-template-columns: 1fr;
		}
	}
</style>
