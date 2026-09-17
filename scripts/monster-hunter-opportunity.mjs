/**
 * Monster Hunter — Opportunity / weapon-effect rules.
 *
 * Pure validation and resolution helpers. No Actor mutation and no UI.
 * These functions are intended to be consumed by Engagement adapters,
 * weapon specializations and future augment data.
 */

export const MONSTER_HUNTER_OPPORTUNITY_RULES = Object.freeze({
  damageDicePerOpportunity: 1,
  effectCosts: Object.freeze({
    standard: 2,
    rare: 3,
  }),
  finisherCriticalCombinesDamageAndEffect: true,
  unusedOpportunityExpires: true,
});

export function opportunityEffectCost(rarity = "standard") {
  const cost = MONSTER_HUNTER_OPPORTUNITY_RULES.effectCosts[rarity];
  if (!cost) throw new Error(`Unknown Monster Hunter effect rarity: ${rarity}`);
  return cost;
}

export function validateOpportunitySpend({
  available,
  damageOpportunity = 0,
  effectRarity = null,
  criticalFinisher = false,
} = {}) {
  assertNonNegativeInteger(available, "available");
  assertNonNegativeInteger(damageOpportunity, "damageOpportunity");

  const effectCost = effectRarity ? opportunityEffectCost(effectRarity) : 0;

  // Normally damage and an Effect are alternatives. A critical Finisher is
  // the explicit exception: it can convert OP into damage and trigger the
  // selected Effect in the same resolution.
  if (damageOpportunity > 0 && effectRarity && !criticalFinisher) {
    return {
      green: false,
      reason: "damage-or-effect",
      required: damageOpportunity + effectCost,
      available,
    };
  }

  const required = damageOpportunity + effectCost;
  return {
    green: required <= available,
    reason: required <= available ? null : "insufficient-opportunity",
    required,
    available,
  };
}

export function resolveOpportunitySpend(options = {}) {
  const check = validateOpportunitySpend(options);
  if (!check.green) {
    throw new Error(
      check.reason === "damage-or-effect"
        ? "Opportunity normally converts to damage OR an Effect; only a critical Finisher combines both."
        : `Not enough Opportunity: ${check.available} available, ${check.required} required.`,
    );
  }

  const {
    available,
    damageOpportunity = 0,
    effectRarity = null,
    criticalFinisher = false,
  } = options;

  const effectCost = effectRarity ? opportunityEffectCost(effectRarity) : 0;
  const spent = damageOpportunity + effectCost;

  return {
    spent,
    remaining: available - spent,
    damageDice:
      damageOpportunity * MONSTER_HUNTER_OPPORTUNITY_RULES.damageDicePerOpportunity,
    effect: effectRarity
      ? {
          rarity: effectRarity,
          cost: effectCost,
          triggered: true,
          combinedWithDamage: Boolean(criticalFinisher && damageOpportunity > 0),
        }
      : null,
    criticalFinisher: Boolean(criticalFinisher),
  };
}

export function monsterHunterOpportunityStatus() {
  const standard = resolveOpportunitySpend({
    available: 2,
    effectRarity: "standard",
  });
  const damage = resolveOpportunitySpend({
    available: 2,
    damageOpportunity: 2,
  });
  const critical = resolveOpportunitySpend({
    available: 4,
    damageOpportunity: 2,
    effectRarity: "standard",
    criticalFinisher: true,
  });

  return {
    mechanic: "monster-hunter/opportunity",
    version: 1,
    rules: MONSTER_HUNTER_OPPORTUNITY_RULES,
    specimens: { standard, damage, critical },
    green:
      standard.spent === 2 &&
      damage.damageDice === 2 &&
      critical.effect?.combinedWithDamage === true,
  };
}

function assertNonNegativeInteger(value, label) {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative integer.`);
  }
}
