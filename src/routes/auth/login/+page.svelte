<script lang="ts">
	import { resolve } from '$app/paths';
	import AuthScreen from '#lib/components/auth-screen.svelte';
</script>

<svelte:head>
	<title>Sign in · Executive Arena</title>
	<meta
		name="description"
		content="Sign in to the private Executive Arena leadership-ranking experiment."
	/>
</svelte:head>

<AuthScreen
	eyebrow="Private experiment"
	title="Welcome to Executive Arena"
	description="Sign in through Pocket ID to compare company leadership, review rankings, and manage research coverage."
	actionHref={resolve('auth/login/start')}
	actionLabel="Sign in with Pocket ID"
	showComplianceLinks
/>
