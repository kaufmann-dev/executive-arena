<script lang="ts" module>
	function formatDate(value: Date | string): string {
		return new Intl.DateTimeFormat('en-US', {
			dateStyle: 'medium',
			timeStyle: 'short'
		}).format(new Date(value));
	}

	function formatLimit(value: number | null, suffix: string): string {
		return value === null ? 'Unlimited' : `${value.toLocaleString()} ${suffix}`;
	}

	function noticeMessage(value: string): string {
		return (
			{
				'provider-created': 'Provider saved with an encrypted credential.',
				'provider-updated': 'Provider settings updated.',
				'key-rotated': 'Provider credential rotated.',
				'model-created': 'Model and rate limits saved.',
				'model-updated': 'Model and rate limits updated.',
				'run-created': 'Research run queued.',
				'run-paused': 'Research run paused.',
				'run-resumed': 'Research run resumed.',
				'run-cancelled': 'Research run cancelled.'
			}[value] ?? 'Research settings saved.'
		);
	}
</script>

<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { onMount } from 'svelte';
	import {
		Bot,
		CheckCircle2,
		CirclePause,
		CirclePlay,
		KeyRound,
		Plus,
		RotateCw,
		ShieldAlert,
		Square,
		Zap
	} from '@lucide/svelte';

	let { data, form } = $props();

	onMount(() => {
		const timer = setInterval(() => {
			if (data.runs.some((run) => run.status === 'queued' || run.status === 'running')) {
				void invalidateAll();
			}
		}, 5_000);
		return () => clearInterval(timer);
	});
</script>

<svelte:head><title>Research · Executive Arena</title></svelte:head>

<section class="page-heading">
	<div>
		<p class="eyebrow">Automated population</p>
		<h1>Research runner</h1>
		<p class="lede">
			Manage OpenAI-compatible providers, encrypted credentials, model limits, and resumable
			executive-research runs.
		</p>
	</div>
	<span class:online={data.worker?.active} class="worker-state">
		<Bot size={16} />
		{data.worker?.active ? 'Worker online' : 'Worker offline'}
	</span>
</section>

{#if data.notice}
	<p class="notice success"><CheckCircle2 size={17} /> {noticeMessage(data.notice)}</p>
{/if}
{#if form?.message}
	<p class="notice error"><ShieldAlert size={17} /> {form.message}</p>
{/if}

{#if !data.worker?.active}
	<section class="panel worker-warning">
		<ShieldAlert size={20} />
		<div>
			<strong>No active research worker</strong>
			<p>
				Runs remain safely queued until <code>pnpm research:worker</code> is running against this database.
			</p>
		</div>
	</section>
{/if}

<section class="panel runs-panel">
	<header>
		<div>
			<p class="eyebrow">Execution history</p>
			<h2>Research runs</h2>
		</div>
	</header>
	{#if data.runs.length === 0}
		<div class="empty-state">
			<h3>No runs yet</h3>
			<p>Add a provider and model, then start the first reproducible run.</p>
		</div>
	{:else}
		<div class="table-wrap">
			<table>
				<thead>
					<tr>
						<th>Model</th>
						<th>Status</th>
						<th>Progress</th>
						<th>Review / failed</th>
						<th>Tokens</th>
						<th>Created</th>
						<th><span class="sr-only">Actions</span></th>
					</tr>
				</thead>
				<tbody>
					{#each data.runs as run (run.id)}
						<tr>
							<td>
								<strong>{run.providerName} · {run.modelName}</strong>
								<small>{run.modelIdentifier} · {run.maxConcurrency} concurrent</small>
							</td>
							<td><span class={`pill ${run.status}`}>{run.status}</span></td>
							<td>
								<strong
									>{(run.completedJobs + run.reviewJobs + run.failedJobs).toLocaleString()} /
									{run.totalJobs.toLocaleString()}</strong
								>
								<small>{run.activeJobs.toLocaleString()} active</small>
							</td>
							<td>{run.reviewJobs.toLocaleString()} / {run.failedJobs.toLocaleString()}</td>
							<td>{(run.promptTokens + run.completionTokens).toLocaleString()}</td>
							<td>{formatDate(run.createdAt)}</td>
							<td class="run-actions">
								{#if run.status === 'queued' || run.status === 'running'}
									<form method="POST" action="?/pauseRun">
										<input type="hidden" name="id" value={run.id} />
										<button title="Pause run" type="submit"><CirclePause size={16} /></button>
									</form>
								{:else if run.status === 'paused'}
									<form method="POST" action="?/resumeRun">
										<input type="hidden" name="id" value={run.id} />
										<button title="Resume run" type="submit"><CirclePlay size={16} /></button>
									</form>
								{/if}
								{#if run.status === 'queued' || run.status === 'running' || run.status === 'paused'}
									<form
										method="POST"
										action="?/cancelRun"
										onsubmit={(event) => {
											if (!confirm('Cancel this run? Completed profiles will remain published.'))
												event.preventDefault();
										}}
									>
										<input type="hidden" name="id" value={run.id} />
										<button class="cancel" title="Cancel run" type="submit"
											><Square size={14} /></button
										>
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

{#if data.failures.length > 0}
	<section class="panel failures-panel">
		<header>
			<div>
				<p class="eyebrow">Attention required</p>
				<h2>Recent failed jobs</h2>
			</div>
		</header>
		<div class="failure-list">
			{#each data.failures as failure (failure.id)}
				<article>
					<div>
						<strong>{failure.ticker} · {failure.companyName}</strong>
						<small>{failure.providerName} · {failure.modelName} · {failure.attempt} attempts</small>
					</div>
					<p>{failure.lastError ?? 'The job failed without an error message.'}</p>
				</article>
			{/each}
		</div>
	</section>
{/if}

<section class="configuration-heading">
	<div>
		<p class="eyebrow">Reusable configuration</p>
		<h2>Providers and models</h2>
	</div>
</section>

<div class="configuration-grid">
	<section class="panel create-provider">
		<span class="panel-icon"><Plus size={20} /></span>
		<h2>Add provider</h2>
		<p>The API key is encrypted before it is stored and is never displayed again.</p>
		<form method="POST" action="?/createProvider">
			<label>
				<span>Provider name</span>
				<input name="name" placeholder="Primary inference provider" maxlength="100" required />
			</label>
			<label>
				<span>Base URL</span>
				<input
					name="baseUrl"
					type="url"
					placeholder="https://api.provider.example/v1"
					maxlength="1000"
					required
				/>
			</label>
			<label>
				<span>API key</span>
				<input
					name="apiKey"
					type="password"
					autocomplete="new-password"
					minlength="8"
					maxlength="10000"
					required
				/>
			</label>
			<button class="primary-button" type="submit"><KeyRound size={16} /> Save provider</button>
		</form>
	</section>

	<div class="providers">
		{#if data.providers.length === 0}
			<section class="panel empty-state">
				<h3>No providers configured</h3>
				<p>Add any OpenAI-compatible API endpoint to begin.</p>
			</section>
		{/if}
		{#each data.providers as provider (provider.id)}
			<section class="panel provider-card">
				<header>
					<div>
						<h2>{provider.name}</h2>
						<p>{provider.baseUrl} · key ending {provider.keyHint}</p>
					</div>
					<span class:disabled={!provider.enabled} class="status"
						>{provider.enabled ? 'Enabled' : 'Disabled'}</span
					>
				</header>

				<details>
					<summary>Provider settings</summary>
					<div class="provider-settings">
						<form method="POST" action="?/updateProvider" class="fields">
							<input type="hidden" name="id" value={provider.id} />
							<label>
								<span>Name</span>
								<input name="name" value={provider.name} maxlength="100" required />
							</label>
							<label>
								<span>Base URL</span>
								<input
									name="baseUrl"
									type="url"
									value={provider.baseUrl}
									maxlength="1000"
									required
								/>
							</label>
							<label class="checkbox">
								<input name="enabled" type="checkbox" checked={provider.enabled} />
								<span>Provider enabled</span>
							</label>
							<button class="secondary-button" type="submit">Update provider</button>
						</form>
						<form method="POST" action="?/rotateKey" class="rotate-form">
							<input type="hidden" name="id" value={provider.id} />
							<label>
								<span>Replacement API key</span>
								<input
									name="apiKey"
									type="password"
									autocomplete="new-password"
									minlength="8"
									maxlength="10000"
									required
								/>
							</label>
							<button class="secondary-button" type="submit"
								><RotateCw size={15} /> Rotate key</button
							>
						</form>
					</div>
				</details>

				<div class="models">
					{#each provider.models as model (model.id)}
						<article class="model-row">
							<div class="model-summary">
								<div>
									<strong>{model.name}</strong>
									<code>{model.modelId}</code>
								</div>
								<p>
									{model.maxConcurrency} concurrent ·
									{formatLimit(model.requestsPerMinute, 'RPM')} ·
									{formatLimit(model.tokensPerMinute, 'TPM')}
								</p>
								<form method="POST" action="?/startRun">
									<input type="hidden" name="id" value={model.id} />
									<button
										class="primary-button"
										type="submit"
										disabled={!provider.enabled || !model.enabled}
										><Zap size={15} /> Start run</button
									>
								</form>
							</div>
							<details>
								<summary>Edit model and limits</summary>
								<form method="POST" action="?/updateModel" class="model-form">
									<input type="hidden" name="id" value={model.id} />
									<input type="hidden" name="providerId" value={provider.id} />
									{@render ModelFields(model)}
									<label class="checkbox">
										<input name="enabled" type="checkbox" checked={model.enabled} />
										<span>Model enabled</span>
									</label>
									<button class="secondary-button" type="submit">Update model</button>
								</form>
							</details>
						</article>
					{/each}
				</div>

				<details class="add-model">
					<summary>Add model</summary>
					<form method="POST" action="?/createModel" class="model-form">
						<input type="hidden" name="providerId" value={provider.id} />
						{@render ModelFields(null)}
						<label class="checkbox">
							<input name="enabled" type="checkbox" checked />
							<span>Model enabled</span>
						</label>
						<button class="primary-button" type="submit"><Plus size={15} /> Add model</button>
					</form>
				</details>
			</section>
		{/each}
	</div>
</div>

{#snippet ModelFields(model: (typeof data.providers)[number]['models'][number] | null)}
	<label>
		<span>Display name</span>
		<input name="name" value={model?.name ?? ''} maxlength="100" required />
	</label>
	<label>
		<span>Model identifier</span>
		<input name="modelId" value={model?.modelId ?? ''} maxlength="200" required />
	</label>
	<label>
		<span>Concurrency</span>
		<input
			name="maxConcurrency"
			type="number"
			value={model?.maxConcurrency ?? 50}
			min="1"
			max="500"
			required
		/>
	</label>
	<label>
		<span>Requests/minute <small>blank = unlimited</small></span>
		<input
			name="requestsPerMinute"
			type="number"
			value={model?.requestsPerMinute ?? ''}
			min="1"
			max="1000000"
		/>
	</label>
	<label>
		<span>Tokens/minute <small>blank = unlimited</small></span>
		<input
			name="tokensPerMinute"
			type="number"
			value={model?.tokensPerMinute ?? ''}
			min="1"
			max="2000000000"
		/>
	</label>
	<label>
		<span>Timeout (milliseconds)</span>
		<input
			name="requestTimeoutMs"
			type="number"
			value={model?.requestTimeoutMs ?? 180000}
			min="1000"
			max="900000"
			required
		/>
	</label>
	<label>
		<span>Maximum output tokens</span>
		<input
			name="maxOutputTokens"
			type="number"
			value={model?.maxOutputTokens ?? 12000}
			min="256"
			max="1000000"
			required
		/>
	</label>
	<label>
		<span>Maximum attempts</span>
		<input
			name="maxAttempts"
			type="number"
			value={model?.maxAttempts ?? 3}
			min="1"
			max="20"
			required
		/>
	</label>
{/snippet}

<style>
	.worker-state,
	.status {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		padding: 0.55rem 0.7rem;
		border-radius: 999px;
		color: #7f312d;
		background: #f7e3e1;
		font-size: 0.74rem;
		font-weight: 800;
	}

	.worker-state.online,
	.status {
		color: #09533c;
		background: var(--accent-pale);
	}

	.status.disabled {
		color: #7f312d;
		background: #f7e3e1;
	}

	.notice,
	.worker-warning {
		display: flex;
		align-items: center;
		gap: 0.7rem;
		margin-bottom: 1rem;
		padding: 0.9rem 1rem;
		border-radius: 12px;
		font-size: 0.82rem;
	}

	.notice.success {
		color: #09533c;
		background: var(--accent-pale);
	}

	.notice.error,
	.worker-warning {
		color: #7f312d;
		background: #fff7f5;
	}

	.worker-warning p {
		margin: 0.2rem 0 0;
		color: #795d59;
	}

	.runs-panel,
	.failures-panel,
	.provider-card {
		overflow: hidden;
	}

	.runs-panel > header,
	.failures-panel > header,
	.provider-card > header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 1.1rem 1.2rem;
		border-bottom: 1px solid var(--line);
	}

	.runs-panel h2,
	.failures-panel h2,
	.provider-card h2,
	.create-provider h2,
	.configuration-heading h2 {
		margin-bottom: 0.3rem;
		font-family: Georgia, 'Times New Roman', serif;
		font-size: 1.35rem;
		font-weight: 500;
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
		padding: 0.85rem 1rem;
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

	td strong,
	td small {
		display: block;
	}

	td strong {
		color: var(--ink);
	}

	td small {
		margin-top: 0.2rem;
	}

	.run-actions {
		display: flex;
		justify-content: flex-end;
		gap: 0.25rem;
	}

	.run-actions button {
		display: grid;
		width: 32px;
		height: 32px;
		place-items: center;
		border: 1px solid var(--line);
		border-radius: 8px;
		background: white;
		cursor: pointer;
	}

	.run-actions button.cancel {
		color: var(--danger);
	}

	.failures-panel {
		margin-top: 1rem;
	}

	.failure-list article {
		display: grid;
		grid-template-columns: minmax(220px, 0.7fr) minmax(0, 2fr);
		gap: 1rem;
		padding: 0.9rem 1.2rem;
		border-bottom: 1px solid var(--line);
	}

	.failure-list strong,
	.failure-list small {
		display: block;
	}

	.failure-list small {
		margin-top: 0.2rem;
		color: var(--muted);
	}

	.failure-list p {
		margin: 0;
		overflow-wrap: anywhere;
		color: #7f312d;
		font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
		font-size: 0.72rem;
		line-height: 1.5;
		white-space: pre-wrap;
	}

	.pill.running,
	.pill.completed {
		color: #09533c;
		background: var(--accent-pale);
	}

	.pill.paused {
		color: #815014;
		background: #faebd5;
	}

	.pill.cancelled {
		color: #7f312d;
		background: #f7e3e1;
	}

	.configuration-heading {
		margin: 2rem 0 1rem;
	}

	.configuration-grid {
		display: grid;
		grid-template-columns: minmax(260px, 0.65fr) minmax(0, 2fr);
		gap: 1rem;
		align-items: start;
	}

	.create-provider {
		padding: 1.2rem;
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

	.create-provider > p,
	.provider-card header p {
		margin: 0;
		color: var(--muted);
		font-size: 0.78rem;
		line-height: 1.5;
	}

	.create-provider form,
	.fields,
	.rotate-form,
	.model-form {
		display: grid;
		gap: 0.8rem;
	}

	.create-provider form {
		margin-top: 1rem;
	}

	label {
		display: grid;
		gap: 0.35rem;
		color: var(--muted);
		font-size: 0.7rem;
		font-weight: 800;
	}

	label span small {
		font-weight: 500;
	}

	input {
		min-width: 0;
		height: 42px;
		padding: 0 0.7rem;
		border: 1px solid #d4dbd5;
		border-radius: 9px;
		background: #fafcf9;
		color: var(--ink);
	}

	.checkbox {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.checkbox input {
		width: 18px;
		height: 18px;
	}

	.providers {
		display: grid;
		gap: 1rem;
	}

	details {
		border-bottom: 1px solid var(--line);
	}

	summary {
		padding: 0.8rem 1.2rem;
		color: var(--accent);
		font-size: 0.75rem;
		font-weight: 800;
		cursor: pointer;
	}

	.provider-settings {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 1rem;
		padding: 0 1.2rem 1.2rem;
	}

	.models {
		display: grid;
	}

	.model-row {
		border-bottom: 1px solid var(--line);
	}

	.model-summary {
		display: grid;
		grid-template-columns: minmax(180px, 1fr) minmax(250px, 1fr) auto;
		align-items: center;
		gap: 1rem;
		padding: 1rem 1.2rem;
	}

	.model-summary strong,
	.model-summary code {
		display: block;
	}

	.model-summary code {
		margin-top: 0.25rem;
		color: var(--muted);
		font-size: 0.72rem;
	}

	.model-summary p {
		margin: 0;
		color: var(--muted);
		font-size: 0.75rem;
	}

	.model-summary button:disabled {
		cursor: not-allowed;
		opacity: 0.45;
	}

	.model-form {
		grid-template-columns: repeat(3, minmax(0, 1fr));
		padding: 0 1.2rem 1.2rem;
	}

	.add-model {
		border-bottom: 0;
	}

	.sr-only {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip: rect(0, 0, 0, 0);
		white-space: nowrap;
	}

	@media (max-width: 1050px) {
		.configuration-grid {
			grid-template-columns: 1fr;
		}

		.model-summary {
			grid-template-columns: 1fr auto;
		}

		.model-summary p {
			grid-column: 1 / -1;
			grid-row: 2;
		}
	}

	@media (max-width: 720px) {
		.provider-settings,
		.model-form {
			grid-template-columns: 1fr;
		}

		.model-summary {
			grid-template-columns: 1fr;
		}

		.failure-list article {
			grid-template-columns: 1fr;
		}
	}
</style>
