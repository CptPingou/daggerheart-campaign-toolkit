const MODULE_ID = "daggerheart-campaign-toolkit";
const FLAG_KEY = "contextualCards";

function assertActor(actor) {
  if (!actor || actor.documentName !== "Actor") {
    throw new TypeError("Campaign Toolkit | Contextual Cards require a Foundry Actor");
  }
}

function assertGm() {
  if (!globalThis.game?.user?.isGM) {
    throw new Error("Campaign Toolkit | Contextual Card assignment is GM-only");
  }
}

function normalizeId(value, label) {
  const id = String(value ?? "").trim();
  if (!id) throw new TypeError(`Campaign Toolkit | ${label} id is required`);
  return id;
}

function allAssignments(actor) {
  assertActor(actor);
  const stored = actor.getFlag(MODULE_ID, FLAG_KEY) ?? {};
  return foundry.utils.deepClone(stored);
}

function domainAssignments(actor, domainId) {
  const all = allAssignments(actor);
  const value = all[domainId];
  return Array.isArray(value) ? [...new Set(value.map(String))] : [];
}

export function createContextualDomainApi(domain) {
  const domainId = normalizeId(domain?.id, "Contextual Domain");
  const maxCards = Number(domain?.constraints?.maxCardsPerCharacter ?? Infinity);

  function list(actor) {
    return domainAssignments(actor, domainId);
  }

  function has(actor, cardId) {
    return list(actor).includes(normalizeId(cardId, "Contextual Card"));
  }

  async function assign(actor, cardId) {
    assertGm();
    assertActor(actor);

    const normalizedCardId = normalizeId(cardId, "Contextual Card");
    const card = domain.cards?.[normalizedCardId];
    if (!card) {
      throw new Error(
        `Campaign Toolkit | Unknown ${domain.label ?? domainId} card: ${normalizedCardId}`,
      );
    }

    const assigned = list(actor);
    if (assigned.includes(normalizedCardId)) {
      return Object.freeze({
        changed: false,
        reason: "already-assigned",
        actorId: actor.id,
        domainId,
        cards: assigned,
      });
    }

    if (Number.isFinite(maxCards) && assigned.length >= maxCards) {
      const result = Object.freeze({
        changed: false,
        reason: "limit-reached",
        actorId: actor.id,
        domainId,
        limit: maxCards,
        cards: assigned,
      });
      globalThis.ui?.notifications?.warn?.(
        `${domain.label ?? domainId} : maximum ${maxCards} cartes par personnage.`,
      );
      return result;
    }

    const all = allAssignments(actor);
    all[domainId] = [...assigned, normalizedCardId];
    await actor.setFlag(MODULE_ID, FLAG_KEY, all);

    const result = Object.freeze({
      changed: true,
      actorId: actor.id,
      actorName: actor.name,
      domainId,
      cardId: normalizedCardId,
      cards: all[domainId],
    });
    console.info(
      `Campaign Toolkit | ${domain.label ?? domainId} card assigned`,
      result,
    );
    return result;
  }

  async function remove(actor, cardId) {
    assertGm();
    assertActor(actor);

    const normalizedCardId = normalizeId(cardId, "Contextual Card");
    const assigned = list(actor);
    if (!assigned.includes(normalizedCardId)) {
      return Object.freeze({
        changed: false,
        reason: "not-assigned",
        actorId: actor.id,
        domainId,
        cards: assigned,
      });
    }

    const all = allAssignments(actor);
    all[domainId] = assigned.filter(id => id !== normalizedCardId);
    await actor.setFlag(MODULE_ID, FLAG_KEY, all);

    const result = Object.freeze({
      changed: true,
      actorId: actor.id,
      actorName: actor.name,
      domainId,
      cardId: normalizedCardId,
      cards: all[domainId],
    });
    console.info(
      `Campaign Toolkit | ${domain.label ?? domainId} card removed`,
      result,
    );
    return result;
  }

  function status(actor) {
    const assigned = list(actor);
    return Object.freeze({
      domainId,
      label: domain.label ?? domainId,
      actorId: actor.id,
      actorName: actor.name,
      cards: assigned,
      count: assigned.length,
      limit: Number.isFinite(maxCards) ? maxCards : null,
      green: !Number.isFinite(maxCards) || assigned.length <= maxCards,
    });
  }

  return Object.freeze({
    domain,
    list,
    has,
    assign,
    remove,
    status,
  });
}
