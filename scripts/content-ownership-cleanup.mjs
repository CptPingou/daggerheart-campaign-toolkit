const MODULE_ID = "daggerheart-campaign-toolkit";
const SYSTEM_PACKAGE = "daggerheart";
const DOCUMENT_TYPE = "Item";

// Families for which the Toolkit is already the presentation/runtime owner.
// Equipment is deliberately excluded until the FR coverage pass is complete.
const OWNED_FAMILIES = Object.freeze({
  ancestry: "dh-ancestries",
  community: "dh-communities",
  class: "dh-classes",
  subclass: "dh-subclasses",
  domainCard: "dh-domain-cards",
});

function countBy(values) {
  const out = {};
  for (const value of values) out[value] = (out[value] ?? 0) + 1;
  return out;
}

async function packTypes(pack) {
  const index = await pack.getIndex({ fields: ["type"] });
  return new Set([...index].map(entry => entry.type).filter(Boolean));
}

async function discoverNativeOwnedPacks() {
  const rows = [];
  for (const pack of game.packs) {
    if (pack.metadata?.packageName !== SYSTEM_PACKAGE || pack.documentName !== DOCUMENT_TYPE) continue;
    const types = await packTypes(pack);
    const managed = [...types].filter(type => OWNED_FAMILIES[type]);
    if (!managed.length) continue;
    rows.push({ pack, types: [...types], managed });
  }
  return rows;
}

async function excludeNativeOwnedPacks() {
  if (!game.user?.isGM) return { changed: false, skipped: "GM-only", excludedPacks: [] };

  const settingKey = CONFIG?.DH?.SETTINGS?.gameSettings?.CompendiumBrowserSettings;
  if (!settingKey) throw new Error("CompendiumBrowserSettings unavailable");
  const settings = game.settings.get(CONFIG.DH.id, settingKey);
  if (!settings?.toObject || !settings?.updateSource) throw new Error("CompendiumBrowserSettings model unavailable");

  const source = settings.toObject();
  source.excludedPacks ??= {};
  source.excludedPacks[SYSTEM_PACKAGE] ??= {};
  const native = await discoverNativeOwnedPacks();
  let changed = false;

  for (const { pack } of native) {
    const packName = pack.metadata?.name ?? pack.collection.split(".").at(-1);
    const config = source.excludedPacks[SYSTEM_PACKAGE][packName] ??= { excludedDocumentTypes: [] };
    config.excludedDocumentTypes ??= [];
    if (!config.excludedDocumentTypes.includes(DOCUMENT_TYPE)) {
      config.excludedDocumentTypes.push(DOCUMENT_TYPE);
      changed = true;
    }
  }

  if (changed) {
    settings.updateSource(source);
    await game.settings.set(CONFIG.DH.id, settingKey, settings.toObject());
  }

  return {
    changed,
    excludedPacks: native.map(({ pack }) => pack.collection),
    families: Object.keys(OWNED_FAMILIES),
  };
}

async function auditOwnedPack(type, packName) {
  const pack = game.packs.get(`${MODULE_ID}.${packName}`);
  if (!pack) return { present: false };
  const index = await pack.getIndex({ fields: ["name", "type", `flags.${MODULE_ID}.canonicalId`, `flags.${MODULE_ID}.owned`] });
  const rows = [...index];
  const roots = rows.filter(row => row.type === type);
  const names = countBy(rows.map(row => `${row.type}:${String(row.name ?? "").trim().toLocaleLowerCase()}`));
  const repeatedNames = Object.entries(names).filter(([, n]) => n > 1).map(([key, count]) => ({ key, count }));
  const canonical = rows.map(row => foundry.utils.getProperty(row, `flags.${MODULE_ID}.canonicalId`)).filter(Boolean);
  const canonicalCounts = countBy(canonical);
  const duplicateCanonicalIds = Object.entries(canonicalCounts).filter(([, n]) => n > 1).map(([canonicalId, count]) => ({ canonicalId, count }));
  return {
    present: true,
    total: rows.length,
    roots: roots.length,
    owned: rows.filter(row => foundry.utils.getProperty(row, `flags.${MODULE_ID}.owned`) === true).length,
    repeatedNames,
    duplicateCanonicalIds,
  };
}

export async function cleanupOwnedContentPresentation() {
  const browser = await excludeNativeOwnedPacks();
  return { owner: MODULE_ID, browser };
}

export async function contentOwnershipStatus() {
  const native = await discoverNativeOwnedPacks();
  const owned = {};
  for (const [type, packName] of Object.entries(OWNED_FAMILIES)) {
    owned[packName] = await auditOwnedPack(type, packName);
  }
  return {
    owner: MODULE_ID,
    nativeOwnedFamilies: native.map(({ pack, types, managed }) => ({ pack: pack.collection, types, managed })),
    owned,
    note: "Repeated feature names are not automatically duplicates: e.g. Amphibious belongs to both Ribbet and Tidekin and has distinct canonical IDs.",
  };
}
