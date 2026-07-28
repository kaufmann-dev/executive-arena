<script lang="ts">
	import {
		ArrowRight,
		Check,
		ExternalLink,
		Image,
		Images,
		RefreshCw,
		ShieldAlert
	} from '@lucide/svelte';
	import { resolve } from '$app/paths';

	let { data, form } = $props();

	type SelectedItem = { personId: string; value: string };
	let selectionState = $state<{
		companyId: string | null;
		items: SelectedItem[];
	}>({
		companyId: null,
		items: []
	});

	const currentSelections = $derived(
		selectionState.companyId === data.target?.card.companyId ? selectionState.items : []
	);
	const searchesByPerson = $derived(
		new Map(data.searches.map((search) => [search.personId, search]))
	);

	function candidateValue(
		personId: string,
		candidate: (typeof data.searches)[number]['candidates'][number]
	): string {
		return JSON.stringify({ personId, candidate });
	}

	function isSelected(value: string): boolean {
		return currentSelections.some((selection) => selection.value === value);
	}

	function selectedForPerson(personId: string): number {
		return currentSelections.filter((selection) => selection.personId === personId).length;
	}

	function toggleSelection(personId: string, value: string, checked: boolean) {
		const companyId = data.target?.card.companyId ?? null;
		const items =
			selectionState.companyId === companyId ? [...selectionState.items] : ([] as SelectedItem[]);
		const existingIndex = items.findIndex((selection) => selection.value === value);
		if (checked && existingIndex === -1) items.push({ personId, value });
		if (!checked && existingIndex !== -1) items.splice(existingIndex, 1);
		selectionState = { companyId, items };
	}
</script>

<svelte:head><title>Portrait backfill · Executive Arena</title></svelte:head>

<section class="page-heading">
	<div>
		<p class="eyebrow">Cohort administration</p>
		<h1>Portrait backfill</h1>
		<p class="lede">
			Review Brave image candidates, compare them with saved portraits, and fill each executive’s
			three-image set.
		</p>
	</div>
	<div class="mode-switch" aria-label="Backfill queue mode">
		<a
			class={{ active: data.mode === 'missing' }}
			href={resolve('/admin/portrait-backfill?mode=missing')}>No images</a
		>
		<a
			class={{ active: data.mode === 'incomplete' }}
			href={resolve('/admin/portrait-backfill?mode=incomplete')}>Fewer than 3</a
		>
	</div>
</section>

{#if data.notice.saved > 0 || data.notice.failed > 0}
	<div class="notice" role="status">
		<Check size={18} />
		<span>
			{data.notice.saved} portrait{data.notice.saved === 1 ? '' : 's'} saved.
			{#if data.notice.failed > 0}
				{data.notice.failed} selection{data.notice.failed === 1 ? '' : 's'} could not be saved.
			{/if}
		</span>
	</div>
{/if}

{#if form?.message}
	<div class={['notice', { warning: (form.failures?.length ?? 0) > 0 }]} role="status">
		{#if (form.failures?.length ?? 0) > 0}<ShieldAlert size={18} />{:else}<Check size={18} />{/if}
		<div>
			<strong>{form.message}</strong>
			{#if (form.failures?.length ?? 0) > 0}
				<ul>
					{#each form.failures as failure, index (`${failure.personId}:${index}`)}
						<li>{failure.message}</li>
					{/each}
				</ul>
			{/if}
		</div>
	</div>
{/if}

<section class="diagnostics" aria-labelledby="diagnostics-heading">
	<div class="section-heading">
		<div>
			<p class="eyebrow">Last seven days</p>
			<h2 id="diagnostics-heading">Ingestion diagnostics</h2>
		</div>
		<small>Sanitized hosts and response metadata only</small>
	</div>
	<div class="metric-grid">
		<article>
			<strong>{data.diagnostics.summary.originalSaved}</strong>
			<span>Originals saved</span>
		</article>
		<article>
			<strong>{data.diagnostics.summary.fallbackSaved}</strong>
			<span>Thumbnail fallbacks</span>
		</article>
		<article>
			<strong>{data.diagnostics.summary.suspectedBlocked}</strong>
			<span>Suspected blocks</span>
		</article>
		<article>
			<strong>{data.diagnostics.summary.rejected}</strong>
			<span>Rejected fetches</span>
		</article>
		<article>
			<strong>{data.diagnostics.summary.duplicate}</strong>
			<span>Exact duplicates</span>
		</article>
	</div>
	{#if data.diagnostics.recentFailures.length > 0}
		<details>
			<summary>Recent failures</summary>
			<div class="table-wrap">
				<table>
					<thead>
						<tr>
							<th>Executive</th>
							<th>Retrieval</th>
							<th>Host</th>
							<th>Reason</th>
							<th>Time</th>
						</tr>
					</thead>
					<tbody>
						{#each data.diagnostics.recentFailures as attempt (attempt.id)}
							<tr>
								<td data-label="Executive">
									<strong>{attempt.personName}</strong>
									<small>{attempt.companyName}</small>
								</td>
								<td data-label="Retrieval">{attempt.retrievalKind.replace('_', ' ')}</td>
								<td data-label="Host">{attempt.host}</td>
								<td data-label="Reason">
									{attempt.validationCode ?? attempt.outcome}
									{#if attempt.httpStatus}<small>HTTP {attempt.httpStatus}</small>{/if}
								</td>
								<td data-label="Time">
									{new Intl.DateTimeFormat('en-US', {
										dateStyle: 'medium',
										timeStyle: 'short'
									}).format(attempt.createdAt)}
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		</details>
	{/if}
</section>

{#if !data.target}
	<section class="panel empty-state">
		<Images size={30} />
		<h2>Queue complete</h2>
		<p>
			No included company after this position has an active executive matching the selected mode.
		</p>
		<a class="secondary-button" href={resolve(`/admin/portrait-backfill?mode=${data.mode}`)}
			>Start a new run</a
		>
	</section>
{:else}
	<section class="company-context">
		<div>
			<p class="eyebrow">Current company</p>
			<h2>{data.target.card.companyName}</h2>
			<p>
				{data.target.card.ticker} · {data.target.card.leaders.length} active executive{data.target
					.card.leaders.length === 1
					? ''
					: 's'}
			</p>
		</div>
		<a
			class="secondary-button"
			href={resolve('/admin/companies/[id]', { id: data.target.card.companyId })}
			>Manage company <ExternalLink size={15} /></a
		>
	</section>

	<form class="backfill-form" method="POST" action="?/save">
		<input type="hidden" name="mode" value={data.mode} />
		<input type="hidden" name="companyId" value={data.target.card.companyId} />
		<input type="hidden" name="currentCursor" value={data.target.cursor} />
		<input type="hidden" name="beforeCursor" value={data.cursor ?? ''} />

		{#each data.target.card.leaders as leader (leader.id)}
			{@const search = searchesByPerson.get(leader.id)}
			{@const remaining = 3 - leader.portraits.length}
			<article class="leader-review">
				<header>
					<div>
						<p class="eyebrow">{leader.title}</p>
						<h3>{leader.name}</h3>
					</div>
					<span class="capacity">{leader.portraits.length} of 3 saved</span>
				</header>

				<div class="saved-portraits" aria-label={`Saved portraits for ${leader.name}`}>
					{#each leader.portraits as savedPortrait, index (savedPortrait.id)}
						<figure>
							<img src={`/media/portraits/${savedPortrait.id}`} alt={savedPortrait.altText} />
							<figcaption>Saved {index + 1}</figcaption>
						</figure>
					{/each}
					{#each { length: remaining }, slot}
						<div class="empty-slot" aria-label={`Empty portrait slot ${slot + 1}`}>
							<Image size={22} />
							<span>Open slot</span>
						</div>
					{/each}
				</div>

				{#if search}
					<div class="search-context">
						<span>Brave query</span>
						<code>{search.query}</code>
					</div>
					{#if search.error}
						<div class="search-error" role="alert">
							<ShieldAlert size={18} />
							<div>
								<strong>Search unavailable</strong>
								<p>{search.error}</p>
							</div>
						</div>
					{:else if search.candidates.length === 0}
						<div class="search-error">
							<Images size={18} />
							<div>
								<strong>No usable candidates returned</strong>
								<p>Skip this company or begin another run later for refreshed results.</p>
							</div>
						</div>
					{:else}
						<div class="candidate-heading">
							<div>
								<h4>Top candidates</h4>
								<p>
									Select up to {remaining}; original assets fall back to validated Brave thumbnails.
								</p>
							</div>
							<strong>{selectedForPerson(leader.id)} selected</strong>
						</div>
						<div class="candidate-grid">
							{#each search.candidates as candidate (candidate.originalUrl)}
								{@const value = candidateValue(leader.id, candidate)}
								{@const selected = isSelected(value)}
								<div class="candidate-item">
									<label
										class={[
											'candidate',
											{ selected, disabled: !selected && selectedForPerson(leader.id) >= remaining }
										]}
									>
										<input
											type="checkbox"
											name="selection"
											{value}
											checked={selected}
											disabled={!selected && selectedForPerson(leader.id) >= remaining}
											onchange={(event) =>
												toggleSelection(
													leader.id,
													value,
													(event.currentTarget as HTMLInputElement).checked
												)}
										/>
										<span class="selection-mark" aria-hidden="true"><Check size={16} /></span>
										<img src={candidate.thumbnailUrl} alt="" />
										<span class="candidate-copy">
											<strong>{candidate.title}</strong>
											<small>
												{candidate.publisher}
												{#if candidate.thumbnailWidth && candidate.thumbnailHeight}
													· {candidate.thumbnailWidth}×{candidate.thumbnailHeight}
												{/if}
											</small>
											{#if candidate.confidence}<small>{candidate.confidence} confidence</small
												>{/if}
										</span>
									</label>
									<a
										class="source-link"
										href={candidate.sourcePageUrl}
										target="_blank"
										rel="external noreferrer">Inspect source <ExternalLink size={13} /></a
									>
								</div>
							{/each}
						</div>
					{/if}
				{:else}
					<p class="complete-message">
						<Check size={17} /> This executive already satisfies this queue mode.
					</p>
				{/if}
			</article>
		{/each}

		<footer class="queue-actions">
			<button class="primary-button" type="submit" disabled={currentSelections.length === 0}>
				<RefreshCw size={16} /> Save {currentSelections.length || ''} selected
			</button>
		</footer>
	</form>

	<form class="skip-form" method="POST" action="?/skip">
		<input type="hidden" name="mode" value={data.mode} />
		<input type="hidden" name="currentCursor" value={data.target.cursor} />
		<button class="quiet-button" type="submit">Skip and show next <ArrowRight size={16} /></button>
	</form>
{/if}

<style>
	.mode-switch {
		display: inline-flex;
		padding: 0.2rem;
		border: 1px solid var(--line);
		border-radius: 8px;
		background: #efefed;
	}

	.mode-switch a {
		min-height: 42px;
		padding: 0.65rem 0.85rem;
		border-radius: 6px;
		color: var(--muted);
		font-size: 0.76rem;
		font-weight: 800;
		text-decoration: none;
	}

	.mode-switch a.active {
		color: var(--ink);
		background: #fff;
		box-shadow: 0 1px 4px rgb(0 0 0 / 8%);
	}

	.notice {
		display: flex;
		align-items: flex-start;
		gap: 0.65rem;
		margin-bottom: 1rem;
		padding: 0.85rem 1rem;
		border: 1px solid #b8d9ca;
		border-radius: 8px;
		color: #164e3a;
		background: #edf8f3;
	}

	.notice.warning {
		border-color: #e1c79d;
		color: #784b0d;
		background: #fff8ec;
	}

	.notice ul {
		margin: 0.35rem 0 0;
		padding-left: 1.1rem;
	}

	.diagnostics {
		margin-bottom: 1rem;
		padding: 1rem;
		border: 1px solid var(--line);
		border-radius: 10px;
		background: #fff;
	}

	.section-heading,
	.company-context,
	.leader-review > header,
	.candidate-heading,
	.queue-actions {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
	}

	.section-heading h2,
	.company-context h2,
	.leader-review h3,
	.candidate-heading h4 {
		margin: 0;
	}

	.section-heading > small,
	.company-context p,
	.candidate-heading p {
		margin: 0;
		color: var(--muted);
	}

	.metric-grid {
		display: grid;
		grid-template-columns: repeat(5, minmax(0, 1fr));
		gap: 0.65rem;
		margin-top: 0.9rem;
	}

	.metric-grid article {
		padding: 0.75rem;
		border-radius: 7px;
		background: #f4f4f1;
	}

	.metric-grid strong,
	.metric-grid span {
		display: block;
	}

	.metric-grid strong {
		font-family: var(--serif);
		font-size: 1.45rem;
	}

	.metric-grid span {
		margin-top: 0.15rem;
		color: var(--muted);
		font-size: 0.7rem;
		font-weight: 750;
	}

	details {
		margin-top: 0.9rem;
		border-top: 1px solid var(--line);
	}

	summary {
		min-height: 42px;
		padding-top: 0.75rem;
		font-weight: 800;
		cursor: pointer;
	}

	td small,
	td strong {
		display: block;
	}

	.company-context {
		margin-bottom: 1rem;
		padding: 1rem 1.1rem;
		border-radius: 10px;
		color: #fff;
		background: #173d32;
	}

	.company-context p {
		color: #c9ded6;
	}

	.company-context .secondary-button {
		border-color: rgb(255 255 255 / 30%);
		color: #fff;
		background: rgb(255 255 255 / 8%);
	}

	.backfill-form {
		display: grid;
		gap: 1rem;
	}

	.leader-review {
		min-width: 0;
		padding: 1.1rem;
		border: 1px solid var(--line);
		border-radius: 10px;
		background: #fff;
	}

	.capacity {
		padding: 0.35rem 0.55rem;
		border-radius: 999px;
		color: var(--accent);
		font-size: 0.7rem;
		font-weight: 850;
		background: #e9f4ef;
	}

	.saved-portraits {
		display: grid;
		grid-template-columns: repeat(3, minmax(100px, 150px));
		gap: 0.65rem;
		margin-top: 0.9rem;
	}

	.saved-portraits figure {
		margin: 0;
	}

	.saved-portraits img,
	.empty-slot {
		display: block;
		width: 100%;
		aspect-ratio: 0.82;
		border-radius: 8px;
		background: #ececea;
	}

	.saved-portraits img {
		object-fit: cover;
	}

	.saved-portraits figcaption {
		margin-top: 0.25rem;
		color: var(--muted);
		font-size: 0.68rem;
		font-weight: 750;
	}

	.empty-slot {
		display: grid;
		place-items: center;
		align-content: center;
		gap: 0.3rem;
		border: 1px dashed #c9c9c5;
		color: var(--muted);
		font-size: 0.68rem;
		font-weight: 750;
	}

	.search-context {
		display: grid;
		gap: 0.25rem;
		margin-top: 1rem;
	}

	.search-context span {
		color: var(--muted);
		font-size: 0.68rem;
		font-weight: 800;
		text-transform: uppercase;
		letter-spacing: 0.08em;
	}

	.search-context code {
		overflow-wrap: anywhere;
		font-size: 0.74rem;
	}

	.search-error,
	.complete-message {
		display: flex;
		align-items: flex-start;
		gap: 0.6rem;
		margin: 1rem 0 0;
		padding: 0.8rem;
		border-radius: 7px;
		color: var(--muted);
		background: #f4f4f1;
	}

	.search-error p {
		margin: 0.2rem 0 0;
	}

	.candidate-heading {
		margin-top: 1.1rem;
	}

	.candidate-heading > strong {
		color: var(--accent);
		font-size: 0.75rem;
	}

	.candidate-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(170px, 1fr));
		gap: 0.7rem;
		margin-top: 0.7rem;
	}

	.candidate-item {
		display: grid;
		align-content: start;
	}

	.candidate {
		position: relative;
		display: grid;
		overflow: hidden;
		border: 2px solid transparent;
		border-radius: 9px;
		background: #f0f0ee;
		cursor: pointer;
	}

	.candidate.selected {
		border-color: var(--accent);
		box-shadow: 0 0 0 3px rgb(17 97 73 / 12%);
	}

	.candidate:has(input:focus-visible) {
		outline: 3px solid var(--accent);
		outline-offset: 2px;
	}

	.candidate.disabled {
		opacity: 0.46;
		cursor: not-allowed;
	}

	.candidate input {
		position: absolute;
		width: 1px;
		height: 1px;
		opacity: 0;
	}

	.selection-mark {
		position: absolute;
		top: 0.55rem;
		right: 0.55rem;
		display: grid;
		width: 30px;
		height: 30px;
		place-items: center;
		border: 2px solid #fff;
		border-radius: 50%;
		color: transparent;
		background: rgb(15 25 22 / 45%);
	}

	.candidate.selected .selection-mark {
		color: #fff;
		background: var(--accent);
	}

	.candidate img {
		width: 100%;
		aspect-ratio: 1;
		object-fit: cover;
		background: #e2e2df;
	}

	.candidate-copy {
		display: grid;
		gap: 0.2rem;
		padding: 0.65rem;
	}

	.candidate-copy strong {
		display: -webkit-box;
		overflow: hidden;
		font-size: 0.75rem;
		-webkit-box-orient: vertical;
		-webkit-line-clamp: 2;
		line-clamp: 2;
	}

	.candidate-copy small {
		color: var(--muted);
		font-size: 0.65rem;
	}

	.source-link {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		min-height: 42px;
		margin-top: -0.7rem;
		padding: 0.5rem 0.25rem 0;
		color: var(--accent);
		font-size: 0.68rem;
		font-weight: 800;
	}

	.queue-actions {
		position: sticky;
		bottom: 0.75rem;
		padding: 0.75rem;
		border: 1px solid var(--line);
		border-radius: 9px;
		background: rgb(255 255 255 / 94%);
		box-shadow: 0 8px 30px rgb(0 0 0 / 10%);
		backdrop-filter: blur(8px);
	}

	.skip-form {
		display: flex;
		justify-content: flex-end;
		margin-top: 0.65rem;
	}

	.empty-state {
		gap: 0.7rem;
	}

	@media (max-width: 760px) {
		.page-heading,
		.company-context,
		.section-heading,
		.leader-review > header,
		.candidate-heading {
			align-items: flex-start;
			flex-direction: column;
		}

		.mode-switch {
			width: 100%;
		}

		.mode-switch a {
			flex: 1;
			text-align: center;
		}

		.metric-grid {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}

		.saved-portraits {
			grid-template-columns: repeat(3, minmax(0, 1fr));
		}

		.candidate-grid {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}

		.company-context .secondary-button {
			width: 100%;
		}
	}

	@media (max-width: 420px) {
		.candidate-grid {
			grid-template-columns: 1fr;
		}
	}
</style>
