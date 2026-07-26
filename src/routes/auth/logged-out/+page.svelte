<script lang="ts">
	import { resolve } from '$app/paths';
</script>

<svelte:head>
	<title>Signed out · Executive Arena</title>
</svelte:head>

<div class="flex min-h-svh items-center justify-center bg-zinc-950 p-4 text-zinc-100">
	<section
		class="w-full max-w-sm rounded-2xl border border-zinc-800 bg-zinc-900 p-8 text-center shadow-2xl"
	>
		<p class="text-xs font-semibold tracking-[0.24em] text-amber-400 uppercase">Executive Arena</p>
		<h1 class="mt-3 text-2xl font-semibold">Signed out</h1>
		<p class="mt-2 text-sm leading-6 text-zinc-400">
			Your local session and identity-provider session have ended.
		</p>
		<a
			class="mt-6 inline-flex w-full items-center justify-center rounded-lg bg-amber-400 px-4 py-2.5 text-sm font-semibold text-zinc-950 transition hover:bg-amber-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-400"
			href={resolve('/auth/login')}
			data-sveltekit-preload-data="off"
			data-sveltekit-reload
		>
			Sign in
		</a>
	</section>
</div>
