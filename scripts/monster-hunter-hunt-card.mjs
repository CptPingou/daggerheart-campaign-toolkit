/**
 * Monster Hunter — Hunt domain-card mechanic schema.
 *
 * Engagement behaviour belongs to Hunt domain cards, not weapons.
 * Weapons remain material profiles (damage/range/traits/augments).
 */

export const HUNT_CARD_ROLES = Object.freeze(["opener", "finisher", "support"]);

export const HUNT_CARD_MECHANIC_SCHEMA = Object.freeze({
  id: "monster-hunter/hunt-card",
  version: 1,
  maxLoadoutCards: 2,
  roles: HUNT_CARD_ROLES,
  opportunity: Object.freeze({
    spendModes: Object.freeze(["damage", "effect"]),
    standardEffectCost: 2,
    rareEffectCost: 3,
  }),
});

export function defineHuntCardMechanic(definition = {}) {
  const {
    id,
    role,
    name = id,
    hopeCost = 0,
    opportunity = {},
    conditions = [],
    tags = [],
  } = definition;

  if (!id || typeof id !== "string") throw new Error("Hunt card mechanic requires an id.");
  if (!HUNT_CARD_ROLES.includes(role)) {
    throw new Error(`Hunt card role must be one of: ${HUNT_CARD_ROLES.join(", ")}.`);
  }
  if (!Number.isInteger(hopeCost) || hopeCost < 0) {
    throw new Error("hopeCost must be a non-negative integer.");
  }
  if (!Array.isArray(conditions) || !Array.isArray(tags)) {
    throw new Error("conditions and tags must be arrays.");
  }

  const mechanic = {
    id,
    name,
    role,
    hopeCost,
    opportunity: normalizeOpportunity(opportunity),
    conditions: [...conditions],
    tags: [...tags],
  };

  return Object.freeze(mechanic);
}

export function validateHuntCardLoadout(cards = []) {
  if (!Array.isArray(cards)) throw new Error("Hunt card loadout must be an array.");

  const ids = cards.map((card) => card?.id).filter(Boolean);
  const duplicateIds = ids.filter((id, index) => ids.indexOf(id) !== index);
  const invalidRoles = cards
    .filter((card) => !HUNT_CARD_ROLES.includes(card?.role))
    .map((card) => card?.id ?? "(unknown)");

  const reasons = [];
  if (cards.length > HUNT_CARD_MECHANIC_SCHEMA.maxLoadoutCards) reasons.push("max-loadout");
  if (duplicateIds.length) reasons.push("duplicate-card");
  if (invalidRoles.length) reasons.push("invalid-role");

  return {
    green: reasons.length === 0,
    count: cards.length,
    max: HUNT_CARD_MECHANIC_SCHEMA.maxLoadoutCards,
    reasons,
    duplicateIds: [...new Set(duplicateIds)],
    invalidRoles,
  };
}

export function huntCardMechanicStatus() {
  const opener = defineHuntCardMechanic({
    id: "specimen-opener",
    role: "opener",
    hopeCost: 2,
    opportunity: { generate: 2 },
  });
  const finisher = defineHuntCardMechanic({
    id: "specimen-finisher",
    role: "finisher",
    opportunity: { spend: ["damage", "effect"] },
  });

  const valid = validateHuntCardLoadout([opener, finisher]);
  const overflow = validateHuntCardLoadout([opener, finisher, {
    id: "specimen-support",
    role: "support",
  }]);

  return {
    mechanic: HUNT_CARD_MECHANIC_SCHEMA.id,
    version: HUNT_CARD_MECHANIC_SCHEMA.version,
    schema: HUNT_CARD_MECHANIC_SCHEMA,
    specimens: { opener, finisher },
    green: valid.green && !overflow.green && overflow.reasons.includes("max-loadout"),
  };
}

function normalizeOpportunity(value) {
  const generate = value.generate ?? 0;
  const spend = value.spend ?? [];
  const effectCosts = value.effectCosts ?? {};

  if (!Number.isInteger(generate) || generate < 0) {
    throw new Error("opportunity.generate must be a non-negative integer.");
  }
  if (!Array.isArray(spend) || spend.some((mode) => !["damage", "effect"].includes(mode))) {
    throw new Error('opportunity.spend accepts only "damage" and "effect".');
  }

  return Object.freeze({
    generate,
    spend: Object.freeze([...spend]),
    effectCosts: Object.freeze({
      standard: effectCosts.standard ?? 2,
      rare: effectCosts.rare ?? 3,
    }),
  });
}
