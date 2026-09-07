import { getImportLocale, loadLocaleDictionary, inspectLocaleOverlay } from "./content-locale.mjs";

const MODULE_ID = "daggerheart-campaign-toolkit";
const PACKS = ["dh-classes", "dh-subclasses", "dh-domain-cards", "dh-weapons", "dh-armor", "dh-adversaries", "dh-environments"];

export async function localizationAudit(locale = getImportLocale()) {
  const dictionary = await loadLocaleDictionary(locale);
  const localeEntries = dictionary?.entries ?? {};
  const canonicalIds = new Set();
  let documents = 0;
  let translatedDocuments = 0;
  let fallbackDocuments = 0;
  let translatedFields = 0;

  for (const packId of PACKS) {
    const pack = game.packs.get(`${MODULE_ID}.${packId}`);
    if (!pack) continue;
    const index = await pack.getIndex({ fields: [
      `flags.${MODULE_ID}.managed`,
      `flags.${MODULE_ID}.sourceId`,
      `flags.${MODULE_ID}.canonicalSourceId`,
      `flags.${MODULE_ID}.contentLocale`,
      `flags.${MODULE_ID}.localeFallback`,
      `flags.${MODULE_ID}.localizedPaths`,
    ] });
    for (const row of index) {
      if (foundry.utils.getProperty(row, `flags.${MODULE_ID}.managed`) !== true) continue;
      documents += 1;
      const sourceId = foundry.utils.getProperty(row, `flags.${MODULE_ID}.canonicalSourceId`)
        ?? foundry.utils.getProperty(row, `flags.${MODULE_ID}.sourceId`);
      if (sourceId) canonicalIds.add(sourceId);
      const paths = foundry.utils.getProperty(row, `flags.${MODULE_ID}.localizedPaths`) ?? [];
      if (paths.length) {
        translatedDocuments += 1;
        translatedFields += paths.length;
      } else if (locale !== "en") fallbackDocuments += 1;
    }
  }

  const unknownLocaleIds = Object.keys(localeEntries).filter(id => !canonicalIds.has(id));
  const invalidEntries = [];
  for (const [id, overlay] of Object.entries(localeEntries)) {
    const inspection = inspectLocaleOverlay(overlay);
    if (inspection.disallowedPaths.length) invalidEntries.push({ id, paths: inspection.disallowedPaths });
  }

  const report = {
    phase: "P2.3.4a-fix2",
    requestedLocale: locale,
    documents,
    canonicalIds: canonicalIds.size,
    localeEntries: Object.keys(localeEntries).length,
    translatedDocuments,
    translatedFields,
    fallbackDocuments,
    unknownLocaleIds,
    invalidEntries,
    dictionaryValid: unknownLocaleIds.length === 0 && invalidEntries.length === 0,
  };
  console.table({
    requestedLocale: report.requestedLocale,
    documents: report.documents,
    canonicalIds: report.canonicalIds,
    localeEntries: report.localeEntries,
    translatedDocuments: report.translatedDocuments,
    translatedFields: report.translatedFields,
    fallbackDocuments: report.fallbackDocuments,
    unknownLocaleIds: report.unknownLocaleIds.length,
    invalidEntries: report.invalidEntries.length,
    dictionaryValid: report.dictionaryValid,
  });
  if (unknownLocaleIds.length) console.warn(`${MODULE_ID} | unknown locale IDs`, unknownLocaleIds);
  if (invalidEntries.length) console.warn(`${MODULE_ID} | disallowed locale paths`, invalidEntries);
  ui.notifications[report.dictionaryValid ? "info" : "warn"](
    `Campaign Toolkit : localisation ${report.dictionaryValid ? "valide" : "invalide — voir console"} · ${translatedDocuments}/${documents} documents traduits`
  );
  return report;
}
