/**
 * P2.8n.1 — Virtual Toolkit card family presentation.
 *
 * Foundryborne still receives a valid native `system.domain` for document
 * hydration. Toolkit-managed cards use `flags...toolkitCard.family` as their
 * semantic family. This bridge replaces the misleading native domain label in
 * rendered item sheets only.
 */

const MODULE_ID = "daggerheart-campaign-toolkit";
const TOOLKIT_FLAG = "toolkitCard";

export function toolkitCardPresentation(document) {
  const meta = document?.flags?.[MODULE_ID]?.[TOOLKIT_FLAG] ?? null;
  if (!meta?.family) return null;

  return Object.freeze({
    family: meta.family,
    label: meta.familyLabel || meta.family,
    nativeDomain: document?.system?.domain ?? null,
  });
}

export function installToolkitCardPresentationBridge() {
  Hooks.on("renderItemSheet", (app, html) => {
    const item = app?.document ?? app?.object ?? null;
    const presentation = toolkitCardPresentation(item);
    if (!presentation) return;

    const root = html?.[0] ?? html;
    if (!(root instanceof HTMLElement)) return;

    root.dataset.toolkitCardFamily = presentation.family;
    replaceNativeDomainLabels(root, presentation);
  });

  // Foundryborne renders domain cards again inside Actor sheets/loadouts. Those
  // badges are not part of the Item sheet DOM, so they need their own pass.
  Hooks.on("renderActorSheet", (app, html) => {
    const actor = app?.document ?? app?.object ?? null;
    if (!actor) return;

    const root = html?.[0] ?? html;
    if (!(root instanceof HTMLElement)) return;

    replaceActorToolkitCardLabels(root, actor);
  });
}

function replaceActorToolkitCardLabels(root, actor) {
  const toolkitItems = [...(actor.items ?? [])]
    .map((item) => ({ item, presentation: toolkitCardPresentation(item) }))
    .filter(({ presentation }) => presentation);

  for (const { item, presentation } of toolkitItems) {
    const rows = findRenderedItemRows(root, item);
    for (const row of rows) {
      row.dataset.toolkitCardFamily = presentation.family;
      replaceNativeDomainLabels(row, presentation);
    }
  }
}

function findRenderedItemRows(root, item) {
  const ids = [item.id, item._id].filter(Boolean);
  const selectors = ids.flatMap((id) => [
    `[data-item-id="${cssEscape(id)}"]`,
    `[data-document-id="${cssEscape(id)}"]`,
    `[data-entry-id="${cssEscape(id)}"]`,
    `[data-id="${cssEscape(id)}"]`,
  ]);

  const direct = selectors.flatMap((selector) => [...root.querySelectorAll(selector)]);
  if (direct.length) return uniqueElements(direct);

  // Fallback for Foundryborne templates that do not expose the embedded item id:
  // scope by the rendered item name, then walk up to the smallest useful row.
  const wantedName = String(item.name ?? "").trim();
  if (!wantedName) return [];

  const nameNodes = [...root.querySelectorAll("h1,h2,h3,h4,label,span,div,p")]
    .filter((node) => node.children.length === 0 && node.textContent?.trim() === wantedName);

  return uniqueElements(
    nameNodes.map((node) =>
      node.closest(
        "[data-item-id],[data-document-id],[data-entry-id],[data-id],li,.item,.card,.loadout-item,.feature,.inventory-item"
      ) ?? node.parentElement
    ).filter(Boolean)
  );
}

function replaceNativeDomainLabels(root, presentation) {
  // First prefer semantic/template selectors.
  const candidates = new Set(root.querySelectorAll(
    '[data-field="system.domain"], [name="system.domain"], .domain, .domain-label, [data-domain]'
  ));

  // Foundryborne's Actor loadout currently renders the domain as a plain badge,
  // so include leaf nodes whose entire text is exactly the native domain label.
  const native = String(presentation.nativeDomain ?? "").trim().toLowerCase();
  if (native) {
    for (const node of root.querySelectorAll("span,div,label,p")) {
      if (node.children.length) continue;
      if (node.textContent?.trim().toLowerCase() === native) candidates.add(node);
    }
  }

  for (const node of candidates) {
    if (node instanceof HTMLInputElement || node instanceof HTMLSelectElement) {
      if (node instanceof HTMLSelectElement) {
        const selected = node.options[node.selectedIndex];
        if (selected) selected.textContent = presentation.label;
      }
      node.setAttribute("data-toolkit-native-domain", presentation.nativeDomain ?? "");
      node.setAttribute("aria-label", presentation.label);
      continue;
    }

    const value = node.textContent?.trim().toLowerCase();
    if (!value || value === native || value === "valor") {
      node.textContent = presentation.label;
      node.setAttribute("data-toolkit-native-domain", presentation.nativeDomain ?? "");
    }
  }
}

function cssEscape(value) {
  if (globalThis.CSS?.escape) return CSS.escape(String(value));
  return String(value).replace(/["\\]/g, "\\$&");
}

function uniqueElements(elements) {
  return [...new Set(elements)];
}

export function toolkitCardPresentationStatus() {
  const specimen = {
    system: { domain: "valor" },
    flags: {
      [MODULE_ID]: {
        [TOOLKIT_FLAG]: {
          family: "hunt",
          familyLabel: "Chasse",
          eligibility: "toolkit",
          loadoutGroup: "hunt",
        },
      },
    },
  };
  const p = toolkitCardPresentation(specimen);
  return {
    green: p?.family === "hunt" && p?.label === "Chasse" && p?.nativeDomain === "valor",
    semanticFamily: p?.family ?? null,
    displayLabel: p?.label ?? null,
    nativeDomainPreserved: p?.nativeDomain ?? null,
  };
}
