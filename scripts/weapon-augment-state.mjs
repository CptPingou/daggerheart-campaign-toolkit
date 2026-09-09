import { evaluateWeaponAugmentPrecompile } from "./weapon-augment-precompile.mjs";
import {
  addNativeWeaponFeature,
  getWeaponFeatureEntries,
  hasNativeWeaponFeature,
  removeNativeWeaponFeature,
} from "./weapon-augment-native.mjs";
const MODULE_ID = "daggerheart-campaign-toolkit";
const FLAG_KEY = "weaponAugments";
const SCHEMA_VERSION = 1;

function clone(value) {
  return foundry.utils.deepClone(value);
}

function assertOwnedWeapon(weapon) {
  if (!weapon || weapon.documentName !== "Item" || weapon.type !== "weapon") {
    throw new Error("Expected a Foundryborne weapon Item.");
  }

  if (weapon.parent?.documentName !== "Actor") {
    throw new Error("Weapon Augment state is only supported on actor-embedded weapons.");
  }

  return weapon;
}

function assertGM() {
  if (!game.user?.isGM) {
    throw new Error("This Weapon Augment operation is GM-only.");
  }
}

function assertNonEmptyId(value, label = "augmentId") {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${label} must be a non-empty string.`);
  }
  return value;
}

function assertSlots(slots) {
  if (!Number.isInteger(slots) || slots < 0) {
    throw new Error("slots must be a non-negative integer.");
  }
  return slots;
}

function emptyState(slots = 2) {
  return {
    schemaVersion: SCHEMA_VERSION,
    slots: assertSlots(slots),
    crafted: [],
    installed: [],
  };
}

function uniqueStrings(values, label) {
  if (!Array.isArray(values)) {
    throw new Error(`${label} must be an array.`);
  }

  const result = [];
  const seen = new Set();

  for (const value of values) {
    if (typeof value !== "string" || !value.trim()) {
      throw new Error(`${label} must contain non-empty string IDs.`);
    }

    if (seen.has(value)) {
      throw new Error(`${label} contains duplicate ID: ${value}.`);
    }

    seen.add(value);
    result.push(value);
  }

  return result;
}

export function validateWeaponAugmentStateData(state) {
  if (!state || typeof state !== "object") {
    throw new Error("Weapon Augment state is absent or invalid.");
  }

  if (state.schemaVersion !== SCHEMA_VERSION) {
    throw new Error(
      `Unsupported Weapon Augment schemaVersion: ${state.schemaVersion ?? "missing"}.`,
    );
  }

  const slots = assertSlots(state.slots);
  const crafted = uniqueStrings(state.crafted, "crafted");
  const installed = uniqueStrings(state.installed, "installed");
  const craftedSet = new Set(crafted);

  for (const augmentId of installed) {
    if (!craftedSet.has(augmentId)) {
      throw new Error(`Installed Augment is not crafted: ${augmentId}.`);
    }
  }

  if (installed.length > slots) {
    throw new Error(
      `Installed Augments exceed slots: ${installed.length} installed, ${slots} slots.`,
    );
  }

  return {
    green: true,
    slots,
    craftedCount: crafted.length,
    installedCount: installed.length,
    availableSlots: slots - installed.length,
  };
}

async function resolveCatalogAugment(catalogApi, augmentId) {
  assertNonEmptyId(augmentId);

  if (!catalogApi?.get) {
    throw new Error("Weapon Augment catalog API is unavailable.");
  }

  return catalogApi.get(augmentId);
}

async function evaluatePrecompile(catalogApi, weapon, augmentId) {
  assertOwnedWeapon(weapon);
  const augment = await resolveCatalogAugment(catalogApi, augmentId);
  const evaluation = evaluateWeaponAugmentPrecompile(
    weapon,
    augment.precompile ?? null,
  );

  return {
    ...evaluation,
    augmentId: augment.id,
    precompile: clone(augment.precompile ?? null),
  };
}

async function writeState(weapon, state) {
  assertOwnedWeapon(weapon);
  validateWeaponAugmentStateData(state);
  await weapon.setFlag(MODULE_ID, FLAG_KEY, clone(state));
  return getWeaponAugmentState(weapon);
}

async function writeStateAndNativeFeatures(weapon, state, weaponFeatures) {
  assertOwnedWeapon(weapon);
  validateWeaponAugmentStateData(state);

  await weapon.update({
    [`flags.${MODULE_ID}.${FLAG_KEY}`]: clone(state),
    "system.weaponFeatures": clone(weaponFeatures),
  });

  return {
    ...getWeaponAugmentState(weapon),
    nativeWeaponFeatures: getWeaponFeatureEntries(weapon),
  };
}

export function getWeaponAugmentState(weapon) {
  assertOwnedWeapon(weapon);

  const state = weapon.getFlag(MODULE_ID, FLAG_KEY);

  if (!state) {
    const candidate = emptyState();
    return {
      state: candidate,
      initialized: false,
      ...validateWeaponAugmentStateData(candidate),
    };
  }

  return {
    state: clone(state),
    initialized: true,
    ...validateWeaponAugmentStateData(state),
  };
}

export function validateWeaponAugmentState(weapon) {
  return getWeaponAugmentState(weapon);
}

export async function initializeWeaponAugments(weapon, { slots = 2 } = {}) {
  assertOwnedWeapon(weapon);
  assertGM();

  if (weapon.getFlag(MODULE_ID, FLAG_KEY)) {
    throw new Error("Weapon Augment state is already initialized.");
  }

  return writeState(weapon, emptyState(slots));
}

export async function setWeaponAugmentSlots(weapon, slots) {
  assertOwnedWeapon(weapon);
  assertGM();
  assertSlots(slots);

  const current = getWeaponAugmentState(weapon);
  if (!current.initialized) {
    throw new Error("Weapon Augment state must be initialized first.");
  }

  if (current.state.installed.length > slots) {
    throw new Error(
      `Cannot reduce slots to ${slots}: ${current.state.installed.length} Augments are installed.`,
    );
  }

  const next = clone(current.state);
  next.slots = slots;
  return writeState(weapon, next);
}

export function createWeaponAugmentStateApi(catalogApi) {
  return {
    get: getWeaponAugmentState,
    validate: validateWeaponAugmentState,

    initialize: initializeWeaponAugments,

    setSlots: setWeaponAugmentSlots,

    eligibility(weapon, augmentId) {
      return evaluatePrecompile(catalogApi, weapon, augmentId);
    },

    nativeStatus(weapon, augmentId) {
      assertOwnedWeapon(weapon);
      assertNonEmptyId(augmentId);

      const current = getWeaponAugmentState(weapon);
      return {
        augmentId,
        installed: current.state.installed.includes(augmentId),
        nativeFeature: hasNativeWeaponFeature(weapon, augmentId),
      };
    },

    async craft(weapon, augmentId) {
      assertOwnedWeapon(weapon);
      assertGM();

      const current = getWeaponAugmentState(weapon);
      if (!current.initialized) {
        throw new Error("Weapon Augment state must be initialized first.");
      }

      const augment = await resolveCatalogAugment(catalogApi, augmentId);

      if (current.state.crafted.includes(augment.id)) {
        throw new Error(`Augment is already crafted: ${augment.id}.`);
      }

      const eligibility = await evaluatePrecompile(catalogApi, weapon, augment.id);
      if (!eligibility.eligible) {
        throw new Error(
          `Precompile not met for ${augment.id}: ${eligibility.reason ?? "ineligible"}`,
        );
      }

      const next = clone(current.state);
      next.crafted.push(augment.id);
      return writeState(weapon, next);
    },

    async uncraft(weapon, augmentId) {
      assertOwnedWeapon(weapon);
      assertGM();

      const current = getWeaponAugmentState(weapon);
      if (!current.initialized) {
        throw new Error("Weapon Augment state must be initialized first.");
      }

      assertNonEmptyId(augmentId);

      if (!current.state.crafted.includes(augmentId)) {
        throw new Error(`Augment is not crafted: ${augmentId}.`);
      }

      if (current.state.installed.includes(augmentId)) {
        throw new Error(`Cannot uncraft an installed Augment: ${augmentId}.`);
      }

      const next = clone(current.state);
      next.crafted = next.crafted.filter((id) => id !== augmentId);
      return writeState(weapon, next);
    },

    async install(weapon, augmentId) {
      assertOwnedWeapon(weapon);

      const current = getWeaponAugmentState(weapon);
      if (!current.initialized) {
        throw new Error("Weapon Augment state must be initialized first.");
      }

      const augment = await resolveCatalogAugment(catalogApi, augmentId);

      if (!current.state.crafted.includes(augment.id)) {
        throw new Error(`Augment must be crafted before installation: ${augment.id}.`);
      }

      const eligibility = await evaluatePrecompile(catalogApi, weapon, augment.id);
      if (!eligibility.eligible) {
        throw new Error(
          `Precompile not met for ${augment.id}: ${eligibility.reason ?? "ineligible"}`,
        );
      }

      if (current.state.installed.includes(augment.id)) {
        throw new Error(`Augment is already installed: ${augment.id}.`);
      }

      if (current.state.installed.length >= current.state.slots) {
        throw new Error(
          `No Weapon Augment slots available: ${current.state.installed.length}/${current.state.slots} occupied.`,
        );
      }

      const next = clone(current.state);
      next.installed.push(augment.id);

      const nativeFeatures = addNativeWeaponFeature(
        getWeaponFeatureEntries(weapon),
        augment.id,
      );

      return writeStateAndNativeFeatures(weapon, next, nativeFeatures);
    },

    async uninstall(weapon, augmentId) {
      assertOwnedWeapon(weapon);

      const current = getWeaponAugmentState(weapon);
      if (!current.initialized) {
        throw new Error("Weapon Augment state must be initialized first.");
      }

      assertNonEmptyId(augmentId);

      if (!current.state.installed.includes(augmentId)) {
        throw new Error(`Augment is not installed: ${augmentId}.`);
      }

      const next = clone(current.state);
      next.installed = next.installed.filter((id) => id !== augmentId);

      const nativeFeatures = removeNativeWeaponFeature(
        getWeaponFeatureEntries(weapon),
        augmentId,
      );

      return writeStateAndNativeFeatures(weapon, next, nativeFeatures);
    },
  };
}
