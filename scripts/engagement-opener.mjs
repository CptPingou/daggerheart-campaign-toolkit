import { spendActorHope } from "./engagement-resources.mjs";

const MODULE_ID = "daggerheart-campaign-toolkit";
const ROLE = "opener";
const ROLE_LABEL = "Opener";
const FLAG_KEY = "engagementActions";

export const OPENER_REMINDER = "Coût automatique : 2 Hope. Désignez oralement un Finisher distinct. Réussite : +2 Opportunity. Échec : +1 Opportunity.";

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

    const success = context.hitTargets.length > 0;
    const gained = success ? 2 : 1;
    const before = opportunityApi.getOpportunityValue();
    const after = await opportunityApi.increaseOpportunity(gained);

    const result = Object.freeze({
      role: ROLE_LABEL,
      applied: true,
      hope,
      success,
      hitTargetCount: context.hitTargets.length,
      opportunityGained: gained,
      before,
      after,
      itemId: context.item.id,
      actionId: context.actionId,
      messageId: message.id,
    });

    console.info(
      `Campaign Toolkit | ${ROLE_LABEL} — ${success ? "success" : "failure"}: +${gained} Opportunity (${before} → ${after})`,
      result,
    );
    globalThis.ui?.notifications?.info?.(
      `Opener : ${success ? "réussite" : "échec"} — +${gained} Opportunity.`,
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
