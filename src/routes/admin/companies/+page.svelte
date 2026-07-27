<script lang="ts">
	import { Building2, ChevronLeft, ChevronRight, Search } from '@lucide/svelte';
	import { resolve } from '$app/paths';
	import { formatDataLabel } from '$lib/format-label';

	let { data } = $props();

	function submitStatusFilter(event: Event) {
		(event.currentTarget as HTMLSelectElement).form?.requestSubmit();
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
			<select name="status" value={data.status} onchange={submitStatusFilter}>
				<option value="all">All statuses</option>
				<option value="not_ready">not ready</option>
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
							<td class="ticker" data-label="Ticker">{company.ticker}</td>
							<td data-label="Company">
								<strong>{company.name}</strong>
								{#if company.exclusionReason}<small
										>{formatDataLabel(company.exclusionReason)}</small
									>{/if}
							</td>
							<td data-label="Status">
								<span class={`pill ${company.readinessStatus}`}>
									{company.included ? company.readinessStatus.replace('_', ' ') : 'excluded'}
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
		</div>

		<footer class="pagination">
			<p>Page {data.page} of {data.pageCount}</p>
			<form method="GET">
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
			display: grid;
			grid-template-columns: minmax(0, 1fr) auto;
			gap: 0.85rem 1rem;
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

		td:nth-child(2) {
			grid-column: 1 / -1;
			grid-row: 1;
		}

		td:nth-child(1) {
			grid-column: 1;
			grid-row: 2;
		}

		td:nth-child(3) {
			grid-column: 2;
			grid-row: 2;
		}

		td:nth-child(4) {
			grid-column: 1;
			grid-row: 3;
		}

		td:nth-child(5) {
			grid-column: 2;
			grid-row: 3;
			align-self: end;
		}

		.numeric,
		.action {
			text-align: left;
		}
	}
</style>
