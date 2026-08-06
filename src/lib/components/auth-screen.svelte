<script lang="ts">
	import { ArrowRight, ShieldCheck, Swords } from '@lucide/svelte';
	import type { ResolvedPathname } from '$app/types';

	let {
		eyebrow,
		title,
		description,
		actionHref,
		actionLabel,
		showComplianceLinks = false
	}: {
		eyebrow: string;
		title: string;
		description: string;
		actionHref: ResolvedPathname;
		actionLabel: string;
		showComplianceLinks?: boolean;
	} = $props();
</script>

<div class="auth-shell">
	<section class="auth-card">
		<div class="brand" aria-label="Executive Arena">
			<Swords size={28} strokeWidth={2.4} aria-hidden="true" />
			<div>
				<strong>Executive Arena</strong>
				<span>Private experiment</span>
			</div>
		</div>

		<div class="auth-copy">
			<p class="eyebrow">{eyebrow}</p>
			<h1>{title}</h1>
			<p>{description}</p>
		</div>

		<form method="GET" action={actionHref}>
			<button class="auth-action" type="submit">
				{actionLabel}
				<ArrowRight size={17} aria-hidden="true" />
			</button>
		</form>

		<p class="identity-note">
			<ShieldCheck size={15} aria-hidden="true" />
			Authentication is handled securely by Pocket ID.
		</p>

		{#if showComplianceLinks}
			<nav class="compliance-links" aria-label="Legal">
				<a href="https://legal.kaufmann.dev/imprint?site=executives.kaufmann.dev">Imprint</a>
				<a href="https://legal.kaufmann.dev/privacy?site=executives.kaufmann.dev">Privacy</a>
			</nav>
		{/if}
	</section>
</div>

<style>
	.auth-shell {
		display: grid;
		min-height: 100svh;
		place-items: center;
		padding: clamp(1.25rem, 5vw, 3rem);
		background: #f5f5f5;
	}

	.auth-card {
		width: min(100%, 460px);
		padding: clamp(1.5rem, 5vw, 2.5rem);
		border: 1px solid var(--line);
		border-radius: 14px;
		background: var(--paper);
		box-shadow: 0 20px 60px rgb(0 0 0 / 7%);
	}

	.brand {
		display: inline-flex;
		align-items: center;
		gap: 0.75rem;
		color: var(--accent);
	}

	.brand div,
	.brand strong,
	.brand span {
		display: block;
	}

	.brand strong {
		color: var(--ink);
		font-size: 0.92rem;
		letter-spacing: -0.01em;
	}

	.brand span {
		margin-top: 0.12rem;
		color: var(--muted);
		font-size: 0.65rem;
		font-weight: 650;
		letter-spacing: 0.07em;
		text-transform: uppercase;
	}

	.auth-copy {
		margin: clamp(2.5rem, 8vw, 4rem) 0 1.75rem;
	}

	.eyebrow {
		margin-bottom: 0.65rem;
	}

	h1 {
		margin-bottom: 0.8rem;
		font-size: clamp(2rem, 7vw, 2.65rem);
		font-weight: 650;
		letter-spacing: -0.045em;
		line-height: 1.04;
	}

	.auth-copy > p:last-child {
		margin: 0;
		color: var(--muted);
		font-size: 0.92rem;
		line-height: 1.65;
	}

	.auth-action {
		display: flex;
		width: 100%;
		align-items: center;
		justify-content: space-between;
		min-height: 50px;
		padding: 0.75rem 1rem;
		border: 0;
		border-radius: 7px;
		color: white;
		background: var(--accent);
		font: inherit;
		font-size: 0.87rem;
		font-weight: 750;
		cursor: pointer;
	}

	.auth-action:hover {
		background: var(--accent-dark);
	}

	.identity-note {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		margin: 1rem 0 0;
		color: var(--muted);
		font-size: 0.7rem;
		line-height: 1.45;
	}

	.compliance-links {
		justify-content: center;
		gap: 0.35rem;
		margin-top: 1rem;
		padding-top: 0.75rem;
		border-top: 1px solid var(--line);
	}

	.compliance-links a {
		color: var(--muted);
		font-size: 0.72rem;
		font-weight: 600;
	}

	.compliance-links a:hover {
		color: var(--ink);
	}

	@media (max-width: 520px) {
		.auth-shell {
			place-items: stretch;
			padding: 0;
			background: var(--paper);
		}

		.auth-card {
			display: flex;
			width: 100%;
			min-height: 100svh;
			flex-direction: column;
			justify-content: center;
			border: 0;
			border-radius: 0;
			box-shadow: none;
		}
	}
</style>
