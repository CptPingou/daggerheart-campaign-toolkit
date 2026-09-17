const MODULE_ID = "daggerheart-campaign-toolkit";
const TOOLKIT_PACK = `${MODULE_ID}.dh-domain-cards`;
const NATIVE_PACK = "daggerheart.domains";
const CORE_PREFIX = "srd-2.0.domain-card.";

function toolkitFlags(doc) {
  return doc?.flags?.[MODULE_ID] ?? {};
}

function canonicalId(doc) {
  const flags = toolkitFlags(doc);
  return flags.canonicalSourceId ?? flags.sourceId ?? null;
}

function canonicalParts(id) {
  if (!id?.startsWith(CORE_PREFIX)) return null;
  const tail = id.slice(CORE_PREFIX.length);
  const dot = tail.indexOf(".");
  if (dot < 1) return null;
  return {
    domain: tail.slice(0, dot),
    slug: tail.slice(dot + 1),
  };
}

function slugify(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function nativeSourceHints(doc) {
  const flags = doc?.flags ?? {};
  const values = [];

  for (const namespace of Object.values(flags)) {
    if (!namespace || typeof namespace !== "object") continue;
    for (const key of ["canonicalSourceId", "sourceId", "slug", "id"]) {
      if (typeof namespace[key] === "string") values.push(namespace[key]);
    }
  }

  return values;
}

function actionCount(doc) {
  const actions = doc?.system?.actions;
  if (Array.isArray(actions)) return actions.length;
  if (actions instanceof Map) return actions.size;
  if (actions && typeof actions.size === "number") return actions.size;
  if (actions && typeof actions === "object") {
    if (typeof actions.toObject === "function") {
      const object = actions.toObject();
      return object && typeof object === "object" ? Object.keys(object).length : 0;
    }
    return Object.keys(actions).length;
  }
  return 0;
}

function effectCount(doc) {
  const effects = doc?.effects;
  if (Array.isArray(effects)) return effects.length;
  if (effects?.size !== undefined) return effects.size;
  return 0;
}

const NATIVE_MATCH_OVERRIDES = Object.freeze({
  "srd-2.0.domain-card.dread.horror": "Summon Horror",
});

function nativeCandidateScore(toolkit, native) {
  const sourceId = canonicalId(toolkit);
  const parts = canonicalParts(sourceId);
  if (!parts) return { score: 0, reasons: [] };

  const reasons = [];
  let score = 0;

  const overrideName = NATIVE_MATCH_OVERRIDES[sourceId];
  if (overrideName && native?.name === overrideName) {
    score += 1000;
    reasons.push("verified-override");
  }

  const nativeDomain = String(native?.system?.domain ?? "").toLowerCase();
  const nativeSlug = slugify(native?.name);
  const nativeLevel = Number(native?.system?.level);
  const toolkitLevel = Number(toolkit?.system?.level);

  if (nativeSourceHints(native).some(value => value === sourceId)) {
    score += 100;
    reasons.push("canonical-id");
  }

  if (nativeSlug === parts.slug) {
    score += 50;
    reasons.push("slug");
  }

  if (nativeDomain === parts.domain) {
    score += 20;
    reasons.push("domain");
  }

  if (Number.isFinite(nativeLevel) && Number.isFinite(toolkitLevel) && nativeLevel === toolkitLevel) {
    score += 5;
    reasons.push("level");
  }

  return { score, reasons };
}

export function bestNativeMatch(toolkit, nativeDocs) {
  const ranked = nativeDocs
    .map(native => ({ native, ...nativeCandidateScore(toolkit, native) }))
    .filter(row => row.score > 0)
    .sort((a, b) => b.score - a.score || String(a.native.name).localeCompare(String(b.native.name)));

  if (!ranked.length) return { match: null, ambiguous: false, ranked: [] };

  const bestScore = ranked[0].score;
  const best = ranked.filter(row => row.score === bestScore);
  return {
    match: best.length === 1 ? best[0] : null,
    ambiguous: best.length > 1,
    ranked: best.slice(0, 5),
  };
}

export async function auditNativeDomainCardMechanics() {
  const toolkitPack = game.packs.get(TOOLKIT_PACK);
  const nativePack = game.packs.get(NATIVE_PACK);
  if (!toolkitPack) throw new Error(`Campaign Toolkit | missing pack ${TOOLKIT_PACK}`);
  if (!nativePack) throw new Error(`Campaign Toolkit | missing native pack ${NATIVE_PACK}`);

  const [toolkitDocs, nativeDocs] = await Promise.all([
    toolkitPack.getDocuments(),
    nativePack.getDocuments(),
  ]);

  const coreDocs = toolkitDocs.filter(doc => canonicalId(doc)?.startsWith(CORE_PREFIX));
  const rows = [];
  const unmatched = [];
  const ambiguous = [];

  for (const toolkit of coreDocs) {
    const result = bestNativeMatch(toolkit, nativeDocs);
    const parts = canonicalParts(canonicalId(toolkit));

    if (!result.match) {
      const issue = {
        toolkitId: toolkit.id,
        toolkitName: toolkit.name,
        canonicalSourceId: canonicalId(toolkit),
        domain: parts?.domain ?? null,
        slug: parts?.slug ?? null,
        candidates: result.ranked.map(row => ({
          id: row.native.id,
          name: row.native.name,
          domain: row.native.system?.domain ?? null,
          level: row.native.system?.level ?? null,
          score: row.score,
          reasons: row.reasons,
          actions: actionCount(row.native),
          effects: effectCount(row.native),
        })),
      };
      (result.ambiguous ? ambiguous : unmatched).push(issue);
      continue;
    }

    const native = result.match.native;
    rows.push({
      toolkitId: toolkit.id,
      toolkitName: toolkit.name,
      canonicalSourceId: canonicalId(toolkit),
      nativeId: native.id,
      nativeName: native.name,
      domain: native.system?.domain ?? null,
      level: native.system?.level ?? null,
      score: result.match.score,
      reasons: result.match.reasons,
      toolkitActions: actionCount(toolkit),
      nativeActions: actionCount(native),
      toolkitEffects: effectCount(toolkit),
      nativeEffects: effectCount(native),
    });
  }

  const report = {
    phase: "P2.8l",
    mode: "audit-only",
    toolkitPack: TOOLKIT_PACK,
    nativePack: NATIVE_PACK,
    toolkitCoreCards: coreDocs.length,
    nativeCards: nativeDocs.length,
    matched: rows.length,
    unmatched: unmatched.length,
    ambiguous: ambiguous.length,
    matchedWithNativeActions: rows.filter(row => row.nativeActions > 0).length,
    matchedWithNativeEffects: rows.filter(row => row.nativeEffects > 0).length,
    matchedWithAnyNativeMechanics: rows.filter(row => row.nativeActions > 0 || row.nativeEffects > 0).length,
    matchedWithBothNativeMechanics: rows.filter(row => row.nativeActions > 0 && row.nativeEffects > 0).length,
    toolkitCardsWithActions: rows.filter(row => row.toolkitActions > 0).length,
    toolkitCardsWithEffects: rows.filter(row => row.toolkitEffects > 0).length,
    greenForReconstruction:
      rows.length === coreDocs.length &&
      unmatched.length === 0 &&
      ambiguous.length === 0,
    rows,
    unmatchedRows: unmatched,
    ambiguousRows: ambiguous,
  };

  console.table({
    toolkitCoreCards: report.toolkitCoreCards,
    nativeCards: report.nativeCards,
    matched: report.matched,
    unmatched: report.unmatched,
    ambiguous: report.ambiguous,
    matchedWithNativeActions: report.matchedWithNativeActions,
    matchedWithNativeEffects: report.matchedWithNativeEffects,
    matchedWithAnyNativeMechanics: report.matchedWithAnyNativeMechanics,
    matchedWithBothNativeMechanics: report.matchedWithBothNativeMechanics,
    toolkitCardsWithActions: report.toolkitCardsWithActions,
    toolkitCardsWithEffects: report.toolkitCardsWithEffects,
    greenForReconstruction: report.greenForReconstruction,
  });

  if (unmatched.length) console.warn(`${MODULE_ID} | unmatched native domain cards`, unmatched);
  if (ambiguous.length) console.warn(`${MODULE_ID} | ambiguous native domain cards`, ambiguous);

  return report;
}
