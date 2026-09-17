import { loadLocaleDictionary } from "./content-locale.mjs";

const MODULE_ID = "daggerheart-campaign-toolkit";
const SOURCE_PACKAGE = "daggerheart";
const CONTENT = Object.freeze([
  { type: "ancestry", source: "ancestries", target: "dh-ancestries", prefix: "srd-2.0.ancestry" },
  { type: "community", source: "communities", target: "dh-communities", prefix: "srd-2.0.community" },
]);

function slug(v) {
  return String(v ?? "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/['’]/g, "").replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function canonicalId(doc, spec, dictionary) {
  for (const value of [doc?._source?.name, doc?.name, doc?.system?.loreReference]) {
    const key = slug(value);
    if (!key) continue;
    const id = `${spec.prefix}.${key}`;
    if (dictionary?.entries?.[id]) return id;
  }
  return null;
}

function rewritePackReferences(value, sourceCollection, targetCollection) {
  if (typeof value === "string") {
    return value.replaceAll(`Compendium.${sourceCollection}.`, `Compendium.${targetCollection}.`);
  }
  if (Array.isArray(value)) {
    return value.map(entry => rewritePackReferences(entry, sourceCollection, targetCollection));
  }
  if (!value || typeof value !== "object") return value;
  for (const [key, entry] of Object.entries(value)) {
    value[key] = rewritePackReferences(entry, sourceCollection, targetCollection);
  }
  return value;
}

function applyLocale(source, overlay) {
  if (!overlay) return;
  if (typeof overlay.name === "string") source.name = overlay.name;
  for (const [path, value] of Object.entries(overlay)) {
    if (path === "name" || value == null) continue;
    const nativePath = path === "description" ? "system.description" : path;
    foundry.utils.setProperty(source, nativePath, foundry.utils.deepClone(value));
  }
}

function markOwned(source, canonical, spec) {
  source.flags ??= {};
  source.flags[MODULE_ID] = {
    ...(source.flags[MODULE_ID] ?? {}),
    canonicalId: canonical ?? null,
    contentOrigin: "core",
    contentLocale: "fr",
    owned: true,
    family: spec.type,
  };
}

async function buildLocalizedSources(spec, dictionary) {
  const sourcePack = game.packs.get(`${SOURCE_PACKAGE}.${spec.source}`);
  if (!sourcePack) throw new Error(`Bootstrap pack unavailable: ${SOURCE_PACKAGE}.${spec.source}`);
  const docs = await sourcePack.getDocuments();
  const rootCanonicalById = new Map();
  const featureCanonicalById = new Map();

  for (const root of docs.filter(doc => doc.type === spec.type)) {
    const cid = canonicalId(root, spec, dictionary);
    if (!cid) continue;
    rootCanonicalById.set(root.id, cid);
    for (const ref of root.system?.features ?? []) {
      const uuid = typeof ref === "string" ? ref : (ref?.item ?? ref?.uuid ?? ref?.item?.uuid);
      const match = typeof uuid === "string" ? uuid.match(/\.Item\.([^.]+)$/) : null;
      const featureId = match?.[1];
      if (!featureId) continue;
      const feature = docs.find(doc => doc.id === featureId);
      if (!feature) continue;
      const featureKey = slug(feature?._source?.name ?? feature.name);
      if (featureKey) featureCanonicalById.set(feature.id, `${cid}.feature.${featureKey}`);
    }
  }

  const sourceCollection = `${SOURCE_PACKAGE}.${spec.source}`;
  const targetCollection = `${MODULE_ID}.${spec.target}`;
  return docs.map(doc => {
    const source = foundry.utils.deepClone(doc.toObject());
    rewritePackReferences(source, sourceCollection, targetCollection);
    const cid = rootCanonicalById.get(doc.id) ?? featureCanonicalById.get(doc.id) ?? null;
    applyLocale(source, cid ? dictionary?.entries?.[cid] : null);
    markOwned(source, cid, spec);
    return source;
  });
}

async function replacePack(spec, sources) {
  const pack = game.packs.get(`${MODULE_ID}.${spec.target}`);
  if (!pack) throw new Error(`Owned pack unavailable: ${MODULE_ID}.${spec.target}`);
  await pack.configure({ locked: false });
  try {
    const current = await pack.getDocuments();
    if (current.length) await Item.deleteDocuments(current.map(doc => doc.id), { pack: pack.collection });
    if (sources.length) await Item.createDocuments(sources, { pack: pack.collection, keepId: true });
  } finally {
    await pack.configure({ locked: true });
  }
  return sources.length;
}

export async function materializeOwnedHeritage({ force = false } = {}) {
  if (!game.user?.isGM) return { changed: false, skipped: "GM-only" };
  const dictionary = await loadLocaleDictionary("fr");
  const result = { changed: false, locale: "fr", packs: {} };

  for (const spec of CONTENT) {
    const target = game.packs.get(`${MODULE_ID}.${spec.target}`);
    if (!target) throw new Error(`Owned pack unavailable: ${MODULE_ID}.${spec.target}`);
    const index = await target.getIndex({ fields: ["type", `flags.${MODULE_ID}.owned`] });
    const roots = index.filter(entry => entry.type === spec.type);
    const alreadyOwned = roots.length > 0 && roots.every(entry => foundry.utils.getProperty(entry, `flags.${MODULE_ID}.owned`) === true);
    if (alreadyOwned && !force) {
      result.packs[spec.target] = { changed: false, roots: roots.length, total: index.size ?? index.length };
      continue;
    }

    const sources = await buildLocalizedSources(spec, dictionary);
    const total = await replacePack(spec, sources);
    const rootCount = sources.filter(source => source.type === spec.type).length;
    result.packs[spec.target] = { changed: true, roots: rootCount, total };
    result.changed = true;
  }
  return result;
}

export async function ownedHeritageStatus() {
  const packs = {};
  for (const spec of CONTENT) {
    const pack = game.packs.get(`${MODULE_ID}.${spec.target}`);
    if (!pack) { packs[spec.target] = { present: false }; continue; }
    const index = await pack.getIndex({ fields: ["type", `flags.${MODULE_ID}.owned`, `flags.${MODULE_ID}.contentOrigin`] });
    packs[spec.target] = {
      present: true,
      total: index.size ?? index.length,
      roots: index.filter(entry => entry.type === spec.type).length,
      owned: index.filter(entry => foundry.utils.getProperty(entry, `flags.${MODULE_ID}.owned`) === true).length,
    };
  }
  return { owner: MODULE_ID, packs };
}
