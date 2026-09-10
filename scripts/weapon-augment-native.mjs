const MODULE_ID = "daggerheart-campaign-toolkit";
const TOOLKIT_PREFIX = "motherboard.";
const TOOLKIT_NATIVE_PREFIX = "motherboard-";

function toNativeFeatureId(catalogId) {
  if (typeof catalogId !== "string" || !catalogId.trim()) {
    throw new Error("catalogId must be a non-empty string.");
  }
  return catalogId.replaceAll(".", "-");
}

function toCatalogFeatureId(nativeId) {
  if (typeof nativeId !== "string" || !nativeId.trim()) {
    throw new Error("nativeId must be a non-empty string.");
  }
  if (!nativeId.startsWith(TOOLKIT_NATIVE_PREFIX)) {
    return nativeId;
  }
  return nativeId.replaceAll("-", ".");
}

function clone(value) {
  return foundry.utils.deepClone(value);
}

function assertAugment(augment) {
  if (!augment || typeof augment !== "object") {
    throw new Error("Expected a Weapon Augment catalog entry.");
  }
  if (typeof augment.id !== "string" || !augment.id.trim()) {
    throw new Error("Weapon Augment catalog entry requires a non-empty id.");
  }
  return augment;
}

function featureText(augment) {
  return augment?.feature?.rulesText
    ?? augment?.feature?.description
    ?? augment?.rulesText
    ?? augment?.description
    ?? augment?.feature?.primitive
    ?? "";
}

function effect(name, description, img, changes) {
  return {
    name,
    description,
    img,
    system: {
      changes,
    },
  };
}

function additiveChange(key, value) {
  return {
    key,
    type: "add",
    value: String(value),
  };
}

function armorChange(max) {
  return {
    type: "armor",
    value: {
      max: String(max),
    },
  };
}

function nativeActionsFromAugment(augment) {
  switch (augment.id) {
    case "motherboard.split":
      return {
        split: {
          type: "effect",
          chatDisplay: true,
          name: "Split",
          description: featureText(augment),
          img: "icons/skills/movement/arrow-upward-yellow.webp",
          cost: [
            {
              key: "stress",
              value: 1,
            },
          ],
        },
      };

    case "motherboard.follow":
      return {
        follow: {
          type: "effect",
          chatDisplay: true,
          name: "Follow",
          description: featureText(augment),
          img: "icons/magic/control/buff-luck-fortune-green.webp",
          cost: [
            {
              key: "stress",
              value: 2,
            },
          ],
        },
      };

    case "motherboard.scare":
      return {
        scare: {
          type: "effect",
          chatDisplay: true,
          name: "Scare",
          description: featureText(augment),
          img: "icons/magic/death/skull-energy-light-purple.webp",
        },
      };

    case "motherboard.kick":
      return {
        kick: {
          type: "effect",
          chatDisplay: true,
          name: "Kick",
          description: featureText(augment),
          img: "icons/skills/melee/strike-sword-steel-yellow.webp",
          cost: [
            {
              key: "stress",
              value: 2,
            },
          ],
        },
      };

    case "motherboard.zip":
      return {
        zip: {
          type: "effect",
          chatDisplay: true,
          name: "Zip",
          description: featureText(augment),
          img: "icons/skills/movement/feet-winged-boots-glowing-yellow.webp",
        },
      };

    case "motherboard.fix":
      return {
        fix: {
          type: "effect",
          chatDisplay: true,
          name: "Fix",
          description: featureText(augment),
          img: "icons/magic/life/heart-cross-strong-green.webp",
        },
      };

    default:
      return {};
  }
}

function nativeEffectsFromAugment(augment) {
  switch (augment.id) {
    case "motherboard.force":
      return [
        effect(
          "Force",
          "Gain +1 to primary weapon damage rolls.",
          "icons/skills/melee/strike-sword-slashing-red.webp",
          [additiveChange("system.bonuses.damage.primaryWeapon.bonus", 1)],
        ),
      ];

    case "motherboard.guard":
      return [
        effect(
          "Guard",
          "Gain +1 Armor Score.",
          "icons/equipment/shield/heater-steel-boss-red.webp",
          [armorChange(1)],
        ),
      ];

    case "motherboard.converge":
      return [
        effect(
          "Converge",
          "Gain +1 to attack rolls made with the primary weapon.",
          "icons/skills/targeting/crosshair-mark-rough-pink.webp",
          [additiveChange("system.bonuses.roll.primaryWeapon.bonus", 1)],
        ),
      ];

    case "motherboard.deny":
      return [
        effect(
          "Deny",
          "Gain +2 Armor Score.",
          "icons/equipment/shield/heater-steel-boss-red.webp",
          [armorChange(2)],
        ),
      ];

    case "motherboard.target":
      return [
        effect(
          "Target",
          "Gain +2 to attack rolls made with the primary weapon.",
          "icons/skills/targeting/crosshair-bars-yellow.webp",
          [additiveChange("system.bonuses.roll.primaryWeapon.bonus", 2)],
        ),
      ];

    case "motherboard.sear":
      return [
        effect(
          "Sear",
          "Gain +2 to primary weapon damage rolls.",
          "icons/magic/fire/flame-burning-sword-orange.webp",
          [additiveChange("system.bonuses.damage.primaryWeapon.bonus", 2)],
        ),
      ];

    case "motherboard.block":
      return [
        effect(
          "Block",
          "Gain +3 Armor Score and lose 1 Evasion.",
          "icons/skills/melee/shield-block-gray-yellow.webp",
          [
            armorChange(3),
            additiveChange("system.evasion", -1),
          ],
        ),
      ];

    case "motherboard.bury":
      return [
        effect(
          "Bury",
          "Gain +3 to primary weapon damage rolls.",
          "icons/skills/melee/strike-hammer-destructive-red.webp",
          [additiveChange("system.bonuses.damage.primaryWeapon.bonus", 3)],
        ),
      ];

    default:
      return [];
  }
}

function descriptorFromAugment(augment) {
  assertAugment(augment);

  return {
    name: augment.name ?? augment.id,
    img: "icons/magic/life/cross-worn-green.webp",
    description: featureText(augment),
    actions: nativeActionsFromAugment(augment),
    effects: nativeEffectsFromAugment(augment),
  };
}

function getHomebrewSettingKey() {
  const key = CONFIG?.DH?.SETTINGS?.gameSettings?.Homebrew;
  if (!key) {
    throw new Error("Daggerheart Homebrew setting key is unavailable.");
  }
  return key;
}

function getHomebrewSettings() {
  const systemId = CONFIG?.DH?.id;
  if (!systemId) {
    throw new Error("Daggerheart system id is unavailable.");
  }

  return game.settings.get(systemId, getHomebrewSettingKey());
}

function serializeHomebrewSettings(settings) {
  if (typeof settings?.toObject === "function") {
    return settings.toObject();
  }
  return clone(settings ?? {});
}

function ensureHomebrewContainers(source) {
  source.itemFeatures ??= {};
  source.itemFeatures.weaponFeatures ??= {};
  return source;
}

function sameValue(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

export async function registerWeaponAugmentNativeFeatures(catalogApi) {
  if (!catalogApi?.load || !catalogApi?.list) {
    throw new Error("Weapon Augment catalog API is unavailable.");
  }

  await catalogApi.load();
  const augments = await catalogApi.list();

  if (!Array.isArray(augments)) {
    throw new Error("Weapon Augment catalog list must be an array.");
  }

  const definitions = Object.fromEntries(
    augments.map(augment => [
      toNativeFeatureId(augment.id),
      descriptorFromAugment(augment),
    ]),
  );

  const currentSettings = getHomebrewSettings();
  const currentSource = ensureHomebrewContainers(
    serializeHomebrewSettings(currentSettings),
  );
  const currentFeatures = currentSource.itemFeatures.weaponFeatures;

  // P2.5.4h1 wrote dotted IDs. Foundry expands dotted keys into a nested
  // "motherboard" object, so remove only that invalid Toolkit-owned residue.
  if (
    currentFeatures.motherboard
    && typeof currentFeatures.motherboard === "object"
    && !Array.isArray(currentFeatures.motherboard)
  ) {
    delete currentFeatures.motherboard;
  }

  const changedIds = [];
  for (const [id, definition] of Object.entries(definitions)) {
    if (!sameValue(currentFeatures[id], definition)) {
      changedIds.push(id);
    }
    currentFeatures[id] = definition;
  }

  // Registration is world-scoped. A non-GM client consumes the definitions
  // already stored by the GM and must never attempt to write the setting.
  if (!game.user?.isGM) {
    const visible = Object.keys(definitions)
      .filter(id => Boolean(getHomebrewSettings()?.itemFeatures?.weaponFeatures?.[id]));

    return {
      green: visible.length === augments.length,
      mode: "read-only",
      expected: augments.length,
      visible: visible.length,
      missing: Object.keys(definitions).filter(id => !visible.includes(id)),
    };
  }

  if (changedIds.length > 0) {
    await game.settings.set(
      CONFIG.DH.id,
      getHomebrewSettingKey(),
      currentSource,
    );
  }

  const refreshed = getHomebrewSettings();
  if (typeof refreshed?.refreshConfig === "function") {
    refreshed.refreshConfig();
  }

  const registered = Object.keys(definitions)
    .filter(id => Boolean(getHomebrewSettings()?.itemFeatures?.weaponFeatures?.[id]));

  return {
    green: registered.length === augments.length,
    mode: changedIds.length ? "updated" : "unchanged",
    expected: augments.length,
    registered: registered.length,
    changedIds,
  };
}

export function nativeWeaponFeatureEntry(augmentId) {
  if (typeof augmentId !== "string" || !augmentId.trim()) {
    throw new Error("augmentId must be a non-empty string.");
  }

  return {
    value: toNativeFeatureId(augmentId),
    effectIds: [],
    actionIds: [],
  };
}

export function getWeaponFeatureEntries(weapon) {
  const source = weapon?.system?.weaponFeatures;
  return Array.isArray(source) ? clone(source) : [];
}

export function hasNativeWeaponFeature(weapon, augmentId) {
  const nativeId = toNativeFeatureId(augmentId);
  return getWeaponFeatureEntries(weapon)
    .some(feature => feature?.value === nativeId);
}

export function addNativeWeaponFeature(entries, augmentId) {
  const next = clone(entries);
  const nativeId = toNativeFeatureId(augmentId);
  if (!next.some(feature => feature?.value === nativeId)) {
    next.push(nativeWeaponFeatureEntry(augmentId));
  }
  return next;
}

export function removeNativeWeaponFeature(entries, augmentId) {
  const nativeId = toNativeFeatureId(augmentId);
  return clone(entries).filter(feature => feature?.value !== nativeId);
}

export function isToolkitWeaponAugmentFeatureId(id) {
  return typeof id === "string"
    && (
      id.startsWith(TOOLKIT_PREFIX)
      || id.startsWith(TOOLKIT_NATIVE_PREFIX)
    );
}

export {
  toCatalogFeatureId,
  toNativeFeatureId,
};
