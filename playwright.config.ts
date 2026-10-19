import { defineConfig } from '@playwright/test';

export default defineConfig({
	webServer: {
		command: 'yarn build && yarn preview',
		port: 4173,
		timeout: 120_000,
		reuseExistingServer: !process.env.CI
	},
	testMatch: '**/*.e2e.{ts,js}'
});
