/**
 * Command palette open-state — mounted once via `<CommandPalette />` in
 * `+layout.svelte`. Any component can open it (`command.show()`) or the user
 * hits ⌘K / Ctrl+K anywhere. Keeping the flag in a tiny store (rather than
 * inside the component) lets the topbar's "Search" trigger reach it.
 */
class CommandStore {
	open = $state(false);
	show = () => {
		this.open = true;
	};
	hide = () => {
		this.open = false;
	};
	toggle = () => {
		this.open = !this.open;
	};
}

export const command = new CommandStore();
