<script lang="ts">
	import {
		ArrowRight,
		Check,
		ExternalLink,
		Image,
		Images,
		RotateCcw,
		Search,
		ShieldAlert,
		Upload,
		X
	} from '@lucide/svelte';
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import type { SubmitFunction } from '@sveltejs/kit';
	import { onDestroy } from 'svelte';

	let { data, form } = $props();

	const maxBatchBytes = 20 * 1024 * 1024;
	type PendingPortrait = {
		id: string;
		file: File;
		previewUrl: string;
	};
	type UploadState = {
		companyId: string | null;
		byPerson: Record<string, PendingPortrait[]>;
		errors: Record<string, string>;
	};

	let uploadState = $state.raw<UploadState>({
		companyId: null,
		byPerson: {},
		errors: {}
	});
	const currentUploads = $derived(
		uploadState.companyId === data.target?.card.companyId ? uploadState.byPerson : {}
	);
	const uploadCount = $derived(
		Object.values(currentUploads).reduce((count, uploads) => count + uploads.length, 0)
	);
	const searchesByPerson = $derived(
		new Map(data.searches.map((search) => [search.personId, search]))
	);

	function pendingFor(personId: string): PendingPortrait[] {
		return currentUploads[personId] ?? [];
	}

	function uploadError(personId: string): string | null {
		return uploadState.companyId === data.target?.card.companyId
			? (uploadState.errors[personId] ?? null)
			: null;
	}

	function queueAction(action: 'save' | 'skip' | 'restore' | 'exclude'): string {
		const mode = encodeURIComponent(data.mode);
		const cursor = data.cursor ? `&cursor=${encodeURIComponent(data.cursor)}` : '';
		return `?/${action}&mode=${mode}${cursor}`;
	}

	function addFiles(personId: string, files: File[], capacity: number) {
		const companyId = data.target?.card.companyId;
		if (!companyId || files.length === 0) return;
		if (uploadState.companyId !== companyId) clearUploads();

		const existing =
			uploadState.companyId === companyId ? (uploadState.byPerson[personId] ?? []) : [];
		const accepted: PendingPortrait[] = [];
		let totalBytes =
			uploadState.companyId === companyId
				? Object.values(uploadState.byPerson)
						.flat()
						.reduce((total, upload) => total + upload.file.size, 0)
				: 0;
		let message = '';

		for (const file of files) {
			if (!file.type.startsWith('image/')) {
				message = `${file.name || 'That file'} is not an image.`;
				continue;
			}
			if (file.size > maxBatchBytes) {
				message = `${file.name || 'That image'} is larger than 20 MB.`;
				continue;
			}
			if (existing.length + accepted.length >= capacity) {
				message = `Only ${capacity} portrait slot${capacity === 1 ? '' : 's'} remain.`;
				continue;
			}
			if (totalBytes + file.size > maxBatchBytes) {
				message = 'The complete portrait batch must be 20 MB or smaller.';
				continue;
			}
			totalBytes += file.size;
			accepted.push({
				id: crypto.randomUUID(),
				file,
				previewUrl: URL.createObjectURL(file)
			});
		}

		uploadState = {
			companyId,
			byPerson: {
				...(uploadState.companyId === companyId ? uploadState.byPerson : {}),
				[personId]: [...existing, ...accepted]
			},
			errors: {
				...(uploadState.companyId === companyId ? uploadState.errors : {}),
				[personId]: message
			}
		};
	}

	function removeUpload(personId: string, uploadId: string) {
		const uploads = pendingFor(personId);
		const removed = uploads.find((upload) => upload.id === uploadId);
		if (removed) URL.revokeObjectURL(removed.previewUrl);
		uploadState = {
			...uploadState,
			byPerson: {
				...uploadState.byPerson,
				[personId]: uploads.filter((upload) => upload.id !== uploadId)
			},
			errors: { ...uploadState.errors, [personId]: '' }
		};
	}

	function handlePaste(event: ClipboardEvent, personId: string, capacity: number) {
		const files = Array.from(event.clipboardData?.files ?? []);
		if (files.length === 0) return;
		event.preventDefault();
		addFiles(personId, files, capacity);
	}

	function handleDrop(event: DragEvent, personId: string, capacity: number) {
		event.preventDefault();
		addFiles(personId, Array.from(event.dataTransfer?.files ?? []), capacity);
	}

	function handlePicker(event: Event, personId: string, capacity: number) {
		const input = event.currentTarget as HTMLInputElement;
		addFiles(personId, Array.from(input.files ?? []), capacity);
		input.value = '';
	}

	function clearUploads() {
		for (const uploads of Object.values(uploadState.byPerson)) {
			for (const upload of uploads) URL.revokeObjectURL(upload.previewUrl);
		}
		uploadState = { companyId: null, byPerson: {}, errors: {} };
	}

	const enhanceSave: SubmitFunction = ({ formData, cancel }) => {
		let appended = 0;
		for (const field of [...formData.keys()]) {
			if (field.startsWith('image:')) formData.delete(field);
		}
		for (const [personId, uploads] of Object.entries(currentUploads)) {
			for (const upload of uploads) {
				formData.append(`image:${personId}`, upload.file, upload.file.name || 'portrait');
				appended += 1;
			}
		}
		if (appended === 0) {
			cancel();
			return;
		}
		return async ({ result, update }) => {
			if (result.type === 'redirect') clearUploads();
			await update({ reset: false });
		};
	};

	onDestroy(clearUploads);
</script>

<svelte:head><title>Portrait backfill · Executive Arena</title></svelte:head>

<section class="page-heading">
	<div>
		<p class="eyebrow">Cohort administration</p>
		<h1>Portrait backfill</h1>
		<p class="lede">
			Open a prepared Google Images search, copy useful portraits, then paste up to three images per
			executive. Skipped companies stay out of the active queues until you restore or save them.
		</p>
	</div>
	<div class="mode-switch" aria-label="Backfill queue mode">
		<a
			class={{ active: data.mode === 'missing' }}
			href={resolve('/admin/portrait-backfill?mode=missing')}>No images</a
		>
		<a
			class={{ active: data.mode === 'incomplete' }}
			href={resolve('/admin/portrait-backfill?mode=incomplete')}>Fewer than 3</a
		>
		<a
			class={{ active: data.mode === 'skipped' }}
			href={resolve('/admin/portrait-backfill?mode=skipped')}>Skipped</a
		>
	</div>
</section>

{#if data.notice.saved > 0}
	<div class="notice" role="status">
		<Check size={18} />
		<span>{data.notice.saved} portrait{data.notice.saved === 1 ? '' : 's'} saved.</span>
	</div>
{:else if data.notice.excluded}
	<div class="notice" role="status">
		<Check size={18} />
		<span>Company excluded because an active executive has no saved portrait.</span>
	</div>
{/if}

{#if form?.message}
	<div class="notice warning" role="alert">
		<ShieldAlert size={18} />
		<strong>{form.message}</strong>
	</div>
{/if}

{#if !data.target}
	<section class="panel empty-state">
		<Images size={30} />
		<h2>Queue complete</h2>
		<p>
			No included company after this position has an active executive matching the selected mode.
		</p>
		<a class="secondary-button" href={resolve(`/admin/portrait-backfill?mode=${data.mode}`)}
			>Start a new run</a
		>
	</section>
{:else}
	{@const target = data.target}
	<section class="company-context">
		<div>
			<p class="eyebrow">Current company</p>
			<h2>{data.target.card.companyName}</h2>
			<p>
				{data.target.card.ticker} · {data.target.card.leaders.length} active executive{data.target
					.card.leaders.length === 1
					? ''
					: 's'}
			</p>
		</div>
		<a
			class="secondary-button"
			href={resolve('/admin/companies/[id]', { id: data.target.card.companyId })}
			>Manage company <ExternalLink size={15} /></a
		>
	</section>

	<form
		id="portrait-backfill-save"
		class="backfill-form"
		method="POST"
		action={queueAction('save')}
		enctype="multipart/form-data"
		use:enhance={enhanceSave}
	>
		<input type="hidden" name="mode" value={data.mode} />
		<input type="hidden" name="companyId" value={data.target.card.companyId} />
		<input type="hidden" name="beforeCursor" value={data.cursor ?? ''} />

		{#each data.target.card.leaders as leader (leader.id)}
			{@const search = searchesByPerson.get(leader.id)}
			{@const remaining = 3 - leader.portraits.length}
			{@const pending = pendingFor(leader.id)}
			<article class="leader-review">
				<header>
					<div>
						<p class="eyebrow">{leader.title}</p>
						<h3>{leader.name}</h3>
					</div>
					<span class="capacity">{leader.portraits.length} of 3 saved</span>
				</header>

				<div class="saved-portraits" aria-label={`Saved portraits for ${leader.name}`}>
					{#each leader.portraits as savedPortrait, index (savedPortrait.id)}
						<figure>
							<img src={`/media/portraits/${savedPortrait.id}`} alt={savedPortrait.altText} />
							<figcaption>Saved {index + 1}</figcaption>
						</figure>
					{/each}
					{#each { length: remaining }, slot}
						<div class="empty-slot" aria-label={`Empty portrait slot ${slot + 1}`}>
							<Image size={22} />
							<span>Open slot</span>
						</div>
					{/each}
				</div>

				{#if search}
					<div class="search-row">
						<div class="search-context">
							<span>Google Images query</span>
							<code>{search.query}</code>
						</div>
						<a
							class="google-button"
							href={search.url}
							target="portrait-google-images"
							rel="external"
						>
							<Search size={17} /> Open Google Images <ExternalLink size={14} />
						</a>
					</div>

					<button
						class="paste-zone"
						aria-label={`Paste portraits for ${leader.name}`}
						type="button"
						onpaste={(event) => handlePaste(event, leader.id, remaining)}
						ondragover={(event) => event.preventDefault()}
						ondrop={(event) => handleDrop(event, leader.id, remaining)}
					>
						<Upload size={24} />
						<div>
							<strong>Paste or drop portrait images here</strong>
							<p>
								Click here after copying an image, then press Ctrl+V or ⌘V. You can paste repeatedly
								until the {remaining} open slot{remaining === 1 ? '' : 's'} are filled.
							</p>
						</div>
					</button>
					<label class="file-picker">
						Choose images
						<input
							type="file"
							accept="image/*"
							name={`image:${leader.id}`}
							multiple
							onchange={(event) => handlePicker(event, leader.id, remaining)}
						/>
					</label>

					{#if uploadError(leader.id)}
						<p class="upload-error" role="alert">{uploadError(leader.id)}</p>
					{/if}

					{#if pending.length > 0}
						<div class="pending-heading">
							<h4>Ready to save</h4>
							<strong>{pending.length} of {remaining} selected</strong>
						</div>
						<div class="preview-grid">
							{#each pending as upload (upload.id)}
								<figure>
									<img src={upload.previewUrl} alt={`Pending portrait for ${leader.name}`} />
									<button
										type="button"
										aria-label={`Remove ${upload.file.name || 'pasted image'}`}
										onclick={() => removeUpload(leader.id, upload.id)}
									>
										<X size={16} />
									</button>
									<figcaption>{upload.file.name || 'Pasted image'}</figcaption>
								</figure>
							{/each}
						</div>
					{/if}
				{:else}
					<p class="complete-message">
						<Check size={17} /> This executive already satisfies this queue mode.
					</p>
				{/if}
			</article>
		{/each}
	</form>

	<footer class="queue-actions">
		<p>All selected images are validated and saved together.</p>
		<div class="queue-action-controls">
			<button
				class="primary-button"
				type="submit"
				form="portrait-backfill-save"
				disabled={uploadCount === 0}
			>
				<Check size={16} /> Save {uploadCount || ''} &amp; show next
			</button>
			{#if data.mode === 'skipped'}
				<form method="POST" action={queueAction('restore')}>
					<input type="hidden" name="mode" value={data.mode} />
					<input type="hidden" name="companyId" value={data.target.card.companyId} />
					<input type="hidden" name="beforeCursor" value={data.cursor ?? ''} />
					<button class="secondary-button" type="submit"
						><RotateCcw size={16} /> Return to queue</button
					>
				</form>
			{/if}
			{#if data.canExclude}
				<form
					method="POST"
					action={queueAction('exclude')}
					onsubmit={(event) => {
						if (
							!confirm(
								`Exclude ${target.card.companyName} from Executive Arena and show the next company?`
							)
						) {
							event.preventDefault();
						}
					}}
				>
					<input type="hidden" name="mode" value={data.mode} />
					<input type="hidden" name="companyId" value={data.target.card.companyId} />
					<input type="hidden" name="beforeCursor" value={data.cursor ?? ''} />
					<button class="exclude-button" type="submit">
						<ShieldAlert size={16} /> Exclude &amp; show next
					</button>
				</form>
			{/if}
			<form method="POST" action={queueAction('skip')}>
				<input type="hidden" name="mode" value={data.mode} />
				<input type="hidden" name="companyId" value={data.target.card.companyId} />
				<input type="hidden" name="beforeCursor" value={data.cursor ?? ''} />
				<button class="quiet-button" type="submit">
					{data.mode === 'skipped' ? 'Keep skipped and show next' : 'Skip and show next'}
					<ArrowRight size={16} />
				</button>
			</form>
		</div>
	</footer>
{/if}

<style>
	.mode-switch {
		display: inline-flex;
		padding: 0.2rem;
		border: 1px solid var(--line);
		border-radius: 8px;
		background: #efefed;
	}

	.mode-switch a {
		min-height: 42px;
		padding: 0.65rem 0.85rem;
		border-radius: 6px;
		color: var(--muted);
		font-size: 0.76rem;
		font-weight: 800;
		text-decoration: none;
	}

	.mode-switch a.active {
		color: var(--ink);
		background: #fff;
		box-shadow: 0 1px 4px rgb(0 0 0 / 8%);
	}

	.notice {
		display: flex;
		align-items: center;
		gap: 0.65rem;
		margin-bottom: 1rem;
		padding: 0.85rem 1rem;
		border: 1px solid #b8d9ca;
		border-radius: 8px;
		color: #164e3a;
		background: #edf8f3;
	}

	.notice.warning {
		align-items: flex-start;
		border-color: #e1c79d;
		color: #784b0d;
		background: #fff8ec;
	}

	.company-context,
	.leader-review > header,
	.search-row,
	.pending-heading,
	.queue-actions {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
	}

	.company-context h2,
	.leader-review h3,
	.pending-heading h4 {
		margin: 0;
	}

	.company-context p,
	.queue-actions p {
		margin: 0;
		color: var(--muted);
	}

	.company-context {
		margin-bottom: 1rem;
		padding: 1rem 1.1rem;
		border-radius: 10px;
		color: #fff;
		background: #173d32;
	}

	.company-context p {
		color: #c9ded6;
	}

	.company-context .secondary-button {
		border-color: rgb(255 255 255 / 30%);
		color: #fff;
		background: rgb(255 255 255 / 8%);
	}

	.backfill-form {
		display: grid;
		gap: 1rem;
	}

	.leader-review {
		padding: 1.1rem;
		border: 1px solid var(--line);
		border-radius: 10px;
		background: var(--paper);
	}

	.capacity {
		padding: 0.35rem 0.55rem;
		border-radius: 999px;
		color: var(--muted);
		background: #efefed;
		font-size: 0.72rem;
		font-weight: 800;
	}

	.saved-portraits,
	.preview-grid {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 0.65rem;
		margin-top: 1rem;
	}

	.saved-portraits figure,
	.preview-grid figure,
	.empty-slot {
		position: relative;
		overflow: hidden;
		min-height: 145px;
		margin: 0;
		border: 1px solid var(--line);
		border-radius: 8px;
		background: #f2f2ef;
	}

	.saved-portraits img,
	.preview-grid img {
		width: 100%;
		height: 145px;
		object-fit: cover;
	}

	.saved-portraits figcaption,
	.preview-grid figcaption {
		overflow: hidden;
		padding: 0.45rem 0.55rem;
		color: var(--muted);
		font-size: 0.72rem;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.empty-slot {
		display: grid;
		place-content: center;
		justify-items: center;
		gap: 0.35rem;
		border-style: dashed;
		color: var(--muted);
		font-size: 0.72rem;
		font-weight: 700;
	}

	.search-row {
		margin-top: 1rem;
		padding-top: 1rem;
		border-top: 1px solid var(--line);
	}

	.search-context {
		display: grid;
		min-width: 0;
		gap: 0.25rem;
	}

	.search-context span {
		color: var(--muted);
		font-size: 0.68rem;
		font-weight: 800;
		letter-spacing: 0.08em;
		text-transform: uppercase;
	}

	.search-context code {
		overflow-wrap: anywhere;
		font-size: 0.83rem;
	}

	.google-button,
	.file-picker {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 0.45rem;
		min-height: 42px;
		padding: 0.65rem 0.8rem;
		border: 1px solid #a8c9bc;
		border-radius: 7px;
		color: #164e3a;
		background: #edf8f3;
		font-size: 0.76rem;
		font-weight: 800;
		text-decoration: none;
		white-space: nowrap;
		cursor: pointer;
	}

	.paste-zone {
		display: grid;
		width: 100%;
		grid-template-columns: auto minmax(0, 1fr);
		align-items: center;
		gap: 0.9rem;
		margin-top: 0.85rem;
		padding: 1rem;
		border: 1px dashed #91aa9f;
		border-radius: 9px;
		color: inherit;
		background: #f7faf8;
		font: inherit;
		text-align: left;
		cursor: pointer;
	}

	.paste-zone:focus {
		border-color: var(--accent);
		outline: 3px solid rgb(17 97 73 / 22%);
		outline-offset: 2px;
		background: #f7fbf9;
	}

	.paste-zone p {
		margin: 0.2rem 0 0;
		color: var(--muted);
		font-size: 0.78rem;
		line-height: 1.45;
	}

	.file-picker input {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip: rect(0, 0, 0, 0);
		white-space: nowrap;
		clip-path: inset(50%);
	}

	.file-picker {
		margin-top: 0.55rem;
	}

	.upload-error {
		margin: 0.55rem 0 0;
		color: #9b321f;
		font-size: 0.78rem;
		font-weight: 700;
	}

	.pending-heading {
		margin-top: 1rem;
	}

	.pending-heading strong {
		color: var(--muted);
		font-size: 0.75rem;
	}

	.preview-grid {
		margin-top: 0.6rem;
	}

	.preview-grid figure {
		border-color: #8eb5a5;
		background: #edf8f3;
	}

	.preview-grid button {
		position: absolute;
		top: 0.4rem;
		right: 0.4rem;
		display: grid;
		width: 42px;
		height: 42px;
		place-content: center;
		border: 1px solid rgb(255 255 255 / 60%);
		border-radius: 999px;
		color: #fff;
		background: rgb(20 35 30 / 82%);
		cursor: pointer;
	}

	.complete-message {
		display: flex;
		align-items: center;
		gap: 0.45rem;
		margin: 1rem 0 0;
		color: #28634e;
		font-size: 0.8rem;
		font-weight: 700;
	}

	.queue-actions {
		padding: 0.85rem 0 0.2rem;
	}

	.primary-button,
	.secondary-button,
	.exclude-button,
	.quiet-button {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 0.45rem;
		min-height: 42px;
	}

	.exclude-button {
		padding: 0.65rem 0.9rem;
		border: 1px solid #dcb8b5;
		border-radius: 7px;
		color: #8d2924;
		background: #fff7f6;
		font: inherit;
		font-size: 0.76rem;
		font-weight: 800;
		cursor: pointer;
	}

	.primary-button:disabled {
		cursor: not-allowed;
		opacity: 0.45;
	}

	.queue-action-controls {
		display: flex;
		flex-wrap: wrap;
		justify-content: flex-end;
		gap: 0.65rem;
	}

	.queue-action-controls form {
		display: flex;
	}

	.empty-state {
		display: grid;
		justify-items: start;
		gap: 0.7rem;
	}

	.empty-state h2,
	.empty-state p {
		margin: 0;
	}

	@media (max-width: 720px) {
		.company-context,
		.leader-review > header,
		.search-row,
		.queue-actions {
			align-items: stretch;
			flex-direction: column;
		}

		.company-context .secondary-button,
		.google-button,
		.primary-button,
		.queue-action-controls,
		.queue-action-controls form,
		.queue-action-controls button {
			width: 100%;
		}

		.saved-portraits,
		.preview-grid {
			grid-template-columns: 1fr 1fr;
		}

		.file-picker {
			width: 100%;
		}
	}

	@media (max-width: 440px) {
		.saved-portraits,
		.preview-grid {
			grid-template-columns: 1fr;
		}
	}
</style>
