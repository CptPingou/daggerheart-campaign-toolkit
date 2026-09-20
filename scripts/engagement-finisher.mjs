import { spendActorHope } from "./engagement-resources.mjs";
import { huntCardEffectsFromDocument, huntRoleRule } from "./monster-hunter-hunt-card.mjs";

const MODULE_ID = "daggerheart-campaign-toolkit";
const ROLE = "finisher";
const ROLE_LABEL = "Finisher";
const FLAG_KEY = "engagementActions";
const ROLE_RULE = huntRoleRule(ROLE);

export const FINISHER_REMINDER = "Coût automatique : 1 Hope. Engagez toute l\'Opportunity disponible avec le Finisher (maximum 4 au Tier 1). Réussite : X Opportunity est converti. Échec : X Opportunity est perdu. Dans les deux cas, Opportunity revient à 0.";

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

function getEngagementActionRole(item, actionOrId) {
  const actionId = actionIdOf(actionOrId);
  if (!item || !actionId) return null;
  return item.getFlag(MODULE_ID, FLAG_KEY)?.[actionId]?.role ?? null;
}

async function setEngagementActionRole(item, actionOrId, role) {
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

function finisherContextFromMessage(message) {
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

export function createEngagementFinisherApi(opportunityApi, stateApi = null) {
  if (!opportunityApi?.clearOpportunity || !opportunityApi?.getOpportunityValue) {
    throw new TypeError("Campaign Toolkit | Finisher requires the Opportunity API");
  }

  async function resolveMessage(message) {
    const context = finisherContextFromMessage(message);
    if (!context) return null;

    if (stateApi) {
      const window = stateApi.validateRoleWindow(ROLE);
      if (!window.green) {
        globalThis.ui?.notifications?.warn?.("Finisher refusé : aucun Engagement n’est ouvert.");
        return Object.freeze({ role: ROLE_LABEL, applied: false, reason: window.reason, window });
      }

      const validation = stateApi.validateFinisher(context.actor);
      if (!validation.green) {
        globalThis.ui?.notifications?.warn?.("Finisher refusé : ce personnage n’est pas le Finisher désigné.");
        return Object.freeze({ role: ROLE_LABEL, applied: false, reason: validation.reason, validation });
      }
      const claim = await stateApi.claim(context.actor, {
        role: ROLE,
        cardId: context.item.id,
        actionId: context.actionId,
      });
      if (!claim.claimed) {
        globalThis.ui?.notifications?.warn?.("Action Monster Hunter déjà utilisée par ce personnage pour cet Engagement.");
        return Object.freeze({ role: ROLE_LABEL, applied: false, reason: claim.reason, claim });
      }
    }

    const hope = await spendActorHope(context.actor, ROLE_RULE.hopeCost, { label: ROLE_LABEL });
    if (!hope.paid && stateApi) await stateApi.release(context.actor);
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
    const pendingFinisherEffects = stateApi?.pendingEffects ? stateApi.pendingEffects({ timing: "next-finisher-attack" }) : [];
    const opportunity = Math.min(ROLE_RULE.maxOpportunity, opportunityApi.getOpportunityValue());
    const after = await opportunityApi.clearOpportunity();

    const result = Object.freeze({
      role: ROLE_LABEL,
      applied: true,
      hope,
      success,
      hitTargetCount: context.hitTargets.length,
      opportunityConsumed: opportunity,
      converted: success ? opportunity : 0,
      lost: success ? 0 : opportunity,
      before: opportunity,
      after,
      itemId: context.item.id,
      actionId: context.actionId,
      messageId: message.id,
    });

    console.info(
      `Campaign Toolkit | ${ROLE_LABEL} — ${success ? "success" : "failure"}: ${opportunity} Opportunity ${success ? "converted" : "lost"} (${opportunity} → ${after})`,
      result,
    );
    globalThis.ui?.notifications?.info?.(
      `Finisher : ${success ? "réussite" : "échec"} — ${opportunity} Opportunity ${success ? "converti" : "perdu"}.`,
    );

    const finisherEffect = huntCardEffectsFromDocument(context.item).finisher ?? null;

    if (pendingFinisherEffects.length) {
      await ChatMessage.create({
        content: ['<div class="daggerheart-campaign-toolkit monster-hunter-pending-effects">',
          '<h3><i class="fa-solid fa-crosshairs"></i> Effets en attente — Finisher</h3>',
          ...pendingFinisherEffects.map(effect => `<div>${effect.chat ?? foundry.utils.escapeHTML(effect.id)}</div>`),
          '</div>'].join(""),
        flags: { [MODULE_ID]: { monsterHunterPendingEffects: { version: 1, timing: "next-finisher-attack",
          effectIds: pendingFinisherEffects.map(effect => effect.id) } } },
      });
      if (stateApi?.consumeEffects) await stateApi.consumeEffects({ timing: "next-finisher-attack" });
    }

    const conversionContent = success
      ? [
          '<div class="daggerheart-campaign-toolkit monster-hunter-conversion">',
          `<h3><i class="fa-solid fa-burst"></i> Conversion — ${opportunity} Opportunité${opportunity > 1 ? "s" : ""}</h3>`,
          `<p>Ajoutez <strong>${opportunity} dé${opportunity > 1 ? "s" : ""} de dégâts de l’arme</strong> à cette attaque, <strong>ou</strong> dépensez ces Opportunités pour déclencher un Effet disponible.</p>`,
          `<p>Effet standard : <strong>${ROLE_RULE.effectCosts.standard} OP</strong> · Effet rare : <strong>${ROLE_RULE.effectCosts.rare} OP</strong>.</p>`,
          '<p><strong>Critique :</strong> vous pouvez appliquer les dégâts <strong>et</strong> l’Effet.</p>',
          finisherEffect?.chat ? `<div>${finisherEffect.chat}</div>` : "",
          '</div>',
        ].join("")
      : [
          '<div class="daggerheart-campaign-toolkit monster-hunter-conversion">',
          `<h3><i class="fa-solid fa-xmark"></i> Conversion échouée — ${opportunity} Opportunité${opportunity > 1 ? "s" : ""} perdue${opportunity > 1 ? "s" : ""}</h3>`,
          '<p>L’Opportunité engagée est perdue. Aucun bonus de dégâts ni Effet n’est converti.</p>',
          '</div>',
        ].join("");

    await ChatMessage.create({
      content: conversionContent,
      flags: {
        [MODULE_ID]: {
          monsterHunterConversion: {
            version: 1,
            sourceMessageId: message.id,
            success,
            opportunityConsumed: opportunity,
            converted: success ? opportunity : 0,
            lost: success ? 0 : opportunity,
            finisherEffectId: finisherEffect?.id ?? null,
          },
        },
      },
    });

    if (stateApi) await stateApi.close();

    return result;
  }

  async function markAction(item, actionOrId) {
    await setEngagementActionRole(item, actionOrId, ROLE);
    return {
      itemId: item.id,
      actionId: actionIdOf(actionOrId),
      role: ROLE,
      reminder: FINISHER_REMINDER,
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
    reminder: FINISHER_REMINDER,
    getActionRole: getEngagementActionRole,
    markAction,
    clearAction,
    resolveMessage,
  });
}

export function registerEngagementFinisherChatHook(finisherApi) {
  return Hooks.on("createChatMessage", async (message) => {
    // createChatMessage is emitted on every connected client. Only the authoring
    // client may mutate the shared Opportunity countdown for this message.
    if (message.author?.id !== game.user?.id) return;

    try {
      await finisherApi.resolveMessage(message);
    } catch (error) {
      console.error("Campaign Toolkit | Finisher chat resolution failed", error, message);
    }
  });
}
