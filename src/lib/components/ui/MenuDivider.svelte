<script lang="ts">
	/**
	 * Thin separator between groups of `MenuItem`s inside a `Menu`.
	 *
	 *   <MenuItem icon="lucide:pencil" onclick={edit}>Edit</MenuItem>
	 *   <MenuDivider />
	 *   <MenuItem tone="danger" icon="lucide:trash-2" onclick={del}>Delete</MenuItem>
	 */
	let { class: cls = '' }: { class?: string } = $props();
</script>

<div class="my-1 h-px bg-[var(--ui-border-muted)] {cls}" role="separator"></div>
