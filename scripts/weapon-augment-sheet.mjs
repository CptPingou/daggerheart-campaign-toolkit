import { describeWeaponAugmentPrecompile } from "./weapon-augment-precompile.mjs";
const MODULE_ID = "daggerheart-campaign-toolkit";
const TAB_ID = "augment";
const ACTIVE_AUGMENT_APPS = new WeakSet();

function getRoot(app, html) {
  if (html instanceof HTMLElement) return html;
  if (html?.[0] instanceof HTMLElement) return html[0];
  if (app?.element instanceof HTMLElement) return app.element;
  if (app?.element?.[0] instanceof HTMLElement) return app.element[0];
  return null;
}

function getWeapon(app) {
  const document = app?.document ?? app?.item ?? app?.object ?? null;
  if (document?.documentName !== "Item" || document?.type !== "weapon") return null;
  if (!document?.parent || document.parent.documentName !== "Actor") return null;
  return document;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function featureText(augment) {
  return augment?.feature?.rulesText
    ?? augment?.feature?.description
    ?? augment?.rulesText
    ?? augment?.description
    ?? augment?.feature?.primitive
    ?? "";
}

function recipeText(augment) {
  if (!Array.isArray(augment?.recipe)) return "";

  return augment.recipe
    .map(entry => `${entry.quantity} ${entry.resource}`)
    .join(", ");
}

function precompileText(augment, eligibility) {
  return describeWeaponAugmentPrecompile(
    augment?.precompile ?? null,
    eligibility,
  );
}

async function loadCatalog(api) {
  await api.weaponAugments.load();
  const listed = await api.weaponAugments.list();
  return Array.isArray(listed) ? listed : [];
}

function setActiveTab(root, tabId) {
  const nav = root.querySelector('nav.sheet-tabs[data-group="primary"]');
  if (!nav) return;

  for (const link of nav.querySelectorAll('[data-action="tab"][data-group="primary"][data-tab]')) {
    link.classList.toggle("active", link.dataset.tab === tabId);
  }

  for (const section of root.querySelectorAll('section.tab[data-group="primary"][data-tab]')) {
    section.classList.toggle("active", section.dataset.tab === tabId);
  }
}

function makeRow(augment, installed, canInstall) {
  const id = escapeHtml(augment.id);
  const name = escapeHtml(augment.name ?? augment.id);
  const rules = escapeHtml(featureText(augment));
  const action = installed ? "uninstall" : "install";
  const label = installed ? "Uninstall" : "Install";
  const disabled = !installed && !canInstall ? " disabled" : "";

  return `
    <li class="dct-augment-row" data-augment-id="${id}">
      <div class="dct-augment-copy">
        <strong>${name}</strong>
        ${rules ? `<div class="dct-augment-rules">${rules}</div>` : ""}
      </div>
      <button type="button" data-dct-augment-action="${action}"${disabled}>${label}</button>
    </li>`;
}

function makeGmCatalogRow(augment, craftedIds, installedIds, eligibility) {
  const id = escapeHtml(augment.id);
  const name = escapeHtml(augment.name ?? augment.id);
  const rules = escapeHtml(featureText(augment));
  const recipe = escapeHtml(recipeText(augment));
  const precompile = escapeHtml(precompileText(augment, eligibility));
  const crafted = craftedIds.has(augment.id);
  const installed = installedIds.has(augment.id);

  let action;
  let label;
  let disabled = "";

  if (!crafted) {
    action = "craft";
    label = eligibility?.eligible ? "Craft" : "Locked";
    if (!eligibility?.eligible) disabled = " disabled";
  } else if (installed) {
    action = "uncraft";
    label = "Installed";
    disabled = " disabled";
  } else {
    action = "uncraft";
    label = "Uncraft";
  }

  const status = installed ? "installed" : crafted ? "crafted" : "not crafted";
  const eligibilityClass = eligibility?.eligible ? "eligible" : "locked";

  return `
    <li class="dct-augment-row dct-augment-gm-row ${eligibilityClass}" data-augment-id="${id}">
      <div class="dct-augment-copy">
        <strong>${name}</strong>
        <span class="dct-augment-status">${escapeHtml(status)}</span>
        ${rules ? `<div class="dct-augment-rules">${rules}</div>` : ""}
        ${recipe ? `<div class="dct-augment-recipe"><strong>Recipe:</strong> ${recipe}</div>` : ""}
        <div class="dct-augment-precompile">${precompile}</div>
      </div>
      <button type="button" data-dct-augment-action="${action}"${disabled}>${label}</button>
    </li>`;
}

async function injectAugmentTab(app, html) {
  const weapon = getWeapon(app);
  if (!weapon) return;

  const api = game.modules.get(MODULE_ID)?.api;
  if (!api?.weaponAugmentState || !api?.weaponAugments) return;

  const stateView = api.weaponAugmentState.get(weapon);
  if (!stateView?.initialized) return;

  const root = getRoot(app, html);
  if (!root) return;

  const nav = root.querySelector('nav.sheet-tabs[data-group="primary"]');
  if (!nav) return;

  root.querySelector('[data-dct-augment-tab-link]')?.remove();
  root.querySelector('[data-dct-augment-tab-panel]')?.remove();

  let catalog;
  try {
    catalog = await loadCatalog(api);
  } catch (error) {
    console.error(`${MODULE_ID} | unable to load Weapon Augment catalog for sheet`, error);
    return;
  }

  const byId = new Map(catalog.map(entry => [entry.id, entry]));
  const { state, slots, installedCount, availableSlots } = stateView;
  const installedIds = new Set(state.installed);
  const craftedIds = new Set(state.crafted);
  const crafted = state.crafted
    .map(id => byId.get(id))
    .filter(Boolean);
  const isGM = game.user?.isGM === true;

  const eligibilityById = new Map();
  const results = await Promise.all(
    catalog.map(async augment => [
      augment.id,
      await api.weaponAugmentState.eligibility(weapon, augment.id),
    ]),
  );
  for (const [augmentId, eligibility] of results) {
    eligibilityById.set(augmentId, eligibility);
  }

  const usableCrafted = crafted.filter(
    augment => eligibilityById.get(augment.id)?.eligible === true,
  );
  const incompatibleInstalled = state.installed.filter(
    augmentId => eligibilityById.get(augmentId)?.eligible !== true,
  );

  const link = document.createElement("a");
  link.className = `${TAB_ID} dct-augment-tab-link`;
  link.dataset.action = "tab";
  link.dataset.group = "primary";
  link.dataset.tab = TAB_ID;
  link.dataset.dctAugmentTabLink = "true";
  link.innerHTML = "<span>Augments</span>";
  nav.append(link);

  const panel = document.createElement("section");
  panel.className = `tab ${TAB_ID} dct-augment-tab-panel`;
  panel.dataset.tab = TAB_ID;
  panel.dataset.group = "primary";
  panel.dataset.applicationPart = TAB_ID;
  panel.dataset.dctAugmentTabPanel = "true";

  const rows = usableCrafted.map(augment => makeRow(
    augment,
    installedIds.has(augment.id),
    availableSlots > 0
  )).join("");

  const gmControls = isGM ? `
    <fieldset class="dct-augment-fieldset dct-augment-gm-controls">
      <legend>GM Controls</legend>
      <div class="dct-augment-slot-controls">
        <strong>Weapon Augment slots</strong>
        <button type="button"
                data-dct-slot-action="decrement"
                ${slots <= installedCount ? "disabled" : ""}>−</button>
        <span>${slots}</span>
        <button type="button" data-dct-slot-action="increment">+</button>
      </div>
      <button type="button"
              data-dct-augment-resync="true">
        Resync installed Augments
      </button>
      <div class="dct-augment-note">
        Precompile eligibility is enforced. Recipes are displayed, but scrap/material consumption is not enforced yet.
      </div>
      <ul class="dct-augment-list">
        ${catalog.map(augment => makeGmCatalogRow(
          augment,
          craftedIds,
          installedIds,
          eligibilityById.get(augment.id)
        )).join("")}
      </ul>
    </fieldset>` : "";

  panel.innerHTML = `
    <fieldset class="dct-augment-fieldset">
      <legend>Augments</legend>
      <div class="dct-augment-summary">
        <strong>Slots</strong>
        <span>${installedCount} / ${slots} installed</span>
        <span>${availableSlots} available</span>
        ${incompatibleInstalled.length
          ? `<span class="dct-augment-warning">${incompatibleInstalled.length} installed Augment(s) no longer meet Precompile</span>`
          : ""}
      </div>
      <ul class="dct-augment-list">
        ${rows || '<li class="dct-augment-empty">No compatible crafted Augments.</li>'}
      </ul>
    </fieldset>
    ${gmControls}`;

  const lastPrimary = [...root.querySelectorAll('section.tab[data-group="primary"]')].at(-1);
  if (lastPrimary) lastPrimary.after(panel);
  else root.querySelector(".window-content")?.append(panel);

  nav.addEventListener("click", event => {
    const tabLink = event.target.closest(
      '[data-action="tab"][data-group="primary"][data-tab]'
    );
    if (!tabLink) return;

    if (tabLink.dataset.tab === TAB_ID) {
      ACTIVE_AUGMENT_APPS.add(app);
    } else {
      ACTIVE_AUGMENT_APPS.delete(app);
    }
  });

  link.addEventListener("click", event => {
    event.preventDefault();
    event.stopPropagation();
    ACTIVE_AUGMENT_APPS.add(app);
    setActiveTab(root, TAB_ID);
  });

  if (ACTIVE_AUGMENT_APPS.has(app)) {
    setActiveTab(root, TAB_ID);
  }

  panel.addEventListener("click", async event => {
    const resyncButton = event.target.closest("[data-dct-augment-resync]");
    if (resyncButton) {
      if (!game.user?.isGM) return;

      resyncButton.disabled = true;
      try {
        await api.weaponAugmentState.resync(weapon);
        ui.notifications.info("Installed Augments resynchronized.");
        await app.render({ force: true });
      } catch (error) {
        console.error(`${MODULE_ID} | Weapon Augment resync failed`, error);
        ui.notifications.error(error?.message ?? "Weapon Augment resync failed.");
        resyncButton.disabled = false;
      }
      return;
    }

    const slotButton = event.target.closest("[data-dct-slot-action]");
    if (slotButton) {
      if (!game.user?.isGM) return;

      const direction = slotButton.dataset.dctSlotAction;
      const nextSlots = direction === "increment" ? slots + 1 : slots - 1;
      if (!Number.isInteger(nextSlots) || nextSlots < installedCount || nextSlots < 0) return;

      slotButton.disabled = true;
      try {
        await api.weaponAugmentState.setSlots(weapon, nextSlots);
        await app.render({ force: true });
      } catch (error) {
        console.error(`${MODULE_ID} | Weapon Augment setSlots failed`, error);
        ui.notifications.error(error?.message ?? "Weapon Augment slot update failed.");
        slotButton.disabled = false;
      }
      return;
    }

    const button = event.target.closest("[data-dct-augment-action]");
    if (!button) return;

    const row = button.closest("[data-augment-id]");
    const augmentId = row?.dataset.augmentId;
    const action = button.dataset.dctAugmentAction;
    if (!augmentId || !["install", "uninstall", "craft", "uncraft"].includes(action)) return;
    if (["craft", "uncraft"].includes(action) && !game.user?.isGM) return;

    button.disabled = true;
    try {
      await api.weaponAugmentState[action](weapon, augmentId);
      await app.render({ force: true });
    } catch (error) {
      console.error(`${MODULE_ID} | Weapon Augment ${action} failed`, error);
      ui.notifications.error(error?.message ?? `Weapon Augment ${action} failed.`);
      button.disabled = false;
    }
  });
}

export function registerWeaponAugmentSheetIntegration() {
  Hooks.on("renderWeaponSheet", (app, html) => {
    injectAugmentTab(app, html).catch(error => {
      console.error(`${MODULE_ID} | Weapon Augments tab render failed`, error);
    });
  });
}
