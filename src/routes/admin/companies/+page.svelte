<script lang="ts">
	import {
		Building2,
		CheckCircle2,
		ChevronLeft,
		ChevronRight,
		CircleAlert,
		Search,
		Trash2
	} from '@lucide/svelte';
	import { resolve } from '$app/paths';
	import { companyExclusionReasonLabel } from '$lib/company-exclusion';
	import { companiesPageSearchParams, type CompaniesPageState } from '$lib/companies-page';
	import { formatReadinessLabel } from '$lib/format-label';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	let portraitsByCompany = $derived(
		new Map(data.portraitReview.map((review) => [review.companyId, review]))
	);

	function submitStatusFilter(event: Event) {
		(event.currentTarget as HTMLSelectElement).form?.requestSubmit();
	}

	function companiesHref(
		overrides: Partial<Pick<CompaniesPageState, 'q' | 'status' | 'page' | 'view'>>
	) {
		const search = companiesPageSearchParams(data, overrides);
		return resolve(`/admin/companies?${search.toString()}` as `/admin/companies?${string}`);
	}

	function confirmPortraitDelete(event: SubmitEvent, executiveName: string) {
		if (!confirm(`Delete the saved portrait of ${executiveName}? This cannot be undone.`)) {
			event.preventDefault();
		}
	}
</script>

<svelte:head><title>Companies · Executive Arena</title></svelte:head>

<section class="page-heading">
	<div>
		<p class="eyebrow">Cohort administration</p>
		<h1>Companies</h1>
		<p class="lede">
			Inspect research status, edit complete profiles, or explicitly remove a company from the fixed
			experiment cohort.
		</p>
	</div>
	<div class="heading-actions">
		<span class="record-count">{data.total.toLocaleString()} records</span>
		<a class="primary-button" href={resolve('/admin/companies/new')}
			><Building2 size={16} /> Add company</a
		>
	</div>
</section>

{#if data.notice === 'portrait-deleted'}
	<p class="notice success" role="status">
		<CheckCircle2 size={17} /> Portrait deleted and company readiness recalculated.
	</p>
{:else if data.notice === 'portrait-delete-failed'}
	<p class="notice error" role="alert">
		<CircleAlert size={17} /> The portrait could not be deleted. It may no longer belong to this company’s
		active leadership.
	</p>
{/if}

<section class="panel company-panel">
	<nav class="view-switch" aria-label="Companies view">
		<a
			class={{ active: data.view === 'list' }}
			aria-current={data.view === 'list' ? 'page' : undefined}
			href={companiesHref({ view: 'list', page: 1 })}>List</a
		>
		<a
			class={{ active: data.view === 'portraits' }}
			aria-current={data.view === 'portraits' ? 'page' : undefined}
			href={companiesHref({ view: 'portraits', page: 1 })}>Portrait review</a
		>
	</nav>

	<form class="search-form" method="GET">
		<input type="hidden" name="view" value={data.view} />
		<input type="hidden" name="page" value={data.page} />
		<label>
			<span class="sr-only">Search companies or tickers</span>
			<Search size={17} />
			<input name="q" value={data.q} placeholder="Search company or ticker…" maxlength="100" />
		</label>
		<label class="status-filter">
			<span class="sr-only">Filter by research status</span>
			<select name="status" value={data.status} onchange={submitStatusFilter}>
				<option value="all">All statuses</option>
				<option value="not_ready">not ready</option>
				<option value="missing_image">Missing image</option>
				<option value="ready">Ready</option>
				<option value="excluded">Excluded</option>
			</select>
		</label>
		<button class="secondary-button" type="submit">Search</button>
	</form>

	{#if data.rows.length === 0}
		<div class="empty-state">
			<h2>No companies found</h2>
			<p>Try another company name or ticker.</p>
			<a class="secondary-button" href={companiesHref({ q: '' })}>Clear search</a>
		</div>
	{:else}
		<div class="table-wrap">
			{#if data.view === 'list'}
				<table class="list-table">
					<thead>
						<tr>
							<th>Ticker</th>
							<th>Company</th>
							<th>Status</th>
							<th class="numeric">Market cap</th>
							<th><span class="sr-only">Action</span></th>
						</tr>
					</thead>
					<tbody>
						{#each data.rows as company (company.id)}
							<tr>
								<td class="ticker" data-label="Ticker">{company.ticker}</td>
								<td data-label="Company">
									<strong>{company.name}</strong>
									{#if company.exclusionReason}<small
											>{companyExclusionReasonLabel(company.exclusionReason)}</small
										>{/if}
								</td>
								<td data-label="Status">
									<span class={`pill ${company.readinessStatus}`}>
										{formatReadinessLabel(company.included ? company.readinessStatus : 'excluded')}
									</span>
								</td>
								<td class="numeric" data-label="Market cap">
									{company.marketCap
										? new Intl.NumberFormat('en-US', {
												style: 'currency',
												currency: 'USD',
												notation: 'compact',
												maximumFractionDigits: 1
											}).format(company.marketCap)
										: '—'}
								</td>
								<td class="action" data-label="Action">
									<a href={resolve('/admin/companies/[id]', { id: company.id })}>Manage</a>
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			{:else}
				<table class="portrait-table">
					<thead>
						<tr>
							<th>Company</th>
							<th>Active leaders and saved portraits</th>
							<th>Readiness</th>
							<th><span class="sr-only">Action</span></th>
						</tr>
					</thead>
					<tbody>
						{#each data.rows as company (company.id)}
							{@const review = portraitsByCompany.get(company.id)}
							<tr>
								<td class="company-cell" data-label="Company">
									<strong>{company.name}</strong>
									<small class="ticker">{company.ticker}</small>
								</td>
								<td class="leaders-cell" data-label="Active leaders and saved portraits">
									{#if review && review.leaders.length > 0}
										<div class="leader-list">
											{#each review.leaders as leader (leader.id)}
												<section class="leader-review">
													<header>
														<strong>{leader.name}</strong>
														<small>{leader.isInterim ? 'Interim ' : ''}{leader.title}</small>
													</header>
													{#if leader.portraits.length > 0}
														<div
															class="portrait-gallery"
															aria-label={`Saved portraits for ${leader.name}`}
														>
															{#each leader.portraits as portrait, index (portrait.id)}
																<figure class="portrait-item">
																	<a
																		class="portrait-link"
																		href={resolve('/media/portraits/[id]', {
																			id: portrait.id
																		})}
																		target="_blank"
																		rel="noreferrer"
																		aria-label={`Open portrait ${index + 1} of ${leader.name} in a new tab`}
																	>
																		<img
																			src={resolve('/media/portraits/[id]', {
																				id: portrait.id
																			})}
																			alt={portrait.altText}
																			width={portrait.width}
																			height={portrait.height}
																			loading="lazy"
																			decoding="async"
																		/>
																	</a>
																	<form
																		method="POST"
																		action="?/deletePortrait"
																		onsubmit={(event) => confirmPortraitDelete(event, leader.name)}
																	>
																		<input type="hidden" name="companyId" value={company.id} />
																		<input type="hidden" name="portraitId" value={portrait.id} />
																		<input type="hidden" name="q" value={data.q} />
																		<input type="hidden" name="status" value={data.status} />
																		<input type="hidden" name="page" value={data.page} />
																		<input type="hidden" name="view" value={data.view} />
																		<button
																			type="submit"
																			aria-label={`Delete portrait ${index + 1} of ${leader.name}`}
																		>
																			<Trash2 size={16} />
																			<span>Delete</span>
																		</button>
																	</form>
																	<figcaption class="sr-only">
																		Portrait {index + 1} of {leader.name}
																	</figcaption>
																</figure>
															{/each}
														</div>
													{:else}
														<p class="missing-state">No saved portraits</p>
													{/if}
												</section>
											{/each}
										</div>
									{:else}
										<p class="missing-state">No active leadership</p>
									{/if}
								</td>
								<td class="readiness-cell" data-label="Readiness">
									<span class={`pill ${company.readinessStatus}`}>
										{formatReadinessLabel(company.included ? company.readinessStatus : 'excluded')}
									</span>
								</td>
								<td class="action" data-label="Action">
									<a href={resolve('/admin/companies/[id]', { id: company.id })}>Manage</a>
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			{/if}
		</div>

		<footer class="pagination">
			<p>Page {data.page} of {data.pageCount}</p>
			<form method="GET">
				<input type="hidden" name="view" value={data.view} />
				{#if data.q}<input type="hidden" name="q" value={data.q} />{/if}
				{#if data.status !== 'all'}
					<input type="hidden" name="status" value={data.status} />
				{/if}
				{#if data.page > 1}
					<button class="secondary-button" type="submit" name="page" value={data.page - 1}
						><ChevronLeft size={16} /> Previous</button
					>
				{/if}
				{#if data.page < data.pageCount}
					<button class="secondary-button" type="submit" name="page" value={data.page + 1}
						>Next <ChevronRight size={16} /></button
					>
				{/if}
			</form>
		</footer>
	{/if}
</section>

<style>
	.company-panel {
		min-width: 0;
		max-width: 100%;
		overflow: hidden;
	}

	.heading-actions {
		display: flex;
		align-items: center;
		gap: 0.7rem;
	}

	.record-count {
		color: var(--muted);
		font-size: 0.78rem;
		font-weight: 700;
	}

	.notice {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		margin: 0 0 1rem;
		padding: 0.75rem 0.9rem;
		border: 1px solid;
		border-radius: 6px;
		font-size: 0.82rem;
		font-weight: 700;
	}

	.notice.success {
		border-color: #b7d5c9;
		background: #edf8f3;
		color: #0d684b;
	}

	.notice.error {
		border-color: #e5c2bf;
		background: #fff1f0;
		color: #9c3029;
	}

	.view-switch {
		display: flex;
		gap: 0.35rem;
		padding: 0.75rem 1rem;
		border-bottom: 1px solid var(--line);
		background: #fafafa;
	}

	.view-switch a {
		display: inline-flex;
		min-height: 42px;
		align-items: center;
		padding: 0 0.9rem;
		border: 1px solid transparent;
		border-radius: 6px;
		color: var(--muted);
		font-size: 0.78rem;
		font-weight: 800;
	}

	.view-switch a.active {
		border-color: #c8d7d1;
		background: #ffffff;
		color: var(--accent);
		box-shadow: 0 1px 2px rgb(0 0 0 / 5%);
	}

	.search-form {
		display: flex;
		min-width: 0;
		max-width: 100%;
		gap: 0.65rem;
		padding: 1rem;
		border-bottom: 1px solid var(--line);
	}

	.search-form label {
		display: flex;
		min-width: 0;
		flex: 1;
		align-items: center;
		gap: 0.55rem;
		height: 42px;
		padding: 0 0.8rem;
		border: 1px solid #d8d8d8;
		border-radius: 6px;
		background: #ffffff;
	}

	.search-form label:focus-within {
		border-color: var(--accent);
		box-shadow: 0 0 0 3px rgb(17 97 73 / 10%);
	}

	.search-form input {
		flex: 1;
		min-width: 0;
		border: 0;
		outline: 0;
		background: transparent;
	}

	.status-filter {
		flex: 0 0 155px !important;
	}

	.status-filter select {
		width: 100%;
		border: 0;
		outline: 0;
		background: transparent;
		color: var(--ink);
	}

	.table-wrap {
		min-width: 0;
		max-width: 100%;
		overflow-x: auto;
	}

	table {
		width: 100%;
		border-collapse: collapse;
	}

	th,
	td {
		padding: 0.8rem 1rem;
		border-bottom: 1px solid #e9e9e9;
		text-align: left;
	}

	th {
		color: var(--muted);
		background: #f7f7f7;
		font-size: 0.67rem;
		letter-spacing: 0.06em;
		text-transform: uppercase;
	}

	td {
		color: #555555;
		font-size: 0.81rem;
	}

	td strong,
	td small {
		display: block;
	}

	td strong {
		color: var(--ink);
	}

	td small {
		margin-top: 0.2rem;
		color: var(--muted);
	}

	.ticker {
		color: var(--accent);
		font-weight: 850;
		letter-spacing: 0.07em;
	}

	.numeric {
		text-align: right;
		font-variant-numeric: tabular-nums;
	}

	.action {
		text-align: right;
	}

	.action a {
		color: var(--accent);
		font-weight: 750;
	}

	.portrait-table td {
		vertical-align: top;
	}

	.portrait-table .action {
		vertical-align: middle;
	}

	.portrait-table .readiness-cell {
		vertical-align: middle;
	}

	.portrait-table .readiness-cell .pill {
		white-space: nowrap;
	}

	.portrait-table .action a {
		display: inline-flex;
		min-height: 42px;
		align-items: center;
	}

	.portrait-table .company-cell {
		width: 18%;
		min-width: 150px;
	}

	.portrait-table .leaders-cell {
		min-width: 430px;
	}

	.leader-list {
		display: grid;
		gap: 1rem;
	}

	.leader-review {
		display: grid;
		grid-template-columns: minmax(150px, 0.6fr) minmax(0, 1.4fr);
		gap: 0.8rem;
		align-items: start;
	}

	.leader-review + .leader-review {
		padding-top: 1rem;
		border-top: 1px solid #ededed;
	}

	.leader-review header small {
		line-height: 1.35;
	}

	.portrait-gallery {
		display: flex;
		flex-wrap: wrap;
		gap: 0.65rem;
	}

	.portrait-item {
		width: 84px;
		margin: 0;
	}

	.portrait-link {
		display: block;
		width: 84px;
		height: 84px;
		overflow: hidden;
		border: 1px solid #d8d8d8;
		border-radius: 6px;
		background: #eeeeee;
	}

	.portrait-link img {
		width: 100%;
		height: 100%;
		object-fit: cover;
	}

	.portrait-item form {
		margin-top: 0.35rem;
	}

	.portrait-item button {
		display: inline-flex;
		width: 100%;
		min-height: 42px;
		align-items: center;
		justify-content: center;
		gap: 0.3rem;
		padding: 0 0.4rem;
		border: 1px solid #e1c4c1;
		border-radius: 5px;
		background: #ffffff;
		color: #9c3029;
		font: inherit;
		font-size: 0.7rem;
		font-weight: 800;
		cursor: pointer;
	}

	.portrait-link:focus-visible,
	.portrait-item button:focus-visible,
	.view-switch a:focus-visible {
		outline: 3px solid rgb(17 97 73 / 24%);
		outline-offset: 2px;
	}

	.missing-state {
		margin: 0.4rem 0 0;
		color: var(--muted);
		font-size: 0.76rem;
		font-style: italic;
	}

	.pagination {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 1rem;
	}

	.pagination p {
		margin: 0;
		color: var(--muted);
		font-size: 0.75rem;
	}

	.pagination form {
		display: flex;
		gap: 0.5rem;
	}

	.sr-only {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip: rect(0, 0, 0, 0);
		white-space: nowrap;
	}

	@media (max-width: 580px) {
		.heading-actions,
		.search-form,
		.pagination {
			align-items: stretch;
			flex-direction: column;
		}

		.view-switch {
			display: grid;
			grid-template-columns: 1fr 1fr;
		}

		.view-switch a {
			justify-content: center;
			text-align: center;
		}

		.status-filter {
			flex-basis: auto !important;
		}

		.table-wrap {
			overflow: visible;
		}

		table,
		tbody {
			display: block;
			width: 100%;
		}

		thead {
			position: absolute;
			width: 1px;
			height: 1px;
			overflow: hidden;
			clip-path: inset(50%);
			white-space: nowrap;
		}

		tbody tr {
			padding: 1rem;
			border-bottom: 1px solid #e9e9e9;
		}

		td {
			display: block;
			min-width: 0;
			padding: 0;
			border: 0;
			text-align: left;
			overflow-wrap: anywhere;
		}

		td::before {
			display: block;
			margin-bottom: 0.2rem;
			color: var(--muted);
			font-size: 0.62rem;
			font-weight: 800;
			letter-spacing: 0.06em;
			text-transform: uppercase;
			content: attr(data-label);
		}

		.list-table tbody tr {
			display: grid;
			grid-template-columns: minmax(0, 1fr) auto;
			gap: 0.85rem 1rem;
		}

		.list-table td:nth-child(2) {
			grid-column: 1 / -1;
			grid-row: 1;
		}

		.list-table td:nth-child(1) {
			grid-column: 1;
			grid-row: 2;
		}

		.list-table td:nth-child(3) {
			grid-column: 2;
			grid-row: 2;
		}

		.list-table td:nth-child(4) {
			grid-column: 1;
			grid-row: 3;
		}

		.list-table td:nth-child(5) {
			grid-column: 2;
			grid-row: 3;
			align-self: end;
		}

		.numeric,
		.action {
			text-align: left;
		}

		.portrait-table tbody tr {
			display: block;
		}

		.portrait-table td + td {
			margin-top: 1rem;
		}

		.portrait-table .company-cell,
		.portrait-table .leaders-cell {
			width: auto;
			min-width: 0;
		}

		.leader-review {
			display: block;
		}

		.leader-review header {
			margin-bottom: 0.7rem;
		}

		.portrait-gallery {
			gap: 0.75rem;
		}
	}
</style>
