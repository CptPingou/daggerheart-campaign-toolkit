const MODULE_ID = "daggerheart-campaign-toolkit";
const CATALOG_URL = `modules/${MODULE_ID}/data/weapon-augments/motherboard.json`;
const EXPECTED_AUGMENTS = 18;
const EXPECTED_TIERS = new Map([
  [1, 10],
  [2, 3],
  [3, 3],
  [4, 2],
]);

let cachedCatalog = null;

function clone(value) {
  return foundry.utils.deepClone(value);
}

function requiredTier(augment) {
  const precompile = augment.precompile;
  if (!precompile) return 1;

  if (
    precompile.primitive !== "tier"
    || !Number.isInteger(precompile.minimum)
    || precompile.minimum < 2
    || precompile.minimum > 4
  ) {
    throw new Error(`Unsupported Motherboard precompile for ${augment.id}.`);
  }

  return precompile.minimum;
}

function validateRecipe(augment) {
  if (!Array.isArray(augment.recipe) || augment.recipe.length === 0) {
    throw new Error(`Augment ${augment.id} requires a non-empty recipe.`);
  }

  for (const ingredient of augment.recipe) {
    if (
      !ingredient
      || typeof ingredient.resource !== "string"
      || !ingredient.resource.trim()
      || !Number.isInteger(ingredient.quantity)
      || ingredient.quantity <= 0
    ) {
      throw new Error(`Invalid recipe ingredient for ${augment.id}.`);
    }
  }
}

function validateFeature(augment) {
  if (!augment.feature || typeof augment.feature !== "object") {
    throw new Error(`Augment ${augment.id} requires a feature declaration.`);
  }

  if (
    typeof augment.feature.primitive !== "string"
    || !augment.feature.primitive.trim()
  ) {
    throw new Error(`Augment ${augment.id} requires a feature primitive.`);
  }
}

export function validateMotherboardAugmentCatalog(catalog) {
  if (!catalog || typeof catalog !== "object") {
    throw new Error("Motherboard Augment catalog is absent or invalid.");
  }

  if (catalog.schemaVersion !== 1) {
    throw new Error(
      `Unsupported Motherboard Augment catalog schemaVersion: ${catalog.schemaVersion ?? "missing"}.`,
    );
  }

  if (catalog.id !== "motherboard.base-augments") {
    throw new Error(`Unexpected Motherboard Augment catalog id: ${catalog.id ?? "missing"}.`);
  }

  if (
    catalog.slotProgression?.tier1 !== 2
    || catalog.slotProgression?.additionalPerTier !== 1
  ) {
    throw new Error("Motherboard slot progression must be Tier 1 = 2, +1 per subsequent tier.");
  }

  if (!Array.isArray(catalog.augments)) {
    throw new Error("Motherboard Augment catalog augments must be an array.");
  }

  if (catalog.augments.length !== EXPECTED_AUGMENTS) {
    throw new Error(
      `Motherboard Augment catalog expected ${EXPECTED_AUGMENTS} entries, found ${catalog.augments.length}.`,
    );
  }

  const ids = new Set();
  const names = new Set();
  const tierCounts = new Map([[1, 0], [2, 0], [3, 0], [4, 0]]);

  for (const augment of catalog.augments) {
    if (!augment || typeof augment !== "object") {
      throw new Error("Each Motherboard Augment must be an object.");
    }

    if (typeof augment.id !== "string" || !augment.id.startsWith("motherboard.")) {
      throw new Error(`Invalid Motherboard Augment id: ${augment.id ?? "missing"}.`);
    }

    if (ids.has(augment.id)) {
      throw new Error(`Duplicate Motherboard Augment id: ${augment.id}.`);
    }
    ids.add(augment.id);

    if (typeof augment.name !== "string" || !augment.name.trim()) {
      throw new Error(`Augment ${augment.id} requires a name.`);
    }

    if (names.has(augment.name)) {
      throw new Error(`Duplicate Motherboard Augment name: ${augment.name}.`);
    }
    names.add(augment.name);

    if (typeof augment.description !== "string" || !augment.description.trim()) {
      throw new Error(`Augment ${augment.id} requires a description.`);
    }

    validateRecipe(augment);
    validateFeature(augment);

    const tier = requiredTier(augment);
    tierCounts.set(tier, tierCounts.get(tier) + 1);
  }

  for (const [tier, expected] of EXPECTED_TIERS) {
    const actual = tierCounts.get(tier);
    if (actual !== expected) {
      throw new Error(
        `Motherboard Augment Tier ${tier} count mismatch: expected ${expected}, found ${actual}.`,
      );
    }
  }

  return {
    green: true,
    catalogId: catalog.id,
    augments: catalog.augments.length,
    tierCounts: Object.fromEntries(tierCounts),
    slotProgression: clone(catalog.slotProgression),
  };
}

export async function loadMotherboardAugmentCatalog({ refresh = false } = {}) {
  if (cachedCatalog && !refresh) {
    return clone(cachedCatalog);
  }

  const response = await fetch(CATALOG_URL, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(
      `Unable to load Motherboard Augment catalog: HTTP ${response.status}.`,
    );
  }

  const catalog = await response.json();
  validateMotherboardAugmentCatalog(catalog);
  cachedCatalog = clone(catalog);
  return clone(cachedCatalog);
}

export async function listMotherboardAugments({ tier = null } = {}) {
  const catalog = await loadMotherboardAugmentCatalog();

  if (tier === null) {
    return clone(catalog.augments);
  }

  if (!Number.isInteger(tier) || tier < 1 || tier > 4) {
    throw new Error("tier must be an integer between 1 and 4.");
  }

  return clone(
    catalog.augments.filter((augment) => requiredTier(augment) <= tier),
  );
}

export async function getMotherboardAugment(augmentId) {
  if (typeof augmentId !== "string" || !augmentId.trim()) {
    throw new Error("augmentId must be a non-empty string.");
  }

  const catalog = await loadMotherboardAugmentCatalog();
  const augment = catalog.augments.find((entry) => entry.id === augmentId);

  if (!augment) {
    throw new Error(`Unknown Motherboard Augment: ${augmentId}.`);
  }

  return clone(augment);
}

export async function motherboardAugmentCatalogStatus() {
  const catalog = await loadMotherboardAugmentCatalog();
  return validateMotherboardAugmentCatalog(catalog);
}

export const motherboardAugmentCatalogApi = {
  load: loadMotherboardAugmentCatalog,
  list: listMotherboardAugments,
  get: getMotherboardAugment,
  status: motherboardAugmentCatalogStatus,
};
