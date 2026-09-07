const MODULE_ID = "daggerheart-campaign-toolkit";
const FLAG_SCOPE = MODULE_ID;

const ROUTES = Object.freeze({
  class:       { packId: "dh-classes" },
  subclass:    { packId: "dh-subclasses" },
  domain_card: { packId: "dh-domain-cards" },
  weapon:      { packId: "dh-weapons" },
  armor:       { packId: "dh-armor" },
  adversary:   { packId: "dh-adversaries" },
  environment: { packId: "dh-environments" },
});

/*
 * Fields below are deliberately broader than the current mapper. They are
 * fields where a cloned SRD template can leave semantically foreign content.
 * The audit does not mutate anything; it only identifies repeated non-empty
 * fingerprints which are suspicious after a template-based import.
 */
const SENSITIVE_SYSTEM_FIELDS = Object.freeze({
  class: ["classItems", "features", "inventory", "characterGuide", "backgroundQuestions", "connections"],
  subclass: ["features", "linkedClass", "spellcastingTrait"],
  domain_card: ["actions", "resource"],
  weapon: ["actions", "resource", "weaponFeatures"],
  armor: ["actions", "resource", "armorFeatures"],
  adversary: ["description", "experiences"],
  environment: ["description", "potentialAdversaries"],
});

function isMeaningful(value) {
  if (value === null || value === undefined || value === "") return false;
  if (value === false || value === 0) return false;
  if (Array.isArray(value)) return value.some(isMeaningful);
  if (typeof value === "object") {
    return Object.values(value).some(isMeaningful);
  }
  return true;
}

function stable(value, seen = new WeakSet()) {
  if (value === null || value === undefined) return value;
  if (typeof value !== "object") return value;

  if (seen.has(value)) return "[Circular]";
  seen.add(value);

  try {
    // Foundry DataModel / TypedObject values can carry internal state that
    // makes direct JSON serialization fail. Reduce them to source data first.
    if (typeof value.toObject === "function") {
      return stable(value.toObject(false), seen);
    }

    if (Array.isArray(value)) return value.map(v => stable(v, seen));

    if (value instanceof Map) {
      return Object.fromEntries(
        [...value.entries()]
          .sort(([a], [b]) => String(a).localeCompare(String(b)))
          .map(([k, v]) => [String(k), stable(v, seen)])
      );
    }

    if (value instanceof Set) {
      return [...value].map(v => stable(v, seen)).sort((a, b) => String(a).localeCompare(String(b)));
    }

    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map(k => [k, stable(value[k], seen)])
    );
  } finally {
    seen.delete(value);
  }
}

function fingerprint(value) {
  try {
    const normalized = stable(value);
    return JSON.stringify(normalized);
  } catch (error) {
    // Never collapse all object values to the same "[object Object]"
    // fingerprint: that would manufacture template-leakage false positives.
    return `[Unserializable:${error?.name ?? "Error"}]`;
  }
}

function short(value, max = 150) {
  const text = fingerprint(value);
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

async function managedDocuments(packId) {
  const pack = game.packs.get(`${MODULE_ID}.${packId}`);
  if (!pack) throw new Error(`Compendium absent: ${packId}`);
  const index = await pack.getIndex({ fields: [
    `flags.${FLAG_SCOPE}.managed`,
    `flags.${FLAG_SCOPE}.kind`,
    `flags.${FLAG_SCOPE}.sourceId`,
    `flags.${FLAG_SCOPE}.sourcePath`,
    `flags.${FLAG_SCOPE}.mappingVersion`,
    "name", "type",
  ]});
  const rows = index.filter(e => foundry.utils.getProperty(e, `flags.${FLAG_SCOPE}.managed`) === true);
  const docs = [];
  for (const row of rows) {
    const doc = await pack.getDocument(row._id);
    if (doc) docs.push(doc);
  }
  return docs;
}

function repeatedSystemFingerprints(kind, docs) {
  const findings = [];
  const fields = SENSITIVE_SYSTEM_FIELDS[kind] ?? [];
  const threshold = Math.max(3, Math.ceil(docs.length * 0.20));

  for (const field of fields) {
    const groups = new Map();
    for (const doc of docs) {
      const value = foundry.utils.getProperty(doc.system, field);
      if (!isMeaningful(value)) continue;
      const fp = fingerprint(value);
      if (!groups.has(fp)) groups.set(fp, { value, names: [] });
      groups.get(fp).names.push(doc.name);
    }

    for (const group of groups.values()) {
      if (group.names.length < threshold) continue;
      findings.push({
        kind,
        field: `system.${field}`,
        repeated: group.names.length,
        total: docs.length,
        sampleNames: group.names.slice(0, 5).join(" | "),
        value: short(group.value),
      });
    }
  }
  return findings;
}

function environmentPotentialAdversaryIssues(docs) {
  const findings = [];
  for (const doc of docs) {
    const flags = doc.flags?.[FLAG_SCOPE] ?? {};
    const sourceText = String(flags.potentialAdversariesSourceText ?? "").trim();
    if (!sourceText) continue;
    const groups = doc.system?.potentialAdversaries ?? {};
    if (!isMeaningful(groups)) {
      findings.push({ kind: "environment", name: doc.name, field: "system.potentialAdversaries", message: "source text exists but structured groups are empty" });
    }
  }
  return findings;
}

function repeatedEmbeddedItems(kind, docs) {
  if (!["adversary", "environment"].includes(kind)) return [];
  const groups = new Map();
  for (const doc of docs) {
    const signature = doc.items?.map(i => `${i.type}:${i.name}`).sort() ?? [];
    if (!signature.length) continue;
    const fp = fingerprint(signature);
    if (!groups.has(fp)) groups.set(fp, { signature, names: [] });
    groups.get(fp).names.push(doc.name);
  }
  const threshold = Math.max(3, Math.ceil(docs.length * 0.20));
  return [...groups.values()]
    .filter(g => g.names.length >= threshold)
    .map(g => ({
      kind,
      field: "embeddedItems",
      repeated: g.names.length,
      total: docs.length,
      sampleNames: g.names.slice(0, 5).join(" | "),
      value: short(g.signature),
    }));
}


function blankFeatureSemanticBaseline() {
  // Foundryborne can materialize neutral schema defaults (notably resource or
  // action containers) even when the importer deliberately omits them. Those
  // defaults are not template leakage. Compare imported embedded features to a
  // fresh minimal native Feature document instead of treating every non-empty
  // DataModel as source semantics.
  try {
    const DocumentClass = CONFIG.Item?.documentClass ?? Item;
    const blank = new DocumentClass({ name: "Audit Neutral Feature", type: "feature" });
    return {
      actions: fingerprint(blank.system?.actions),
      resource: fingerprint(blank.system?.resource),
      effects: fingerprint(blank.effects),
    };
  } catch (error) {
    console.warn(`${MODULE_ID} | unable to build neutral Feature baseline`, error);
    return { actions: fingerprint(undefined), resource: fingerprint(undefined), effects: fingerprint([]) };
  }
}

function embeddedSourceFeatureIssues(kind, docs) {
  if (!["adversary", "environment"].includes(kind)) return [];
  const issues = [];
  const neutral = blankFeatureSemanticBaseline();
  for (const doc of docs) {
    const flags = doc.flags?.[FLAG_SCOPE] ?? {};
    const expected = Number(flags.sourceFeatureCount ?? 0);
    const sourceItems = [...(doc.items ?? [])].filter(item => item.type === "feature" && item.flags?.[FLAG_SCOPE]?.embeddedSourceFeature === true);
    if (Number.isFinite(expected) && sourceItems.length !== expected) {
      issues.push({ kind, name: doc.name, field: "embeddedItems:features", message: `expected ${expected}, found ${sourceItems.length}` });
    }
    for (const item of sourceItems) {
      if (!item.name || !String(item.system?.description ?? "").trim()) {
        issues.push({ kind, name: doc.name, field: `embeddedItems:${item.name ?? "unnamed"}`, message: "feature name/description incomplete" });
      }
      if (!["passive", "action", "reaction"].includes(String(item.system?.featureForm ?? ""))) {
        issues.push({ kind, name: doc.name, field: `embeddedItems:${item.name}`, message: "invalid featureForm" });
      }
      const semanticFields = {
        actions: fingerprint(item.system?.actions),
        resource: fingerprint(item.system?.resource),
        effects: fingerprint(item.effects),
      };
      const leaked = Object.entries(semanticFields)
        .filter(([field, value]) => value !== neutral[field])
        .map(([field]) => field);
      if (leaked.length) {
        issues.push({
          kind,
          name: doc.name,
          field: `embeddedItems:${item.name}`,
          message: `template semantic leakage: ${leaked.join(", ")}`,
        });
      }
    }
  }
  return issues;
}

function adversarySemanticIssues(docs) {
  const issues = [];
  for (const doc of docs) {
    const flags = doc.flags?.[FLAG_SCOPE] ?? {};
    const direct = flags.sourceAttackDamage;
    if (!direct?.direct) continue;
    const formula = doc.system?.attack?.damage?.main?.value?.custom?.formula;
    if (String(formula ?? "") !== String(direct.formula ?? "")) {
      issues.push({
        kind: "adversary",
        name: doc.name,
        field: "system.attack.damage",
        message: "direct-damage provenance/formula mismatch",
      });
    }
  }
  return issues;
}

function equipmentStatIssues(kind, docs) {
  const issues = [];
  if (kind === "weapon") {
    for (const doc of docs) {
      const a = doc.system?.attack;
      const flags = doc.flags?.[FLAG_SCOPE] ?? {};
      const dynamicSpellcast = flags.sourceAttackTrait === "spellcast"
        && flags.spellcastTraitResolution === "actor-default"
        && !a?.roll?.trait
        && (a?.roll?.useDefault === true || !("useDefault" in (a?.roll ?? {})))
        && a?.range && a?.damage?.main?.type?.size;
      if (!dynamicSpellcast && (!a?.roll?.trait || !a?.range || !a?.damage?.main?.type?.size)) {
        issues.push({ kind, name: doc.name, field: "system.attack", message: "attack stat line incomplete" });
      }
    }
  }
  if (kind === "armor") {
    for (const doc of docs) {
      const a = doc.system?.armor;
      const t = doc.system?.baseThresholds;
      if (!Number.isFinite(a?.max) || !Number.isFinite(t?.major) || !Number.isFinite(t?.severe)) {
        issues.push({ kind, name: doc.name, field: "system", message: "armor stat line incomplete" });
      }
    }
  }
  return issues;
}

function classStatIssues(kind, docs) {
  if (kind !== "class") return [];
  const issues = [];
  for (const doc of docs) {
    const flags = doc.flags?.[FLAG_SCOPE] ?? {};
    if (!flags.managed) continue;
    const domains = doc.system?.domains;
    const evasion = Number(doc.system?.evasion);
    const hp = Number(doc.system?.hitPoints);
    if (!Array.isArray(domains) || domains.length !== 2) {
      issues.push({ kind, name: doc.name, field: "system.domains", message: "class domain pair incomplete" });
    }
    if (!Number.isFinite(evasion) || evasion <= 0) {
      issues.push({ kind, name: doc.name, field: "system.evasion", message: "starting evasion incomplete" });
    }
    if (!Number.isFinite(hp) || hp <= 0) {
      issues.push({ kind, name: doc.name, field: "system.hitPoints", message: "starting hit points incomplete" });
    }
  }
  return issues;
}

function linkedSourceFeatureIssues(kind, docs) {
  if (!["class", "subclass"].includes(kind)) return [];
  const issues = [];
  for (const doc of docs) {
    const flags = doc.flags?.[FLAG_SCOPE] ?? {};
    const expected = Number(flags.sourceFeatureCount ?? 0);
    if (!expected) continue;
    const links = Array.from(doc.system?.features ?? []);
    if (links.length !== expected) {
      issues.push({ kind, name: doc.name, field: "system.features", message: `linked source feature count ${links.length}/${expected}` });
      continue;
    }
    for (const link of links) {
      const uuid = link?.uuid ?? link?.item?.uuid ?? (typeof link?.item === "string" ? link.item : null);
      if (!uuid) issues.push({ kind, name: doc.name, field: "system.features", message: "linked source feature missing UUID" });
    }
  }
  return issues;
}

async function bloodHunterFeaturePackAudit() {
  const issues = [];
  const pack = game.packs.get(`${MODULE_ID}.dh-features`);

  const classPack = game.packs.get(`${MODULE_ID}.dh-classes`);
  let activeVersion = null;
  if (classPack) {
    const classIndex = await classPack.getIndex({ fields: [`flags.${FLAG_SCOPE}.sourceId`, `flags.${FLAG_SCOPE}.managed`, "name"] });
    const bloodHunter = classIndex.find(row => {
      if (foundry.utils.getProperty(row, `flags.${FLAG_SCOPE}.managed`) !== true) return false;
      const sourceId = String(foundry.utils.getProperty(row, `flags.${FLAG_SCOPE}.sourceId`) ?? "");
      return /^the-void\.[^.]+\.class\.blood-hunter$/.test(sourceId);
    });
    const sourceId = String(foundry.utils.getProperty(bloodHunter, `flags.${FLAG_SCOPE}.sourceId`) ?? "");
    const match = sourceId.match(/^the-void\.(.+)\.class\.blood-hunter$/);
    activeVersion = match?.[1] ?? null;
  }

  // The support-pack contract is derived from the active canonical parents,
  // not from a hand-maintained version table. Each successfully resolved
  // Blood Hunter class/subclass stores its canonical source feature count in
  // flags during import. This keeps the audit aligned with future playtest
  // revisions without weakening the invariant.
  let expected = 0;
  let expectedParents = 0;
  for (const familyPackId of ["dh-classes", "dh-subclasses"]) {
    const familyPack = game.packs.get(`${MODULE_ID}.${familyPackId}`);
    if (!familyPack) continue;
    const familyIndex = await familyPack.getIndex({ fields: [
      `flags.${FLAG_SCOPE}.managed`,
      `flags.${FLAG_SCOPE}.sourceId`,
      `flags.${FLAG_SCOPE}.sourceFeatureCount`,
    ] });
    for (const row of familyIndex) {
      if (foundry.utils.getProperty(row, `flags.${FLAG_SCOPE}.managed`) !== true) continue;
      const sourceId = String(foundry.utils.getProperty(row, `flags.${FLAG_SCOPE}.sourceId`) ?? "");
      if (!activeVersion || !sourceId.startsWith(`the-void.${activeVersion}.`)) continue;
      if (!sourceId.includes(".class.") && !sourceId.includes(".subclass.")) continue;
      const count = Number(foundry.utils.getProperty(row, `flags.${FLAG_SCOPE}.sourceFeatureCount`) ?? 0);
      if (!Number.isFinite(count) || count < 0) {
        issues.push({ kind: "feature", name: row.name, field: "sourceFeatureCount", message: `invalid canonical source feature count: ${count}` });
        continue;
      }
      expected += count;
      expectedParents += 1;
    }
  }
  if (!activeVersion || expectedParents === 0) {
    issues.push({ kind: "feature", name: "dh-features", field: "activeVersion", message: `Unable to derive Blood Hunter feature contract for version ${activeVersion ?? "absent"}` });
    expected = null;
  }

  if (!pack) {
    issues.push({ kind: "feature", name: "dh-features", field: "compendium", message: "dedicated feature compendium absent" });
    return { pack: "dh-features", documents: null, expected, activeVersion, issues };
  }

  const index = await pack.getIndex({ fields: [
    `flags.${FLAG_SCOPE}.supportManaged`,
    `flags.${FLAG_SCOPE}.sourceFeature`,
    `flags.${FLAG_SCOPE}.parentSourceId`,
    "name", "type",
  ] });
  const rows = index.filter(r => foundry.utils.getProperty(r, `flags.${FLAG_SCOPE}.supportManaged`) === true);
  if (expected != null && rows.length !== expected) {
    issues.push({ kind: "feature", name: "dh-features", field: "supportManaged", message: `Blood Hunter feature count ${rows.length}/${expected} for ${activeVersion}` });
  }
  for (const row of rows) {
    if (row.type !== "feature" || foundry.utils.getProperty(row, `flags.${FLAG_SCOPE}.sourceFeature`) !== true) {
      issues.push({ kind: "feature", name: row.name, field: "type/provenance", message: "invalid dedicated source feature record" });
    }
    const parentSourceId = String(foundry.utils.getProperty(row, `flags.${FLAG_SCOPE}.parentSourceId`) ?? "");
    if (activeVersion && !parentSourceId.startsWith(`the-void.${activeVersion}.`)) {
      issues.push({ kind: "feature", name: row.name, field: "parentSourceId", message: `stale Blood Hunter support feature from another version: ${parentSourceId}` });
    }
  }

  for (const familyPackId of ["dh-classes", "dh-subclasses"]) {
    const familyPack = game.packs.get(`${MODULE_ID}.${familyPackId}`);
    if (!familyPack) continue;
    const familyIndex = await familyPack.getIndex({ fields: [`flags.${FLAG_SCOPE}.supportManaged`, "name", "type"] });
    for (const row of familyIndex.filter(r => foundry.utils.getProperty(r, `flags.${FLAG_SCOPE}.supportManaged`) === true)) {
      issues.push({ kind: "feature", name: row.name, field: familyPackId, message: "legacy support Feature still stored in family pack" });
    }
  }
  return { pack: "dh-features", documents: rows.length, expected, activeVersion, issues };
}

export async function semanticAudit() {
  if (!game.user?.isGM) throw new Error("P2.3.3p semantic audit is GM-only.");

  const summary = [];
  const provenanceIssues = [];
  const mappingGaps = [];
  const equipmentFeatureDispositions = [];
  const repeated = [];
  const statIssues = [];

  for (const [kind, route] of Object.entries(ROUTES)) {
    const docs = await managedDocuments(route.packId);
    summary.push({ kind, pack: route.packId, documents: docs.length });

    for (const doc of docs) {
      const flags = doc.flags?.[FLAG_SCOPE] ?? {};
      for (const field of flags.mappingGaps ?? []) {
        mappingGaps.push({ kind, name: doc.name, sourceId: flags.sourceId ?? null, field });
      }
      for (const disposition of flags.equipmentFeatureDispositions ?? []) {
        equipmentFeatureDispositions.push({
          kind,
          name: doc.name,
          sourceId: flags.sourceId ?? null,
          ...disposition,
        });
      }
      if (!flags.sourceId || !flags.sourcePath || !flags.mappingVersion) {
        provenanceIssues.push({
          kind,
          name: doc.name,
          sourceId: flags.sourceId ?? null,
          sourcePath: flags.sourcePath ?? null,
          mappingVersion: flags.mappingVersion ?? null,
        });
      }
    }

    repeated.push(...repeatedSystemFingerprints(kind, docs));
    repeated.push(...repeatedEmbeddedItems(kind, docs));
    statIssues.push(...equipmentStatIssues(kind, docs));
    if (kind === "adversary") statIssues.push(...adversarySemanticIssues(docs));
    statIssues.push(...embeddedSourceFeatureIssues(kind, docs));
    if (kind === "environment") statIssues.push(...environmentPotentialAdversaryIssues(docs));
    statIssues.push(...classStatIssues(kind, docs));
    statIssues.push(...linkedSourceFeatureIssues(kind, docs));
  }

  const bloodHunterFeaturePack = await bloodHunterFeaturePackAudit();
  statIssues.push(...bloodHunterFeaturePack.issues);

  const total = summary.reduce((n, r) => n + r.documents, 0);
  const nativeMapped = equipmentFeatureDispositions.filter(x => x.status === "nativeMapped");
  const mappedStructured = equipmentFeatureDispositions.filter(x => x.status === "mappedStructured");
  const deferredAutomation = equipmentFeatureDispositions.filter(x => x.status === "deferredAutomation");
  const uniqueBehaviorCount = rows => new Set(rows.map(x => `${x.kind}|${x.key ?? x.behavior}`)).size;

  const semanticComplete =
    total === 1012 &&
    bloodHunterFeaturePack.documents === bloodHunterFeaturePack.expected &&
    provenanceIssues.length === 0 &&
    repeated.length === 0 &&
    mappingGaps.length === 0 &&
    statIssues.length === 0;

  const result = {
    total,
    summary,
    bloodHunterFeaturePack,
    provenanceIssues,
    repeatedTemplateFingerprints: repeated,
    mappingGaps,
    equipmentFeatureDispositions,
    functionalDebt: {
      nativeMapped: nativeMapped.length,
      nativeBehaviors: uniqueBehaviorCount(nativeMapped),
      mappedStructured: mappedStructured.length,
      structuredBehaviors: uniqueBehaviorCount(mappedStructured),
      deferredAutomation: deferredAutomation.length,
      deferredBehaviors: uniqueBehaviorCount(deferredAutomation),
    },
    statIssues,
    semanticComplete,
    green: semanticComplete,
  };

  console.group(`${MODULE_ID} | P2.3.3p semantic audit`);
  console.table(summary);
  console.table({ supportPack: bloodHunterFeaturePack.pack, documents: bloodHunterFeaturePack.documents, expected: bloodHunterFeaturePack.expected, activeVersion: bloodHunterFeaturePack.activeVersion });
  console.table({
    documents: total,
    provenanceIssues: provenanceIssues.length,
    repeatedTemplateFingerprints: repeated.length,
    mappingGaps: mappingGaps.length,
    nativeMapped: nativeMapped.length,
    nativeBehaviors: result.functionalDebt.nativeBehaviors,
    mappedStructured: mappedStructured.length,
    structuredBehaviors: result.functionalDebt.structuredBehaviors,
    deferredAutomation: deferredAutomation.length,
    deferredBehaviors: result.functionalDebt.deferredBehaviors,
    statIssues: statIssues.length,
    semanticComplete: result.semanticComplete,
    green: result.green,
  });
  if (provenanceIssues.length) {
    console.warn(`${MODULE_ID} | provenance issues`);
    console.table(provenanceIssues);
  }
  if (statIssues.length) {
    console.warn(`${MODULE_ID} | equipment stat mapping issues`);
    console.table(statIssues);
  }
  if (equipmentFeatureDispositions.length) {
    const byBehavior = Object.values(equipmentFeatureDispositions.reduce((acc, row) => {
      const key = `${row.kind}|${row.key ?? row.behavior}|${row.status}`;
      acc[key] ??= {
        kind: row.kind,
        behavior: row.behavior,
        key: row.key,
        status: row.status,
        occurrences: 0,
        sampleNames: [],
      };
      acc[key].occurrences += 1;
      if (acc[key].sampleNames.length < 5) acc[key].sampleNames.push(row.name);
      return acc;
    }, {})).map(row => ({ ...row, sampleNames: row.sampleNames.join(" | ") }));
    console.info(`${MODULE_ID} | P2.3.3 equipment behavior dispositions`);
    console.table(byBehavior);
  }

  if (mappingGaps.length) {
    const byField = Object.values(mappingGaps.reduce((acc, gap) => {
      const key = `${gap.kind}:${gap.field}`;
      acc[key] ??= { kind: gap.kind, field: gap.field, count: 0, sampleNames: [] };
      acc[key].count += 1;
      if (acc[key].sampleNames.length < 5) acc[key].sampleNames.push(gap.name);
      return acc;
    }, {})).map(row => ({ ...row, sampleNames: row.sampleNames.join(" | ") }));
    console.info(`${MODULE_ID} | explicit mapping gaps (not template leakage)`);
    console.table(byField);
  }
  if (repeated.length) {
    console.warn(`${MODULE_ID} | repeated template-sensitive fingerprints (review required)`);
    console.table(repeated);
  }
  console.groupEnd();

  ui.notifications[result.green ? "info" : "warn"](
    result.green
      ? `Campaign Toolkit : P2.3.3p semantic closure GREEN · ${result.functionalDebt.deferredBehaviors} comportements différés`
      : `Campaign Toolkit : P2.3.3p à examiner — ${mappingGaps.length} mapping gaps · voir console`
  );
  return result;
}
