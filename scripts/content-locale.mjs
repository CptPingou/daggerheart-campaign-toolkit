const MODULE_ID = "daggerheart-campaign-toolkit";

const LOCALE_ROOT = `modules/${MODULE_ID}/locales`;
const SUPPORTED_LOCALES = new Set(["en", "fr"]);

// P2.3.4a-fix2: locale files may only replace presentation text. Mechanics,
// identities, provenance, flags, actions, effects and numeric fields are never
// writable from a translation overlay.
const TRANSLATABLE_PATHS = new Set([
  "name",
  "system.description",
  "system.motivesAndTactics",
  "system.notes",
  "system.impulses",
  "system.backgroundQuestions",
  "system.connections",
]);

let cache = new Map();

export function normalizeContentLocale(locale) {
  const value = String(locale ?? "en").trim().toLowerCase().split("-")[0];
  return SUPPORTED_LOCALES.has(value) ? value : "en";
}

export function getImportLocale() {
  const configured = game.settings?.get?.(MODULE_ID, "contentLocale");
  return normalizeContentLocale(configured || game.i18n?.lang || "en");
}

export async function loadLocaleDictionary(locale) {
  const lang = normalizeContentLocale(locale);
  if (lang === "en") return { schemaVersion: 1, locale: "en", fallback: null, entries: {} };
  if (cache.has(lang)) return cache.get(lang);

  const response = await fetch(`${LOCALE_ROOT}/${lang}.json`, { cache: "no-store" });
  if (!response.ok) throw new Error(`Unable to load locale ${lang}: HTTP ${response.status}`);
  const data = await response.json();
  cache.set(lang, data);
  return data;
}

function leafPaths(value, prefix = "") {
  if (Array.isArray(value)) return prefix ? [prefix] : [];
  if (!value || typeof value !== "object") return prefix ? [prefix] : [];
  const out = [];
  for (const [key, child] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (Array.isArray(child) || !child || typeof child !== "object") out.push(path);
    else out.push(...leafPaths(child, path));
  }
  return out;
}

export function inspectLocaleOverlay(overlay) {
  const paths = leafPaths(overlay);
  return {
    paths,
    allowedPaths: paths.filter(path => TRANSLATABLE_PATHS.has(path)),
    disallowedPaths: paths.filter(path => !TRANSLATABLE_PATHS.has(path)),
  };
}

function applyAllowedOverlay(target, overlay) {
  const inspection = inspectLocaleOverlay(overlay);
  for (const path of inspection.allowedPaths) {
    const value = foundry.utils.getProperty(overlay, path);
    if (value === undefined || value === null) continue;
    foundry.utils.setProperty(target, path, foundry.utils.deepClone(value));
  }
  return inspection;
}

export async function applyContentLocale(documentData, sourceId, locale = getImportLocale()) {
  const lang = normalizeContentLocale(locale);
  const canonicalId = sourceId ?? documentData?.flags?.[MODULE_ID]?.sourceId ?? null;
  documentData.flags ??= {};
  documentData.flags[MODULE_ID] ??= {};
  documentData.flags[MODULE_ID].contentLocale = lang;
  documentData.flags[MODULE_ID].canonicalSourceId = canonicalId;
  documentData.flags[MODULE_ID].localeFallback = lang !== "en";
  documentData.flags[MODULE_ID].localizedPaths = [];

  if (lang === "en" || !canonicalId) return documentData;

  const dictionary = await loadLocaleDictionary(lang);
  const overlay = dictionary?.entries?.[canonicalId];
  if (!overlay) return documentData;

  const inspection = applyAllowedOverlay(documentData, overlay);
  documentData.flags[MODULE_ID].localizedPaths = inspection.allowedPaths;
  documentData.flags[MODULE_ID].localeFallback = inspection.allowedPaths.length === 0;
  if (inspection.disallowedPaths.length) {
    console.warn(`${MODULE_ID} | locale overlay contains disallowed paths`, canonicalId, inspection.disallowedPaths);
  }
  return documentData;
}

export function clearLocaleCache() {
  cache = new Map();
}
