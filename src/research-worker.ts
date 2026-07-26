import { runResearchWorker } from '$lib/server/research-runner/worker';

const controller = new AbortController();
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
	process.once(signal, () => controller.abort());
}

const once = process.argv.includes('--once');

runResearchWorker({ once, signal: controller.signal }).catch((cause) => {
	console.error(cause);
	process.exitCode = 1;
});
