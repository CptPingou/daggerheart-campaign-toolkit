const MODULE_ID = "daggerheart-campaign-toolkit";
const SETTING_KEY = "monsterHunterEngagementState";
const SCHEMA = "monster-hunter/engagement-state@2";

function emptyState() {
  return {
    schema: SCHEMA,
    open: false,
    openerActorId: null,
    designatedFinisherActorId: null,
    participants: {},
    pendingEffects: [],
    openedAt: null,
    closedAt: null,
  };
}

export function registerEngagementStateSetting() {
  game.settings.register(MODULE_ID, SETTING_KEY, {
    scope: "world",
    config: false,
    type: Object,
    default: emptyState(),
  });
}

function source() {
  return foundry.utils.deepClone(game.settings.get(MODULE_ID, SETTING_KEY) ?? emptyState());
}

async function write(next) {
  if (!game.user?.isGM) {
    throw new Error("Campaign Toolkit | Engagement state can only be changed by a GM");
  }
  await game.settings.set(MODULE_ID, SETTING_KEY, next);
  return snapshot();
}

export function snapshot() {
  const value = source();
  return Object.freeze({
    schema: value.schema ?? SCHEMA,
    open: Boolean(value.open),
    openerActorId: value.openerActorId ?? null,
    designatedFinisherActorId: value.designatedFinisherActorId ?? null,
    participants: Object.freeze(foundry.utils.deepClone(value.participants ?? {})),
    pendingEffects: Object.freeze(foundry.utils.deepClone(value.pendingEffects ?? [])),
    openedAt: value.openedAt ?? null,
    closedAt: value.closedAt ?? null,
  });
}

export function actorActionStatus(actorOrId) {
  const actorId = typeof actorOrId === "string" ? actorOrId : actorOrId?.id;
  const state = snapshot();
  const entry = actorId ? state.participants?.[actorId] : null;
  return Object.freeze({
    actorId: actorId ?? null,
    used: Boolean(entry?.used),
    role: entry?.role ?? null,
    cardId: entry?.cardId ?? null,
    actionId: entry?.actionId ?? null,
  });
}

export function canUseMonsterHunterAction(actorOrId) {
  const status = actorActionStatus(actorOrId);
  return Object.freeze({
    ...status,
    allowed: Boolean(status.actorId) && !status.used,
    reason: !status.actorId ? "actor-required" : status.used ? "mh-action-already-used" : null,
  });
}

export async function claimMonsterHunterAction(actor, { role, cardId = null, actionId = null } = {}) {
  const actorId = actor?.id;
  if (!actorId) throw new TypeError("Campaign Toolkit | MH Action requires an Actor");

  const check = canUseMonsterHunterAction(actorId);
  if (!check.allowed) return Object.freeze({ green: false, claimed: false, ...check });

  const value = source();
  value.participants ??= {};
  value.participants[actorId] = {
    used: true,
    role: role ?? null,
    cardId,
    actionId,
    usedAt: Date.now(),
  };
  await write(value);
  return Object.freeze({ green: true, claimed: true, ...actorActionStatus(actorId) });
}

export async function releaseMonsterHunterAction(actorOrId) {
  const actorId = typeof actorOrId === "string" ? actorOrId : actorOrId?.id;
  if (!actorId) return snapshot();
  const value = source();
  delete value.participants?.[actorId];
  return write(value);
}

export async function openEngagement({ openerActor = null } = {}) {
  const current = snapshot();
  if (current.open) {
    return Object.freeze({
      green: false,
      opened: false,
      reason: "engagement-already-open",
      state: current,
    });
  }

  const value = source();
  value.schema = SCHEMA;
  value.open = true;
  value.openerActorId = openerActor?.id ?? openerActor ?? null;
  value.designatedFinisherActorId = null;
  value.openedAt = Date.now();
  value.closedAt = null;
  // A new Engagement is also a new MH-action window.
  value.participants = {};
  value.pendingEffects = [];
  const next = await write(value);
  return Object.freeze({ green: true, opened: true, state: next });
}

export function validateRoleWindow(role) {
  const value = snapshot();

  if (role === "opener") {
    return Object.freeze({
      green: !value.open,
      reason: value.open ? "engagement-already-open" : null,
    });
  }

  if (role === "support" || role === "finisher") {
    return Object.freeze({
      green: value.open,
      reason: value.open ? null : "engagement-closed",
    });
  }

  return Object.freeze({ green: false, reason: "unknown-role" });
}

function normalizePendingEffect(effect, { sourceActor = null, sourceCard = null } = {}) {
  if (!effect?.id) throw new TypeError("Campaign Toolkit | Pending Hunt effect requires an id");
  return {
    instanceId: foundry.utils.randomID(), id: String(effect.id), timing: effect.timing ?? null,
    automation: effect.automation ?? "manual", modifier: effect.modifier ?? null,
    appliesTo: effect.appliesTo ?? null, cost: effect.cost ?? null, rarity: effect.rarity ?? null,
    chat: effect.chat ?? null, sourceActorId: sourceActor?.id ?? sourceActor ?? null,
    sourceCardId: sourceCard?.id ?? sourceCard ?? null, status: "pending", createdAt: Date.now(),
  };
}

export async function queueEffect(effect, options = {}) {
  const value = source();
  if (!value.open) return Object.freeze({ green: false, queued: false, reason: "engagement-closed", state: snapshot() });
  value.pendingEffects ??= [];
  const pending = normalizePendingEffect(effect, options);
  value.pendingEffects.push(pending);
  await write(value);
  return Object.freeze({ green: true, queued: true, effect: Object.freeze(foundry.utils.deepClone(pending)), state: snapshot() });
}

export function pendingEffects({ timing = null, appliesTo = null } = {}) {
  return snapshot().pendingEffects.filter(effect => effect.status === "pending"
    && (!timing || effect.timing === timing) && (!appliesTo || effect.appliesTo === appliesTo));
}

export async function consumeEffects({ timing = null, appliesTo = null } = {}) {
  const value = source(); value.pendingEffects ??= []; const consumed = [];
  for (const effect of value.pendingEffects) {
    if (effect.status !== "pending") continue;
    if (timing && effect.timing !== timing) continue;
    if (appliesTo && effect.appliesTo !== appliesTo) continue;
    effect.status = "consumed"; effect.consumedAt = Date.now(); consumed.push(foundry.utils.deepClone(effect));
  }
  if (consumed.length) await write(value);
  return Object.freeze(consumed);
}

export async function consumeEffect(instanceId) {
  if (!instanceId) throw new TypeError("Campaign Toolkit | Pending Hunt effect instanceId is required");
  const value = source(); value.pendingEffects ??= [];
  const effect = value.pendingEffects.find(entry => entry.instanceId === instanceId && entry.status === "pending");
  if (!effect) return Object.freeze({ green: false, consumed: false, reason: "pending-effect-not-found", instanceId });
  effect.status = "consumed";
  effect.consumedAt = Date.now();
  await write(value);
  return Object.freeze({ green: true, consumed: true, effect: Object.freeze(foundry.utils.deepClone(effect)), state: snapshot() });
}

export async function designateFinisher(actorOrId) {
  const actorId = typeof actorOrId === "string" ? actorOrId : actorOrId?.id;
  if (!actorId) throw new TypeError("Campaign Toolkit | Finisher designation requires an Actor");
  const value = source();
  if (!value.open) return Object.freeze({ green: false, reason: "engagement-closed", state: snapshot() });
  if (actorId === value.openerActorId) {
    return Object.freeze({ green: false, reason: "finisher-must-be-distinct", state: snapshot() });
  }
  value.designatedFinisherActorId = actorId;
  await write(value);
  return Object.freeze({ green: true, actorId, state: snapshot() });
}

export function validateFinisher(actorOrId) {
  const actorId = typeof actorOrId === "string" ? actorOrId : actorOrId?.id;
  const value = snapshot();
  if (!value.open) return Object.freeze({ green: false, reason: "engagement-closed" });
  if (!value.designatedFinisherActorId) {
    // P2.8o.1 keeps oral designation compatible: no designation stored means
    // the Finisher is allowed, but the state reports that it was not verified.
    return Object.freeze({ green: true, verified: false, reason: "finisher-not-designated" });
  }
  return Object.freeze({
    green: actorId === value.designatedFinisherActorId,
    verified: true,
    reason: actorId === value.designatedFinisherActorId ? null : "wrong-finisher",
  });
}

export async function closeEngagement() {
  const value = source();
  value.open = false;
  value.closedAt = Date.now();
  value.designatedFinisherActorId = null;
  return write(value);
}

export async function resetEngagementState() {
  return write(emptyState());
}

export const engagementStateApi = Object.freeze({
  schema: SCHEMA,
  snapshot,
  actorActionStatus,
  canUse: canUseMonsterHunterAction,
  validateRoleWindow,
  queueEffect,
  pendingEffects,
  consumeEffects,
  consumeEffect,
  claim: claimMonsterHunterAction,
  release: releaseMonsterHunterAction,
  open: openEngagement,
  designateFinisher,
  validateFinisher,
  close: closeEngagement,
  reset: resetEngagementState,
  status() {
    const value = snapshot();
    return Object.freeze({
      green: value.schema === SCHEMA,
      ...value,
    });
  },
});
