<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import type { SubmitFunction } from '@sveltejs/kit';
	import {
		ArrowLeft,
		CheckCircle2,
		CirclePlus,
		Image,
		Save,
		ShieldAlert,
		Trash2,
		Users
	} from '@lucide/svelte';
	import { formatReadinessLabel } from '$lib/format-label';
	import type { ExecutiveProfile } from '$lib/research/schemas';

	type DraftSource = {
		url: string;
		title: string;
		publisher: string;
	};

	type DraftFact = {
		category: string;
		value: string;
	};

	type DraftLeader = {
		name: string;
		title: string;
		roleKind: string;
		isInterim: boolean;
		summary: string;
		sources: DraftSource[];
		facts: DraftFact[];
	};

	type DraftProfile = {
		leadershipAsOf: string;
		leaders: DraftLeader[];
	};

	let { data, form } = $props();
	let updateValues = $derived(form?.values && 'name' in form.values ? form.values : undefined);
	let exclusionValues = $derived(form?.values && 'reason' in form.values ? form.values : undefined);
	let profileErrors = $derived(
		(form?.action === 'profile' && 'fieldErrors' in form ? (form.fieldErrors ?? {}) : {}) as Record<
			string,
			string
		>
	);
	// svelte-ignore state_referenced_locally
	let draft = $state(toDraft(data.profile as unknown as ExecutiveProfile | null));
	let portraitPreviews = $state<Record<string, string>>({});
	let portraitPasteErrors = $state<Record<string, string>>({});

	const notices: Record<string, string> = {
		'metadata-updated': 'Company metadata updated. Existing comparisons were preserved.',
		'profile-created': 'Leadership profile created. Add any missing portraits below.',
		'profile-updated': 'Profile content updated. Existing comparisons were preserved.',
		'profile-replaced':
			'Leadership changed. A new slate and cohort revision were created, then the ranking was refit.',
		'company-excluded':
			'Company excluded, current portrait bytes purged, and the active ranking was refit.',
		'portrait-saved': 'Portrait saved and company readiness recalculated.',
		'portrait-deleted': 'Portrait deleted and company readiness recalculated.'
	};

	function today(): string {
		return new Date().toISOString().slice(0, 10);
	}

	function emptySource(): DraftSource {
		return { url: '', title: '', publisher: '' };
	}

	function emptyFact(): DraftFact {
		return { category: 'career', value: '' };
	}

	function emptyLeader(): DraftLeader {
		return {
			name: '',
			title: '',
			roleKind: 'ceo',
			isInterim: false,
			summary: '',
			sources: [emptySource()],
			facts: []
		};
	}

	function toDraft(profile: ExecutiveProfile | null): DraftProfile {
		if (!profile) return { leadershipAsOf: today(), leaders: [emptyLeader()] };
		return {
			leadershipAsOf: profile.leadership_as_of,
			leaders: profile.leaders.map((leader) => ({
				name: leader.name,
				title: leader.title,
				roleKind: leader.role_kind,
				isInterim: leader.is_interim,
				summary: leader.summary,
				sources: leader.sources.map(sourceToDraft),
				facts: leader.facts.map((fact) => ({
					category: fact.category,
					value: fact.value
				}))
			}))
		};
	}

	function sourceToDraft(
		source: ExecutiveProfile['leaders'][number]['sources'][number]
	): DraftSource {
		return {
			url: source.url,
			title: source.title ?? '',
			publisher: source.publisher ?? ''
		};
	}

	function addLeader() {
		draft.leaders.push(emptyLeader());
	}

	function removeLeader(index: number) {
		if (draft.leaders.length > 1) draft.leaders.splice(index, 1);
	}

	function fieldError(path: string): string | undefined {
		return profileErrors[path];
	}

	function setPortraitFile(event: ClipboardEvent | DragEvent, personId: string) {
		const files =
			event instanceof ClipboardEvent ? event.clipboardData?.files : event.dataTransfer?.files;
		const clipboardImage =
			event instanceof ClipboardEvent
				? [...(event.clipboardData?.items ?? [])]
						.find((item) => item.kind === 'file' && item.type.startsWith('image/'))
						?.getAsFile()
				: null;
		const file = files?.[0] ?? clipboardImage;
		if (!file?.type.startsWith('image/')) {
			portraitPasteErrors[personId] =
				'No image bytes were found. Save the image locally and use Select image.';
			return;
		}
		event.preventDefault();
		const form = (event.currentTarget as HTMLElement).closest('form');
		const fileInput = form?.querySelector<HTMLInputElement>('input[type="file"]');
		if (!fileInput) return;
		const transfer = new DataTransfer();
		transfer.items.add(file);
		fileInput.files = transfer.files;
		delete portraitPasteErrors[personId];
		updatePortraitPreview(personId, file);
	}

	function updatePortraitPreview(personId: string, file: File | undefined) {
		delete portraitPasteErrors[personId];
		const previous = portraitPreviews[personId];
		if (previous) URL.revokeObjectURL(previous);
		if (!file) {
			delete portraitPreviews[personId];
			return;
		}
		portraitPreviews[personId] = URL.createObjectURL(file);
	}

	function enhancePortraitUpload(personId: string): SubmitFunction {
		return ({ formElement }) => {
			return async ({ result, update }) => {
				if (result.type === 'redirect') {
					const preview = portraitPreviews[personId];
					if (preview) URL.revokeObjectURL(preview);
					delete portraitPreviews[personId];
					delete portraitPasteErrors[personId];
					formElement.reset();
				}
				await update();
			};
		};
	}
</script>

<svelte:head><title>{data.record.name} · Admin · Executive Arena</title></svelte:head>

<a class="back-link" href={resolve('/admin/companies')}><ArrowLeft size={16} /> All companies</a>

<section class="page-heading">
	<div>
		<p class="eyebrow">{data.record.canonicalTicker} · {data.record.issuerKey}</p>
		<h1>{data.record.name}</h1>
		<p class="lede">Maintain company context and its active executive leadership profile.</p>
	</div>
	<span class={`pill ${data.record.included ? data.record.readinessStatus : 'excluded'}`}>
		{formatReadinessLabel(data.record.included ? data.record.readinessStatus : 'excluded')}
	</span>
</section>

{#if data.notice && notices[data.notice]}
	<p class="notice success"><CheckCircle2 size={17} /> {notices[data.notice]}</p>
{/if}
{#if form?.message}
	<p class="notice error"><ShieldAlert size={17} /> {form.message}</p>
{/if}

<section class="overview-grid">
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
				<textarea name="description" rows="6" maxlength="10000"
					>{updateValues?.description ?? data.record.description}</textarea
				>
			</label>
			<button class="primary-button" type="submit"><Save size={16} /> Save metadata</button>
		</form>
	</section>

	<aside class="panel facts-panel">
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
	</aside>
</section>

{#if data.record.card}
	<section class="panel active-slate">
		<header>
			<div>
				<p class="eyebrow">Current active slate</p>
				<h2>{data.record.card.leaders.length > 1 ? 'Leadership team' : 'Executive profile'}</h2>
			</div>
			<span>Effective {data.record.card.effectiveAt}</span>
		</header>
		<div class="leader-gallery">
			{#each data.record.card.leaders as leader (leader.id)}
				<article>
					<div class="portraits" aria-label={`Saved portraits for ${leader.name}`}>
						{#each leader.portraits as portrait, index (portrait.id)}
							<figure>
								<img src={`/media/portraits/${portrait.id}`} alt={portrait.altText} />
								<figcaption>
									<span>Portrait {index + 1}</span>
									<form method="POST" action="?/deletePortrait" use:enhance>
										<input type="hidden" name="portraitId" value={portrait.id} />
										<button
											class="text-button danger-text"
											type="submit"
											aria-label={`Delete portrait ${index + 1} of ${leader.name}`}
											><Trash2 size={13} /> Delete</button
										>
									</form>
								</figcaption>
							</figure>
						{/each}
						{#if leader.portraits.length === 0}
							<div class="missing-portrait"><Image size={24} /><span>No portrait yet</span></div>
						{/if}
					</div>
					<div class="leader-copy">
						<h3>{leader.name}</h3>
						<p>{leader.isInterim ? 'Interim ' : ''}{leader.title}</p>
						<p class="summary">{leader.summary}</p>
						<small>{leader.facts.length} facts · {leader.sources.length} profile sources</small>
						<form
							class="portrait-upload"
							method="POST"
							action="?/portrait"
							enctype="multipart/form-data"
							use:enhance={enhancePortraitUpload(leader.id)}
						>
							<input type="hidden" name="personId" value={leader.id} />
							<div
								class="paste-zone"
								role="button"
								tabindex="0"
								onpaste={(event) => setPortraitFile(event, leader.id)}
								ondragover={(event) => event.preventDefault()}
								ondrop={(event) => setPortraitFile(event, leader.id)}
								aria-label={`Paste or drop a portrait of ${leader.name}`}
							>
								{#if portraitPreviews[leader.id]}
									<img src={portraitPreviews[leader.id]} alt="Selected portrait preview" />
								{:else}
									<Image size={22} />
									<strong>Paste or drop an image</strong>
									<span>Focus here and press Ctrl/⌘+V</span>
								{/if}
							</div>
							{#if portraitPasteErrors[leader.id]}
								<small class="field-error">{portraitPasteErrors[leader.id]}</small>
							{/if}
							<label class="file-picker">
								<span>Select image</span>
								<input
									name="image"
									type="file"
									accept="image/*"
									required
									onchange={(event) =>
										updatePortraitPreview(leader.id, event.currentTarget.files?.[0])}
								/>
							</label>
							{#if leader.portraits.length > 0}
								<label>
									<span
										>{leader.portraits.length >= 3
											? 'Portrait to replace'
											: 'Replace existing portrait (optional)'}</span
									>
									<select name="portraitId">
										{#if leader.portraits.length < 3}
											<option value="">Add as a new portrait</option>
										{/if}
										{#each leader.portraits as portrait, index (portrait.id)}
											<option value={portrait.id}>Replace portrait {index + 1}</option>
										{/each}
									</select>
								</label>
							{:else}
								<input type="hidden" name="portraitId" value="" />
							{/if}
							<label>
								<span>Alt text (optional)</span>
								<input name="altText" maxlength="250" placeholder={`Portrait of ${leader.name}`} />
							</label>
							<div class="field-grid">
								<label>
									<span>Source URL (optional)</span>
									<input name="sourceUrl" type="url" />
								</label>
								<label>
									<span>Source publisher (optional)</span>
									<input name="sourcePublisher" maxlength="200" />
								</label>
							</div>
							<label>
								<span>Source title (optional)</span>
								<input name="sourceTitle" maxlength="300" />
							</label>
							<button class="secondary-button" type="submit">
								<Image size={16} /> Save portrait
							</button>
						</form>
					</div>
				</article>
			{/each}
		</div>
	</section>
{:else}
	<section class="panel empty-state">
		<Users size={22} />
		<div>
			<h2>No active profile</h2>
			<p>Use the structured editor below to publish the first complete leadership slate.</p>
		</div>
	</section>
{/if}

<section class="panel editor-panel">
	<header>
		<div>
			<p class="eyebrow">Validated replacement</p>
			<h2>Edit executive leadership</h2>
			<p>
				Each executive needs one or more shared sources supporting the current role and summary.
				Facts and portraits are optional.
			</p>
		</div>
	</header>

	<form method="POST" action="?/profile" use:enhance>
		<label class="date-field">
			<span>Leadership effective date</span>
			<input
				name="leadershipAsOf"
				type="date"
				required
				bind:value={draft.leadershipAsOf}
				aria-invalid={Boolean(fieldError('leadershipAsOf'))}
			/>
			{#if fieldError('leadershipAsOf')}<small class="field-error"
					>{fieldError('leadershipAsOf')}</small
				>{/if}
		</label>

		<div class="leader-editor-list">
			{#each draft.leaders as leader, leaderIndex (leader)}
				{@const prefix = `leaders.${leaderIndex}`}
				<fieldset class="leader-editor">
					<legend>Executive {leaderIndex + 1}</legend>
					<div class="leader-heading">
						<p>Current role, concise biography, and shared evidence.</p>
						{#if draft.leaders.length > 1}
							<button
								class="text-button danger-text"
								type="button"
								onclick={() => removeLeader(leaderIndex)}
							>
								<Trash2 size={15} /> Remove executive
							</button>
						{/if}
					</div>

					<div class="field-grid">
						<label>
							<span>Name</span>
							<input name={`${prefix}.name`} required maxlength="200" bind:value={leader.name} />
							{#if fieldError(`${prefix}.name`)}<small class="field-error"
									>{fieldError(`${prefix}.name`)}</small
								>{/if}
						</label>
						<label>
							<span>Title</span>
							<input name={`${prefix}.title`} required maxlength="200" bind:value={leader.title} />
							{#if fieldError(`${prefix}.title`)}<small class="field-error"
									>{fieldError(`${prefix}.title`)}</small
								>{/if}
						</label>
						<label>
							<span>Leadership role</span>
							<select name={`${prefix}.roleKind`} bind:value={leader.roleKind}>
								<option value="ceo">CEO</option>
								<option value="co_ceo">Co-CEO</option>
								<option value="president">President</option>
								<option value="executive_chair">Executive chair</option>
								<option value="managing_director">Managing director</option>
							</select>
							{#if fieldError(`${prefix}.roleKind`)}<small class="field-error"
									>{fieldError(`${prefix}.roleKind`)}</small
								>{/if}
						</label>
						<label class="checkbox-label">
							<input name={`${prefix}.isInterim`} type="checkbox" bind:checked={leader.isInterim} />
							<span>Interim appointment</span>
						</label>
					</div>

					<label>
						<span>Executive summary</span>
						<textarea name={`${prefix}.summary`} rows="5" required bind:value={leader.summary}
						></textarea>
						<small class="input-note"
							>{leader.summary.trim() ? leader.summary.trim().split(/\s+/).length : 0} of 50–100 words</small
						>
						{#if fieldError(`${prefix}.summary`)}<small class="field-error"
								>{fieldError(`${prefix}.summary`)}</small
							>{/if}
					</label>

					<section class="repeat-section">
						<div class="section-heading">
							<div>
								<h3>Profile sources</h3>
								<p>One source may support the role, summary, and optional facts together.</p>
							</div>
							<button
								class="text-button"
								type="button"
								onclick={() => leader.sources.push(emptySource())}
								><CirclePlus size={15} /> Add citation</button
							>
						</div>
						{#each leader.sources as source, sourceIndex (source)}
							<div class="repeat-item">
								{@render SourceFields(
									source,
									`${prefix}.sources.${sourceIndex}`,
									`Profile source ${sourceIndex + 1}`
								)}
								{#if leader.sources.length > 1}
									<button
										class="text-button danger-text citation-remove-button"
										type="button"
										aria-label="Remove profile source"
										onclick={() => leader.sources.splice(sourceIndex, 1)}
										><Trash2 size={15} /> Remove citation</button
									>
								{/if}
							</div>
						{/each}
					</section>

					<section class="repeat-section">
						<div class="section-heading">
							<div>
								<h3>Biographical facts</h3>
								<p>Add concise facts when they materially improve the profile.</p>
							</div>
							<button
								class="text-button"
								type="button"
								onclick={() => leader.facts.push(emptyFact())}
								><CirclePlus size={15} /> Add fact</button
							>
						</div>
						{#each leader.facts as fact, factIndex (fact)}
							<div class="fact-editor">
								<div class="field-grid">
									<label
										><span>Category</span><select
											name={`${prefix}.facts.${factIndex}.category`}
											bind:value={fact.category}
											><option value="birthplace">Birthplace</option><option value="upbringing"
												>Upbringing</option
											><option value="origin">Origin</option><option value="education"
												>Education</option
											><option value="career">Career</option><option value="achievement"
												>Achievement</option
											><option value="personal">Personal</option><option value="other_notable"
												>Other notable</option
											></select
										></label
									>
									<label
										><span>Fact</span><input
											name={`${prefix}.facts.${factIndex}.value`}
											required
											maxlength="600"
											bind:value={fact.value}
										/></label
									>
								</div>
								<button
									class="text-button danger-text"
									type="button"
									onclick={() => leader.facts.splice(factIndex, 1)}
									><Trash2 size={15} /> Remove fact</button
								>
							</div>
						{/each}
					</section>
				</fieldset>
			{/each}
		</div>

		<button class="secondary-button add-leader" type="button" onclick={addLeader}
			><CirclePlus size={16} /> Add executive</button
		>
		<button class="primary-button" type="submit"
			><Save size={16} /> Validate and publish leadership</button
		>
	</form>
</section>

{#if data.record.included}
	<section class="panel danger-panel">
		<div>
			<p class="eyebrow">Destructive cohort change</p>
			<h2>Exclude company</h2>
			<p>
				Retires its active slate and removes every stored portrait. Historical votes remain
				auditable but no longer affect the active ranking.
			</p>
		</div>
		<form method="POST" action="?/exclude">
			<label
				><span>Required reason</span><input
					name="reason"
					required
					minlength="10"
					maxlength="500"
					value={exclusionValues?.reason ?? ''}
					placeholder="Why this issuer does not belong in the cohort"
				/></label
			>
			<label class="confirm"
				><input name="confirmation" type="checkbox" required /><span
					>I understand this permanently removes every stored portrait for this company.</span
				></label
			>
			<button class="danger-button" type="submit"
				><ShieldAlert size={16} /> Exclude and purge portraits</button
			>
		</form>
	</section>
{/if}

{#snippet SourceFields(source: DraftSource, prefix: string, label: string)}
	<fieldset class="source-fields">
		<legend>{label}</legend>
		<div class="source-grid">
			<label
				><span>URL</span><input
					name={`${prefix}.url`}
					type="url"
					required
					bind:value={source.url}
				/></label
			>
			<label
				><span>Title</span><input
					name={`${prefix}.title`}
					maxlength="300"
					bind:value={source.title}
				/></label
			>
			<label
				><span>Publisher</span><input
					name={`${prefix}.publisher`}
					maxlength="200"
					bind:value={source.publisher}
				/></label
			>
		</div>
		{#if fieldError(`${prefix}.url`)}<small class="field-error">{fieldError(`${prefix}.url`)}</small
			>{/if}
	</fieldset>
{/snippet}

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
	.overview-grid {
		display: grid;
		grid-template-columns: minmax(0, 1.45fr) minmax(280px, 0.85fr);
		gap: 1rem;
		align-items: start;
	}
	.form-panel,
	.facts-panel,
	.editor-panel,
	.danger-panel,
	.active-slate {
		padding: 1.3rem;
	}
	.form-panel header,
	.editor-panel > header,
	.active-slate > header {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 1rem;
		margin-bottom: 1rem;
	}
	h2 {
		margin: 0;
		font-family: inherit;
		font-size: 1.45rem;
		font-weight: 500;
	}
	h3 {
		margin: 0;
		font-size: 1rem;
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
	dt,
	legend {
		color: var(--muted);
		font-size: 0.69rem;
		font-weight: 800;
		letter-spacing: 0.06em;
		text-transform: uppercase;
	}
	input,
	textarea,
	select {
		box-sizing: border-box;
		width: 100%;
		padding: 0.72rem 0.8rem;
		border: 1px solid #d8d8d8;
		border-radius: 10px;
		color: var(--ink);
		background: #fafafa;
		font: inherit;
		line-height: 1.5;
	}
	textarea {
		resize: vertical;
	}
	button {
		justify-self: start;
	}
	.field-error {
		color: #9a2924;
		font-size: 0.75rem;
		font-weight: 700;
	}
	.input-note {
		color: var(--muted);
		font-size: 0.72rem;
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
	.active-slate,
	.editor-panel,
	.danger-panel {
		margin-top: 1rem;
	}
	.active-slate > header > span {
		color: var(--muted);
		font-size: 0.78rem;
		font-weight: 700;
	}
	.leader-gallery {
		display: grid;
		gap: 1rem;
	}
	.leader-gallery article {
		display: grid;
		grid-template-columns: minmax(240px, 0.85fr) minmax(0, 1.65fr);
		gap: 1.2rem;
		padding-top: 1rem;
		border-top: 1px solid var(--line);
	}
	.portraits {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 0.55rem;
	}
	.portraits figure {
		min-width: 0;
		margin: 0;
	}
	.portraits img {
		display: block;
		width: 100%;
		aspect-ratio: 0.78;
		object-fit: cover;
		border-radius: 10px;
		background: #e9e9e9;
	}
	.portraits figcaption {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.3rem;
		margin-top: 0.25rem;
		color: var(--muted);
		font-size: 0.66rem;
		font-weight: 700;
	}
	.portraits figcaption form {
		display: block;
	}
	.missing-portrait {
		display: grid;
		min-height: 180px;
		place-content: center;
		gap: 0.45rem;
		border-radius: 10px;
		color: var(--muted);
		background: #f0f0f0;
		font-size: 0.72rem;
		font-weight: 700;
		text-align: center;
	}
	.leader-copy > p:not(.summary) {
		margin: 0.25rem 0 0.65rem;
		color: var(--accent);
		font-size: 0.82rem;
		font-weight: 700;
	}
	.summary {
		margin: 0 0 0.7rem;
		color: var(--muted);
		font-size: 0.82rem;
		line-height: 1.6;
	}
	.leader-copy small {
		color: var(--muted);
		font-size: 0.72rem;
	}
	.portrait-upload {
		margin-top: 1rem;
		padding-top: 1rem;
		border-top: 1px solid var(--line);
	}
	.paste-zone {
		display: grid;
		min-height: 130px;
		place-content: center;
		gap: 0.35rem;
		padding: 0.8rem;
		border: 1px dashed #b8b8b8;
		border-radius: 10px;
		color: var(--muted);
		background: #fafafa;
		text-align: center;
		cursor: copy;
	}
	.paste-zone:focus-visible {
		border-color: var(--accent);
		outline: 3px solid rgb(17 97 73 / 15%);
	}
	.paste-zone img {
		display: block;
		max-width: 100%;
		max-height: 220px;
		margin: auto;
		border-radius: 8px;
		object-fit: contain;
	}
	.paste-zone strong {
		color: var(--ink);
		font-size: 0.8rem;
	}
	.paste-zone span {
		font-size: 0.7rem;
	}
	.empty-state {
		display: flex;
		align-items: center;
		gap: 0.8rem;
		margin-top: 1rem;
		padding: 1.3rem;
	}
	.empty-state h2 {
		margin-bottom: 0.3rem;
	}
	.empty-state p,
	.editor-panel > header p,
	.section-heading p,
	.leader-heading p,
	.danger-panel p {
		margin: 0.25rem 0 0;
		color: var(--muted);
		font-size: 0.8rem;
		line-height: 1.55;
	}
	.date-field {
		max-width: 260px;
	}
	.editor-panel > form {
		gap: 1.5rem;
	}
	.leader-editor-list {
		display: grid;
		gap: 1.75rem;
	}
	.leader-editor {
		display: grid;
		min-width: 0;
		gap: 1.25rem;
		margin: 0;
		padding: 0;
		border: 0;
	}
	.leader-editor + .leader-editor {
		padding-top: 1.75rem;
		border-top: 1px solid var(--line);
	}
	.leader-editor > legend,
	.source-fields > legend {
		margin-bottom: 0.1rem;
		padding: 0;
		color: var(--accent);
	}
	.leader-editor > legend {
		font-size: 0.76rem;
	}
	.leader-heading,
	.section-heading {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 1rem;
	}
	.field-grid {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 0.8rem;
	}
	.checkbox-label {
		grid-template-columns: auto 1fr;
		align-items: center;
		align-self: end;
		min-height: 46px;
		padding: 0 0 0.65rem;
	}
	.checkbox-label input {
		width: 1rem;
		height: 1rem;
		accent-color: var(--accent);
	}
	.checkbox-label span {
		color: var(--ink);
		font-size: 0.8rem;
		font-weight: 700;
		letter-spacing: 0;
		text-transform: none;
	}
	.source-fields {
		min-width: 0;
		margin: 0;
		padding: 0;
		border: 0;
		background: transparent;
	}
	.source-grid {
		display: grid;
		grid-template-columns: 1.35fr 1fr 1fr;
		gap: 0.7rem;
	}
	.repeat-section {
		display: grid;
		gap: 0.8rem;
		padding-top: 1rem;
		border-top: 1px solid var(--line);
	}
	.section-heading h3 {
		font-size: 0.9rem;
	}
	.repeat-item {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: 0.6rem;
		align-items: start;
	}
	.repeat-item + .repeat-item {
		padding-top: 0.9rem;
		border-top: 1px solid var(--line);
	}
	.text-button {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		border: 0;
		color: var(--accent);
		background: transparent;
		font: inherit;
		font-size: 0.76rem;
		font-weight: 800;
		cursor: pointer;
	}
	.danger-text {
		color: #9a2924;
	}
	.citation-remove-button {
		white-space: nowrap;
	}
	.fact-editor {
		display: grid;
		gap: 0.8rem;
		padding: 0;
		border: 0;
	}
	.fact-editor + .fact-editor {
		padding-top: 1rem;
		border-top: 1px solid var(--line);
	}
	.add-leader {
		margin-top: 0.1rem;
	}
	.danger-panel {
		display: grid;
		grid-template-columns: 1fr minmax(300px, 0.9fr);
		gap: 1.5rem;
		border-color: #e6c5c2;
		background: #fffafa;
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
		color: var(--ink);
		font-size: 0.78rem;
		font-weight: 600;
		letter-spacing: 0;
		line-height: 1.45;
		text-transform: none;
	}
	@media (max-width: 900px) {
		.overview-grid,
		.danger-panel,
		.leader-gallery article {
			grid-template-columns: 1fr;
		}
		.source-grid {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
	}
	@media (max-width: 620px) {
		.field-grid,
		.source-grid {
			grid-template-columns: 1fr;
		}
		.leader-heading,
		.section-heading,
		.form-panel header,
		.editor-panel > header,
		.active-slate > header {
			flex-direction: column;
		}
	}
</style>
