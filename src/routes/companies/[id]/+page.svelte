<script lang="ts">
	import { ArrowLeft, ArrowUpRight, Building2, CalendarDays, Pencil } from '@lucide/svelte';
	import { resolve } from '$app/paths';
	import { formatDataLabel } from '$lib/format-label';

	let { data } = $props();
</script>

<svelte:head><title>{data.card.companyName} · Executive Arena</title></svelte:head>

<div class="back-row">
	<a href={resolve('/leaderboard')}><ArrowLeft size={15} /> Back to leaderboard</a>
	<a class="secondary-button" href={resolve('/admin/companies/[id]', { id: data.card.companyId })}
		><Pencil size={15} /> Edit profile</a
	>
</div>

<section class="hero panel">
	<div>
		<p class="eyebrow">{data.card.ticker}</p>
		<h1>{data.card.companyName}</h1>
		<p class="lede">{data.card.description}</p>
		<div class="meta">
			<span><CalendarDays size={15} /> Leadership as of {data.card.effectiveAt}</span>
			{#if data.card.homepageUrl}
				<a href={data.card.homepageUrl} target="_blank" rel="external noreferrer"
					><Building2 size={15} /> Company website <ArrowUpRight size={13} /></a
				>
			{/if}
		</div>
	</div>
	<div class="listings">
		<p>Listed securities</p>
		{#each data.listings as listing (listing.id)}
			<span class:canonical={listing.isCanonical}>
				{listing.ticker}
				<small>{listing.primaryExchange ?? '—'}</small>
			</span>
		{/each}
	</div>
</section>

<section class="profile-grid">
	{#each data.card.leaders as leader (leader.id)}
		{@const primaryPortrait = leader.portraits[0]}
		<article class="profile panel">
			<div class="portrait-wrap">
				{#if primaryPortrait}
					<a
						href={primaryPortrait.source.url}
						target="_blank"
						rel="external noreferrer"
						title={`Portrait source: ${primaryPortrait.source.publisher}`}
					>
						<img src={`/media/portraits/${primaryPortrait.id}`} alt={primaryPortrait.altText} />
					</a>
				{/if}
				<div>
					<p>{formatDataLabel(leader.roleKind)}</p>
					<h2>{leader.name}</h2>
					<span>
						{leader.isInterim ? 'Interim ' : ''}{leader.title}
						{#if leader.roleSources[0]}
							<a
								href={leader.roleSources[0].url}
								target="_blank"
								rel="external noreferrer"
								aria-label={`Source for ${leader.name}'s role`}
							>
								<ArrowUpRight size={12} />
							</a>
						{/if}
					</span>
				</div>
			</div>
			<p class="summary">{leader.summary}</p>
			<div class="summary-sources">
				<strong>Summary sources</strong>
				{#each leader.summarySources as source (source.id)}
					<a href={source.url} target="_blank" rel="external noreferrer">
						{source.publisher}<ArrowUpRight size={11} />
					</a>
				{/each}
			</div>
			{#if leader.facts.length > 0}
				<dl>
					{#each leader.facts as fact (fact.id)}
						<div>
							<dt>{formatDataLabel(fact.category)}</dt>
							<dd>
								{fact.value}
								<span class="fact-sources">
									{#each fact.sources as source (source.id)}
										<a href={source.url} target="_blank" rel="noreferrer">
											{source.publisher}<ArrowUpRight size={12} />
										</a>
									{/each}
								</span>
							</dd>
						</div>
					{/each}
				</dl>
			{/if}
		</article>
	{/each}
</section>

<style>
	.back-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: 1.2rem;
	}

	.back-row > a:first-child {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		color: var(--muted);
		font-size: 0.8rem;
		font-weight: 700;
		text-decoration: none;
	}

	.hero {
		display: grid;
		grid-template-columns: 1fr auto;
		gap: 2rem;
		padding: 2rem;
		background: var(--paper);
	}

	.hero h1 {
		font-size: clamp(2.2rem, 5vw, 3.3rem);
	}

	.meta {
		display: flex;
		flex-wrap: wrap;
		gap: 0.65rem 1.2rem;
		margin-top: 1.25rem;
		color: var(--muted);
		font-size: 0.77rem;
	}

	.meta span,
	.meta a {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
	}

	.listings {
		display: flex;
		align-content: flex-start;
		justify-content: flex-end;
		flex-wrap: wrap;
		gap: 0.45rem;
		max-width: 280px;
	}

	.listings p {
		flex-basis: 100%;
		margin-bottom: 0.2rem;
		color: var(--muted);
		font-size: 0.66rem;
		font-weight: 800;
		letter-spacing: 0.08em;
		text-align: right;
		text-transform: uppercase;
	}

	.listings > span {
		display: grid;
		min-width: 68px;
		padding: 0.55rem;
		border: 1px solid var(--line);
		border-radius: 10px;
		background: #f9fbf8;
		font-size: 0.78rem;
		font-weight: 800;
		text-align: center;
	}

	.listings > span.canonical {
		border-color: #9bc8b6;
		color: var(--accent);
		background: var(--accent-pale);
	}

	.listings small {
		margin-top: 0.15rem;
		color: var(--muted);
		font-size: 0.57rem;
		font-weight: 600;
	}

	.profile-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(min(100%, 440px), 1fr));
		gap: 1.25rem;
		margin-top: 1.25rem;
	}

	.profile {
		padding: 1.4rem;
	}

	.portrait-wrap {
		display: flex;
		align-items: flex-end;
		gap: 1.2rem;
	}

	.portrait-wrap > a {
		flex: none;
	}

	.portrait-wrap img {
		display: block;
		width: 140px;
		height: 170px;
		object-fit: cover;
		border-radius: 7px;
	}

	.portrait-wrap p {
		margin-bottom: 0.3rem;
		color: var(--accent);
		font-size: 0.66rem;
		font-weight: 850;
		letter-spacing: 0.11em;
		text-transform: uppercase;
	}

	.portrait-wrap h2 {
		margin-bottom: 0.3rem;
		font-family: Georgia, 'Times New Roman', serif;
		font-size: 1.9rem;
		font-weight: 500;
		letter-spacing: -0.03em;
	}

	.portrait-wrap span {
		display: flex;
		align-items: center;
		gap: 0.25rem;
		color: var(--muted);
		font-size: 0.79rem;
	}

	.portrait-wrap span a {
		display: inline-flex;
		color: var(--accent);
	}

	.summary {
		margin: 1.3rem 0;
		color: #45534c;
		font-size: 0.9rem;
		line-height: 1.7;
	}

	.summary-sources,
	.fact-sources {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.35rem 0.55rem;
	}

	.summary-sources {
		margin: -0.75rem 0 1.3rem;
		color: var(--muted);
		font-size: 0.65rem;
	}

	.summary-sources strong {
		letter-spacing: 0.06em;
		text-transform: uppercase;
	}

	.summary-sources a {
		display: inline-flex;
		align-items: center;
		gap: 0.15rem;
		color: var(--accent);
		font-weight: 700;
	}

	dl {
		display: grid;
		gap: 0;
		margin: 0;
		border-top: 1px solid #e7ebe7;
	}

	dl div {
		display: grid;
		grid-template-columns: 125px 1fr;
		gap: 1rem;
		padding: 0.8rem 0;
		border-bottom: 1px solid #e7ebe7;
	}

	dt {
		color: var(--muted);
		font-size: 0.68rem;
		font-weight: 800;
		letter-spacing: 0.06em;
		text-transform: uppercase;
	}

	dd {
		margin: 0;
		color: #45534c;
		font-size: 0.8rem;
		line-height: 1.5;
	}

	dd a {
		display: inline-flex;
		align-items: center;
		gap: 0.2rem;
		margin-left: 0.4rem;
		color: var(--accent);
		font-size: 0.66rem;
		font-weight: 700;
	}

	.fact-sources {
		display: inline-flex;
		margin-left: 0.3rem;
	}

	@media (max-width: 700px) {
		.hero {
			grid-template-columns: 1fr;
			padding: 1.35rem;
		}

		.listings {
			justify-content: flex-start;
			max-width: none;
		}

		.listings p {
			text-align: left;
		}
	}

	@media (max-width: 480px) {
		.portrait-wrap {
			align-items: flex-start;
		}

		.portrait-wrap img {
			width: 96px;
			height: 118px;
		}

		dl div {
			grid-template-columns: 1fr;
			gap: 0.25rem;
		}
	}
</style>
