declare module 'virtual:pwa-info' {
	export const pwaInfo: { webManifest: { href: string; useCredentials: boolean } } | undefined;
}
