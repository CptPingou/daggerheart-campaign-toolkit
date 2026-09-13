const MODULE_ID = "daggerheart-campaign-toolkit";
const CONTEXTUAL_FLAG = "contextualCard";

function assertContextualItem(item) {
  if (!item || item.documentName !== "Item") {
    throw new TypeError("Campaign Toolkit | Hunting native action requires an Item");
  }

  const marker = item.getFlag(MODULE_ID, CONTEXTUAL_FLAG) ?? null;
  if (!marker?.contextual) {
    throw new Error("Campaign Toolkit | Item is not a Toolkit Contextual Card");
  }

  if (!["feature", "domainCard"].includes(item.type)) {
    throw new TypeError(
      `Campaign Toolkit | Unsupported Contextual Card carrier type: ${item.type}`,
    );
  }
}

function actionIdOf(actionOrId) {
  const id = typeof actionOrId === "string"
    ? actionOrId
    : actionOrId?._id ?? actionOrId?.id;
  if (!id) {
    throw new TypeError("Campaign Toolkit | Native action id is required");
  }
  return String(id);
}

function sourceOfAction(action) {
  if (!action) {
    throw new TypeError("Campaign Toolkit | Source action is required");
  }

  if (typeof action.toObject === "function") {
    return foundry.utils.deepClone(action.toObject());
  }

  if (action._source && typeof action._source === "object") {
    return foundry.utils.deepClone(action._source);
  }

  return foundry.utils.deepClone(action);
}

function contextualMarker(item) {
  return item.getFlag(MODULE_ID, CONTEXTUAL_FLAG) ?? null;
}

export function getContextualNativeAction(item) {
  assertContextualItem(item);
  const marker = contextualMarker(item);
  const actionId = marker?.actionId;
  if (!actionId) return null;
  return item.system?.actions?.get?.(actionId) ?? null;
}

export async function cloneNativeActionToContextualCard(
  item,
  sourceItem,
  sourceAction,
  { role, label } = {},
) {
  assertContextualItem(item);

  const marker = contextualMarker(item);
  const sourceActionId = actionIdOf(sourceAction);
  const actionData = sourceOfAction(sourceAction);
  const actionId = foundry.utils.randomID();

  actionData._id = actionId;
  actionData.systemPath = "actions";
  actionData.baseAction = false;
  actionData.name = label ?? item.name;
  actionData.chatDisplay = true;

  if (actionData.damage && typeof actionData.damage === "object") {
    actionData.damage.includeBase = false;
  }

  await item.update({
    "system.actions": {
      [actionId]: actionData,
    },
    [`flags.${MODULE_ID}.${CONTEXTUAL_FLAG}.actionId`]: actionId,
    [`flags.${MODULE_ID}.${CONTEXTUAL_FLAG}.actionRole`]: role ?? marker.cardType ?? null,
    [`flags.${MODULE_ID}.${CONTEXTUAL_FLAG}.prototypeSource`]: {
      itemId: sourceItem?.id ?? null,
      itemUuid: sourceItem?.uuid ?? null,
      actionId: sourceActionId,
    },
  });

  const action = item.system?.actions?.get?.(actionId);
  if (!action) {
    throw new Error(`Campaign Toolkit | Native action ${actionId} was not created on ${item.name}`);
  }

  const result = Object.freeze({
    changed: true,
    itemId: item.id,
    itemName: item.name,
    itemType: item.type,
    cardId: marker.cardId,
    role: role ?? marker.cardType ?? null,
    actionId,
    actionName: action.name,
    actionType: action.type,
    sourceItemId: sourceItem?.id ?? null,
    sourceItemName: sourceItem?.name ?? null,
    sourceActionId,
    action,
  });

  console.info("Campaign Toolkit | Contextual native action created", result);
  return result;
}

export async function createContextualReminderAction(
  item,
  { role, label, description } = {},
) {
  assertContextualItem(item);

  const marker = contextualMarker(item);

  const existing = getContextualNativeAction(item);
  if (existing) {
    return Object.freeze({
      changed: false,
      reason: "already-materialized",
      itemId: item.id,
      itemName: item.name,
      itemType: item.type,
      cardId: marker.cardId,
      role: role ?? marker.cardType ?? null,
      actionId: existing.id ?? existing._id,
      actionName: existing.name,
      actionType: existing.type,
      action: existing,
    });
  }

  const actionId = foundry.utils.randomID();

  const actionData = {
    _id: actionId,
    systemPath: "actions",
    type: "effect",
    baseAction: false,
    name: label ?? item.name,
    description: description ?? item.system?.description ?? "",
    chatDisplay: true,
    actionType: "action",
    originItem: {
      type: "itemCollection",
      itemPath: null,
      actionIndex: null,
    },
    triggers: [],
    areas: [],
    cost: [],
    uses: {
      value: null,
      max: "",
      recovery: null,
      consumeOnSuccess: false,
    },
    target: {
      type: "any",
      amount: null,
    },
    effects: [],
  };

  await item.update({
    "system.actions": {
      [actionId]: actionData,
    },
    [`flags.${MODULE_ID}.${CONTEXTUAL_FLAG}.actionId`]: actionId,
    [`flags.${MODULE_ID}.${CONTEXTUAL_FLAG}.actionRole`]: role ?? marker.cardType ?? null,
  });

  const action = item.system?.actions?.get?.(actionId);
  if (!action) {
    throw new Error(
      `Campaign Toolkit | Native reminder action ${actionId} was not created on ${item.name}`,
    );
  }

  const result = Object.freeze({
    changed: true,
    itemId: item.id,
    itemName: item.name,
    itemType: item.type,
    cardId: marker.cardId,
    role: role ?? marker.cardType ?? null,
    actionId,
    actionName: action.name,
    actionType: action.type,
    action,
  });

  console.info("Campaign Toolkit | Contextual reminder action created", result);
  return result;
}


// Legacy compatibility alias. Toolkit internals use cloneNativeActionToContextualCard.
export const cloneNativeActionToContextualFeature =
  cloneNativeActionToContextualCard;
