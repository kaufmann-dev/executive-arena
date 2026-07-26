<script lang="ts">
	const SIGNAL_INTERVAL_MS = 5 * 60 * 1000;
	let lastSignalAt = 0;

	function signalActivity(event: Event) {
		if (!event.isTrusted || Date.now() - lastSignalAt < SIGNAL_INTERVAL_MS) return;
		lastSignalAt = Date.now();
		void fetch('/auth/activity', {
			method: 'POST',
			credentials: 'same-origin',
			headers: { 'x-executive-arena-user-activity': 'true' },
			cache: 'no-store'
		});
	}
</script>

<svelte:window onpointerdown={signalActivity} onkeydown={signalActivity} />
