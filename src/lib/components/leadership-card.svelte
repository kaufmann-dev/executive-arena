<script lang="ts">
	import { ArrowUpRight, GraduationCap, MapPin, Sparkles, Trophy } from '@lucide/svelte';
	import { formatDataLabel } from '$lib/format-label';
	import type { LeadershipCard } from '$lib/server/arena/types';

	let {
		card,
		presentationId,
		side
	}: { card: LeadershipCard; presentationId: string; side: 'left' | 'right' } = $props();

	const categoryIcon = (category: string) => {
		const normalized = category.toLowerCase();
		if (normalized.includes('education') || normalized.includes('school')) return GraduationCap;
		if (
			normalized.includes('origin') ||
			normalized.includes('birth') ||
			normalized.includes('upbringing')
		)
			return MapPin;
		if (normalized.includes('achievement') || normalized.includes('career')) return Trophy;
		return Sparkles;
	};
</script>

<article class="leadership-card">
	<header>
		<div>
			<p class="ticker">{card.ticker}</p>
			<h2>{card.companyName}</h2>
		</div>
		<span class="side-label">{side === 'left' ? 'A' : 'B'}</span>
	</header>

	<div class="leaders" class:multiple={card.leaders.length > 1}>
		{#each card.leaders as leader (leader.id)}
			<section class="leader">
				<div
					class="portrait-gallery"
					class:one={leader.portraits.length === 1}
					class:two={leader.portraits.length === 2}
					class:three={leader.portraits.length === 3}
					aria-label={`Portraits of ${leader.name}`}
				>
					{#each leader.portraits as portrait (portrait.id)}
						<a
							class="portrait-link"
							href={portrait.source.url}
							target="_blank"
							rel="external noreferrer"
							title={`Portrait source: ${portrait.source.publisher}`}
						>
							<img src={`/media/portraits/${portrait.id}`} alt={portrait.altText} />
						</a>
					{/each}
				</div>
				<div class="identity">
					<h3>{leader.name}</h3>
					<p>
						{leader.isInterim ? 'Interim ' : ''}{leader.title}
						{#if leader.roleSources[0]}
							<a
								href={leader.roleSources[0].url}
								target="_blank"
								rel="external noreferrer"
								aria-label={`Source for ${leader.name}'s role: ${leader.roleSources[0].title}`}
							>
								<ArrowUpRight size={13} />
							</a>
						{/if}
					</p>
				</div>
				<p class="summary">{leader.summary}</p>
				<div class="summary-sources" aria-label="Summary sources">
					<span>Sources</span>
					{#each leader.summarySources as source (source.id)}
						<a href={source.url} target="_blank" rel="external noreferrer">
							{source.publisher}<ArrowUpRight size={11} />
						</a>
					{/each}
				</div>

				{#if leader.facts.length > 0}
					<ul class="facts">
						{#each leader.facts as fact (fact.id)}
							{@const Icon = categoryIcon(fact.category)}
							<li>
								<span class="fact-icon"><Icon size={16} aria-hidden="true" /></span>
								<span>
									<small>{formatDataLabel(fact.category)}</small>
									{fact.value}
								</span>
								<span class="fact-sources">
									{#each fact.sources as source (source.id)}
										<a
											href={source.url}
											target="_blank"
											rel="external noreferrer"
											aria-label={`Source for ${formatDataLabel(fact.category)}: ${source.title}`}
											title={`${source.publisher}: ${source.title}`}
										>
											<ArrowUpRight size={14} />
										</a>
									{/each}
								</span>
							</li>
						{/each}
					</ul>
				{/if}
			</section>
		{/each}
	</div>

	{#if card.description}
		<p class="company-description">{card.description}</p>
	{/if}

	<form method="POST">
		<input type="hidden" name="presentationId" value={presentationId} />
		<input type="hidden" name="winnerSlateId" value={card.slateId} />
		<button class="choice-button" type="submit">
			<span>Choose {card.leaders.length > 1 ? 'this team' : card.leaders[0]?.name}</span>
		</button>
	</form>
</article>

<style>
	.leadership-card {
		display: flex;
		position: relative;
		flex-direction: column;
		min-width: 0;
		overflow: hidden;
		border: 1px solid var(--line);
		border-radius: 10px;
		background: var(--paper);
	}

	.leadership-card:has(.choice-button:hover),
	.leadership-card:has(.choice-button:focus-visible) {
		border-color: #9f9f9f;
		box-shadow: 0 12px 30px rgb(0 0 0 / 10%);
	}

	header {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 1rem;
		padding: 1.3rem 1.4rem 1.05rem;
		border-bottom: 1px solid #e9e9e9;
		background: var(--paper-soft);
	}

	.ticker {
		margin-bottom: 0.3rem;
		color: var(--accent);
		font-size: 0.71rem;
		font-weight: 850;
		letter-spacing: 0.13em;
	}

	header h2 {
		margin: 0;
		font-family: inherit;
		font-size: 1.45rem;
		font-weight: 500;
		letter-spacing: -0.03em;
	}

	.side-label {
		display: grid;
		flex: 0 0 34px;
		width: 34px;
		height: 34px;
		place-items: center;
		border: 1px solid #d4d4d4;
		border-radius: 5px;
		color: var(--muted);
		background: white;
		font-family: inherit;
		font-weight: 700;
	}

	.leaders.multiple {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
	}

	.leader {
		display: flex;
		flex-direction: column;
		min-width: 0;
		border-bottom: 1px solid #eeeeee;
	}

	.leaders.multiple .leader + .leader {
		border-left: 1px solid #eeeeee;
	}

	.portrait-gallery {
		display: grid;
		position: relative;
		z-index: 3;
		gap: 3px;
		width: 100%;
		height: clamp(250px, 27vw, 390px);
		overflow: hidden;
		background: #e3e3e3;
	}

	.portrait-gallery.one {
		grid-template-columns: 1fr;
	}

	.portrait-gallery.two {
		grid-template-columns: repeat(2, minmax(0, 1fr));
	}

	.portrait-gallery.three {
		grid-template-rows: repeat(2, minmax(0, 1fr));
		grid-template-columns: minmax(0, 2fr) minmax(0, 1fr);
	}

	.portrait-gallery.three .portrait-link:first-child {
		grid-row: 1 / 3;
	}

	.portrait-link {
		display: block;
		min-width: 0;
		min-height: 0;
		overflow: hidden;
		background: #e9e9e9;
	}

	.portrait-link img {
		display: block;
		width: 100%;
		height: 100%;
		object-fit: cover;
		object-position: center top;
		background: #e9e9e9;
		transition: transform 180ms ease;
	}

	.portrait-link:hover img {
		transform: scale(1.018);
	}

	.identity {
		padding: 1rem 1.35rem 0;
	}

	.identity h3 {
		margin: 0 0 0.25rem;
		font-size: 1.1rem;
		letter-spacing: -0.02em;
	}

	.identity p {
		display: flex;
		align-items: center;
		gap: 0.25rem;
		margin: 0;
		color: var(--accent);
		font-size: 0.77rem;
		font-weight: 750;
	}

	.identity p a {
		display: inline-flex;
		color: var(--accent);
	}

	.summary {
		margin: 1rem 1.35rem 0;
		color: #4a4a4a;
		font-size: 0.88rem;
		line-height: 1.65;
	}

	.summary-sources {
		display: flex;
		position: relative;
		z-index: 3;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.35rem 0.55rem;
		margin: 0.65rem 1.35rem 0;
		color: var(--muted);
		font-size: 0.64rem;
	}

	.summary-sources > span {
		font-weight: 800;
		letter-spacing: 0.07em;
		text-transform: uppercase;
	}

	.summary-sources a {
		display: inline-flex;
		align-items: center;
		gap: 0.15rem;
		color: var(--accent);
		font-weight: 700;
	}

	.facts {
		display: grid;
		position: relative;
		z-index: 3;
		gap: 0.55rem;
		margin: 1rem 1.35rem 1.35rem;
		padding: 0;
		list-style: none;
	}

	.facts li {
		display: grid;
		grid-template-columns: 20px 1fr auto;
		align-items: start;
		gap: 0.5rem;
		padding: 0.65rem 0.7rem;
		border-radius: 6px;
		color: #4a4a4a;
		background: #f6f6f6;
		font-size: 0.78rem;
		line-height: 1.4;
	}

	.fact-icon {
		display: inline-flex;
		margin-top: 0.1rem;
		color: var(--warm);
	}

	.facts small {
		display: block;
		margin-bottom: 0.12rem;
		color: var(--muted);
		font-size: 0.61rem;
		font-weight: 800;
		letter-spacing: 0.08em;
		text-transform: uppercase;
	}

	.facts a {
		display: grid;
		width: 25px;
		height: 25px;
		place-items: center;
		border-radius: 7px;
		color: var(--accent);
		background: white;
	}

	.fact-sources {
		display: flex;
		flex-wrap: wrap;
		gap: 0.2rem;
	}

	.company-description {
		flex: 1;
		margin: 0;
		padding: 1rem 1.35rem;
		color: var(--muted);
		font-size: 0.78rem;
		line-height: 1.55;
	}

	form {
		padding: 0 1.35rem 1.35rem;
	}

	.choice-button {
		width: 100%;
		min-height: 48px;
		border: 0;
		border-radius: 7px;
		color: white;
		background: var(--accent);
		font-weight: 800;
		cursor: pointer;
	}

	.choice-button::before {
		position: absolute;
		z-index: 1;
		inset: 0;
		content: '';
		cursor: pointer;
	}

	.choice-button:hover::before {
		background: rgb(23 96 71 / 2%);
	}

	.choice-button span {
		position: relative;
		z-index: 2;
	}

	.leadership-card a {
		position: relative;
		z-index: 3;
	}

	.choice-button:hover {
		background: var(--accent-dark);
	}

	@media (max-width: 560px) {
		.portrait-gallery {
			height: clamp(220px, 68vw, 330px);
		}
	}
</style>
