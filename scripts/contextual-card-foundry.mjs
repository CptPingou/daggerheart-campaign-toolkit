const MODULE_ID = "daggerheart-campaign-toolkit";
const FLAG_KEY = "contextualCard";
const HUNTING_DOMAIN_ID = "hunting";

function assertActor(actor) {
  if (!actor || actor.documentName !== "Actor") {
    throw new TypeError("Campaign Toolkit | Contextual Card materialization requires a Foundry Actor");
  }
}

function assertGm() {
  if (!globalThis.game?.user?.isGM) {
    throw new Error("Campaign Toolkit | Contextual Card materialization is GM-only");
  }
}

function markerFor(card) {
  return {
    contextual: true,
    domainId: card.domainId,
    cardId: card.id,
    cardType: card.type,
  };
}

function markerOf(item) {
  return item?.getFlag?.(MODULE_ID, FLAG_KEY) ?? null;
}

function isMatchingContextualItem(item, cardId) {
  const marker = markerOf(item);
  return marker?.contextual === true && marker?.cardId === cardId;
}

function domainCardTypeFallback() {
  const field = CONFIG?.Item?.dataModels?.domainCard?.schema?.fields?.type;
  let choices = field?.choices;

  try {
    if (typeof choices === "function") choices = choices();
  } catch {
    choices = null;
  }

  if (choices && typeof choices === "object") {
    const first = Object.keys(choices)[0];
    if (first) return first;
  }

  // Known valid native type in Daggerheart 2.9.4 (Book of Ava specimen).
  return "grimoire";
}

function nativeDomainCardType(actor) {
  const specimen = actor.items.find(item => item.type === "domainCard");
  return specimen?.system?.type ?? domainCardTypeFallback();
}

function nativeDomainCardImage(card) {
  if (card?.img) return card.img;
  return "icons/svg/target.svg";
}

function actionSourceOf(item) {
  const source = item?.toObject?.() ?? null;
  return foundry.utils.deepClone(source?.system?.actions ?? {});
}

function migratedFlagsFrom(item, card) {
  const source = item?.toObject?.() ?? {};
  const flags = foundry.utils.deepClone(source.flags ?? {});

  flags[MODULE_ID] ??= {};
  flags[MODULE_ID][FLAG_KEY] = {
    ...(flags[MODULE_ID][FLAG_KEY] ?? {}),
    ...markerFor(card),
  };

  return flags;
}

function loadoutCompensationEffect() {
  const change = {
    key: "system.bonuses.maxLoadout",
    type: "add",
    value: 1,
    phase: "initial",
  };

  // This mirrors the native Daggerheart ActiveEffect data shape observed on
  // Toolkit's validated Force effect in Daggerheart 2.9.4.
  return {
    name: "Hunting — Contextual Loadout",
    description:
      "Cette carte Hunting augmente de 1 la capacité du loadout afin de ne pas consommer un emplacement de carte de domaine standard.",
    img: "icons/svg/upgrade.svg",
    disabled: false,
    transfer: true,
    system: {
      changes: [change],
      duration: {
        description: "",
      },
      rangeDependence: null,
      stacking: null,
      targetDispositions: [],
    },
  };
}

async function ensureLoadoutCompensation(item) {
  const existing = [...(item.effects ?? [])].find(
    effect =>
      effect.name === "Hunting — Contextual Loadout" ||
      effect.system?.changes?.some?.(
        change => change.key === "system.bonuses.maxLoadout",
      ),
  );

  if (existing) return existing;

  const [created] = await item.createEmbeddedDocuments(
    "ActiveEffect",
    [loadoutCompensationEffect()],
  );

  if (!created) {
    throw new Error(
      `Campaign Toolkit | Failed to create Hunting loadout compensation on ${item.name}`,
    );
  }

  return created;
}

export function findMaterializedContextualCard(actor, cardId) {
  assertActor(actor);

  const matches = actor.items.filter(
    item => isMatchingContextualItem(item, cardId),
  );

  // Native domainCard representation wins over a legacy Feature carrier during migration.
  return (
    matches.find(item => item.type === "domainCard") ??
    matches.find(item => item.type === "feature") ??
    null
  );
}

export async function dematerializeContextualCard(actor, cardId) {
  assertGm();
  assertActor(actor);

  const existing = actor.items.filter(
    item => isMatchingContextualItem(item, cardId),
  );

  if (!existing.length) {
    return Object.freeze({
      changed: false,
      reason: "not-materialized",
      actorId: actor.id,
      cardId,
    });
  }

  const removed = existing.map(item => ({
    itemId: item.id,
    itemName: item.name,
    itemType: item.type,
  }));

  await actor.deleteEmbeddedDocuments(
    "Item",
    existing.map(item => item.id),
  );

  const result = Object.freeze({
    changed: true,
    actorId: actor.id,
    actorName: actor.name,
    cardId,
    removed,
  });

  console.info("Campaign Toolkit | Contextual Card dematerialized", result);
  return result;
}

export async function materializeContextualCard(actor, card) {
  assertGm();
  assertActor(actor);

  const allMatches = actor.items.filter(
    item => isMatchingContextualItem(item, card.id),
  );
  const native = allMatches.find(item => item.type === "domainCard") ?? null;
  const legacyFeature = allMatches.find(item => item.type === "feature") ?? null;

  if (native) {
    await ensureLoadoutCompensation(native);

    if (legacyFeature) {
      await actor.deleteEmbeddedDocuments("Item", [legacyFeature.id]);
    }

    return Object.freeze({
      changed: Boolean(legacyFeature),
      reason: legacyFeature ? "legacy-feature-removed" : "already-materialized",
      actorId: actor.id,
      cardId: card.id,
      itemId: native.id,
      itemUuid: native.uuid,
      itemType: native.type,
      item: native,
    });
  }

  const actions = legacyFeature ? actionSourceOf(legacyFeature) : {};
  const flags = migratedFlagsFrom(legacyFeature, card);

  const data = {
    name: card.name,
    type: "domainCard",
    img: nativeDomainCardImage(card),
    system: {
      description: card.description ?? "",
      gmNotes: "",
      resource: null,
      actions,
      domain: HUNTING_DOMAIN_ID,
      level: 1,
      recallCost: 0,
      type: nativeDomainCardType(actor),
      inVault: false,
      vaultActive: false,
      loadoutIgnore: true,
      domainTouched: null,
    },
    flags,
  };

  const [created] = await actor.createEmbeddedDocuments("Item", [data]);
  if (!created) {
    throw new Error(`Campaign Toolkit | Failed to materialize contextual card ${card.id}`);
  }

  await ensureLoadoutCompensation(created);

  if (legacyFeature) {
    await actor.deleteEmbeddedDocuments("Item", [legacyFeature.id]);
  }

  const result = Object.freeze({
    changed: true,
    migratedLegacyFeature: Boolean(legacyFeature),
    actorId: actor.id,
    actorName: actor.name,
    cardId: card.id,
    itemId: created.id,
    itemUuid: created.uuid,
    itemType: created.type,
    domain: created.system?.domain ?? null,
    loadoutIgnore: created.system?.loadoutIgnore ?? null,
    item: created,
  });

  console.info("Campaign Toolkit | Contextual Card materialized", result);
  return result;
}

export async function materializeAssignedContextualCards(actor, domainApi) {
  assertGm();
  assertActor(actor);

  const assigned = domainApi.list(actor);
  const results = [];

  for (const cardId of assigned) {
    const card = domainApi.get(cardId);
    if (!card) {
      results.push({
        changed: false,
        reason: "catalog-missing",
        actorId: actor.id,
        cardId,
      });
      continue;
    }

    results.push(await materializeContextualCard(actor, card));
  }

  return Object.freeze({
    actorId: actor.id,
    actorName: actor.name,
    domainId: domainApi.domain.id,
    assigned: [...assigned],
    materialized: results,
  });
}
