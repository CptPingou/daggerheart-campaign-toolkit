const MODULE_ID = "daggerheart-campaign-toolkit";
const TOOLKIT_PACK = `${MODULE_ID}.dh-domain-cards`;
const NATIVE_PACK = "daggerheart.domains";
const CORE_PREFIX = "srd-2.0.domain-card.";

import { bestNativeMatch } from "./domain-card-native-mechanics-audit.mjs";

function flagsOf(doc) {
  return doc?.flags?.[MODULE_ID] ?? {};
}

function canonicalId(doc) {
  const flags = flagsOf(doc);
  return flags.canonicalSourceId ?? flags.sourceId ?? null;
}

function clone(value) {
  return foundry.utils.deepClone(value);
}

function actionsObject(doc) {
  const actions = doc?.system?.actions;
  if (!actions) return {};
  if (typeof actions.toObject === "function") return clone(actions.toObject());
  if (actions instanceof Map) return Object.fromEntries([...actions].map(([k, v]) => [k, clone(v?.toObject?.() ?? v)]));
  return clone(actions);
}

function effectsArray(doc) {
  const effects = doc?.effects;
  if (!effects) return [];
  return [...effects].map(effect => clone(effect?.toObject?.() ?? effect));
}

function sourceObject(doc) {
  return clone(doc.toObject());
}

function rewriteSelfReferences(value, nativeDoc, toolkitDoc) {
  const nativeUuid = nativeDoc.uuid;
  const toolkitUuid = toolkitDoc.uuid;
  const nativeId = nativeDoc.id;
  const toolkitId = toolkitDoc.id;

  const visit = node => {
    if (Array.isArray(node)) return node.map(visit);
    if (!node || typeof node !== "object") {
      if (typeof node !== "string") return node;
      if (nativeUuid && node === nativeUuid) return toolkitUuid;
      return node;
    }

    const out = {};
    for (const [key, raw] of Object.entries(node)) {
      let next = visit(raw);
      // Only rewrite fields whose semantics are clearly document/item identity.
      if (typeof next === "string") {
        if ((key === "itemId" || key === "originItemId") && next === nativeId) next = toolkitId;
        if ((key === "uuid" || key === "itemUuid" || key === "originUuid" || key === "targetUuid") && next === nativeUuid) next = toolkitUuid;
      }
      out[key] = next;
    }
    return out;
  };

  return visit(value);
}

function collectNativePackReferences(value, path = "", rows = []) {
  if (Array.isArray(value)) {
    value.forEach((entry, i) => collectNativePackReferences(entry, `${path}[${i}]`, rows));
    return rows;
  }
  if (!value || typeof value !== "object") {
    if (typeof value === "string" && value.includes("Compendium.daggerheart.domains")) {
      rows.push({ path, value });
    }
    return rows;
  }
  for (const [key, entry] of Object.entries(value)) {
    collectNativePackReferences(entry, path ? `${path}.${key}` : key, rows);
  }
  return rows;
}

function downloadJson(filename, data) {
  const blob = new Blob([JSON.stringify(data, null, 2) + "\n"], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function reconstructNativeDomainCardMechanics({ download = true } = {}) {
  if (!game.user?.isGM) throw new Error("Campaign Toolkit | GM required for reconstruction audit");

  const toolkitPack = game.packs.get(TOOLKIT_PACK);
  const nativePack = game.packs.get(NATIVE_PACK);
  if (!toolkitPack) throw new Error(`Campaign Toolkit | missing pack ${TOOLKIT_PACK}`);
  if (!nativePack) throw new Error(`Campaign Toolkit | missing native pack ${NATIVE_PACK}`);

  const [toolkitDocs, nativeDocs] = await Promise.all([
    toolkitPack.getDocuments(),
    nativePack.getDocuments(),
  ]);

  const coreDocs = toolkitDocs.filter(doc => canonicalId(doc)?.startsWith(CORE_PREFIX));
  const reconstructed = [];
  const rows = [];
  const unresolved = [];
  const externalNativeRefs = [];

  for (const toolkit of coreDocs) {
    const result = bestNativeMatch(toolkit, nativeDocs);
    if (!result.match) {
      unresolved.push({
        toolkitId: toolkit.id,
        toolkitName: toolkit.name,
        canonicalSourceId: canonicalId(toolkit),
        ambiguous: result.ambiguous,
      });
      continue;
    }

    const native = result.match.native;
    const item = sourceObject(toolkit);
    const nativeActions = rewriteSelfReferences(actionsObject(native), native, toolkit);
    const nativeEffects = rewriteSelfReferences(effectsArray(native), native, toolkit);

    item.system ??= {};
    item.system.actions = nativeActions;
    item.effects = nativeEffects;

    // Source ownership remains Toolkit-owned. Native IDs/names are provenance only.
    item.flags ??= {};
    item.flags[MODULE_ID] ??= {};
    item.flags[MODULE_ID].mechanicsReconstruction = {
      version: 1,
      sourcePack: NATIVE_PACK,
      nativeId: native.id,
      nativeName: native.name,
      systemVersion: game.system.version,
    };

    const refs = collectNativePackReferences({ actions: nativeActions, effects: nativeEffects });
    for (const ref of refs) {
      externalNativeRefs.push({
        toolkitId: toolkit.id,
        toolkitName: toolkit.name,
        canonicalSourceId: canonicalId(toolkit),
        ...ref,
      });
    }

    reconstructed.push(item);
    rows.push({
      toolkitId: toolkit.id,
      toolkitName: toolkit.name,
      nativeId: native.id,
      nativeName: native.name,
      actions: Object.keys(nativeActions ?? {}).length,
      effects: nativeEffects.length,
    });
  }

  reconstructed.sort((a, b) => String(a._id).localeCompare(String(b._id)));

  const report = {
    phase: "P2.8m",
    mode: "source-reconstruction-export",
    toolkitCards: coreDocs.length,
    reconstructed: reconstructed.length,
    unresolved: unresolved.length,
    cardsWithActions: rows.filter(r => r.actions > 0).length,
    cardsWithEffects: rows.filter(r => r.effects > 0).length,
    cardsWithAnyMechanics: rows.filter(r => r.actions > 0 || r.effects > 0).length,
    externalNativeReferences: externalNativeRefs.length,
    green:
      reconstructed.length === coreDocs.length &&
      unresolved.length === 0 &&
      externalNativeRefs.length === 0,
    outputFile: "dh-domain-cards.reconstructed.json",
    rows,
    unresolvedRows: unresolved,
    externalNativeReferenceRows: externalNativeRefs,
  };

  console.table({
    toolkitCards: report.toolkitCards,
    reconstructed: report.reconstructed,
    unresolved: report.unresolved,
    cardsWithActions: report.cardsWithActions,
    cardsWithEffects: report.cardsWithEffects,
    cardsWithAnyMechanics: report.cardsWithAnyMechanics,
    externalNativeReferences: report.externalNativeReferences,
    green: report.green,
  });

  if (externalNativeRefs.length) {
    console.warn(`${MODULE_ID} | native pack references remain in reconstructed mechanics`, externalNativeRefs);
  }

  if (download && report.green) {
    downloadJson(report.outputFile, reconstructed);
  } else if (download && !report.green) {
    console.warn(`${MODULE_ID} | reconstruction not downloaded because report is not green`);
  }

  return { report, data: reconstructed };
}
