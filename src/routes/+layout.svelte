<script lang="ts">
	import {
		Building2,
		ChartNoAxesColumnIncreasing,
		KeyRound,
		Menu,
		Images,
		ShieldCheck,
		Swords,
		Users,
		X
	} from '@lucide/svelte';
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import SessionActivity from '#lib/components/session-activity.svelte';
	import './layout.css';

	let { children, data } = $props();
	let mobileMenuOpen = $state(false);

	const isActive = (path: string, exact = false) =>
		exact ? page.url.pathname === path : page.url.pathname.startsWith(path);

	function closeMobileMenu() {
		mobileMenuOpen = false;
	}

	function handleWindowKeydown(event: KeyboardEvent) {
		if (event.key === 'Escape') closeMobileMenu();
	}
</script>

<svelte:window onkeydown={handleWindowKeydown} />

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
		<a
			class="brand"
			href={resolve('compare')}
			aria-label="Executive Arena home"
			onclick={closeMobileMenu}
		>
			<span class="brand-mark"><Swords size={24} strokeWidth={2.5} /></span>
			<span>
				<strong>Executive Arena</strong>
				<small>Private experiment</small>
			</span>
		</a>
		<button
			class="menu-toggle"
			type="button"
			aria-label={mobileMenuOpen ? 'Close navigation menu' : 'Open navigation menu'}
			aria-controls="primary-navigation"
			aria-expanded={mobileMenuOpen}
			onclick={() => (mobileMenuOpen = !mobileMenuOpen)}
		>
			{#if mobileMenuOpen}<X size={20} />{:else}<Menu size={20} />{/if}
		</button>
		<div class={['header-actions', { open: mobileMenuOpen }]}>
			<nav id="primary-navigation" aria-label="Primary navigation">
				<a
					href={resolve('compare')}
					class={{ active: isActive(resolve('compare'), true) }}
					onclick={closeMobileMenu}><Swords size={16} />Compare</a
				>
				<a
					href={resolve('leaderboard')}
					class={{ active: isActive(resolve('leaderboard')) }}
					onclick={closeMobileMenu}
				>
					<ChartNoAxesColumnIncreasing size={16} />
					Leaderboard
				</a>

				<a
					href={resolve('admin/companies')}
					class={{ active: isActive(resolve('admin/companies')) }}
					onclick={closeMobileMenu}><Building2 size={16} />Companies</a
				>
				<a
					href={resolve('admin/coverage')}
					class={{ active: isActive(resolve('admin/coverage')) }}
					onclick={closeMobileMenu}><Users size={16} />Coverage</a
				>
				<a
					href={resolve('admin/portrait-backfill')}
					class={{ active: isActive(resolve('admin/portrait-backfill')) }}
					onclick={closeMobileMenu}><Images size={16} />Portraits</a
				>
				<a
					href={resolve('admin/api-keys')}
					class={{ active: isActive(resolve('admin/api-keys')) }}
					onclick={closeMobileMenu}><KeyRound size={16} />API Keys</a
				>
			</nav>
			<form method="POST" action="/auth/logout">
				<button class="quiet-button" type="submit"><ShieldCheck size={16} /> Sign out</button>
			</form>
		</div>
	</header>
{/if}

<main class={{ authenticated: data.authenticated }}>
	{@render children()}
</main>
