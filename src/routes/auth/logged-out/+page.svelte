<script lang="ts">
	import { resolve } from '$app/paths';
	import AuthScreen from '$lib/components/auth-screen.svelte';
</script>

<svelte:head>
	<title>Signed out · Executive Arena</title>
</svelte:head>

<AuthScreen
	eyebrow="Session ended"
	title="You’re signed out"
	description="Your Executive Arena session and Pocket ID session have ended."
	actionHref={resolve('/auth/login')}
	actionLabel="Return to sign in"
/>
