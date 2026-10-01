import type { AuthenticatedSession } from '#lib/server/auth/session.js';

declare global {
	namespace App {
		// interface Error {}
		interface Locals {
			session: AuthenticatedSession | null;
		}
		// interface PageData {}
		// interface PageState {}
		// interface Platform {}
	}
}

export {};
