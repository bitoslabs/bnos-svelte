<script lang="ts">
  import { resolve } from "$app/paths";
  import Icon from "$lib/components/ui/Icon.svelte";
  import Input from "$lib/components/ui/Input.svelte";
  import Popover from "$lib/components/ui/Popover.svelte";
  import Switch from "$lib/components/ui/Switch.svelte";
  import { relays } from "$nostr/relay.svelte";
  import { dataSync } from "$nostr/sync.svelte";
  import { t } from "$lib/i18n/i18n.svelte";

  let open = $state(false);
  let newRelay = $state("");

  const triggerClass = $derived(
    relays.online
      ? "relative inline-grid size-9 place-items-center rounded-lg border border-emerald-500/30 bg-emerald-500/10 text-emerald-600 transition-colors hover:bg-emerald-500/15 dark:text-emerald-400"
      : "relative inline-grid size-9 place-items-center rounded-lg border border-amber-500/40 bg-amber-500/10 text-amber-600 transition-colors hover:bg-amber-500/15 dark:text-amber-400",
  );
  const statusTitle = $derived(
    `${relays.online ? t("common.online") : t("common.offline")} · ${t("topbar.relaysActive", { active: relays.activeRelays.length, total: relays.relays.length })}`,
  );
  const syncState = $derived(dataSync.status);
  const syncLabel = $derived.by(() => {
    if (syncState === "syncing") return t("topbar.syncingAllData");
    if (syncState === "done") return t("common.allDataSynced");
    if (syncState === "failed") return t("common.syncFailed");
    return t("common.syncAll");
  });
  const syncIcon = $derived.by(() => {
    if (syncState === "syncing") return "lucide:loader-circle";
    if (syncState === "done") return "lucide:check";
    if (syncState === "failed") return "lucide:x";
    return "lucide:refresh-cw";
  });

  function addRelay() {
    const value = newRelay.trim();
    if (!value) return;
    relays.add(value);
    newRelay = "";
  }

  async function syncAllData() {
    await dataSync.manualSync();
  }
</script>

<Popover
  bind:open
  align="end"
  side="bottom"
  title={statusTitle}
  {triggerClass}
  triggerActiveClass="ring-2 ring-primary-500/20"
>
  {#snippet trigger()}
    <Icon
      name={relays.online ? "lucide:wifi" : "lucide:wifi-off"}
      class="size-[18px]"
    />
    <span class="absolute -right-0.5 -bottom-0.5 flex size-2.5">
      {#if relays.online}<span
          class="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-75"
        ></span>{/if}
      <span
        class="relative inline-flex size-2.5 rounded-full ring-2 ring-[var(--surface-bg)] {relays.online
          ? 'bg-emerald-500'
          : 'bg-amber-500'}"
      ></span>
    </span>
  {/snippet}
  {#snippet content()}
    <div class="w-80 space-y-2.5 p-1">
      <div class="flex items-center justify-between px-1">
        <div class="flex items-center gap-2">
          <span class="relative flex size-2.5">
            {#if relays.online}<span
                class="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-75"
              ></span>{/if}
            <span
              class="relative inline-flex size-2.5 rounded-full {relays.online
                ? 'bg-emerald-500'
                : 'bg-amber-500'}"
            ></span>
          </span>
          <span class="text-[13px] font-semibold"
            >{relays.online ? t("common.connected") : t("common.offline")}</span
          >
          <span class="text-[11px] text-[var(--ui-text-dimmed)]"
            >{t("topbar.relaysActive", {
              active: relays.activeRelays.length,
              total: relays.relays.length,
            })}</span
          >
        </div>
        <a
          href={resolve("/settings/relays")}
          onclick={() => (open = false)}
          class="text-[11.5px] font-semibold text-primary-600 hover:underline dark:text-primary-400"
          >{t("common.manage")}</a
        >
      </div>

      <form
        class="flex gap-1.5 px-1"
        onsubmit={(e) => (e.preventDefault(), addRelay())}
      >
        <Input
          bind:value={newRelay}
          size="sm"
          icon="lucide:plus"
          placeholder={t("topbar.relayPlaceholder")}
          class="flex-1"
        />
        <button
          type="submit"
          class="inline-flex h-8 shrink-0 items-center gap-1 rounded-lg bg-primary-500 px-2.5 text-[12px] font-semibold text-white transition-colors hover:bg-primary-400"
          >{t("common.add")}</button
        >
      </form>

      {#if relays.relays.length === 0}
        <div
          class="rounded-lg border border-dashed border-[var(--ui-border-muted)] px-3 py-6 text-center"
        >
          <Icon
            name="lucide:radio-off"
            class="mx-auto mb-1.5 size-5 text-[var(--ui-text-dimmed)]"
          />
          <p class="text-[12px] font-semibold text-[var(--ui-text-muted)]">
            {t("topbar.noRelays")}
          </p>
          <p class="mt-0.5 text-[11px] text-[var(--ui-text-dimmed)]">
            {t("topbar.noRelaysDesc")}
          </p>
        </div>
      {:else}
        <ul class="max-h-64 space-y-1 overflow-y-auto px-0.5">
          {#each relays.relays as url (url)}
            {@const active = relays.isActive(url)}
            {@const isPrimary = relays.primaryRelay === url}
            <li
              class="flex items-center gap-2.5 rounded-lg border border-[var(--ui-border-muted)] bg-[var(--ui-bg-muted)] px-2.5 py-2"
            >
              <span
                class="size-2 shrink-0 rounded-full {active
                  ? 'bg-emerald-500'
                  : 'bg-[var(--ui-text-dimmed)]'}"
              ></span>
              <div class="min-w-0 flex-1">
                <div class="flex items-center gap-1">
                  <p class="truncate font-mono text-[11.5px] font-medium">
                    {url.replace("wss://", "")}
                  </p>
                  {#if isPrimary}<Icon
                      name="lucide:star"
                      class="size-3 shrink-0 fill-amber-400 text-amber-500"
                    />{/if}
                </div>
                <span
                  class="text-[10px] font-semibold {active
                    ? 'text-emerald-600 dark:text-emerald-400'
                    : 'text-[var(--ui-text-dimmed)]'}"
                  >{active ? t("common.active") : t("common.inactive")}</span
                >
              </div>
              <Switch
                checked={active}
                label={active
                  ? t("topbar.deactivateRelay")
                  : t("topbar.activateRelay")}
                onCheckedChange={(v) => relays.setActive(url, v)}
              />
              <button
                type="button"
                onclick={() => relays.remove(url)}
                class="grid size-7 shrink-0 place-items-center rounded-md text-[var(--ui-text-dimmed)] transition-colors hover:bg-[var(--tone-error-bg)] hover:text-[var(--tone-error-text)]"
                aria-label={t("common.removeRelay")}
                title={t("common.removeRelay")}
                ><Icon name="lucide:x" class="size-3.5" /></button
              >
            </li>
          {/each}
        </ul>
      {/if}

      <button
        type="button"
        onclick={syncAllData}
        disabled={syncState === "syncing"}
        class="mt-1 flex w-full items-center justify-center gap-2 rounded-lg border border-[var(--ui-border)] bg-[var(--ui-bg-muted)] px-3 py-2 text-[12px] font-semibold transition-colors hover:bg-[var(--ui-bg-accented)] disabled:cursor-not-allowed disabled:opacity-60"
      >
        <Icon
          name={syncIcon}
          class="size-3.5 {syncState === 'syncing' ? 'animate-spin' : ''}"
        /><span>{syncLabel}</span>
      </button>
    </div>
  {/snippet}
</Popover>
