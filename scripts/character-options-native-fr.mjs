import { loadLocaleDictionary, normalizeContentLocale } from "./content-locale.mjs";

const PACKS = [
  ["daggerheart.ancestries", "ancestry", "srd-2.0.ancestry"],
  ["daggerheart.communities", "community", "srd-2.0.community"],
];

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

async function bindings() {
  const out = [];
  for (const [packId, rootType, prefix] of PACKS) {
    const pack = game.packs.get(packId);
    if (!pack) continue;
    const docs = await pack.getDocuments();
    for (const root of docs.filter(d => d.type === rootType)) {
      const key = slug(root.system?.loreReference || root.name);
      if (!key) continue;
      const cid = `${prefix}.${key}`;
      out.push([cid, root]);
      for (const ref of root.system?.features ?? []) {
        const feature = await resolveFeature(ref);
        if (feature) out.push([`${cid}.feature.${slug(feature.name)}`, feature]);
      }
    }
  }
  return out;
}

export async function localizeNativeCharacterOptions(locale = "en") {
  const lang = normalizeContentLocale(locale);
  if (lang !== "fr") return { locale: lang, bindings: 0, localized: 0, fields: 0, missing: 0 };
  const dictionary = await loadLocaleDictionary(lang);
  const rows = await bindings();
  let localized = 0, fields = 0, missing = 0;
  for (const [cid, doc] of rows) {
    const overlay = dictionary?.entries?.[cid];
    if (!overlay) { missing++; continue; }
    const n = applyOverlay(doc, overlay);
    if (n) localized++;
    fields += n;
  }
  return { locale: lang, bindings: rows.length, localized, fields, missing };
}
