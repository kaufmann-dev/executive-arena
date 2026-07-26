<script lang="ts">
	import {
		Building2,
		ChartNoAxesColumnIncreasing,
		ShieldCheck,
		Swords,
		Users
	} from '@lucide/svelte';
	import { resolve } from '$app/paths';
	import SessionActivity from '$lib/components/session-activity.svelte';
	import './layout.css';

	let { children, data } = $props();
</script>

<svelte:head>
	<title>Executive Arena</title>
	<meta
		name="description"
		content="A private Bradley–Terry experiment for ranking company leadership."
	/>
</svelte:head>

{#if data.authenticated}
	<SessionActivity />
	<header class="site-header">
		<a class="brand" href={resolve('/compare')} aria-label="Executive Arena home">
			<span class="brand-mark"><Swords size={19} strokeWidth={2.2} /></span>
			<span>
				<strong>Executive Arena</strong>
				<small>Private experiment</small>
			</span>
		</a>
		<nav aria-label="Primary navigation">
			<a href={resolve('/compare')}><Swords size={16} /> Compare</a>
			<a href={resolve('/leaderboard')}><ChartNoAxesColumnIncreasing size={16} /> Leaderboard</a>
			<a href={resolve('/admin/companies')}><Building2 size={16} /> Companies</a>
			<a href={resolve('/admin/coverage')}><Users size={16} /> Coverage</a>
		</nav>
		<form method="POST" action="/auth/logout">
			<button class="quiet-button" type="submit"><ShieldCheck size={16} /> Sign out</button>
		</form>
	</header>
{/if}

<main class:authenticated={data.authenticated}>
	{@render children()}
</main>
