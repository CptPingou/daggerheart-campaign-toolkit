/**
 * Toolkit Card Families
 *
 * Cross-cutting card families are independent from Daggerheart class domains.
 * They can reuse Foundryborne Item/domain-card presentation without consuming
 * one of a character's two native domains.
 */
const MODULE_ID = "daggerheart-campaign-toolkit";

const FAMILY_DEFINITIONS = new Map();

export function registerToolkitCardFamily(definition) {
  const family = definition?.id;
  if (!family || typeof family !== "string") throw new Error("Toolkit card family requires an id.");
  const maxCards = definition.maxCards ?? null;
  if (maxCards !== null && (!Number.isInteger(maxCards) || maxCards < 0)) {
    throw new Error("maxCards must be null or a non-negative integer.");
  }
  const normalized = Object.freeze({
    id: family,
    label: definition.label ?? family,
    maxCards,
    namespace: definition.namespace ?? null,
  });
  FAMILY_DEFINITIONS.set(family, normalized);
  return normalized;
}

export function toolkitCardFamilyDefinition(family) {
  return FAMILY_DEFINITIONS.get(family) ?? null;
}

export function toolkitCardMetadata(document) {
  const meta = document?.flags?.[MODULE_ID]?.toolkitCard;
  if (!meta?.family) return null;
  return {
    family: meta.family,
    familyLabel: meta.familyLabel ?? meta.family,
    eligibility: meta.eligibility ?? "toolkit",
    loadoutGroup: meta.loadoutGroup ?? meta.family,
  };
}

export function isToolkitCard(document, family = null) {
  const meta = toolkitCardMetadata(document);
  return Boolean(meta && (!family || meta.family === family));
}

export function actorToolkitCards(actor, family = null) {
  if (!actor) throw new Error("An Actor is required.");
  return Array.from(actor.items ?? []).filter((item) => isToolkitCard(item, family));
}

export function validateToolkitCardFamilyLoadout(actor, family) {
  const definition = toolkitCardFamilyDefinition(family);
  if (!definition) return { green: false, family, reason: "unknown-family" };

  const cards = actorToolkitCards(actor, family);
  const over = definition.maxCards !== null && cards.length > definition.maxCards;
  return {
    green: !over,
    family,
    count: cards.length,
    max: definition.maxCards,
    cards: cards.map((item) => ({ id: item.id, name: item.name })),
    reasons: over ? ["max-loadout"] : [],
  };
}

export async function importToolkitCard(actor, sourceDocument, { family = null } = {}) {
  if (!actor) throw new Error("An Actor is required.");
  if (!sourceDocument) throw new Error("A source card is required.");

  const meta = toolkitCardMetadata(sourceDocument);
  if (!meta) throw new Error("The source document is not a Toolkit card.");
  if (family && meta.family !== family) throw new Error(`Expected Toolkit family ${family}.`);

  const definition = toolkitCardFamilyDefinition(meta.family);
  if (!definition) throw new Error(`Unknown Toolkit card family: ${meta.family}.`);

  const existing = actorToolkitCards(actor, meta.family);
  if (definition.maxCards !== null && existing.length >= definition.maxCards) {
    return {
      green: false,
      imported: false,
      family: meta.family,
      reason: "max-loadout",
      count: existing.length,
      max: definition.maxCards,
    };
  }

  // Deliberately create the embedded Item through the Toolkit path instead of
  // Foundryborne's domain-card drop handler, whose native eligibility check is
  // tied to the character's two class domains.
  const data = sourceDocument.toObject();
  delete data._id;
  // Daggerheart ActionField actions are materialized reliably through
  // Document#update. Preserve Toolkit-authored actions across embedded Item
  // creation just as the autonomous compendium synchronizer does.
  const sourceActions = data?.type === "domainCard"
    ? foundry.utils.deepClone(data?.system?.actions ?? {})
    : {};
  if (data?.type === "domainCard" && data?.system) {
    data.system.actions = {};
  }

  const created = await actor.createEmbeddedDocuments("Item", [data]);
  const item = created?.[0] ?? null;

  if (
    item &&
    Object.keys(sourceActions).length > 0
  ) {
    await item.update({
      "system.actions": sourceActions,
    });
  }

  if (!item) {
    return {
      green: false,
      imported: false,
      family: meta.family,
      itemId: null,
      reason: "embedded-create-rejected",
      count: existing.length,
      max: definition.maxCards,
    };
  }

  return {
    green: true,
    imported: true,
    family: meta.family,
    itemId: item.id,
    count: existing.length + 1,
    max: definition.maxCards,
  };
}

export async function removeToolkitCard(actor, item) {
  if (!actor) throw new Error("An Actor is required.");
  if (!item) throw new Error("A Toolkit card Item is required.");

  const meta = toolkitCardMetadata(item);
  if (!meta) throw new Error("The Item is not a Toolkit card.");
  if (item.parent?.id !== actor.id) {
    throw new Error("The Toolkit card does not belong to this Actor.");
  }

  await actor.deleteEmbeddedDocuments("Item", [item.id]);

  const remaining = actorToolkitCards(actor, meta.family);
  return {
    green: true,
    removed: true,
    family: meta.family,
    itemId: item.id,
    count: remaining.length,
    max: toolkitCardFamilyDefinition(meta.family)?.maxCards ?? null,
  };
}

export function toolkitCardFamiliesStatus() {
  const hunt = toolkitCardFamilyDefinition("hunt");
  return {
    mechanic: "toolkit/card-families",
    version: 1,
    families: [...FAMILY_DEFINITIONS.values()],
    green: hunt?.maxCards === 2,
  };
}

// First family. Eberron families can register on the same primitive later.
registerToolkitCardFamily({
  id: "hunt",
  label: "Chasse",
  maxCards: 2,
  namespace: "monster-hunter",
});
