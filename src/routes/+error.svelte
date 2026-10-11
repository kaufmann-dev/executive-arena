<script lang="ts">
	import { RotateCcw } from '@lucide/svelte';
	import { page } from '$app/state';
	import { resolve } from '$app/paths';

	// SvelteKit's generic messages ("Not Found", "Internal Error", ...) add nothing to the title.
	const detail = $derived.by(() => {
		const message = page.error?.message;
		const generic = ['Not Found', 'Forbidden', 'Internal Error', `Error: ${page.status}`];
		return message && !generic.includes(message) ? message : null;
	});

	const content = $derived.by(() => {
		if (page.status === 404)
			return {
				title: 'Page not found',
				description:
					detail ?? "This page doesn't exist. It may have been moved, or the address has a typo."
			};
		if (page.status === 403)
			return {
				title: 'Access denied',
				description: detail ?? "You don't have permission to view this page."
			};
		if (page.status < 500)
			return {
				title: 'Request could not be completed',
				description: detail ?? 'The request was invalid.'
			};
		return {
			title: 'Something went wrong',
			description: 'An unexpected error occurred. Try again in a moment.'
		};
	});
</script>

<svelte:head>
	<title>{content.title} · Executive Arena</title>
</svelte:head>

<section class="error-page">
	<div class="panel empty-state">
		<p class="eyebrow">Error {page.status}</p>
		<h1>{content.title}</h1>
		<p>{content.description}</p>
		<div class="actions">
			{#if page.status >= 500}
				<button class="primary-button" type="button" onclick={() => location.reload()}>
					<RotateCcw size={16} />
					Try again
				</button>
			{/if}
			<a
				class={page.status >= 500 ? 'secondary-button' : 'primary-button'}
				href={resolve('compare')}
			>
				Back to comparisons
			</a>
		</div>
	</div>
</section>

<style>
	.error-page {
		max-width: 720px;
		margin: 0 auto;
		padding: 4rem 1rem;
	}

	.actions {
		display: flex;
		flex-wrap: wrap;
		justify-content: center;
		gap: 0.6rem;
	}
</style>
