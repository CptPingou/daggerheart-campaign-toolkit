const MODULE_ID = "daggerheart-campaign-toolkit";

const OWNED_NATIVE_PACKS = Object.freeze([
  "daggerheart.ancestries",
  "daggerheart.communities",
  "daggerheart.classes",
  "daggerheart.subclasses",
  "daggerheart.domains",
  "daggerheart.weapons",
  "daggerheart.armor",
  "daggerheart.armors",
]);

export function ownedSrdBootstrapStatus() {
  return {
    owner: MODULE_ID,
    ownedFamilies: 7,
    nativeContentPacksRequired: [],
    nativeContentReadRequired: false,
    schemaAuthority: "CONFIG.Item.documentClass",
    equipmentAutomationSource: {
      weapon: `${MODULE_ID}.dh-weapons`,
      armor: `${MODULE_ID}.dh-armor`,
    },
    excludedNativePacks: [...OWNED_NATIVE_PACKS],
    actorLegacyBootstrapRemaining: true,
    actorLegacyScope: ["adversary", "environment"],
    green: true,
  };
}
