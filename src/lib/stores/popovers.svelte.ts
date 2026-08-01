/**
 * Shared popover/dropdown-menu state.
 *
 * Only one popover is open app-wide: opening one closes any other. Outside
 * click and Escape are handled globally in `+layout.svelte`, so individual
 * `Menu` triggers only need to call `toggle(id)`.
 */
class PopoverStore {
	active = $state<string | null>(null);

	open(id: string) {
		this.active = id;
	}
	toggle(id: string) {
		this.active = this.active === id ? null : id;
	}
	close() {
		this.active = null;
	}
	isOpen(id: string) {
		return this.active === id;
	}
}

export const popovers = new PopoverStore();
