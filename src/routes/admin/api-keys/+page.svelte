<script lang="ts" module>
	function formatDate(value: Date | string): string {
		return new Intl.DateTimeFormat('en-US', {
			dateStyle: 'medium',
			timeStyle: 'short'
		}).format(new Date(value));
	}
</script>

<script lang="ts">
	import {
		CheckCircle2,
		Clipboard,
		KeyRound,
		ShieldAlert,
		ShieldCheck,
		XCircle
	} from '@lucide/svelte';

	let { data, form } = $props();
	let copied = $state(false);

	async function copyToken(token: string) {
		await navigator.clipboard.writeText(token);
		copied = true;
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

{#if data.notice === 'key-revoked'}
	<p class="notice success"><CheckCircle2 size={17} /> API key revoked immediately.</p>
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
			<code>{form.created.token}</code>
			<button class="primary-button" type="button" onclick={() => copyToken(form.created.token)}>
				<Clipboard size={16} />
				{copied ? 'Copied' : 'Copy key'}
			</button>
		</div>
	</section>
{/if}

<div class="key-grid">
	<section class="panel create-panel">
		<span class="panel-icon"><KeyRound size={20} /></span>
		<h2>Create API key</h2>
		<p>
			Use a name that identifies the client or machine. Keys do not expire until you revoke them.
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
							<th>Status</th>
							<th><span class="sr-only">Action</span></th>
						</tr>
					</thead>
					<tbody>
						{#each data.keys as key (key.id)}
							<tr>
								<td><strong>{key.name}</strong></td>
								<td><code>ear_{key.prefix}_…</code></td>
								<td>{formatDate(key.createdAt)}</td>
								<td>{key.lastUsedAt ? formatDate(key.lastUsedAt) : 'Never'}</td>
								<td>
									<span class:revoked={key.revokedAt} class="status">
										{#if key.revokedAt}<XCircle size={14} /> Revoked{:else}<ShieldCheck size={14} />
											Active{/if}
									</span>
								</td>
								<td class="action">
									{#if !key.revokedAt}
										<form
											method="POST"
											action="?/revoke"
											onsubmit={(event) => {
												if (!confirm(`Revoke “${key.name}”? This cannot be undone.`))
													event.preventDefault();
											}}
										>
											<input type="hidden" name="id" value={key.id} />
											<button class="danger-link" type="submit">Revoke</button>
										</form>
									{/if}
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
	.access-badge,
	.status {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		border-radius: 999px;
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
		border-radius: 12px;
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
		border-color: #9ac8b8;
		background: #f3faf6;
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

	.token-row code {
		flex: 1;
		padding: 0.8rem;
		overflow-wrap: anywhere;
		border: 1px solid #bad8cc;
		border-radius: 10px;
		background: white;
		font-size: 0.78rem;
	}

	.key-grid {
		display: grid;
		grid-template-columns: minmax(260px, 0.7fr) minmax(0, 2fr);
		gap: 1rem;
		align-items: start;
	}

	.create-panel {
		padding: 1.25rem;
	}

	.panel-icon {
		display: grid;
		width: 42px;
		height: 42px;
		margin-bottom: 1rem;
		place-items: center;
		border-radius: 12px;
		color: var(--accent);
		background: var(--accent-pale);
	}

	.create-panel form {
		display: grid;
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
		height: 42px;
		padding: 0 0.75rem;
		border: 1px solid #d4dbd5;
		border-radius: 10px;
		background: #fafcf9;
		color: var(--ink);
	}

	.keys-panel {
		overflow: hidden;
	}

	.keys-panel > header {
		padding: 1rem;
		border-bottom: 1px solid var(--line);
	}

	.table-wrap {
		overflow-x: auto;
	}

	table {
		width: 100%;
		border-collapse: collapse;
	}

	th,
	td {
		padding: 0.8rem;
		border-bottom: 1px solid #e8ece8;
		text-align: left;
		white-space: nowrap;
	}

	th {
		color: var(--muted);
		background: #f8faf7;
		font-size: 0.65rem;
		letter-spacing: 0.06em;
		text-transform: uppercase;
	}

	td {
		color: #516057;
		font-size: 0.77rem;
	}

	td strong {
		color: var(--ink);
	}

	td code {
		font-size: 0.72rem;
	}

	.status {
		padding: 0.35rem 0.55rem;
	}

	.status.revoked {
		color: #7f312d;
		background: #f7e3e1;
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
</style>
