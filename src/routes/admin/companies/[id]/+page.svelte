<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
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
		retrievedAt: string;
	};

	type DraftPortrait = {
		imageUrl: string;
		altText: string;
		source: DraftSource;
	};

	type DraftFact = {
		category: string;
		value: string;
		sources: DraftSource[];
	};

	type DraftLeader = {
		name: string;
		title: string;
		roleKind: string;
		isInterim: boolean;
		summary: string;
		roleSource: DraftSource;
		summarySources: DraftSource[];
		portraits: DraftPortrait[];
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

	const notices: Record<string, string> = {
		'metadata-updated': 'Company metadata updated. Existing comparisons were preserved.',
		'profile-created': 'Leadership profile created and marked ready.',
		'profile-updated': 'Profile content updated. Existing comparisons were preserved.',
		'profile-replaced':
			'Leadership changed. A new slate and cohort revision were created, then the ranking was refit.',
		'company-excluded':
			'Company excluded, current portrait bytes purged, and the active ranking was refit.'
	};

	function today(): string {
		return new Date().toISOString().slice(0, 10);
	}

	function emptySource(): DraftSource {
		return { url: '', title: '', publisher: '', retrievedAt: today() };
	}

	function emptyPortrait(): DraftPortrait {
		return { imageUrl: '', altText: '', source: emptySource() };
	}

	function emptyFact(): DraftFact {
		return { category: 'career', value: '', sources: [emptySource()] };
	}

	function emptyLeader(): DraftLeader {
		return {
			name: '',
			title: '',
			roleKind: 'ceo',
			isInterim: false,
			summary: '',
			roleSource: emptySource(),
			summarySources: [emptySource()],
			portraits: [emptyPortrait()],
			facts: [emptyFact()]
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
				roleSource: sourceToDraft(leader.role_source),
				summarySources: leader.summary_sources.map(sourceToDraft),
				portraits: leader.portraits.map((portrait) => ({
					imageUrl: portrait.image_url,
					altText: portrait.alt_text,
					source: sourceToDraft(portrait.source)
				})),
				facts: leader.facts.map((fact) => ({
					category: fact.category,
					value: fact.value,
					sources: fact.sources.map(sourceToDraft)
				}))
			}))
		};
	}

	function sourceToDraft(source: ExecutiveProfile['leaders'][number]['role_source']): DraftSource {
		return {
			url: source.url,
			title: source.title,
			publisher: source.publisher,
			retrievedAt: source.retrieved_at
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
								<figcaption>Portrait {index + 1}</figcaption>
							</figure>
						{/each}
					</div>
					<div class="leader-copy">
						<h3>{leader.name}</h3>
						<p>{leader.isInterim ? 'Interim ' : ''}{leader.title}</p>
						<p class="summary">{leader.summary}</p>
						<small
							>{leader.facts.length} cited facts · {leader.summarySources.length} summary citations</small
						>
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
				Every role, summary, fact, and portrait needs a supporting source. Saving validates and
				publishes the entire slate together.
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
						<p>Profile details, evidence, and saved portrait replacements.</p>
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

					{@render SourceFields(leader.roleSource, `${prefix}.roleSource`, 'Role citation')}

					<section class="repeat-section">
						<div class="section-heading">
							<div>
								<h3>Summary citations</h3>
								<p>Cite the biographical summary with one or more sources.</p>
							</div>
							<button
								class="text-button"
								type="button"
								onclick={() => leader.summarySources.push(emptySource())}
								><CirclePlus size={15} /> Add citation</button
							>
						</div>
						{#each leader.summarySources as source, sourceIndex (source)}
							<div class="repeat-item">
								{@render SourceFields(
									source,
									`${prefix}.summarySources.${sourceIndex}`,
									`Summary citation ${sourceIndex + 1}`
								)}
								{#if leader.summarySources.length > 1}
									<button
										class="icon-button"
										type="button"
										aria-label="Remove summary citation"
										onclick={() => leader.summarySources.splice(sourceIndex, 1)}
										><Trash2 size={15} /></button
									>
								{/if}
							</div>
						{/each}
					</section>

					<section class="repeat-section">
						<div class="section-heading">
							<div>
								<h3>Portraits</h3>
								<p>
									Add one to three real-person HTTPS images. Each is downloaded and stored
									privately.
								</p>
							</div>
							{#if leader.portraits.length < 3}
								<button
									class="text-button"
									type="button"
									onclick={() => leader.portraits.push(emptyPortrait())}
									><CirclePlus size={15} /> Add portrait</button
								>
							{/if}
						</div>
						{#each leader.portraits as portrait, portraitIndex (portrait)}
							<div class="portrait-editor">
								<div class="portrait-placeholder">
									<Image size={20} /><span>Portrait {portraitIndex + 1}</span>
								</div>
								<div>
									<label
										><span>Image URL</span><input
											name={`${prefix}.portraits.${portraitIndex}.imageUrl`}
											type="url"
											required
											bind:value={portrait.imageUrl}
										/></label
									>
									<label
										><span>Alt text</span><input
											name={`${prefix}.portraits.${portraitIndex}.altText`}
											required
											maxlength="250"
											bind:value={portrait.altText}
										/></label
									>
									{@render SourceFields(
										portrait.source,
										`${prefix}.portraits.${portraitIndex}.source`,
										'Portrait source'
									)}
								</div>
								{#if leader.portraits.length > 1}
									<button
										class="icon-button"
										type="button"
										aria-label="Remove portrait"
										onclick={() => leader.portraits.splice(portraitIndex, 1)}
										><Trash2 size={15} /></button
									>
								{/if}
							</div>
						{/each}
					</section>

					<section class="repeat-section">
						<div class="section-heading">
							<div>
								<h3>Biographical facts</h3>
								<p>Include at least one cited, concise fact.</p>
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
								<div class="fact-sources">
									{#each fact.sources as source, sourceIndex (source)}
										<div class="repeat-item">
											{@render SourceFields(
												source,
												`${prefix}.facts.${factIndex}.sources.${sourceIndex}`,
												`Fact citation ${sourceIndex + 1}`
											)}
											{#if fact.sources.length > 1}<button
													class="icon-button"
													type="button"
													aria-label="Remove fact citation"
													onclick={() => fact.sources.splice(sourceIndex, 1)}
													><Trash2 size={15} /></button
												>{/if}
										</div>
									{/each}
									<button
										class="text-button"
										type="button"
										onclick={() => fact.sources.push(emptySource())}
										><CirclePlus size={15} /> Add citation</button
									>
								</div>
								{#if leader.facts.length > 1}<button
										class="text-button danger-text"
										type="button"
										onclick={() => leader.facts.splice(factIndex, 1)}
										><Trash2 size={15} /> Remove fact</button
									>{/if}
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
					required
					maxlength="300"
					bind:value={source.title}
				/></label
			>
			<label
				><span>Publisher</span><input
					name={`${prefix}.publisher`}
					required
					maxlength="200"
					bind:value={source.publisher}
				/></label
			>
			<label
				><span>Retrieved</span><input
					name={`${prefix}.retrievedAt`}
					type="date"
					required
					bind:value={source.retrievedAt}
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
		margin-top: 0.25rem;
		color: var(--muted);
		font-size: 0.66rem;
		font-weight: 700;
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
	.leader-editor > .source-fields {
		padding-top: 1.25rem;
		border-top: 1px solid var(--line);
	}
	.source-grid {
		display: grid;
		grid-template-columns: 1.35fr 1fr 1fr 0.7fr;
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
		grid-template-columns: 1fr auto;
		gap: 0.6rem;
		align-items: start;
	}
	.repeat-item + .repeat-item {
		padding-top: 0.9rem;
		border-top: 1px solid var(--line);
	}
	.text-button,
	.icon-button {
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
	.icon-button {
		padding: 0.55rem;
		border: 1px solid var(--line);
		border-radius: 8px;
	}
	.danger-text {
		color: #9a2924;
	}
	.portrait-editor {
		display: grid;
		grid-template-columns: 112px minmax(0, 1fr) auto;
		gap: 0.8rem;
		align-items: start;
		padding: 0;
		border: 0;
	}
	.portrait-editor + .portrait-editor {
		padding-top: 0.9rem;
		border-top: 1px solid var(--line);
	}
	.portrait-editor > div:nth-child(2) {
		display: grid;
		gap: 0.7rem;
	}
	.portrait-placeholder {
		display: grid;
		min-height: 124px;
		place-content: center;
		gap: 0.35rem;
		border-radius: 8px;
		color: var(--muted);
		background: #f0f0f0;
		font-size: 0.7rem;
		font-weight: 700;
		text-align: center;
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
	.fact-sources {
		display: grid;
		gap: 0.65rem;
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
		.portrait-editor {
			grid-template-columns: 1fr;
		}
		.portrait-placeholder {
			min-height: 80px;
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
