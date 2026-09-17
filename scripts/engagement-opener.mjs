import { spendActorHope } from "./engagement-resources.mjs";

const MODULE_ID = "daggerheart-campaign-toolkit";
const ROLE = "opener";
const ROLE_LABEL = "Opener";
const FLAG_KEY = "engagementActions";

export const OPENER_REMINDER = "Coût automatique : 2 Hope. Désignez oralement un Finisher distinct. Critique : +3 Opportunity. Réussite avec Hope : +2. Réussite avec Fear : +2 + réaction. Échec avec Hope : +2 + réaction. Échec avec Fear : +1 + réaction.";

function actionIdOf(actionOrId) {
  if (typeof actionOrId === "string" && actionOrId) return actionOrId;
  return actionOrId?._id ?? actionOrId?.id ?? null;
}

function assertItem(item) {
  if (!item || item.documentName !== "Item") {
    throw new TypeError("Campaign Toolkit | Engagement action requires a Foundry Item");
  }
}

function currentBindings(item) {
  return foundry.utils.deepClone(item.getFlag(MODULE_ID, FLAG_KEY) ?? {});
}

export function getEngagementActionRole(item, actionOrId) {
  const actionId = actionIdOf(actionOrId);
  if (!item || !actionId) return null;
  return item.getFlag(MODULE_ID, FLAG_KEY)?.[actionId]?.role ?? null;
}

export async function setEngagementActionRole(item, actionOrId, role) {
  assertItem(item);
  const actionId = actionIdOf(actionOrId);
  if (!actionId) throw new TypeError("Campaign Toolkit | Engagement action id is required");

  const bindings = currentBindings(item);
  if (role == null) {
    delete bindings[actionId];
  } else {
    bindings[actionId] = { role: String(role) };
  }
  await item.setFlag(MODULE_ID, FLAG_KEY, bindings);
  return getEngagementActionRole(item, actionId);
}

function openerContextFromMessage(message) {
  if (message?.type !== "dualityRoll") return null;

  const system = message.system;
  const item = system?.item;
  const action = system?.action;
  const actionId = actionIdOf(action) ?? system?.source?.action ?? null;
  if (!item || !actionId) return null;
  if (getEngagementActionRole(item, actionId) !== ROLE) return null;

  return {
    item,
    action,
    actionId,
    actor: item.parent?.documentName === "Actor" ? item.parent : null,
    hitTargets: Array.isArray(system?.currentHitTargets) ? system.currentHitTargets : [],
  };
}

function firstDefined(...values) {
  return values.find((value) => value !== undefined && value !== null);
}

function normalizedOutcomeToken(value) {
  if (typeof value !== "string") return null;
  return value.trim().toLowerCase().replace(/[ _]+/g, "-");
}

function dualityOutcomeFromMessage(message, context) {
  const system = message?.system ?? {};
  const roll = system?.roll ?? system?.dualityRoll ?? system?.result ?? {};
  const result = system?.result ?? roll?.result ?? {};

  const critical = Boolean(firstDefined(
    system?.isCritical,
    system?.critical,
    roll?.isCritical,
    roll?.critical,
    result?.isCritical,
    result?.critical,
    false,
  ));

  const successValue = firstDefined(
    system?.success,
    system?.isSuccess,
    roll?.success,
    roll?.isSuccess,
    result?.success,
    result?.isSuccess,
  );

  // Preserve the already validated Foundryborne hit-target behavior as a
  // compatibility fallback until every Duality message shape is normalized.
  const success = typeof successValue === "boolean"
    ? successValue
    : context.hitTargets.length > 0;

  const token = normalizedOutcomeToken(firstDefined(
    system?.outcome,
    system?.duality,
    system?.resultType,
    roll?.outcome,
    roll?.duality,
    roll?.resultType,
    result?.outcome,
    result?.duality,
    result?.type,
  ));

  const hopeFlag = firstDefined(
    system?.isHope,
    system?.withHope,
    roll?.isHope,
    roll?.withHope,
    result?.isHope,
    result?.withHope,
  );
  const fearFlag = firstDefined(
    system?.isFear,
    system?.withFear,
    roll?.isFear,
    roll?.withFear,
    result?.isFear,
    result?.withFear,
  );

  let duality = null;
  if (typeof hopeFlag === "boolean" && hopeFlag) duality = "hope";
  if (typeof fearFlag === "boolean" && fearFlag) duality = "fear";

  if (!duality && token) {
    if (token.includes("hope")) duality = "hope";
    if (token.includes("fear")) duality = "fear";
    if (token.includes("critical") || token === "crit") {
      return { critical: true, success: true, duality: "critical", token };
    }
  }

  if (critical) return { critical: true, success: true, duality: "critical", token };
  return { critical: false, success, duality, token };
}

function openerResolution(outcome) {
  if (outcome.critical) {
    return { gained: 3, reactionRequired: false, outcome: "critical" };
  }

  if (outcome.success && outcome.duality === "hope") {
    return { gained: 2, reactionRequired: false, outcome: "success-hope" };
  }

  if (outcome.success && outcome.duality === "fear") {
    return { gained: 2, reactionRequired: true, outcome: "success-fear" };
  }

  if (!outcome.success && outcome.duality === "hope") {
    return { gained: 2, reactionRequired: true, outcome: "failure-hope" };
  }

  if (!outcome.success && outcome.duality === "fear") {
    return { gained: 1, reactionRequired: true, outcome: "failure-fear" };
  }

  return null;
}

export function createEngagementOpenerApi(opportunityApi) {
  if (!opportunityApi?.increaseOpportunity || !opportunityApi?.getOpportunityValue) {
    throw new TypeError("Campaign Toolkit | Opener requires the Opportunity API");
  }

  async function resolveMessage(message) {
    const context = openerContextFromMessage(message);
    if (!context) return null;

    const hope = await spendActorHope(context.actor, 2, { label: ROLE_LABEL });
    if (!hope.paid) {
      return Object.freeze({
        role: ROLE_LABEL,
        applied: false,
        reason: "insufficient-hope",
        hope,
        itemId: context.item.id,
        actionId: context.actionId,
        messageId: message.id,
      });
    }

    const duality = dualityOutcomeFromMessage(message, context);
    const resolution = openerResolution(duality);

    if (!resolution) {
      const result = Object.freeze({
        role: ROLE_LABEL,
        applied: false,
        reason: "duality-outcome-unresolved",
        hope,
        duality,
        hitTargetCount: context.hitTargets.length,
        itemId: context.item.id,
        actionId: context.actionId,
        messageId: message.id,
      });
      console.warn("Campaign Toolkit | Opener Duality outcome unresolved; Opportunity unchanged", result, message);
      globalThis.ui?.notifications?.warn?.(
        "Opener : résultat Duality non reconnu — Opportunity inchangée.",
      );
      return result;
    }

    const before = opportunityApi.getOpportunityValue();
    const after = await opportunityApi.increaseOpportunity(resolution.gained);

    const result = Object.freeze({
      role: ROLE_LABEL,
      applied: true,
      hope,
      success: duality.success,
      duality: duality.duality,
      outcome: resolution.outcome,
      reactionRequired: resolution.reactionRequired,
      hitTargetCount: context.hitTargets.length,
      opportunityGained: resolution.gained,
      before,
      after,
      itemId: context.item.id,
      actionId: context.actionId,
      messageId: message.id,
    });

    console.info(
      `Campaign Toolkit | ${ROLE_LABEL} — ${resolution.outcome}: +${resolution.gained} Opportunity (${before} → ${after})${resolution.reactionRequired ? " + monster reaction" : ""}`,
      result,
    );
    globalThis.ui?.notifications?.info?.(
      `Opener : +${resolution.gained} Opportunity${resolution.reactionRequired ? " — réaction du monstre." : "."}`,
    );
    return result;
  }

  async function markAction(item, actionOrId) {
    await setEngagementActionRole(item, actionOrId, ROLE);
    return {
      itemId: item.id,
      actionId: actionIdOf(actionOrId),
      role: ROLE,
      reminder: OPENER_REMINDER,
    };
  }

  async function clearAction(item, actionOrId) {
    await setEngagementActionRole(item, actionOrId, null);
    return {
      itemId: item.id,
      actionId: actionIdOf(actionOrId),
      role: null,
    };
  }

  return Object.freeze({
    role: ROLE,
    reminder: OPENER_REMINDER,
    getActionRole: getEngagementActionRole,
    markAction,
    clearAction,
    inspectOutcome(message) {
      const context = openerContextFromMessage(message);
      if (!context) return null;
      const duality = dualityOutcomeFromMessage(message, context);
      return Object.freeze({
        duality,
        resolution: openerResolution(duality),
        hitTargetCount: context.hitTargets.length,
      });
    },
    resolveMessage,
  });
}

export function registerEngagementOpenerChatHook(openerApi) {
  return Hooks.on("createChatMessage", async (message) => {
    // createChatMessage is emitted on every connected client. Only the authoring
    // client may mutate the shared Opportunity countdown for this message.
    if (message.author?.id !== game.user?.id) return;

    try {
      await openerApi.resolveMessage(message);
    } catch (error) {
      console.error("Campaign Toolkit | Opener chat resolution failed", error, message);
    }
  });
}
