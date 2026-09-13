import {
  getEngagementActionRole,
  setEngagementActionRole,
} from "./engagement-opener.mjs";
import { spendActorHope } from "./engagement-resources.mjs";

const ROLE = "support";
const ROLE_LABEL = "Support";

export const SUPPORT_REMINDER = "Support — 1 Hope : choisissez un appui. Défensif : -1d4 au jet d'attaque du monstre contre l'Opener pendant sa réaction. Offensif : +1d6 au jet d'attaque du Finisher. Une intervention générique maximum par fenêtre.";

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

  function remind({ payment = null } = {}) {
    const result = Object.freeze({
      role: ROLE_LABEL,
      automated: "hope-only",
      hopeCost: 1,
      payment,
      modes: Object.freeze({
        defensive: Object.freeze({
          timing: "monster reaction against Opener",
          modifier: "-1d4",
          appliesTo: "monster attack roll against Opener",
        }),
        offensive: Object.freeze({
          timing: "Finisher attack",
          modifier: "+1d6",
          appliesTo: "Finisher attack roll",
        }),
      }),
      maximumGenericInterventionsPerWindow: 1,
      reminder: SUPPORT_REMINDER,
    });

    console.info(`Campaign Toolkit | ${ROLE_LABEL} — Hope spent, effect manual`, result);
    globalThis.ui?.notifications?.info?.(
      "Support (1 Hope) : Défensif −1d4 à l’attaque du monstre contre l’Opener OU Offensif +1d6 au jet d’attaque du Finisher.",
    );
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


export function registerEngagementSupportActionHook(supportApi) {
  return Hooks.on(`${CONFIG.DH.id}.postUseAction`, async (action) => {
    try {
      const item = action?.item;
      if (!item || item.documentName !== "Item") return;

      if (supportApi.getActionRole(item, action) !== ROLE) return;

      const actor = item.parent;
      if (!actor || actor.documentName !== "Actor") {
        throw new Error("Campaign Toolkit | Support action has no owning Actor");
      }

      // Support itself costs 1 Hope automatically. The selected modifier remains
      // manual: no monster reaction automation and no automatic roll modification.
      const payment = await spendActorHope(actor, 1, {
        label: "Engagement — Support",
      });
      if (!payment.paid) return;

      supportApi.remind({ payment });
    } catch (error) {
      console.error(
        "Campaign Toolkit | Support action reminder failed",
        error,
        action,
      );
    }
  });
}
