const MODULE_ID = "daggerheart-campaign-toolkit";
const PACK_ID = `${MODULE_ID}.dh-domain-cards`;
const BUTTON_CLASS = "dct-toolkit-cards-button";

function rootElement(html) {
  if (html instanceof HTMLElement) return html;
  if (html?.[0] instanceof HTMLElement) return html[0];
  return null;
}

function actorFromApp(app) {
  return app?.actor ?? app?.document ?? app?.object ?? null;
}

function escapeHtml(value) {
  const div = document.createElement("div");
  div.textContent = String(value ?? "");
  return div.innerHTML;
}

async function familySourceCards(api, family) {
  const pack = game.packs.get(PACK_ID);
  if (!pack) throw new Error(`Campaign Toolkit | Missing pack ${PACK_ID}`);
  const docs = await pack.getDocuments();
  return docs.filter(doc => api.toolkitCardFamilies.metadata(doc)?.family === family);
}

function cardRow({ source, embedded, selected, disabled }) {
  const id = source?.id ?? embedded?.id ?? "";
  const name = source?.name ?? embedded?.name ?? "Carte";
  const action = selected ? "remove" : "add";
  const label = selected ? "Retirer" : "Ajouter";
  return `
    <div class="dct-card-family-row" style="display:grid;grid-template-columns:1fr auto;gap:.75rem;align-items:center;padding:.45rem 0;border-bottom:1px solid var(--color-border-light-2);">
      <div>
        <strong>${escapeHtml(name)}</strong>
        ${selected ? '<div style="opacity:.7;font-size:.85em">Équipée</div>' : ""}
      </div>
      <button type="button" data-dct-action="${action}" data-source-id="${escapeHtml(id)}" ${disabled ? "disabled" : ""}>
        ${label}
      </button>
    </div>`;
}

async function renderManagerContent(actor, api, family) {
  const definition = api.toolkitCardFamilies.definition(family);
  if (!definition) throw new Error(`Campaign Toolkit | Unknown Toolkit card family ${family}`);

  const sources = await familySourceCards(api, family);
  const embedded = api.toolkitCardFamilies.actorCards(actor, family);
  const byCanonical = new Map(
    embedded.map(item => [
      item.flags?.[MODULE_ID]?.canonicalSourceId ?? item.flags?.[MODULE_ID]?.sourceId ?? null,
      item,
    ]),
  );
  const byName = new Map(embedded.map(item => [item.name, item]));
  const atLimit = definition.maxCards !== null && embedded.length >= definition.maxCards;

  const rows = sources.map(source => {
    const canonical = source.flags?.[MODULE_ID]?.canonicalSourceId ?? source.flags?.[MODULE_ID]?.sourceId ?? null;
    const installed = (canonical && byCanonical.get(canonical)) || byName.get(source.name) || null;
    return cardRow({
      source,
      embedded: installed,
      selected: Boolean(installed),
      disabled: !installed && atLimit,
    });
  }).join("");

  return `
    <div class="dct-toolkit-card-manager" data-family="${escapeHtml(family)}">
      <p><strong>${escapeHtml(definition.label)}</strong> — ${embedded.length}/${definition.maxCards ?? "∞"} cartes équipées.</p>
      <div>${rows || "<p>Aucune carte disponible.</p>"}</div>
    </div>`;
}

async function openToolkitCardManager(actor, family = "hunt") {
  const api = game.modules.get(MODULE_ID)?.api;
  if (!api?.toolkitCardFamilies) throw new Error("Campaign Toolkit | Toolkit Card Families API unavailable");

  const DialogV2 = foundry?.applications?.api?.DialogV2;
  if (!DialogV2) throw new Error("Campaign Toolkit | DialogV2 unavailable");

  const content = await renderManagerContent(actor, api, family);
  const definition = api.toolkitCardFamilies.definition(family);

  const dialog = new DialogV2({
    window: { title: `Cartes ${definition?.label ?? family} — ${actor.name}` },
    content,
    buttons: [{ action: "close", label: "Fermer", default: true }],
  });

  dialog.addEventListener?.("render", () => {});
  await dialog.render(true);

  // DialogV2's element is available after render. Delegate clicks so the
  // content can be refreshed after each add/remove operation.
  const element = dialog.element;
  if (!element) return dialog;

  const refresh = async () => {
    const body = element.querySelector(".window-content");
    if (body) body.innerHTML = await renderManagerContent(actor, api, family);
  };

  element.addEventListener("click", async event => {
    const button = event.target.closest?.("[data-dct-action]");
    if (!button) return;

    const action = button.dataset.dctAction;
    const sourceId = button.dataset.sourceId;
    button.disabled = true;

    try {
      if (action === "add") {
        const pack = game.packs.get(PACK_ID);
        const source = await pack.getDocument(sourceId);
        const result = await api.toolkitCardFamilies.importCard(actor, source, { family });
        if (!result.imported) {
          ui.notifications.warn(
            result.reason === "max-loadout"
              ? `${definition.label} : maximum ${result.max} cartes.`
              : `Import impossible : ${result.reason ?? "raison inconnue"}`,
          );
        }
      } else if (action === "remove") {
        const candidates = api.toolkitCardFamilies.actorCards(actor, family);
        const source = (await familySourceCards(api, family)).find(doc => doc.id === sourceId);
        const canonical = source?.flags?.[MODULE_ID]?.canonicalSourceId ?? source?.flags?.[MODULE_ID]?.sourceId ?? null;
        const item =
          candidates.find(i => canonical && (i.flags?.[MODULE_ID]?.canonicalSourceId ?? i.flags?.[MODULE_ID]?.sourceId) === canonical) ??
          candidates.find(i => i.name === source?.name);
        if (item) await api.toolkitCardFamilies.removeCard(actor, item);
      }

      await refresh();
      actor.sheet?.render?.(false);
    } catch (error) {
      console.error("Campaign Toolkit | Toolkit card manager action failed", error);
      ui.notifications.error(error.message ?? "Erreur Toolkit Card");
      button.disabled = false;
    }
  });

  return dialog;
}

function actorFromChooser(app) {
  const candidates = [
    app?.actor,
    app?.document?.parent,
    app?.object?.parent,
    app?.parent?.actor,
    app?.parent?.document,
    app?.parent?.object,
    app?.options?.actor,
    app?.options?.document?.parent,
    app?.options?.object?.parent,
    app?.options?.parent?.actor,
    app?.options?.parent?.document,
    app?.options?.parent?.object,
  ];

  return candidates.find(candidate => candidate?.type === "character") ?? null;
}

async function chooseCharacterActor() {
  const actors = game.actors.contents.filter(actor => actor.type === "character");
  if (!actors.length) {
    ui.notifications.warn("Campaign Toolkit | Aucun personnage disponible.");
    return null;
  }
  if (actors.length === 1) return actors[0];

  const options = actors
    .map(actor => `<option value="${escapeHtml(actor.id)}">${escapeHtml(actor.name)}</option>`)
    .join("");

  const result = await foundry.applications.api.DialogV2.prompt({
    window: { title: "Cartes Chasse — personnage" },
    content: `
      <div class="form-group">
        <label>Personnage</label>
        <select name="actorId">${options}</select>
      </div>`,
    ok: {
      label: "Ouvrir",
      callback: (_event, button, dialog) =>
        dialog.element?.querySelector('select[name="actorId"]')?.value ?? null,
    },
  });

  return result ? game.actors.get(result) ?? null : null;
}

function injectHuntActionIntoCreateDialog(app) {
  const element = app?.element;
  if (!(element instanceof HTMLElement)) return;

  const footer = element.querySelector("footer.form-footer");
  if (!footer) return;

  const create = footer.querySelector('[data-action="create"]');
  const browse = footer.querySelector('[data-action="browse"]');
  if (!create || !browse) return;

  // Scope this to the Foundryborne item chooser: both native actions must be
  // present. Injection is idempotent across ApplicationV2 rerenders.
  if (footer.querySelector('[data-dct-action="hunt"]')) return;

  // Do not use the controlled token as an ownership fallback. The chooser
  // does not always expose its Actor in Foundryborne 2.9.4; in that case we
  // keep the Chasse button and ask explicitly which character to manage.
  const contextualActor = actorFromChooser(app);

  const button = document.createElement("button");
  button.type = "button";
  button.dataset.dctAction = "hunt";
  button.innerHTML = '<i class="fa-solid fa-crosshairs"></i><span>Chasse</span>';
  button.addEventListener("click", async event => {
    event.preventDefault();
    event.stopPropagation();
    const actor = contextualActor ?? await chooseCharacterActor();
    if (!actor) return;
    await app.close?.();
    await openToolkitCardManager(actor, "hunt");
  });

  footer.append(button);
}

function inspectApplicationV2(app) {
  injectHuntActionIntoCreateDialog(app);
}

let registered = false;

function injectApplicationV2(app) {
  const actor = actorFromApp(app);
  if (!actor || actor.type !== "character") return;
  injectButton(app, app.element);
}

export function registerToolkitCardSheetIntegration() {
  if (registered) return false;
  registered = true;

  // The Loadout "+" chooser is an ApplicationV2 dialog. We extend its footer
  // only when both native Foundryborne actions (create + browse) are present.
  Hooks.on("renderApplicationV2", inspectApplicationV2);
  return true;
}

export const toolkitCardSheetApi = Object.freeze({
  open: openToolkitCardManager,
  register: registerToolkitCardSheetIntegration,
});
