const MODULE_ID = "daggerheart-campaign-toolkit";

const SOURCE_PACKS = Object.freeze([
  "dh-ancestries",
  "dh-communities",
  "dh-classes",
  "dh-subclasses",
  "dh-features",
  "dh-domain-cards",
  "dh-weapons",
  "dh-armor",
  "dh-consumables",
  "dh-loot",
]);

const BLOOD_HUNTER_PREFIX = "the-void.2026-07-09.";
const SRD_PREFIX = "srd-2.0.";

function cleanSource(doc) {
  const source = foundry.utils.deepClone(doc.toObject());
  delete source.folder;
  delete source.sort;
  delete source.ownership;
  return source;
}

function flagsOf(source) {
  return source.flags?.[MODULE_ID] ?? {};
}

function sourceIdentity(source) {
  const flags = flagsOf(source);
  return (
    flags.sourceId ??
    flags.canonicalSourceId ??
    flags.canonicalId ??
    ""
  );
}

function classifySource(source) {
  const flags = flagsOf(source);
  const id = sourceIdentity(source);
  const corpus = flags.source?.corpus ?? null;
  const product = flags.source?.product ?? null;

  if (
    id.startsWith(BLOOD_HUNTER_PREFIX) ||
    corpus === "the-void" ||
    product === "blood-hunter"
  ) {
    return {
      origin: "playtest",
      namespace: "the-void/blood-hunter-2026-07-09",
      reason: "the-void-blood-hunter",
    };
  }

  if (
    id.startsWith(SRD_PREFIX) ||
    corpus === "daggerheart-srd" ||
    product === "srd"
  ) {
    return {
      origin: "core",
      namespace: "daggerheart-srd-2.0",
      reason: "daggerheart-srd",
    };
  }

  // Heritage features created during the FR materialization can have no
  // canonicalId. They remain core because their parent pack is an owned SRD
  // family and their runtime UUIDs are already Toolkit-local.
  if (
    ["ancestry", "community"].includes(flags.family) &&
    flags.contentOwner === MODULE_ID
  ) {
    return {
      origin: "core",
      namespace: "daggerheart-srd-2.0",
      reason: "owned-heritage-feature",
    };
  }

  return {
    origin: "unclassified",
    namespace: "unclassified",
    reason: "no-provenance-rule",
  };
}

function normalizeProvenance(source, classification) {
  const copy = foundry.utils.deepClone(source);
  copy.flags ??= {};
  copy.flags[MODULE_ID] ??= {};
  copy.flags[MODULE_ID].contentOwner = MODULE_ID;
  copy.flags[MODULE_ID].contentOrigin = classification.origin;
  copy.flags[MODULE_ID].sourceNamespace = classification.namespace;
  return copy;
}

function downloadJson(filename, data) {
  const text = JSON.stringify(data, null, 2);
  const blob = new Blob([text], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function sortRows(rows) {
  return rows.sort((a, b) => String(a._id).localeCompare(String(b._id)));
}

export async function exportAutonomousCoreSources({ download = true } = {}) {
  const sources = {
    core: {},
    playtest: {},
    unclassified: {},
  };
  const audit = {
    total: 0,
    core: 0,
    playtest: 0,
    unclassified: 0,
    byPack: {},
    unclassifiedItems: [],
  };

  for (const packName of SOURCE_PACKS) {
    const pack = game.packs.get(`${MODULE_ID}.${packName}`);
    if (!pack) throw new Error(`Missing owned pack ${MODULE_ID}.${packName}`);

    const docs = await pack.getDocuments();
    audit.byPack[packName] = { total: docs.length, core: 0, playtest: 0, unclassified: 0 };

    for (const doc of docs) {
      const raw = cleanSource(doc);
      const classification = classifySource(raw);
      const row = normalizeProvenance(raw, classification);

      sources[classification.origin][packName] ??= [];
      sources[classification.origin][packName].push(row);

      audit.total += 1;
      audit[classification.origin] += 1;
      audit.byPack[packName][classification.origin] += 1;

      if (classification.origin === "unclassified") {
        audit.unclassifiedItems.push({
          pack: packName,
          id: row._id,
          name: row.name,
          type: row.type,
          sourceIdentity: sourceIdentity(row) || null,
        });
      }
    }
  }

  for (const group of Object.values(sources)) {
    for (const rows of Object.values(group)) sortRows(rows);
  }

  const payload = {
    schema: "daggerheart-campaign-toolkit/autonomous-content@2",
    owner: MODULE_ID,
    sourceLayout: {
      core: "data/core/fr",
      playtest: "data/playtest",
      homebrew: "data/homebrew",
    },
    audit,
    sources,
  };

  if (download) {
    downloadJson("daggerheart-toolkit-autonomous-sources-v2.json", payload);
  }
  return payload;
}

export function autonomousSourceExpectedCounts() {
  return {
    "dh-ancestries": 72,
    "dh-communities": 30,
    "dh-classes": 14,
    "dh-subclasses": 29,
    "dh-features": 54,
    "dh-domain-cards": 231,
    "dh-weapons": 358,
    "dh-armor": 69,
    "dh-consumables": 120,
    "dh-loot": 0,
    total: 994,
    expectedCore: 934,
    expectedBloodHunterPlaytest: 43,
    expectedMonsterHunterHomebrew: 17,
  };
}
