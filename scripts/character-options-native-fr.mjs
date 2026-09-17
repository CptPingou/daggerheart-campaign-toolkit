import { loadLocaleDictionary, normalizeContentLocale } from "./content-locale.mjs";

// P2.7.5b: heritage is owned by the Toolkit. Never read daggerheart.ancestries
// or daggerheart.communities as a content source at runtime.
const PACKS = Object.freeze([
  ["daggerheart-campaign-toolkit.dh-ancestries", "ancestry", "srd-2.0.ancestry"],
  ["daggerheart-campaign-toolkit.dh-communities", "community", "srd-2.0.community"],
]);

let renderedFeatureEffectObserver = null;
let renderedFeatureEffectScanQueued = false;
let renderedFeatureEffectPoll = null;

function slug(v) {
  return String(v ?? "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/['’]/g, "").replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function applyOverlay(doc, overlay) {
  let changed = 0;
  for (const [path, value] of Object.entries(overlay ?? {})) {
    if (value == null) continue;
    const nativePath = path === "description" ? "system.description" : path;
    foundry.utils.setProperty(doc, nativePath, foundry.utils.deepClone(value));
    changed++;
  }
  return changed;
}

function overlaySource(overlay) {
  const update = {};
  for (const [path, value] of Object.entries(overlay ?? {})) {
    if (value == null) continue;
    const nativePath = path === "description" ? "system.description" : path;
    foundry.utils.setProperty(update, nativePath, foundry.utils.deepClone(value));
  }
  return update;
}

function applyEmbeddedOverlay(doc, overlay) {
  const update = overlaySource(overlay);
  const fields = Object.keys(foundry.utils.flattenObject(update)).length;
  if (!fields) return 0;

  // updateSource only changes the in-memory source. It does not persist the
  // French overlay to the Actor, but it ensures Daggerheart's derived getters
  // (notably ancestry/community itemFeatures) rebuild from localized data.
  doc.updateSource(update);
  return fields;
}

function localizeMatchingFeatureEffects(feature, overlay) {
  if (feature?.type !== "feature") return { localized: 0, fields: 0 };

  const sourceName = feature._source?.name ?? feature.name;
  const sourceKey = slug(sourceName);
  if (!sourceKey) return { localized: 0, fields: 0 };

  let localized = 0, fields = 0;
  for (const effect of feature.effects ?? []) {
    const effectName = effect._source?.name ?? effect.name;
    if (slug(effectName) !== sourceKey) continue;

    const update = {};
    if (typeof overlay?.name === "string") update.name = overlay.name;
    if (typeof overlay?.description === "string") update.description = overlay.description;
    const n = Object.keys(update).length;
    if (!n) continue;

    // These Active Effects are the display entries shown in the character
    // feature list. updateSource remains runtime-only and keeps their
    // mechanical changes, flags and statuses untouched.
    effect.updateSource(foundry.utils.deepClone(update));
    localized++;
    fields += n;
  }

  return { localized, fields };
}

async function resolveFeature(ref) {
  if (!ref) return null;
  if (ref.documentName === "Item" || ref.constructor?.name === "DHItem") return ref;
  const uuid = typeof ref === "string" ? ref
    : typeof ref.item === "string" ? ref.item
    : typeof ref.uuid === "string" ? ref.uuid
    : ref.item?.uuid;
  if (!uuid) return null;
  try { return await fromUuid(uuid); } catch { return null; }
}

function canonicalOptionId(item, dictionary) {
  const type = item?.type;
  if (type !== "ancestry" && type !== "community") return null;

  // Foundryborne 2.9.x contains at least one bad loreReference (Fungril points
  // to Galapa). Prefer a source/runtime name that resolves to a canonical
  // locale entry, then use loreReference as a compatibility fallback for
  // already-localized embedded Items such as Dwarf -> Nain.
  const candidates = [
    item?._source?.name,
    item?.name,
    item?.system?.loreReference,
  ];
  for (const value of candidates) {
    const key = slug(value);
    if (!key) continue;
    const cid = `srd-2.0.${type}.${key}`;
    if (dictionary?.entries?.[cid]) return cid;
  }
  return null;
}

async function bindings(dictionary) {
  const out = [];
  for (const [packId, rootType, prefix] of PACKS) {
    const pack = game.packs.get(packId);
    if (!pack) continue;
    const docs = await pack.getDocuments();
    for (const root of docs.filter(d => d.type === rootType)) {
      const cid = canonicalOptionId(root, dictionary);
      if (!cid || !cid.startsWith(`${prefix}.`)) continue;
      out.push([cid, root]);
      for (const ref of root.system?.features ?? []) {
        const feature = await resolveFeature(ref);
        const featureKey = slug(feature?._source?.name ?? feature?.name);
        if (feature && featureKey) out.push([`${cid}.feature.${featureKey}`, feature]);
      }
    }
  }
  return out;
}

function embeddedItems() {
  const items = [];
  for (const actor of game.actors ?? []) {
    for (const item of actor.items ?? []) items.push(item);
  }
  return items;
}

function localizeEmbeddedCharacterOptions(dictionary, rows) {
  const rootOverlays = new Map();
  const featureOverlaysById = new Map();

  for (const [cid, doc] of rows) {
    const overlay = dictionary?.entries?.[cid];
    if (!overlay) continue;

    if (doc.type === "ancestry" || doc.type === "community") {
      rootOverlays.set(cid, overlay);
    } else if (doc.type === "feature" && doc.id) {
      featureOverlaysById.set(doc.id, overlay);
    }
  }

  let localized = 0, fields = 0;
  for (const item of embeddedItems()) {
    let overlay = null;

    if (item.type === "ancestry" || item.type === "community") {
      const cid = canonicalOptionId(item, dictionary);
      if (cid) overlay = rootOverlays.get(cid) ?? null;
    } else if (item.type === "feature") {
      overlay = featureOverlaysById.get(item.id) ?? null;
    }

    if (!overlay) continue;
    const effects = localizeMatchingFeatureEffects(item, overlay);
    const n = applyEmbeddedOverlay(item, overlay);
    if (n) localized++;
    localized += effects.localized;
    fields += n + effects.fields;
  }

  return { localized, fields };
}

function canonicalRootId(app, dictionary) {
  const item = app?.document ?? app?.item;
  return canonicalOptionId(item, dictionary);
}

function setRenderedDescription(root, html) {
  if (typeof html !== "string") return false;
  const editor = root.querySelector?.('[name="system.description"]');
  if (!editor) return false;

  // ProseMirror is a custom element in Foundry v14. Prefer its value property;
  // fall back to the rendered ProseMirror body. Both changes are DOM-only.
  try {
    if ("value" in editor) {
      editor.value = html;
      return true;
    }
  } catch {}

  const body = editor.querySelector?.(".ProseMirror, .editor-content");
  if (body) {
    body.innerHTML = html;
    return true;
  }
  return false;
}

async function localizeRenderedHeritage(app, element, locale) {
  const lang = normalizeContentLocale(locale);
  if (lang !== "fr") return;

  const dictionary = await loadLocaleDictionary(lang);
  const cid = canonicalRootId(app, dictionary);
  if (!cid) return;
  const overlay = dictionary?.entries?.[cid];
  if (!overlay) return;

  // Presentation-only: never update or mutate the native compendium Item.
  const nameInput = element?.querySelector?.('input[name="name"]');
  if (nameInput && typeof overlay.name === "string") nameInput.value = overlay.name;

  setRenderedDescription(element, overlay.description);
}

async function localizeRenderedFeatureEffects(element) {
  const selector = 'li[data-type="effect"][data-item-uuid]';
  const rows = [];
  if (element?.matches?.(selector)) rows.push(element);
  rows.push(...(element?.querySelectorAll?.(selector) ?? []));
  if (!rows.length) return 0;

  let localized = 0;
  for (const row of rows) {
    const uuid = row.dataset?.itemUuid;
    if (!uuid) continue;

    let effect = null;
    try { effect = await fromUuid(uuid); } catch {}
    if (!effect || effect.parent?.type !== "feature") continue;

    let changed = false;

    const name = row.querySelector?.(".item-name");
    if (name && typeof effect.name === "string") {
      const renderedName = [...name.childNodes]
        .filter(node => node.nodeType === Node.TEXT_NODE)
        .map(node => node.textContent ?? "")
        .join(" ")
        .trim();
      if (renderedName !== effect.name) {
        const expandedIcon = name.querySelector?.(".expanded-icon");
        name.replaceChildren(document.createTextNode(`${effect.name} `));
        if (expandedIcon) name.append(expandedIcon);
        changed = true;
      }
    }

    const description = row.querySelector?.(".inventory-description");
    if (description && typeof effect.description === "string"
      && description.innerHTML !== effect.description) {
      description.innerHTML = effect.description;
      changed = true;
    }
    if (changed) localized++;
  }

  return localized;
}

function queueRenderedFeatureEffectScan() {
  if (renderedFeatureEffectScanQueued) return;
  renderedFeatureEffectScanQueued = true;
  requestAnimationFrame(() => {
    renderedFeatureEffectScanQueued = false;
    localizeRenderedFeatureEffects(document).catch(error => {
      console.error("daggerheart-campaign-toolkit | unable to resync rendered feature effects", error);
    });
  });
}

function observeRenderedFeatureEffects() {
  if (renderedFeatureEffectObserver || !document.body) return 0;

  renderedFeatureEffectObserver = new MutationObserver(queueRenderedFeatureEffectScan);
  renderedFeatureEffectObserver.observe(document.body, {
    childList: true,
    characterData: true,
    subtree: true,
  });
  renderedFeatureEffectPoll = window.setInterval(() => {
    localizeRenderedFeatureEffects(document).catch(error => {
      console.error("daggerheart-campaign-toolkit | unable to poll rendered feature effects", error);
    });
  }, 500);
  queueRenderedFeatureEffectScan();
  return renderedFeatureEffectPoll ? 2 : 1;
}

export function registerNativeCharacterOptionPresentation(locale = "en") {
  const lang = normalizeContentLocale(locale);
  if (lang !== "fr") return 0;

  const handler = (app, element) => {
    localizeRenderedHeritage(app, element, lang).catch(error => {
      console.error("daggerheart-campaign-toolkit | unable to localize heritage presentation", error);
    });
  };

  Hooks.on("renderAncestrySheet", handler);
  Hooks.on("renderCommunitySheet", handler);

  const renderedEffectHandler = (_app, element) => {
    localizeRenderedFeatureEffects(element).catch(error => {
      console.error("daggerheart-campaign-toolkit | unable to localize rendered feature effects", error);
    });
  };
  Hooks.on("renderApplicationV2", renderedEffectHandler);
  Hooks.on("renderActorSheet", renderedEffectHandler);
  Hooks.on("renderItemSheet", renderedEffectHandler);
  observeRenderedFeatureEffects();

  const refresh = () => {
    localizeNativeCharacterOptions(lang).catch(error => {
      console.error("daggerheart-campaign-toolkit | unable to localize embedded character options", error);
    });
  };
  const refreshEmbeddedItem = item => {
    if (!item?.parent || !["ancestry", "community", "feature"].includes(item.type)) return;
    queueMicrotask(refresh);
  };

  Hooks.once("ready", refresh);
  Hooks.on("createItem", refreshEmbeddedItem);
  Hooks.on("updateItem", refreshEmbeddedItem);
  return 10;
}

export async function localizeNativeCharacterOptions(locale = "en") {
  const lang = normalizeContentLocale(locale);
  if (lang !== "fr") return {
    locale: lang,
    bindings: 0,
    localized: 0,
    fields: 0,
    missing: 0,
    embeddedLocalized: 0,
    embeddedFields: 0,
    renderedEffects: 0,
  };
  const dictionary = await loadLocaleDictionary(lang);
  const rows = await bindings(dictionary);
  let localized = 0, fields = 0, missing = 0;
  for (const [cid, doc] of rows) {
    const overlay = dictionary?.entries?.[cid];
    if (!overlay) { missing++; continue; }
    const effects = localizeMatchingFeatureEffects(doc, overlay);
    const n = applyOverlay(doc, overlay);
    if (n) localized++;
    localized += effects.localized;
    fields += n + effects.fields;
  }
  const embedded = localizeEmbeddedCharacterOptions(dictionary, rows);
  const renderedEffects = await localizeRenderedFeatureEffects(document);
  return {
    locale: lang,
    bindings: rows.length,
    localized,
    fields,
    missing,
    embeddedLocalized: embedded.localized,
    embeddedFields: embedded.fields,
    renderedEffects,
  };
}
