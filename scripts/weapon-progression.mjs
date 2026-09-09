const MODULE_ID = "daggerheart-campaign-toolkit";
const FLAG_KEY = "weaponProgression";
const SCHEMA_VERSION = 1;

function clone(value) {
  return foundry.utils.deepClone(value);
}

function assertOwnedWeapon(weapon) {
  if (!weapon || weapon.documentName !== "Item" || weapon.type !== "weapon") {
    throw new Error("Weapon progression requires a Foundry Item of type 'weapon'.");
  }

  if (!weapon.parent || weapon.parent.documentName !== "Actor") {
    throw new Error("Weapon progression is only supported on actor-embedded weapon instances.");
  }

  return weapon;
}

function assertGM(operation) {
  if (!game.user?.isGM) {
    throw new Error(`${operation} is GM-only.`);
  }
}

function assertNonNegativeInteger(value, label) {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative integer.`);
  }
}

function assertPositiveInteger(value, label) {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive integer.`);
  }
}

function assertOptionId(optionId) {
  if (typeof optionId !== "string" || !optionId.trim()) {
    throw new Error("Augment optionId must be a non-empty string.");
  }
}

function emptyProgression() {
  return {
    schemaVersion: SCHEMA_VERSION,
    points: {
      granted: 0,
      spent: 0,
    },
    unlocked: [],
    allocations: [],
  };
}

function validateProgressionData(progression) {
  if (!progression || typeof progression !== "object") {
    throw new Error("Weapon progression state is absent or invalid.");
  }

  if (progression.schemaVersion !== SCHEMA_VERSION) {
    throw new Error(
      `Unsupported weapon progression schemaVersion: ${progression.schemaVersion ?? "missing"}.`
    );
  }

  const granted = progression.points?.granted;
  const spent = progression.points?.spent;

  assertNonNegativeInteger(granted, "points.granted");
  assertNonNegativeInteger(spent, "points.spent");

  if (!Array.isArray(progression.unlocked)) {
    throw new Error("unlocked must be an array.");
  }

  if (!Array.isArray(progression.allocations)) {
    throw new Error("allocations must be an array.");
  }

  const unlocked = new Set();
  for (const optionId of progression.unlocked) {
    assertOptionId(optionId);
    if (unlocked.has(optionId)) {
      throw new Error(`Duplicate unlocked Augment: ${optionId}`);
    }
    unlocked.add(optionId);
  }

  const allocated = new Set();
  let calculatedSpent = 0;

  for (const allocation of progression.allocations) {
    if (!allocation || typeof allocation !== "object") {
      throw new Error("Each allocation must be an object.");
    }

    const { optionId, rank, cost } = allocation;
    assertOptionId(optionId);
    assertPositiveInteger(rank, `rank for ${optionId}`);
    assertPositiveInteger(cost, `cost for ${optionId}`);

    if (!unlocked.has(optionId)) {
      throw new Error(`Allocated Augment is not unlocked: ${optionId}`);
    }

    if (allocated.has(optionId)) {
      throw new Error(`Duplicate allocation: ${optionId}`);
    }

    allocated.add(optionId);
    calculatedSpent += cost;
  }

  if (spent !== calculatedSpent) {
    throw new Error(
      `points.spent mismatch: stored=${spent}, calculated=${calculatedSpent}.`
    );
  }

  if (spent > granted) {
    throw new Error(
      `Weapon progression overspent: ${spent} spent for ${granted} granted.`
    );
  }

  return {
    green: true,
    granted,
    spent,
    available: granted - spent,
    unlockedCount: progression.unlocked.length,
    allocationCount: progression.allocations.length,
  };
}

async function writeProgression(weapon, progression) {
  assertOwnedWeapon(weapon);
  const status = validateProgressionData(progression);
  await weapon.setFlag(MODULE_ID, FLAG_KEY, progression);
  return {
    progression: clone(progression),
    ...status,
  };
}

export function getWeaponProgression(weapon) {
  assertOwnedWeapon(weapon);
  const stored = weapon.getFlag(MODULE_ID, FLAG_KEY);

  if (!stored) {
    return {
      progression: null,
      initialized: false,
      green: true,
      granted: 0,
      spent: 0,
      available: 0,
      unlockedCount: 0,
      allocationCount: 0,
    };
  }

  const progression = clone(stored);
  const status = validateProgressionData(progression);

  return {
    progression,
    initialized: true,
    ...status,
  };
}

export function validateWeaponProgression(weapon) {
  return getWeaponProgression(weapon);
}

export async function initializeWeaponProgression(
  weapon,
  {
    granted = 0,
    unlocked = [],
  } = {},
) {
  assertGM("initializeWeaponProgression");
  assertOwnedWeapon(weapon);
  assertNonNegativeInteger(granted, "granted");

  if (!Array.isArray(unlocked)) {
    throw new Error("unlocked must be an array.");
  }

  const existing = weapon.getFlag(MODULE_ID, FLAG_KEY);
  if (existing) {
    throw new Error(`Weapon progression is already initialized for ${weapon.name}.`);
  }

  const progression = emptyProgression();
  progression.points.granted = granted;
  progression.unlocked = [...unlocked];

  return await writeProgression(weapon, progression);
}

export async function grantWeaponPoints(weapon, amount) {
  assertGM("grantWeaponPoints");
  assertOwnedWeapon(weapon);
  assertPositiveInteger(amount, "amount");

  const current = getWeaponProgression(weapon);
  if (!current.initialized) {
    throw new Error(`Weapon progression is not initialized for ${weapon.name}.`);
  }

  const progression = current.progression;
  progression.points.granted += amount;

  return await writeProgression(weapon, progression);
}

export async function unlockWeaponAugment(weapon, optionId) {
  assertGM("unlockWeaponAugment");
  assertOwnedWeapon(weapon);
  assertOptionId(optionId);

  const current = getWeaponProgression(weapon);
  if (!current.initialized) {
    throw new Error(`Weapon progression is not initialized for ${weapon.name}.`);
  }

  const progression = current.progression;
  if (progression.unlocked.includes(optionId)) {
    throw new Error(`Augment already unlocked: ${optionId}`);
  }

  progression.unlocked.push(optionId);

  return await writeProgression(weapon, progression);
}

export async function allocateWeaponAugment(
  weapon,
  optionId,
  {
    cost,
    rank = 1,
  } = {},
) {
  assertOwnedWeapon(weapon);
  assertOptionId(optionId);
  assertPositiveInteger(cost, "cost");
  assertPositiveInteger(rank, "rank");

  const current = getWeaponProgression(weapon);
  if (!current.initialized) {
    throw new Error(`Weapon progression is not initialized for ${weapon.name}.`);
  }

  const progression = current.progression;

  if (!progression.unlocked.includes(optionId)) {
    throw new Error(`Augment not unlocked: ${optionId}`);
  }

  if (progression.allocations.some((entry) => entry.optionId === optionId)) {
    throw new Error(`Augment already allocated: ${optionId}`);
  }

  if (current.available < cost) {
    throw new Error(
      `Insufficient weapon points: ${current.available} available, ${cost} required.`
    );
  }

  progression.allocations.push({
    optionId,
    rank,
    cost,
  });
  progression.points.spent += cost;

  return await writeProgression(weapon, progression);
}

export async function deallocateWeaponAugment(weapon, optionId) {
  assertOwnedWeapon(weapon);
  assertOptionId(optionId);

  const current = getWeaponProgression(weapon);
  if (!current.initialized) {
    throw new Error(`Weapon progression is not initialized for ${weapon.name}.`);
  }

  const progression = current.progression;
  const index = progression.allocations.findIndex(
    (entry) => entry.optionId === optionId
  );

  if (index < 0) {
    throw new Error(`Augment is not allocated: ${optionId}`);
  }

  const [removed] = progression.allocations.splice(index, 1);
  progression.points.spent -= removed.cost;

  return await writeProgression(weapon, progression);
}

export const weaponProgressionApi = {
  get: getWeaponProgression,
  validate: validateWeaponProgression,
  initialize: initializeWeaponProgression,
  grantPoints: grantWeaponPoints,
  unlockAugment: unlockWeaponAugment,
  allocateAugment: allocateWeaponAugment,
  deallocateAugment: deallocateWeaponAugment,
};
