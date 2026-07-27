<script lang="ts">
	import { Building2, ChevronLeft, ChevronRight, Search } from '@lucide/svelte';
	import { resolve } from '$app/paths';
	import type { ResolvedPathname } from '$app/types';
	import { formatDataLabel } from '$lib/format-label';
	import { SvelteURLSearchParams } from 'svelte/reactivity';

	let { data } = $props();

	function pageHref(page: number): ResolvedPathname {
		const params = new SvelteURLSearchParams();
		if (data.q) params.set('q', data.q);
		if (data.status !== 'all') params.set('status', data.status);
		params.set('page', String(page));
		return `${resolve('/admin/companies')}?${params.toString()}` as ResolvedPathname;
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

<section class="panel company-panel">
	<form class="search-form" method="GET">
		<label>
			<span class="sr-only">Search companies or tickers</span>
			<Search size={17} />
			<input name="q" value={data.q} placeholder="Search company or ticker…" maxlength="100" />
		</label>
		<label class="status-filter">
			<span class="sr-only">Filter by research status</span>
			<select name="status" value={data.status}>
				<option value="all">All statuses</option>
				<option value="not_ready">Not ready</option>
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
			<a class="secondary-button" href={resolve('/admin/companies')}>Clear search</a>
		</div>
	{:else}
		<div class="table-wrap">
			<table>
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
							<td class="ticker">{company.ticker}</td>
							<td>
								<strong>{company.name}</strong>
								{#if company.exclusionReason}<small
										>{formatDataLabel(company.exclusionReason)}</small
									>{/if}
							</td>
							<td>
								<span class={`pill ${company.readinessStatus}`}>
									{company.included ? company.readinessStatus : 'excluded'}
								</span>
							</td>
							<td class="numeric">
								{company.marketCap
									? new Intl.NumberFormat('en-US', {
											style: 'currency',
											currency: 'USD',
											notation: 'compact',
											maximumFractionDigits: 1
										}).format(company.marketCap)
									: '—'}
							</td>
							<td class="action">
								<a href={resolve('/admin/companies/[id]', { id: company.id })}>Manage</a>
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>

		<footer class="pagination">
			<p>Page {data.page} of {data.pageCount}</p>
			<div>
				{#if data.page > 1}
					<a class="secondary-button" href={pageHref(data.page - 1)}
						><ChevronLeft size={16} /> Previous</a
					>
				{/if}
				{#if data.page < data.pageCount}
					<a class="secondary-button" href={pageHref(data.page + 1)}
						>Next <ChevronRight size={16} /></a
					>
				{/if}
			</div>
		</footer>
	{/if}
</section>

<style>
	.company-panel {
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

	.search-form {
		display: flex;
		gap: 0.65rem;
		padding: 1rem;
		border-bottom: 1px solid var(--line);
	}

	.search-form label {
		display: flex;
		flex: 1;
		align-items: center;
		gap: 0.55rem;
		height: 42px;
		padding: 0 0.8rem;
		border: 1px solid #d4dbd5;
		border-radius: 6px;
		background: #fafcf9;
	}

	.search-form label:focus-within {
		border-color: var(--accent);
		box-shadow: 0 0 0 3px rgb(17 97 73 / 10%);
	}

	.search-form input {
		flex: 1;
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
		overflow-x: auto;
	}

	table {
		width: 100%;
		border-collapse: collapse;
	}

	th,
	td {
		padding: 0.8rem 1rem;
		border-bottom: 1px solid #e8ece8;
		text-align: left;
	}

	th {
		color: var(--muted);
		background: #f8faf7;
		font-size: 0.67rem;
		letter-spacing: 0.06em;
		text-transform: uppercase;
	}

	td {
		color: #516057;
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

	.pagination div {
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

		.status-filter {
			flex-basis: auto !important;
		}
	}
</style>
