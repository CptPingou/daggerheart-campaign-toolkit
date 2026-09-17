/**
 * Monster Hunter — Hunt-card Actor loadout adapter.
 * Read-only: inspects actual mechanical Hunt cards embedded on an Actor.
 */
const MODULE_ID = "daggerheart-campaign-toolkit";

export function actorHuntCardLoadout(actor, {
  huntApi = game.modules.get(MODULE_ID)?.api?.monsterHunterHuntCard,
} = {}) {
  if (!actor) throw new Error("An Actor is required.");
  if (!huntApi) throw new Error("Monster Hunter Hunt-card API is unavailable.");

  const cards = Array.from(actor.items ?? [])
    .map((item) => {
      const flags = item.flags?.[MODULE_ID];
      if (flags?.sourceNamespace !== "monster-hunter") return null;
      const mechanic = huntApi.fromDocument(item);
      if (!mechanic) return null;
      return { itemId: item.id, name: item.name, mechanic };
    })
    .filter(Boolean);

  const validation = huntApi.validateLoadout(cards.map((row) => row.mechanic));
  return {
    actorId: actor.id,
    actorName: actor.name,
    cards,
    count: cards.length,
    max: huntApi.schema.maxLoadoutCards,
    validation,
    green: validation.green,
  };
}

export function actorEngagementCapabilities(actor, options = {}) {
  const loadout = actorHuntCardLoadout(actor, options);
  const byRole = { opener: [], finisher: [], support: [] };
  for (const card of loadout.cards) byRole[card.mechanic.role].push(card);
  return {
    ...loadout,
    byRole,
    availableRoles: Object.entries(byRole)
      .filter(([, rows]) => rows.length > 0)
      .map(([role]) => role),
  };
}

export function monsterHunterActorLoadoutStatus() {
  const huntApi = game.modules.get(MODULE_ID)?.api?.monsterHunterHuntCard;
  return {
    mechanic: "monster-hunter/actor-hunt-loadout",
    version: 1,
    maxLoadoutCards: huntApi?.schema?.maxLoadoutCards ?? null,
    green:
      Boolean(huntApi) &&
      huntApi.schema?.maxLoadoutCards === 2 &&
      typeof huntApi.fromDocument === "function" &&
      typeof huntApi.validateLoadout === "function",
  };
}
