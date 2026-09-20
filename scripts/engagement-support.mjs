import {
  getEngagementActionRole,
  setEngagementActionRole,
} from "./engagement-opener.mjs";
import { spendActorHope } from "./engagement-resources.mjs";
import { huntCardEffectsFromDocument, huntRoleRule } from "./monster-hunter-hunt-card.mjs";

const ROLE = "support";
const ROLE_LABEL = "Support";
const ROLE_RULE = huntRoleRule(ROLE);

export const SUPPORT_REMINDER = "Support — 1 Hope : résolvez l'effet indiqué par la carte Chasse utilisée. Le Core Support ne choisit ni n'applique automatiquement cet effet.";

function actionIdOf(actionOrId) {
  if (typeof actionOrId === "string" && actionOrId) return actionOrId;
  return actionOrId?._id ?? actionOrId?.id ?? null;
}

export function createEngagementSupportApi() {
  async function markAction(item, actionOrId) {
    await setEngagementActionRole(item, actionOrId, ROLE);
    return {
      itemId: item.id,
      actionId: actionIdOf(actionOrId),
      role: ROLE,
      reminder: SUPPORT_REMINDER,
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

  async function remind({ payment = null, item = null, action = null, stateApi = null, actor = null } = {}) {
    const supportEffect = huntCardEffectsFromDocument(item).support ?? null;

    if (supportEffect && stateApi?.queueEffect) {
      await stateApi.queueEffect(supportEffect, { sourceActor: actor, sourceCard: item });
    }

    const result = Object.freeze({
      role: ROLE_LABEL,
      automated: "hope-only",
      hopeCost: ROLE_RULE.hopeCost,
      payment,
      cardId: item?.id ?? null,
      cardName: item?.name ?? null,
      actionId: actionIdOf(action),
      supportEffect,
      reminder: SUPPORT_REMINDER,
    });

    console.info(`Campaign Toolkit | ${ROLE_LABEL} — Hope spent, card effect manual`, result);

    const effectText = supportEffect?.chat
      ?? item?.system?.description
      ?? "Résolvez l’effet indiqué par la carte Chasse utilisée.";

    await ChatMessage.create({
      content: [
        '<div class="daggerheart-campaign-toolkit monster-hunter-support">',
        `<h3><i class="fa-solid fa-handshake-angle"></i> Support — ${foundry.utils.escapeHTML(item?.name ?? "Carte Chasse")}</h3>`,
        `<p><strong>${ROLE_RULE.hopeCost} Espoir dépensé.</strong></p>`,
        `<div>${effectText}</div>`,
        '</div>',
      ].join(""),
      flags: {
        ["daggerheart-campaign-toolkit"]: {
          monsterHunterSupport: {
            version: 1,
            cardId: item?.id ?? null,
            actionId: actionIdOf(action),
            effectId: supportEffect?.id ?? null,
          },
        },
      },
    });

    return result;
  }

  return Object.freeze({
    role: ROLE,
    reminder: SUPPORT_REMINDER,
    getActionRole: getEngagementActionRole,
    markAction,
    clearAction,
    remind,
  });
}


export function registerEngagementSupportActionHook(supportApi, stateApi = null) {
  return Hooks.on(`${CONFIG.DH.id}.postUseAction`, async (action) => {
    try {
      const item = action?.item;
      if (!item || item.documentName !== "Item") return;

      if (supportApi.getActionRole(item, action) !== ROLE) return;

      const actor = item.parent;
      if (!actor || actor.documentName !== "Actor") {
        throw new Error("Campaign Toolkit | Support action has no owning Actor");
      }

      // Support exists only inside an open Engagement.
      if (stateApi) {
        const window = stateApi.validateRoleWindow(ROLE);
        if (!window.green) {
          globalThis.ui?.notifications?.warn?.("Support refusé : aucun Engagement n’est ouvert.");
          return;
        }

        const claim = await stateApi.claim(actor, {
          role: ROLE,
          cardId: item.id,
          actionId: actionIdOf(action),
        });
        if (!claim.claimed) {
          globalThis.ui?.notifications?.warn?.("Action Monster Hunter déjà utilisée par ce personnage pour cet Engagement.");
          return;
        }
      }

      // The Core pays the universal Support cost. The card owns the actual effect:
      // no monster reaction automation and no automatic roll modification.
      const payment = await spendActorHope(actor, ROLE_RULE.hopeCost, {
        label: "Engagement — Support",
      });
      if (!payment.paid) {
        if (stateApi) await stateApi.release(actor);
        return;
      }

      await supportApi.remind({ payment, item, action, stateApi, actor });
    } catch (error) {
      console.error(
        "Campaign Toolkit | Support action reminder failed",
        error,
        action,
      );
    }
  });
}
