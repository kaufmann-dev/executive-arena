import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vitest/config';
import adapter from '@sveltejs/adapter-node';
import { sveltekit } from '@sveltejs/kit/vite';

export default defineConfig({
	plugins: [
		tailwindcss(),
		sveltekit({
			compilerOptions: {
				// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
				runes: ({ filename }) =>
					filename.split(/[/\\]/).includes('node_modules') ? undefined : true
			},
			adapter: adapter(),
			// Public origin behind the reverse proxy; used for CSRF checks and request URLs.
			paths: { origin: process.env.ORIGIN || undefined },
			csp: {
				mode: 'auto',
				directives: {
					'default-src': ['self'],
					'base-uri': ['self'],
					'connect-src': ['self'],
					'form-action': ['self'],
					'frame-ancestors': ['none'],
					'img-src': ['self', 'blob:'],
					'object-src': ['none'],
					'script-src': ['self'],
					'style-src': ['self', 'unsafe-inline']
				}
			}
		})
	],
	test: {
		expect: { requireAssertions: true },
		projects: [
			{
				extends: './vite.config.ts',
				test: {
					name: 'server',
					environment: 'node',
					include: ['src/**/*.{test,spec}.{js,ts}'],
					exclude: [
						'src/**/*.svelte.{test,spec}.{js,ts}',
						'src/lib/server/integration/**/*.integration.spec.ts'
					]
				}
			},
			{
				extends: './vite.config.ts',
				test: {
					name: 'integration',
					environment: 'node',
					include: ['src/lib/server/integration/**/*.integration.spec.ts'],
					fileParallelism: false
				}
			}
		]
	}
});
