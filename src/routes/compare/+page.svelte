<script lang="ts">
	import { GitBranch, LockKeyhole, Scale, Sparkles } from '@lucide/svelte';
	import { resolve } from '$app/paths';
	import LeadershipCard from '$lib/components/leadership-card.svelte';

	let { data, form } = $props();
</script>

<svelte:head><title>Compare · Executive Arena</title></svelte:head>

<section class="page-heading">
	<div>
		<p class="eyebrow">Head-to-head</p>
		<h1>Who do you prefer?</h1>
		<p class="lede">
			Choose the leadership slate you like more. Every decision immediately reshapes the full
			Bradley–Terry ranking.
		</p>
	</div>
	{#if data.kind === 'ready'}
		<div class="phase">
			<GitBranch size={15} />
			<span>{data.phase}</span>
		</div>
	{/if}
</section>

{#if form?.message}
	<div class="error-banner" role="alert">{form.message}</div>
{/if}

{#if data.kind === 'locked'}
	<section class="panel locked">
		<span class="lock-icon"><LockKeyhole size={28} /></span>
		<p class="eyebrow">Launch gate</p>
		<h2>The arena is not ready yet</h2>
		<p>{data.reason}</p>
		<div class="readiness">
			<div>
				<span>Profile readiness</span>
				<strong>{data.summary.percent}%</strong>
			</div>
			<div class="bar"><span style={`width: ${data.summary.percent}%`}></span></div>
			<small>
				{data.summary.ready.toLocaleString()} of {data.summary.total.toLocaleString()} included companies
				are complete
			</small>
		</div>
		<a class="primary-button" href={resolve('/admin/coverage')}>View coverage</a>
	</section>
{:else}
	<section class="comparison-grid">
		<LeadershipCard card={data.cards[0]} presentationId={data.presentationId} side="left" />
		<div class="versus" aria-hidden="true"><span>VS</span></div>
		<LeadershipCard card={data.cards[1]} presentationId={data.presentationId} side="right" />
	</section>

	<footer class="comparison-footer">
		<span><Scale size={14} /> {data.summary.comparisons.toLocaleString()} decisions recorded</span>
		<span
			><Sparkles size={14} />
			{data.summary.coveredCompanies.toLocaleString()} of {data.summary.total.toLocaleString()}
			companies encountered</span
		>
		<span><GitBranch size={14} /> Minimum {data.summary.minimumAppearances} appearances</span>
		<span>
			{data.summary.connected ? 'Comparison graph connected' : 'Comparison graph disconnected'}
		</span>
	</footer>
{/if}

<style>
	.phase {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		padding: 0.55rem 0.7rem;
		border: 1px solid #d5dfd8;
		border-radius: 6px;
		color: var(--muted);
		background: var(--paper);
		font-size: 0.68rem;
		font-weight: 800;
		letter-spacing: 0.07em;
		text-transform: uppercase;
	}

	.error-banner {
		margin-bottom: 1rem;
		padding: 0.8rem 1rem;
		border: 1px solid #e9bbb6;
		border-radius: 7px;
		color: #7d302a;
		background: #fbecea;
		font-size: 0.83rem;
	}

	.comparison-grid {
		display: grid;
		grid-template-columns: minmax(0, 1fr) 44px minmax(0, 1fr);
		align-items: start;
	}

	.versus {
		display: grid;
		position: sticky;
		z-index: 2;
		top: 140px;
		height: 100px;
		place-items: center;
	}

	.versus span {
		color: var(--muted);
		font-size: 0.76rem;
		font-weight: 800;
	}

	.comparison-footer {
		display: flex;
		justify-content: center;
		gap: 1.5rem;
		margin-top: 1rem;
		color: var(--muted);
		font-size: 0.7rem;
		font-weight: 650;
	}

	.comparison-footer span {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
	}

	.locked {
		max-width: 680px;
		margin: 4rem auto;
		padding: 3rem;
		text-align: center;
	}

	.lock-icon {
		display: inline-flex;
		margin: 0 auto 1.2rem;
		color: var(--accent);
	}

	.locked h2 {
		margin-bottom: 0.5rem;
		font-family: Georgia, 'Times New Roman', serif;
		font-size: 2rem;
		font-weight: 500;
	}

	.locked > p:not(.eyebrow) {
		color: var(--muted);
	}

	.readiness {
		max-width: 430px;
		margin: 1.5rem auto;
		padding: 1rem;
		border-radius: 7px;
		background: #f4f7f3;
		text-align: left;
	}

	.readiness > div:first-child {
		display: flex;
		justify-content: space-between;
		margin-bottom: 0.6rem;
		font-size: 0.76rem;
	}

	.readiness strong {
		color: var(--accent);
	}

	.bar {
		height: 8px;
		overflow: hidden;
		border-radius: 999px;
		background: #dfe6e0;
	}

	.bar span {
		display: block;
		height: 100%;
		border-radius: inherit;
		background: var(--accent);
	}

	.readiness small {
		display: block;
		margin-top: 0.6rem;
		color: var(--muted);
		font-size: 0.68rem;
	}

	@media (max-width: 900px) {
		.comparison-grid {
			grid-template-columns: 1fr;
			gap: 0;
		}

		.versus {
			position: relative;
			top: auto;
			height: 60px;
		}
	}

	@media (max-width: 560px) {
		.comparison-footer {
			align-items: center;
			flex-direction: column;
			gap: 0.45rem;
		}

		.locked {
			margin: 1rem auto;
			padding: 1.5rem;
		}
	}
</style>
