export interface RateLimits {
	requestsPerMinute: number | null;
	tokensPerMinute: number | null;
}

export class FixedWindowRateLimiter {
	private windowStartedAt = Date.now();
	private requests = 0;
	private tokens = 0;
	private queue = Promise.resolve();

	constructor(private readonly limits: RateLimits) {}

	acquire(estimatedTokens: number): Promise<void> {
		const operation = this.queue.then(() => this.acquireWithinQueue(estimatedTokens));
		this.queue = operation.catch(() => undefined);
		return operation;
	}

	private async acquireWithinQueue(estimatedTokens: number): Promise<void> {
		while (true) {
			this.resetWindowIfNeeded();
			const reservedTokens =
				this.limits.tokensPerMinute === null
					? 0
					: Math.min(Math.max(estimatedTokens, 1), this.limits.tokensPerMinute);
			const requestAllowed =
				this.limits.requestsPerMinute === null ||
				this.requests + 1 <= this.limits.requestsPerMinute;
			const tokensAllowed =
				this.limits.tokensPerMinute === null ||
				this.tokens + reservedTokens <= this.limits.tokensPerMinute;
			if (requestAllowed && tokensAllowed) {
				this.requests += 1;
				this.tokens += reservedTokens;
				return;
			}
			await wait(Math.max(1, this.windowStartedAt + 60_000 - Date.now()));
		}
	}

	private resetWindowIfNeeded(): void {
		const now = Date.now();
		if (now - this.windowStartedAt < 60_000) return;
		this.windowStartedAt = now;
		this.requests = 0;
		this.tokens = 0;
	}
}

function wait(milliseconds: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
