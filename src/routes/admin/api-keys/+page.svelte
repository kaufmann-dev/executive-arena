<script lang="ts" module>
	function formatDate(value: Date | string): string {
		return new Intl.DateTimeFormat('en-US', {
			dateStyle: 'medium',
			timeStyle: 'short'
		}).format(new Date(value));
	}
</script>

<script lang="ts">
	import { CheckCircle2, Clipboard, KeyRound, ShieldAlert, ShieldCheck } from '@lucide/svelte';
	import { copyTextWithFallback, type CopyMethod } from '$lib/copy-to-clipboard';

	let { data, form } = $props();
	let copyResult = $state<{ token: string; method: CopyMethod | 'copying' } | null>(null);

	async function copyToken(token: string, button: HTMLButtonElement) {
		copyResult = { token, method: 'copying' };
		const tokenField = button
			.closest('.token-row')
			?.querySelector<HTMLInputElement>('.token-value');
		if (!tokenField) {
			copyResult = { token, method: 'manual' };
			return;
		}
		copyResult = {
			token,
			method: await copyTextWithFallback(token, tokenField)
		};
	}
</script>

<svelte:head><title>API Keys · Executive Arena</title></svelte:head>

<section class="page-heading">
	<div>
		<p class="eyebrow">MCP access</p>
		<h1>API Keys</h1>
		<p class="lede">
			Create independent keys for trusted agent clients. Every active key can read research tasks
			and immediately publish executive profiles.
		</p>
	</div>
	<span class="access-badge"><ShieldCheck size={16} /> Full research access</span>
</section>

{#if data.notice === 'key-deleted'}
	<p class="notice success">
		<CheckCircle2 size={17} /> API key deleted. It can no longer authenticate.
	</p>
{/if}
{#if form?.message}
	<p class="notice error"><ShieldAlert size={17} /> {form.message}</p>
{/if}

{#if form?.created}
	<section class="panel token-panel">
		<div>
			<p class="eyebrow">Copy this key now</p>
			<h2>{form.created.name}</h2>
			<p>This token is shown once. The database stores only its SHA-256 digest.</p>
		</div>
		<div class="token-row">
			<input
				class="token-value"
				aria-label="Generated API key"
				readonly
				value={form.created.token}
				onclick={(event) => event.currentTarget.select()}
			/>
			<button
				class="primary-button"
				type="button"
				disabled={copyResult?.token === form.created.token && copyResult.method === 'copying'}
				onclick={(event) => copyToken(form.created.token, event.currentTarget)}
			>
				<Clipboard size={16} />
				{copyResult?.token === form.created.token && copyResult.method === 'copying'
					? 'Copying…'
					: copyResult?.token === form.created.token && copyResult.method === 'manual'
						? 'Press Ctrl+C'
						: copyResult?.token === form.created.token
							? 'Copied'
							: 'Copy key'}
			</button>
		</div>
		<p class="copy-help" aria-live="polite">
			{#if copyResult?.token === form.created.token && copyResult.method === 'manual'}
				Your browser blocked automatic copying. The key is selected; press Ctrl+C or ⌘C.
			{:else if copyResult?.token === form.created.token && copyResult.method !== 'copying'}
				Key copied to the clipboard.
			{/if}
		</p>
	</section>
{/if}

<div class="key-grid">
	<section class="panel create-panel">
		<h2>Create API key</h2>
		<p>
			Use a name that identifies the client or machine. Keys remain active until you delete them.
		</p>
		<form method="POST" action="?/create">
			<label>
				<span>Key name</span>
				<input
					name="name"
					value={form?.action === 'create' && form?.name ? form.name : ''}
					placeholder="Codex on workstation"
					maxlength="100"
					autocomplete="off"
					required
				/>
			</label>
			<button class="primary-button" type="submit"><KeyRound size={16} /> Generate key</button>
		</form>
	</section>

	<section class="panel keys-panel">
		<header>
			<div>
				<h2>Generated keys</h2>
				<p>{data.keys.length.toLocaleString()} retained key records</p>
			</div>
		</header>
		{#if data.keys.length === 0}
			<div class="empty-state">
				<h3>No API keys yet</h3>
				<p>Generate the first key to connect an MCP client.</p>
			</div>
		{:else}
			<div class="table-wrap">
				<table>
					<thead>
						<tr>
							<th>Name</th>
							<th>Prefix</th>
							<th>Created</th>
							<th>Last used</th>
							<th><span class="sr-only">Action</span></th>
						</tr>
					</thead>
					<tbody>
						{#each data.keys as key (key.id)}
							<tr>
								<td data-label="Name"><strong>{key.name}</strong></td>
								<td data-label="Prefix"><code>ear_{key.prefix}_…</code></td>
								<td data-label="Created">{formatDate(key.createdAt)}</td>
								<td data-label="Last used">
									{key.lastUsedAt ? formatDate(key.lastUsedAt) : 'Never'}
								</td>
								<td class="action" data-label="Action">
									<form
										method="POST"
										action="?/delete"
										onsubmit={(event) => {
											if (
												!confirm(
													`Delete “${key.name}”? The key will be permanently removed and stop working immediately.`
												)
											)
												event.preventDefault();
										}}
									>
										<input type="hidden" name="id" value={key.id} />
										<button class="danger-link" type="submit">Delete</button>
									</form>
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{/if}
	</section>
</div>

<style>
	.access-badge {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		border-radius: 6px;
		color: #09533c;
		background: var(--accent-pale);
		font-size: 0.74rem;
		font-weight: 800;
	}

	.access-badge {
		padding: 0.65rem 0.8rem;
	}

	.notice {
		display: flex;
		align-items: center;
		gap: 0.55rem;
		margin-bottom: 1rem;
		padding: 0.85rem 1rem;
		border-radius: 7px;
		font-size: 0.82rem;
		font-weight: 700;
	}

	.notice.success {
		color: #09533c;
		background: var(--accent-pale);
	}

	.notice.error {
		color: #7f312d;
		background: #f7e3e1;
	}

	.token-panel {
		margin-bottom: 1rem;
		padding: 1.25rem;
		border-color: #d8d8d8;
		background: #ffffff;
	}

	.token-panel h2,
	.create-panel h2,
	.keys-panel h2 {
		margin-bottom: 0.35rem;
	}

	.token-panel p,
	.create-panel p,
	.keys-panel p {
		color: var(--muted);
		font-size: 0.8rem;
		line-height: 1.5;
	}

	.token-row {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		margin-top: 1rem;
	}

	.token-value {
		flex: 1;
		min-width: 0;
		padding: 0.8rem;
		overflow-wrap: anywhere;
		border: 1px solid #d6d6d6;
		border-radius: 6px;
		outline: 0;
		background: white;
		color: var(--ink);
		font-family: inherit;
		font-size: 0.78rem;
	}

	.token-value:focus {
		border-color: var(--accent);
		box-shadow: 0 0 0 3px rgb(17 97 73 / 10%);
	}

	.copy-help {
		min-height: 1.2rem;
		margin-top: 0.55rem;
		color: var(--muted);
		font-size: 0.74rem;
	}

	.key-grid {
		display: grid;
		width: 100%;
		max-width: 100%;
		min-width: 0;
		grid-template-columns: minmax(260px, 0.7fr) minmax(0, 2fr);
		gap: 1rem;
		align-items: start;
	}

	.create-panel {
		min-width: 0;
		padding: 1.25rem;
	}

	.create-panel form {
		display: grid;
		min-width: 0;
		gap: 0.85rem;
		margin-top: 1rem;
	}

	.create-panel label {
		display: grid;
		gap: 0.35rem;
		color: var(--muted);
		font-size: 0.72rem;
		font-weight: 800;
	}

	.create-panel input {
		width: 100%;
		min-width: 0;
		height: 42px;
		padding: 0 0.75rem;
		border: 1px solid #d8d8d8;
		border-radius: 6px;
		background: #ffffff;
		color: var(--ink);
	}

	.keys-panel {
		min-width: 0;
		overflow: hidden;
	}

	.keys-panel > header {
		padding: 1rem;
		border-bottom: 1px solid var(--line);
	}

	.table-wrap {
		width: 100%;
		max-width: 100%;
		overflow-x: auto;
	}

	table {
		width: 100%;
		border-collapse: collapse;
	}

	th,
	td {
		padding: 0.8rem;
		border-bottom: 1px solid #e9e9e9;
		text-align: left;
		white-space: nowrap;
	}

	th {
		color: var(--muted);
		background: #f7f7f7;
		font-size: 0.65rem;
		letter-spacing: 0.06em;
		text-transform: uppercase;
	}

	td {
		color: #555555;
		font-size: 0.77rem;
	}

	td strong {
		color: var(--ink);
	}

	td code {
		font-size: 0.72rem;
	}

	.action {
		text-align: right;
	}

	.danger-link {
		border: 0;
		color: #9a3e37;
		background: transparent;
		font-size: 0.74rem;
		font-weight: 800;
		cursor: pointer;
	}

	.empty-state {
		padding: 2rem;
		text-align: center;
	}

	@media (max-width: 900px) {
		.key-grid {
			grid-template-columns: 1fr;
		}

		.token-row {
			align-items: stretch;
			flex-direction: column;
		}
	}

	@media (max-width: 580px) {
		.keys-panel,
		.table-wrap {
			overflow: visible;
		}

		table,
		tbody {
			display: block;
			width: 100%;
		}

		thead {
			position: absolute;
			width: 1px;
			height: 1px;
			overflow: hidden;
			clip-path: inset(50%);
			white-space: nowrap;
		}

		tbody tr {
			display: grid;
			grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
			gap: 0.85rem 1rem;
			padding: 1rem;
			border-bottom: 1px solid #e9e9e9;
		}

		td {
			display: block;
			min-width: 0;
			padding: 0;
			border: 0;
			white-space: normal;
			overflow-wrap: anywhere;
		}

		td::before {
			display: block;
			margin-bottom: 0.2rem;
			color: var(--muted);
			font-size: 0.62rem;
			font-weight: 800;
			letter-spacing: 0.06em;
			text-transform: uppercase;
			content: attr(data-label);
		}

		td:first-child,
		td.action {
			grid-column: 1 / -1;
		}

		.action {
			text-align: left;
		}
	}
</style>
