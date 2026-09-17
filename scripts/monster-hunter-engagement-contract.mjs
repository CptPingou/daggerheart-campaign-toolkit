const MODULE_ID = "daggerheart-campaign-toolkit";

export const MONSTER_HUNTER_ENGAGEMENT_CONTRACT = Object.freeze({
  id: "monster-hunter/engagement",
  version: 1,
  contentNamespace: "monster-hunter",
  rules: Object.freeze({
    tier1Opportunity: 2,
    openerHopeCost: 2,
    supportHopeCost: 1,
    supportAttackPenalty: "-1d4",
    opportunityDamageDicePerPoint: 1,
    unusedOpportunityExpires: true,
    immediateFinisherOnSuccessWithHope: true,
  }),
  runtimeParts: Object.freeze([
    "engagement",
    "engagementOpportunity",
    "engagementOpener",
    "engagementFinisher",
    "engagementSupport",
  ]),
});

export function monsterHunterEngagementStatus(api = game.modules.get(MODULE_ID)?.api) {
  const parts = Object.fromEntries(
    MONSTER_HUNTER_ENGAGEMENT_CONTRACT.runtimeParts.map((key) => [key, Boolean(api?.[key])]),
  );

  return {
    mechanic: MONSTER_HUNTER_ENGAGEMENT_CONTRACT.id,
    version: MONSTER_HUNTER_ENGAGEMENT_CONTRACT.version,
    contentNamespace: MONSTER_HUNTER_ENGAGEMENT_CONTRACT.contentNamespace,
    rules: MONSTER_HUNTER_ENGAGEMENT_CONTRACT.rules,
    parts,
    green: Object.values(parts).every(Boolean),
  };
}
