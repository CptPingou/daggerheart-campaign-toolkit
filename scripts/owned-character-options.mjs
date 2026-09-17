const MODULE_ID = "daggerheart-campaign-toolkit";
const SYSTEM_PACKAGE = "daggerheart";
const DOCUMENT_TYPE = "Item";
const NATIVE_PACKS = Object.freeze([
  "classes", "subclasses", "domains", "ancestries", "communities",
  "weapons", "armor", "armors",
]);

export async function preferOwnedCharacterOptionPacks() {
  if (!game.user?.isGM) {
    return { changed: false, skipped: "GM-only", excludedPacks: [] };
  }

  const settingKey = CONFIG?.DH?.SETTINGS?.gameSettings?.CompendiumBrowserSettings;
  if (!settingKey) throw new Error("CompendiumBrowserSettings unavailable");

  const settings = game.settings.get(CONFIG.DH.id, settingKey);
  if (!settings?.toObject || !settings?.updateSource) {
    throw new Error("CompendiumBrowserSettings model unavailable");
  }

  const source = settings.toObject();
  source.excludedPacks ??= {};
  source.excludedPacks[SYSTEM_PACKAGE] ??= {};

  let changed = false;
  for (const packName of NATIVE_PACKS) {
    const pack = game.packs.get(`${SYSTEM_PACKAGE}.${packName}`);
    if (!pack) continue;

    const config = source.excludedPacks[SYSTEM_PACKAGE][packName]
      ??= { excludedDocumentTypes: [] };
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
    excludedPacks: NATIVE_PACKS
      .filter(name => game.packs.has(`${SYSTEM_PACKAGE}.${name}`))
      .map(name => `${SYSTEM_PACKAGE}.${name}`),
    owner: MODULE_ID,
  };
}
