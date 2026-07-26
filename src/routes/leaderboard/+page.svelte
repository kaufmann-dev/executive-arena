<script lang="ts">
	import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, Search } from '@lucide/svelte';
	import { resolve } from '$app/paths';
	import { SvelteURLSearchParams } from 'svelte/reactivity';

	let { data } = $props();

	function sortHref(column: 'rank' | 'company' | 'score' | 'comparisons') {
		const params = new SvelteURLSearchParams();
		if (data.query.q) params.set('q', data.query.q);
		params.set('sort', column);
		const nextDirection =
			data.query.sort === column && data.query.direction === 'asc' ? 'desc' : 'asc';
		params.set('direction', nextDirection);
		return resolve(`/leaderboard?${params.toString()}` as `/leaderboard?${string}`);
	}

	function pageHref(page: number) {
		const params = new SvelteURLSearchParams();
		if (data.query.q) params.set('q', data.query.q);
		params.set('sort', data.query.sort);
		params.set('direction', data.query.direction);
		params.set('page', String(page));
		return resolve(`/leaderboard?${params.toString()}` as `/leaderboard?${string}`);
	}

	function ariaSort(column: string): 'ascending' | 'descending' | 'none' {
		if (data.query.sort !== column) return 'none';
		return data.query.direction === 'asc' ? 'ascending' : 'descending';
	}
</script>

<svelte:head><title>Leaderboard · Executive Arena</title></svelte:head>

<section class="page-heading">
	<div>
		<p class="eyebrow">Personal ranking</p>
		<h1>Leaderboard</h1>
		<p class="lede">
			Bradley–Terry scores reflect every choice you have made. A score of 50 means neutral strength
			against the model baseline.
		</p>
	</div>
	<p class="record-count">{data.total.toLocaleString()} companies</p>
</section>

<section class="panel table-panel">
	<form class="search-form" method="GET">
		<label>
			<span class="sr-only">Search companies, tickers, or executives</span>
			<span class="search-icon"><Search size={17} aria-hidden="true" /></span>
			<input
				name="q"
				value={data.query.q}
				placeholder="Search company, ticker, or executive…"
				maxlength="100"
			/>
		</label>
		<input type="hidden" name="sort" value={data.query.sort} />
		<input type="hidden" name="direction" value={data.query.direction} />
		<button class="secondary-button" type="submit">Search</button>
	</form>

	{#if !data.hasRanking}
		<div class="empty-state">
			<h2>No ranking yet</h2>
			<p>Your first comparison will create the initial leaderboard.</p>
			<a class="primary-button" href={resolve('/compare')}>Start comparing</a>
		</div>
	{:else if data.rows.length === 0}
		<div class="empty-state">
			<h2>No matches</h2>
			<p>Try a different company, ticker, or executive name.</p>
			<a class="secondary-button" href={resolve('/leaderboard')}>Clear search</a>
		</div>
	{:else}
		<div class="table-wrap">
			<table>
				<thead>
					<tr>
						<th aria-sort={ariaSort('rank')}>
							<a href={sortHref('rank')}
								>Rank {@render SortIcon(data.query.sort === 'rank', data.query.direction)}</a
							>
						</th>
						<th aria-sort={ariaSort('company')}>
							<a href={sortHref('company')}
								>Company {@render SortIcon(data.query.sort === 'company', data.query.direction)}</a
							>
						</th>
						<th>Leadership</th>
						<th class="numeric" aria-sort={ariaSort('score')}>
							<a href={sortHref('score')}
								>Score {@render SortIcon(data.query.sort === 'score', data.query.direction)}</a
							>
						</th>
						<th class="numeric record-column">W–L</th>
						<th class="numeric" aria-sort={ariaSort('comparisons')}>
							<a href={sortHref('comparisons')}
								>Compared {@render SortIcon(
									data.query.sort === 'comparisons',
									data.query.direction
								)}</a
							>
						</th>
					</tr>
				</thead>
				<tbody>
					{#each data.rows as row (row.slateId)}
						<tr>
							<td class="rank" title={row.comparisonCount === 0 ? 'Not compared yet' : undefined}>
								{row.comparisonCount === 0 ? '—' : `#${row.rank}`}
							</td>
							<td>
								<a class="company-link" href={resolve('/companies/[id]', { id: row.companyId })}>
									<strong>{row.companyName}</strong>
									<span>{row.ticker}</span>
								</a>
							</td>
							<td>{row.leaderNames.join(' · ')}</td>
							<td class="numeric score">{row.comparisonCount === 0 ? '—' : row.score.toFixed(1)}</td
							>
							<td class="numeric record-column">{row.wins}–{row.losses}</td>
							<td class="numeric">{row.comparisonCount}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>

		<footer class="pagination">
			<p>
				Page {data.query.page.toLocaleString()} of {data.pageCount.toLocaleString()}
			</p>
			<div>
				{#if data.query.page > 1}
					<a class="secondary-button" href={pageHref(data.query.page - 1)}
						><ChevronLeft size={16} /> Previous</a
					>
				{/if}
				{#if data.query.page < data.pageCount}
					<a class="secondary-button" href={pageHref(data.query.page + 1)}
						>Next <ChevronRight size={16} /></a
					>
				{/if}
			</div>
		</footer>
	{/if}
</section>

{#snippet SortIcon(active: boolean, direction: 'asc' | 'desc')}
	{#if active && direction === 'asc'}
		<ArrowUp size={13} aria-hidden="true" />
	{:else}
		<span class:inactive={!active}><ArrowDown size={13} aria-hidden="true" /></span>
	{/if}
{/snippet}

<style>
	.record-count {
		margin: 0;
		color: var(--muted);
		font-size: 0.8rem;
		font-weight: 750;
		white-space: nowrap;
	}

	.table-panel {
		overflow: hidden;
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
		min-width: 0;
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

	.search-icon {
		display: inline-flex;
		flex: none;
		color: var(--muted);
	}

	.search-form input {
		width: 100%;
		border: 0;
		outline: 0;
		background: transparent;
		font-size: 0.86rem;
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
		padding: 0.85rem 1rem;
		border-bottom: 1px solid #e8ece8;
		text-align: left;
		vertical-align: middle;
	}

	th {
		color: #68756d;
		background: #f8faf7;
		font-size: 0.68rem;
		font-weight: 800;
		letter-spacing: 0.06em;
		text-transform: uppercase;
	}

	th a {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
		text-decoration: none;
	}

	th .inactive {
		display: inline-flex;
		opacity: 0.25;
	}

	td {
		color: #526058;
		font-size: 0.82rem;
	}

	tbody tr:hover {
		background: #fbfcfa;
	}

	.numeric {
		text-align: right;
		font-variant-numeric: tabular-nums;
	}

	.rank {
		width: 76px;
		color: var(--accent);
		font-family: Georgia, 'Times New Roman', serif;
		font-size: 1rem;
		font-weight: 700;
	}

	.company-link {
		display: block;
		text-decoration: none;
	}

	.company-link strong,
	.company-link span {
		display: block;
	}

	.company-link strong {
		color: var(--ink);
		font-size: 0.86rem;
	}

	.company-link span {
		margin-top: 0.15rem;
		color: var(--accent);
		font-size: 0.65rem;
		font-weight: 800;
		letter-spacing: 0.08em;
	}

	.score {
		color: var(--ink);
		font-size: 0.9rem;
		font-weight: 800;
	}

	.pagination {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		padding: 1rem;
		background: #fbfcfa;
	}

	.pagination p {
		margin: 0;
		color: var(--muted);
		font-size: 0.78rem;
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

	@media (max-width: 760px) {
		.record-column {
			display: none;
		}

		th,
		td {
			padding: 0.75rem;
		}
	}

	@media (max-width: 520px) {
		.search-form {
			align-items: stretch;
			flex-direction: column;
		}

		.pagination {
			align-items: flex-start;
			flex-direction: column;
		}
	}
</style>
