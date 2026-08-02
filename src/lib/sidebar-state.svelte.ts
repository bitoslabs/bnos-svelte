// Shared sidebar collapsed state — imported by both AppSidebar and +layout
// so the desktop <aside> width reacts to toggles from the sidebar component.
// Svelte 5: can't directly export $state that gets reassigned, so we use
// a reactive object wrapper instead.

const state = $state({ collapsed: false });

export function loadCollapsed() {
	try {
		state.collapsed = localStorage.getItem('bnos-os:sidebar-collapsed') === 'true';
	} catch {
		state.collapsed = false;
	}
}

export function toggleCollapsed() {
	state.collapsed = !state.collapsed;
	try {
		localStorage.setItem('bnos-os:sidebar-collapsed', String(state.collapsed));
	} catch { /* ignore */ }
}

export function isCollapsed(): boolean {
	return state.collapsed;
}

export { state as sidebarState };
