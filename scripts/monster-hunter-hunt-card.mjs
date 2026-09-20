/**
 * Monster Hunter — Hunt card mechanic schema.
 *
 * The Hunt Core owns the universal grammar/rules for Opener, Finisher and Support.
 * Individual Hunt cards only declare their variation/effects.
 */

export const HUNT_CARD_ROLES = Object.freeze(["opener", "finisher", "support"]);

export const HUNT_ROLE_RULES = Object.freeze({
  opener: Object.freeze({
    hopeCost: 2,
    opportunity: Object.freeze({
      critical: 3,
      successHope: 2,
      successFear: 2,
      failureHope: 2,
      failureFear: 1,
    }),
  }),
  finisher: Object.freeze({
    hopeCost: 1,
    maxOpportunity: 4,
    clearOpportunityAfterAttempt: true,
    damageDicePerOpportunity: 1,
    effectCosts: Object.freeze({ standard: 2, rare: 3 }),
    criticalCombinesDamageAndEffect: true,
  }),
  support: Object.freeze({
    hopeCost: 1,
  }),
});

export const HUNT_CARD_MECHANIC_SCHEMA = Object.freeze({
  id: "monster-hunter/hunt-card",
  version: 2,
  maxLoadoutCards: 2,
  roles: HUNT_CARD_ROLES,
  roleRules: HUNT_ROLE_RULES,
  opportunity: Object.freeze({
    spendModes: Object.freeze(["damage", "effect"]),
    standardEffectCost: 2,
    rareEffectCost: 3,
  }),
});

export function huntRoleRule(role) {
  if (!HUNT_CARD_ROLES.includes(role)) {
    throw new Error(`Unknown Hunt card role: ${role}`);
  }
  return HUNT_ROLE_RULES[role];
}

export function huntCardEffectsFromDocument(document) {
  const mechanic = document?.flags?.["daggerheart-campaign-toolkit"]?.huntCardMechanic;
  if (!mechanic) return Object.freeze({});

  // supportEffect is accepted as a compatibility alias for cards created before
  // schema v2. New cards should use mechanic.effects.<slot>.
  const effects = clonePlain(mechanic.effects ?? {});
  if (mechanic.supportEffect && !effects.support) {
    effects.support = clonePlain(mechanic.supportEffect);
  }
  return Object.freeze(effects);
}

export function defineHuntCardMechanic(definition = {}) {
  const {
    id,
    role,
    name = id,
    hopeCost = HUNT_ROLE_RULES[role]?.hopeCost ?? 0,
    opportunity = {},
    conditions = [],
    tags = [],
    effects = {},
    supportEffect = null,
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
  if (!effects || typeof effects !== "object" || Array.isArray(effects)) {
    throw new Error("effects must be an object.");
  }

  const normalizedEffects = clonePlain(effects);
  if (supportEffect && !normalizedEffects.support) {
    normalizedEffects.support = clonePlain(supportEffect);
  }

  const mechanic = {
    id,
    name,
    role,
    hopeCost,
    opportunity: normalizeOpportunity(opportunity),
    conditions: [...conditions],
    tags: [...tags],
    effects: Object.freeze(normalizedEffects),
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

  const universalCostsGreen =
    opener.hopeCost === HUNT_ROLE_RULES.opener.hopeCost &&
    finisher.hopeCost === HUNT_ROLE_RULES.finisher.hopeCost;

  return {
    mechanic: HUNT_CARD_MECHANIC_SCHEMA.id,
    version: HUNT_CARD_MECHANIC_SCHEMA.version,
    schema: HUNT_CARD_MECHANIC_SCHEMA,
    roleRules: HUNT_ROLE_RULES,
    specimens: { opener, finisher },
    green:
      valid.green &&
      !overflow.green &&
      overflow.reasons.includes("max-loadout") &&
      universalCostsGreen,
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
      standard: effectCosts.standard ?? HUNT_ROLE_RULES.finisher.effectCosts.standard,
      rare: effectCosts.rare ?? HUNT_ROLE_RULES.finisher.effectCosts.rare,
    }),
  });
}

function clonePlain(value) {
  if (value == null) return value;
  return JSON.parse(JSON.stringify(value));
}
