<script lang="ts">
	import { CheckCircle2, LockKeyhole, ShieldAlert } from '@lucide/svelte';
	import { resolve } from '$app/paths';

	let { data, form } = $props();
</script>

<svelte:head><title>Coverage · Executive Arena</title></svelte:head>

<section class="page-heading">
	<div>
		<p class="eyebrow">Cohort control</p>
		<h1>Coverage</h1>
		<p class="lede">
			The arena opens only when every included company has a complete, portrait-bearing leadership
			slate.
		</p>
	</div>
	<span
		class:ready={data.summary.ready === data.summary.total && data.summary.total >= 2}
		class="launch-state"
	>
		<LockKeyhole size={16} />
		{data.summary.ready === data.summary.total && data.summary.total >= 2
			? 'Arena ready'
			: 'Launch gate locked'}
	</span>
</section>

{#if data.notice === 'cohort-frozen'}
	<p class="notice success">
		<CheckCircle2 size={17} /> Cohort frozen. The first choice will create the leaderboard.
	</p>
{/if}
{#if form?.message}
	<p class="notice error"><ShieldAlert size={17} /> {form.message}</p>
{/if}

<section class="panel coverage-overview">
	<div class="hero-metric">
		<div class="ring" style={`--progress: ${data.summary.percent * 3.6}deg`}>
			<span>{data.summary.percent}%</span>
		</div>
		<div>
			<p>Profile readiness</p>
			<strong>{data.summary.ready.toLocaleString()} of {data.summary.total.toLocaleString()}</strong
			>
			<small>{data.summary.pending.toLocaleString()} profiles still block the launch gate</small>
		</div>
	</div>
	<dl class="metrics">
		{@render Metric('Included companies', data.summary.total.toLocaleString())}
		{@render Metric('Pending profiles', data.summary.pending.toLocaleString())}
		{@render Metric('Needs review', data.summary.needsReview.toLocaleString())}
		{@render Metric('Excluded records', data.summary.excluded.toLocaleString())}
		{@render Metric('Comparisons', data.summary.comparisons.toLocaleString())}
		{@render Metric(
			'Companies encountered',
			`${data.summary.coveredCompanies.toLocaleString()} / ${data.summary.total.toLocaleString()}`
		)}
		{@render Metric('Minimum appearances', data.summary.minimumAppearances.toLocaleString())}
		{@render Metric('Comparison graph', data.summary.connected ? 'Connected' : 'Disconnected')}
		{@render Metric('Cohort revision', `r${data.summary.revision}`)}
	</dl>
</section>

<section class="panel freeze-panel">
	<div>
		<h2>{data.summary.frozenAt ? 'Cohort frozen' : 'Freeze complete cohort'}</h2>
		<p>
			{data.summary.frozenAt
				? `Frozen ${new Intl.DateTimeFormat('en-US', { dateStyle: 'long', timeStyle: 'short' }).format(new Date(data.summary.frozenAt))}. Later explicit additions, exclusions, or leadership replacements create a new revision.`
				: 'Freezing is available only after every included issuer has one fully cited, portrait-bearing active slate.'}
		</p>
	</div>
	{#if !data.summary.frozenAt}
		<form method="POST" action="?/freeze">
			<button
				class="primary-button"
				type="submit"
				disabled={data.summary.ready !== data.summary.total || data.summary.total < 2}
			>
				<LockKeyhole size={16} /> Freeze cohort
			</button>
		</form>
	{:else}
		<a class="primary-button" href={resolve('/compare')}>Open arena</a>
	{/if}
</section>

<section class="panel status-panel">
	<header>
		<div>
			<h2>Company status</h2>
			<p>First 25 companies in the current universe.</p>
		</div>
		<a class="secondary-button" href={resolve('/admin/companies')}>Manage all companies</a>
	</header>
	<div class="rows">
		{#each data.companies as company (company.id)}
			<a href={resolve('/admin/companies/[id]', { id: company.id })}>
				<span class="ticker">{company.ticker}</span>
				<strong>{company.name}</strong>
				<span class={`pill ${company.readinessStatus}`}>{company.readinessStatus}</span>
			</a>
		{/each}
	</div>
</section>

{#snippet Metric(label: string, value: string)}
	<div class="metric">
		<dt>{label}</dt>
		<dd>{value}</dd>
	</div>
{/snippet}

<style>
	.notice {
		display: flex;
		align-items: center;
		gap: 0.55rem;
		margin-bottom: 1rem;
		padding: 0.85rem 1rem;
		border-radius: 7px;
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

	.launch-state {
		display: inline-flex;
		align-items: center;
		gap: 0.45rem;
		padding: 0.65rem 0.8rem;
		border-radius: 6px;
		color: #82473e;
		background: #f7e3e1;
		font-size: 0.76rem;
		font-weight: 800;
	}

	.launch-state.ready {
		color: #09533c;
		background: var(--accent-pale);
	}

	.coverage-overview {
		display: grid;
		grid-template-columns: minmax(280px, 0.8fr) minmax(0, 2fr);
		overflow: hidden;
	}

	.hero-metric {
		display: flex;
		align-items: center;
		gap: 1.2rem;
		padding: 1.5rem;
		border-right: 1px solid var(--line);
		background: var(--paper-soft);
	}

	.ring {
		display: grid;
		flex: 0 0 104px;
		width: 104px;
		height: 104px;
		place-items: center;
		border-radius: 50%;
		background: conic-gradient(var(--accent) var(--progress), #e9eeea 0);
	}

	.ring::before {
		position: absolute;
		width: 78px;
		height: 78px;
		border-radius: 50%;
		background: white;
		content: '';
	}

	.ring span {
		z-index: 1;
		font-family: Georgia, 'Times New Roman', serif;
		font-size: 1.5rem;
		font-weight: 700;
	}

	.hero-metric p,
	.metric dt {
		margin-bottom: 0.35rem;
		color: var(--muted);
		font-size: 0.72rem;
		font-weight: 700;
	}

	.hero-metric strong,
	.metric dd {
		display: block;
		margin: 0;
		font-family: Georgia, 'Times New Roman', serif;
		font-size: 1.25rem;
		font-weight: 600;
	}

	.hero-metric small {
		display: block;
		max-width: 230px;
		margin-top: 0.45rem;
		color: var(--muted);
		font-size: 0.72rem;
		line-height: 1.45;
	}

	.metrics {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		margin: 0;
	}

	.metric {
		min-width: 0;
		padding: 1.15rem;
		border-right: 1px solid var(--line);
		border-bottom: 1px solid var(--line);
	}

	.status-panel {
		margin-top: 1rem;
		overflow: hidden;
	}

	.freeze-panel {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		margin-top: 1rem;
		padding: 1.25rem;
	}

	.freeze-panel h2 {
		margin-bottom: 0.35rem;
		font-family: Georgia, 'Times New Roman', serif;
		font-size: 1.35rem;
		font-weight: 500;
	}

	.freeze-panel p:last-child {
		max-width: 760px;
		margin: 0;
		color: var(--muted);
		font-size: 0.78rem;
		line-height: 1.6;
	}

	.freeze-panel button:disabled {
		cursor: not-allowed;
		opacity: 0.45;
	}

	.status-panel > header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		padding: 1.2rem;
		border-bottom: 1px solid var(--line);
	}

	.status-panel h2 {
		margin-bottom: 0.2rem;
		font-family: Georgia, 'Times New Roman', serif;
		font-size: 1.35rem;
		font-weight: 500;
	}

	.status-panel header p {
		margin: 0;
		color: var(--muted);
		font-size: 0.76rem;
	}

	.rows a {
		display: grid;
		grid-template-columns: 74px 1fr auto;
		align-items: center;
		gap: 0.8rem;
		padding: 0.78rem 1.2rem;
		border-bottom: 1px solid #e9ece9;
		text-decoration: none;
	}

	.rows a:hover {
		background: #f9fbf8;
	}

	.rows .ticker {
		color: var(--accent);
		font-size: 0.7rem;
		font-weight: 850;
		letter-spacing: 0.08em;
	}

	.rows strong {
		font-size: 0.82rem;
	}

	@media (max-width: 1050px) {
		.coverage-overview {
			grid-template-columns: 1fr;
		}

		.hero-metric {
			border-right: 0;
			border-bottom: 1px solid var(--line);
		}
	}

	@media (max-width: 670px) {
		.metrics {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
	}

	@media (max-width: 460px) {
		.hero-metric {
			align-items: flex-start;
			flex-direction: column;
		}

		.freeze-panel,
		.status-panel > header {
			align-items: flex-start;
			flex-direction: column;
		}
	}
</style>
