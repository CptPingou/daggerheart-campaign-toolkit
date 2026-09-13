import { createContextualDomainApi } from "./contextual-domain.mjs";
import {
  findMaterializedContextualCard,
  materializeContextualCard,
  materializeAssignedContextualCards,
  dematerializeContextualCard,
} from "./contextual-card-foundry.mjs";
import {
  getContextualNativeAction,
  cloneNativeActionToContextualCard,
  createContextualReminderAction,
} from "./hunting-native-actions.mjs";

export const HUNTING_DOMAIN = Object.freeze({
  id: "hunting",
  label: "Hunting",
  presentation: Object.freeze({
    kind: "contextual-domain",
    distinctFromCanonicalDomainCards: true,
  }),
  cardTypes: Object.freeze(["opener", "finisher", "support"]),
  constraints: Object.freeze({
    maxCardsPerCharacter: 2,
  }),
  cards: Object.freeze({
    "hunting.opener": Object.freeze({
      id: "hunting.opener",
      domainId: "hunting",
      type: "opener",
      name: "Hunting — Opener",
      description: "<p><strong>Opener.</strong> Coût automatique : 2 Hope. Désignez oralement un Finisher distinct. Réussite : +2 Opportunity. Échec : +1 Opportunity.</p>",
      costs: Object.freeze({ hope: 2 }),
      rules: Object.freeze({
        successOpportunity: 2,
        failureOpportunity: 1,
        finisherDesignation: "oral",
        finisherMustBeDistinctHunter: true,
      }),
      presentation: Object.freeze({
        prototype: true,
        roleLabel: "Opener",
      }),
    }),
    "hunting.finisher": Object.freeze({
      id: "hunting.finisher",
      domainId: "hunting",
      type: "finisher",
      name: "Hunting — Finisher",
      description: "<p><strong>Finisher.</strong> Coût automatique : 1 Hope. Convertissez toute l’Opportunity disponible. Réussite : 1 Opportunity → +1 dé de dégâts. Échec : toute l’Opportunity est perdue.</p>",
      costs: Object.freeze({ hope: 1 }),
      rules: Object.freeze({
        consumesAllOpportunity: true,
        successConversion: "1 Opportunity → +1 damage die",
        failure: "all Opportunity is lost",
      }),
      presentation: Object.freeze({
        prototype: true,
        roleLabel: "Finisher",
      }),
    }),
    "hunting.support": Object.freeze({
      id: "hunting.support",
      domainId: "hunting",
      type: "support",
      name: "Hunting — Support",
      description: "<p><strong>Support.</strong> Coût automatique : 1 Hope. Choisissez un appui : <strong>défensif</strong>, pendant la réaction du monstre, pour infliger <strong>-1d4</strong> au jet d’attaque du monstre contre l’Opener ; ou <strong>offensif</strong>, avec le Finisher, pour lui accorder <strong>+1d6 à son jet d’attaque</strong>. Une intervention générique de Support maximum par fenêtre.</p>",
      costs: Object.freeze({ hope: 1 }),
      rules: Object.freeze({
        modes: Object.freeze({
          defensive: Object.freeze({
            timing: "monster reaction against Opener",
            effect: "-1d4 to the monster attack roll against the Opener",
          }),
          offensive: Object.freeze({
            timing: "Finisher attack",
            effect: "+1d6 to the Finisher attack roll",
          }),
        }),
        maximumGenericInterventionsPerWindow: 1,
        hopeSpendingAutomated: true,
        effectApplicationAutomated: false,
      }),
      presentation: Object.freeze({
        prototype: true,
        roleLabel: "Support",
      }),
    }),
  }),
});

const huntingDomainApi = createContextualDomainApi(HUNTING_DOMAIN);

export const huntingCardsApi = Object.freeze({
  ...huntingDomainApi,
  get(cardId) {
    return HUNTING_DOMAIN.cards?.[cardId] ?? null;
  },
  catalog() {
    return Object.values(HUNTING_DOMAIN.cards);
  },
  async remove(actor, cardId) {
    // Assignment and Foundry representation are one lifecycle:
    // removing a Contextual Card must also remove its materialized native card.
    // Dematerialization is attempted even when the assignment flag is already
    // gone, which also repairs stale representations left by older Toolkit versions.
    const assignment = await huntingDomainApi.remove(actor, cardId);
    const materialized = await dematerializeContextualCard(actor, cardId);

    const result = Object.freeze({
      changed: assignment.changed === true || materialized.changed === true,
      actorId: actor.id,
      actorName: actor.name,
      domainId: HUNTING_DOMAIN.id,
      cardId,
      assignment,
      materialized,
      cards: huntingDomainApi.list(actor),
    });

    console.info("Campaign Toolkit | Hunting card lifecycle removed", result);
    return result;
  },
  findMaterialized(actor, cardId) {
    return findMaterializedContextualCard(actor, cardId);
  },
  async materialize(actor, cardId) {
    const card = HUNTING_DOMAIN.cards?.[cardId];
    if (!card) {
      throw new Error(`Campaign Toolkit | Unknown Hunting card: ${cardId}`);
    }
    if (!huntingDomainApi.has(actor, cardId)) {
      return Object.freeze({
        changed: false,
        reason: "not-assigned",
        actorId: actor.id,
        cardId,
      });
    }
    return materializeContextualCard(actor, card);
  },
  async materializeAssigned(actor) {
    return materializeAssignedContextualCards(actor, this);
  },
  getNativeAction(actor, cardId) {
    const item = findMaterializedContextualCard(actor, cardId);
    return item ? getContextualNativeAction(item) : null;
  },
  async installSupportAction(actor, supportApi) {
    const cardId = "hunting.support";

    if (!huntingDomainApi.has(actor, cardId)) {
      return Object.freeze({
        changed: false,
        reason: "not-assigned",
        actorId: actor.id,
        actorName: actor.name,
        cardId,
      });
    }

    const item = findMaterializedContextualCard(actor, cardId);
    if (!item) {
      throw new Error(
        "Campaign Toolkit | Materialize hunting.support before installing its native action",
      );
    }

    let action = getContextualNativeAction(item);
    let creation = null;

    if (!action) {
      creation = await createContextualReminderAction(item, {
        role: "support",
        label: "Hunting — Support",
        description: HUNTING_DOMAIN.cards[cardId].description,
      });
      action = creation.action;
    }

    if (!supportApi?.markAction) {
      throw new Error("Campaign Toolkit | Missing Engagement Support API");
    }

    await supportApi.markAction(item, action);

    const result = Object.freeze({
      changed: creation?.changed === true,
      actorId: actor.id,
      actorName: actor.name,
      cardId,
      itemId: item.id,
      itemName: item.name,
      itemType: item.type,
      actionId: action.id ?? action._id,
      actionName: action.name,
      actionType: action.type,
      role: supportApi.getActionRole(item, action),
      automated: "hope-only",
    });

    console.info("Campaign Toolkit | Hunting Support native action installed", result);
    return result;
  },
  async installPrototypeActionsFrom(actor, sourceItem, sourceAction, engagementApis) {
    const roles = [
      ["hunting.opener", "opener", engagementApis?.opener],
      ["hunting.finisher", "finisher", engagementApis?.finisher],
    ];

    const installed = [];

    for (const [cardId, role, engagementApi] of roles) {
      if (!huntingDomainApi.has(actor, cardId)) continue;

      const item = findMaterializedContextualCard(actor, cardId);
      if (!item) {
        throw new Error(
          `Campaign Toolkit | Materialize ${cardId} before installing its native action`,
        );
      }

      let action = getContextualNativeAction(item);
      let creation = null;

      if (!action) {
        creation = await cloneNativeActionToContextualCard(
          item,
          sourceItem,
          sourceAction,
          {
            role,
            label: role === "opener"
              ? "Hunting — Opener"
              : "Hunting — Finisher",
          },
        );
        action = creation.action;
      }

      if (!engagementApi) {
        throw new Error(`Campaign Toolkit | Missing Engagement API for ${role}`);
      }

      await engagementApi.markAction(item, action);

      installed.push({
        cardId,
        role,
        itemId: item.id,
        itemName: item.name,
        actionId: action.id ?? action._id,
        actionName: action.name,
        actionType: action.type,
        created: creation?.changed === true,
      });
    }

    // The Shortbow (or any other source item) was only a runtime specimen.
    // Remove its temporary Engagement role once the Contextual Cards own theirs.
    if (sourceItem && sourceAction) {
      await engagementApis?.opener?.clearAction?.(sourceItem, sourceAction);
      await engagementApis?.finisher?.clearAction?.(sourceItem, sourceAction);
    }

    const result = Object.freeze({
      actorId: actor.id,
      actorName: actor.name,
      sourceItemId: sourceItem?.id ?? null,
      sourceItemName: sourceItem?.name ?? null,
      installed,
      sourceBindingCleared: true,
    });

    console.info("Campaign Toolkit | Hunting prototype actions installed", result);
    return result;
  },
});
