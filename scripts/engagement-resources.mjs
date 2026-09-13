function normalizeHopeCost(cost) {
  const value = Number(cost);
  if (!Number.isInteger(value) || value < 0) {
    throw new TypeError("Campaign Toolkit | Hope cost must be a non-negative integer");
  }
  return value;
}

function assertActor(actor) {
  if (!actor || actor.documentName !== "Actor") {
    throw new TypeError("Campaign Toolkit | Hope cost requires a Foundry Actor");
  }
  if (typeof actor.modifyResource !== "function") {
    throw new TypeError("Campaign Toolkit | Actor.modifyResource is unavailable");
  }
}

export function getActorHope(actor) {
  assertActor(actor);
  return Number(actor.system?.resources?.hope?.value ?? 0);
}

export async function spendActorHope(actor, cost, { label = "Engagement" } = {}) {
  assertActor(actor);
  const requested = normalizeHopeCost(cost);
  const before = getActorHope(actor);

  if (before < requested) {
    const result = Object.freeze({
      paid: false,
      cost: requested,
      before,
      after: before,
      actorId: actor.id,
      actorName: actor.name,
    });

    console.warn(
      `Campaign Toolkit | ${label} — insufficient Hope (${before}/${requested})`,
      result,
    );
    globalThis.ui?.notifications?.warn?.(
      `${label} : Hope insuffisant (${before}/${requested}). L'effet Engagement n'est pas appliqué.`,
    );
    return result;
  }

  if (requested > 0) {
    // Daggerheart 2.9.4 native resource mutation API.
    await actor.modifyResource([{ key: "hope", value: -requested }]);
  }

  const result = Object.freeze({
    paid: true,
    cost: requested,
    before,
    // modifyResource dispatches its document update internally; use the deterministic
    // expected value here rather than racing the asynchronous GM update.
    after: before - requested,
    actorId: actor.id,
    actorName: actor.name,
  });

  console.info(
    `Campaign Toolkit | ${label} — ${requested} Hope spent (${before} → ${result.after})`,
    result,
  );
  return result;
}
