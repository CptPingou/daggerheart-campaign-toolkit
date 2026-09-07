import { applyContentLocale, getImportLocale } from "./content-locale.mjs";
import { buildItem, buildActor, buildLinkedSourceFeature, ensureSourceEquipmentFeatureCatalog } from "./pilot-import.mjs";

const MODULE_ID = "daggerheart-campaign-toolkit";
const FLAG_SCOPE = MODULE_ID;
const FULL_URL = `modules/${MODULE_ID}/data/full-import.json`;
const MAPPING_VERSION = "BH-2026-07-09-active";

const ROUTES = Object.freeze({
  class:       { packId: "dh-classes",       documentClass: Item,  build: buildItem },
  subclass:    { packId: "dh-subclasses",    documentClass: Item,  build: buildItem },
  domain_card: { packId: "dh-domain-cards",  documentClass: Item,  build: buildItem },
  weapon:      { packId: "dh-weapons",       documentClass: Item,  build: buildItem },
  armor:       { packId: "dh-armor",         documentClass: Item,  build: buildItem },
  adversary:   { packId: "dh-adversaries",   documentClass: Actor, build: buildActor },
  environment: { packId: "dh-environments",  documentClass: Actor, build: buildActor },
});

async function loadPayload() {
  const response = await fetch(FULL_URL, { cache: "no-store" });
  if (!response.ok) throw new Error(`full-import.json introuvable (${response.status}). Lance export_foundry_full.py.`);
  const payload = await response.json();
  const phase = String(payload?.phase ?? "");
  if (!(phase.startsWith("P2.3.3a") || phase === "BH-2026-07-09-active")) {
    throw new Error(`full-import.json non supporté (phase reçue: ${payload?.phase ?? "absente"})`);
  }
  return payload;
}

function markManaged(data, kind) {
  const flags = foundry.utils.deepClone(data.flags ?? {});
  flags[FLAG_SCOPE] ??= {};
  delete flags[FLAG_SCOPE].pilot;
  flags[FLAG_SCOPE].managed = true;
  flags[FLAG_SCOPE].kind = kind;
  flags[FLAG_SCOPE].mappingVersion = MAPPING_VERSION;
  data.flags = flags;
  return data;
}

async function replaceManaged(packId, docs, documentClass) {
  const pack = game.packs.get(`${MODULE_ID}.${packId}`);
  if (!pack) throw new Error(`Compendium absent: ${packId}`);
  await pack.configure({ locked: false });
  try {
    const index = await pack.getIndex({ fields: [`flags.${FLAG_SCOPE}.managed`] });
    for (const entry of index.filter(e => foundry.utils.getProperty(e, `flags.${FLAG_SCOPE}.managed`) === true)) {
      const doc = await pack.getDocument(entry._id);
      if (doc) await doc.delete();
    }

    let created = 0;
    const failures = [];
    for (const data of docs) {
      try {
        await documentClass.create(data, { pack: pack.collection });
        created += 1;
      } catch (error) {
        failures.push({ name: data.name, type: data.type, message: error?.message ?? String(error) });
        console.error(`${MODULE_ID} | family import failed`, packId, data.name, data.type, error);
      }
    }
    return { attempted: docs.length, created, failed: failures.length, failures };
  } finally {
    await pack.configure({ locked: true });
  }
}


async function resolveSubclassClassLinks() {
  const classPack = game.packs.get(`${MODULE_ID}.dh-classes`);
  const subclassPack = game.packs.get(`${MODULE_ID}.dh-subclasses`);
  if (!classPack || !subclassPack) return { resolved: 0, unresolved: 0 };

  const classes = [];
  for (const row of await classPack.getIndex({ fields: [`flags.${FLAG_SCOPE}.sourceId`, "name"] })) {
    const doc = await classPack.getDocument(row._id);
    if (doc) classes.push(doc);
  }
  const norm = v => String(v ?? "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
  const byKey = new Map();
  for (const doc of classes) {
    const f = doc.flags?.[FLAG_SCOPE] ?? {};
    const sourceIdTail = f.sourceId ? String(f.sourceId).split(".").at(-1) : null;
    // Resolve parent links against stable canonical identity as well as the
    // displayed name. The displayed name may be localized (Guardian → Gardien),
    // while subclass DH-DATA deliberately keeps its neutral parent name.
    for (const key of [doc.name, f.sourceId, sourceIdTail]) if (key) byKey.set(norm(key), doc);
  }

  let resolved = 0, unresolved = 0;
  await subclassPack.configure({ locked: false });
  try {
    const index = await subclassPack.getIndex({ fields: [`flags.${FLAG_SCOPE}.managed`] });
    for (const row of index.filter(e => foundry.utils.getProperty(e, `flags.${FLAG_SCOPE}.managed`) === true)) {
      const doc = await subclassPack.getDocument(row._id);
      if (!doc) continue;
      const flags = foundry.utils.deepClone(doc.flags?.[FLAG_SCOPE] ?? {});
      const source = flags.linkedClassSourceId;
      if (!source) { unresolved += 1; continue; }
      let parent = byKey.get(norm(source));
      if (!parent && String(source).includes(".")) parent = byKey.get(norm(String(source).split(".").at(-1)));
      if (!parent) { unresolved += 1; continue; }
      flags.mappingGaps = (flags.mappingGaps ?? []).filter(g => g !== "system.linkedClass");
      await doc.update({ "system.linkedClass": parent.uuid, [`flags.${FLAG_SCOPE}`]: flags });
      resolved += 1;
    }
  } finally { await subclassPack.configure({ locked: true }); }
  return { resolved, unresolved };
}


function sourceRules(raw) {
  return raw?.rules ?? raw?.mechanics ?? raw?.system ?? {};
}

function bloodHunterFeatureLinkType(kind, feature) {
  if (kind === "class") {
    return feature?.category === "hope_feature" ? "hope" : "class";
  }
  const tier = String(feature?.tier ?? "").trim().toLowerCase();
  if (["foundation", "specialization", "mastery"].includes(tier)) return tier;
  return null;
}

async function deleteSupportManaged(pack, { keepIds = null } = {}) {
  if (!pack) return 0;
  let removed = 0;
  await pack.configure({ locked: false });
  try {
    // Do not rely on the compendium index cache for migration cleanup.  A
    // support feature may have been created/deleted earlier in the same import
    // cycle, while getIndex() can still expose the previous cached row set.
    const docs = await pack.getDocuments();
    const ids = docs
      .filter(doc => foundry.utils.getProperty(doc, `flags.${FLAG_SCOPE}.supportManaged`) === true)
      .filter(doc => !keepIds || !keepIds.has(doc.id))
      .map(doc => doc.id);
    if (ids.length) {
      await Item.deleteDocuments(ids, { pack: pack.collection });
      removed += ids.length;
    }
  } finally {
    await pack.configure({ locked: true });
  }
  return removed;
}

async function resolveBloodHunterFeatures(payload) {
  const targets = (payload.entries ?? []).filter(entry => {
    if (!["class", "subclass"].includes(entry.kind)) return false;
    const raw = entry.data ?? {};
    return raw?.source?.corpus === "the-void" && raw?.source?.product === "blood-hunter";
  });

  const featurePack = game.packs.get(`${MODULE_ID}.dh-features`);
  if (!featurePack) throw new Error("Compendium absent: dh-features");

  // P2.3.3n created support Feature Items inside the class/subclass family
  // packs. Remove only those support-managed documents before rebuilding them
  // in the dedicated feature pack; canonical class/subclass documents are not
  // touched here.
  const legacyRemoved =
    await deleteSupportManaged(game.packs.get(`${MODULE_ID}.dh-classes`)) +
    await deleteSupportManaged(game.packs.get(`${MODULE_ID}.dh-subclasses`));
  await deleteSupportManaged(featurePack);

  const versions = [...new Set(targets.map(entry => entry?.data?.source?.version).filter(Boolean))];
  const stats = { parents: 0, features: 0, unresolved: 0, legacyRemoved, staleRemoved: 0, featurePack: "dh-features", versions };
  const createdFeatureIds = new Set();
  await featurePack.configure({ locked: false });
  try {
    for (const entry of targets) {
      const raw = entry.data ?? {};
      const features = sourceRules(raw).features;
      if (!Array.isArray(features) || !features.length) continue;
      const route = ROUTES[entry.kind];
      const parentPack = game.packs.get(`${MODULE_ID}.${route.packId}`);
      if (!parentPack) { stats.unresolved += 1; continue; }

      const parentIndex = await parentPack.getIndex({ fields: [`flags.${FLAG_SCOPE}.sourceId`, `flags.${FLAG_SCOPE}.managed`] });
      const parentRow = parentIndex.find(r => foundry.utils.getProperty(r, `flags.${FLAG_SCOPE}.managed`) === true && foundry.utils.getProperty(r, `flags.${FLAG_SCOPE}.sourceId`) === raw.id);
      const parent = parentRow ? await parentPack.getDocument(parentRow._id) : null;
      if (!parent) { stats.unresolved += 1; continue; }

      const links = [];
      for (let index = 0; index < features.length; index += 1) {
        const feature = features[index];
        const linkType = bloodHunterFeatureLinkType(entry.kind, feature);
        if (!linkType) { stats.unresolved += 1; continue; }
        const featureData = await buildLinkedSourceFeature(feature, raw, entry.source_path, index, linkType);
        const created = await Item.create(featureData, { pack: featurePack.collection });
        if (!created) { stats.unresolved += 1; continue; }
        links.push({ type: linkType, item: created.uuid });
        createdFeatureIds.add(created.id);
        stats.features += 1;
      }

      if (links.length === features.length) {
        const flags = foundry.utils.deepClone(parent.flags?.[FLAG_SCOPE] ?? {});
        flags.mappingGaps = (flags.mappingGaps ?? []).filter(g => g !== "system.features");
        flags.sourceFeatureCount = features.length;
        await parentPack.configure({ locked: false });
        try {
          await parent.update({ "system.features": links, [`flags.${FLAG_SCOPE}`]: flags });
        } finally {
          await parentPack.configure({ locked: true });
        }
        stats.parents += 1;
      } else {
        stats.unresolved += 1;
      }
    }
  } finally {
    await featurePack.configure({ locked: true });
  }

  // Migration invariant: the active support pack must contain exactly the
  // features built during this run. Remove any stale support-managed record
  // left by an older Blood Hunter version or by a previous interrupted import.
  stats.staleRemoved = await deleteSupportManaged(featurePack, { keepIds: createdFeatureIds });
  return stats;
}

function normalizeAdversaryName(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[’‘]/g, "'")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function splitTopLevel(text) {
  const out = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === "(") depth += 1;
    else if (ch === ")" && depth > 0) depth -= 1;
    else if (ch === "," && depth === 0) {
      const part = text.slice(start, i).trim();
      if (part) out.push(part);
      start = i + 1;
    }
  }
  const tail = text.slice(start).trim();
  if (tail) out.push(tail);
  return out;
}

function parsePotentialAdversaryGroups(text) {
  return splitTopLevel(String(text ?? "")).map((segment, index) => {
    const match = segment.match(/^(.+?)\s*\((.*)\)\s*$/);
    if (!match) return { key: `group-${index + 1}`, label: segment.trim(), names: [segment.trim()] };
    return {
      key: `group-${index + 1}`,
      label: match[1].trim(),
      names: splitTopLevel(match[2]).map(v => v.trim()).filter(Boolean),
    };
  });
}

function buildAdversaryResolver(documents) {
  const byExact = new Map();
  const all = [];
  for (const doc of documents) {
    const key = normalizeAdversaryName(doc.name);
    if (key) byExact.set(key, doc);
    all.push({ key, doc });
  }

  const explicitAliases = new Map([
    ["temporal enforcer", "T emporal Enforcer"],
    ["temporal enforcers", "T emporal Enforcer"],
    ["pirate tough", "Pirate T ough"],
    ["pirate toughs", "Pirate T ough"],
    ["tangle bramble", "T angle Bramble"],
    ["adult flickerfly", "Adult Flickerfl y"],
    ["yufos", "Yufo"],
    ["fallen shock troops", "Fallen Shock Troop"],
    ["cryptimoths", "Cryptimoth"],
    ["whisper wraiths", "Whisper Wraith"],
    ["jack-o'-lanterns", "Jack-o’-Lantern"],
    ["redcap biters", "Redcap Biter"],
    ["electric eels", "Electric Eels"],
  ].map(([a, b]) => [normalizeAdversaryName(a), normalizeAdversaryName(b)]));

  function singularCandidates(key) {
    const out = [key];
    if (key.endsWith("ies")) out.push(`${key.slice(0, -3)}y`);
    if (key.endsWith("ses")) out.push(key.slice(0, -2));
    if (key.endsWith("s")) out.push(key.slice(0, -1));
    return [...new Set(out)];
  }

  function resolveOne(name) {
    const sourceKey = normalizeAdversaryName(name);
    if (!sourceKey || ["any", "none"].includes(sourceKey)) return [];
    const aliasKey = explicitAliases.get(sourceKey);
    if (aliasKey && byExact.has(aliasKey)) return [byExact.get(aliasKey)];
    for (const key of singularCandidates(sourceKey)) if (byExact.has(key)) return [byExact.get(key)];

    // Generic plural/category labels can legitimately point at several concrete stat blocks.
    const prefixAliases = {
      vaultguardians: "vaultguardian",
      jaggedknifebandits: "jaggedknife",
      jaggedknives: "jaggedknife",
      pirates: "pirate",
      skeletons: "skeleton",
      zombies: "zombie",
      constructs: "construct",
      guards: "guard",
      psychicvampires: "vampire",
    };
    const prefix = prefixAliases[sourceKey];
    if (prefix) return all.filter(row => row.key.includes(prefix)).map(row => row.doc);
    return [];
  }
  return resolveOne;
}

async function resolveEnvironmentPotentialAdversaries() {
  const adversaryPack = game.packs.get(`${MODULE_ID}.dh-adversaries`);
  const environmentPack = game.packs.get(`${MODULE_ID}.dh-environments`);
  if (!adversaryPack || !environmentPack) return { resolvedEnvironments: 0, linkedUuids: 0, textOnlyGroups: 0 };

  const adversaries = [];
  for (const row of await adversaryPack.getIndex({ fields: ["name"] })) {
    const doc = await adversaryPack.getDocument(row._id);
    if (doc) adversaries.push(doc);
  }
  const resolveOne = buildAdversaryResolver(adversaries);

  let resolvedEnvironments = 0;
  let linkedUuids = 0;
  let textOnlyGroups = 0;
  await environmentPack.configure({ locked: false });
  try {
    const index = await environmentPack.getIndex({ fields: [`flags.${FLAG_SCOPE}.managed`] });
    for (const row of index.filter(e => foundry.utils.getProperty(e, `flags.${FLAG_SCOPE}.managed`) === true)) {
      const doc = await environmentPack.getDocument(row._id);
      if (!doc) continue;
      const flags = foundry.utils.deepClone(doc.flags?.[FLAG_SCOPE] ?? {});
      const sourceText = String(flags.potentialAdversariesSourceText ?? "").trim();
      if (!sourceText) continue;

      const groups = {};
      for (const parsed of parsePotentialAdversaryGroups(sourceText)) {
        const uuids = [];
        for (const name of parsed.names) {
          for (const adversary of resolveOne(name)) {
            if (!uuids.includes(adversary.uuid)) uuids.push(adversary.uuid);
          }
        }
        if (!uuids.length) textOnlyGroups += 1;
        linkedUuids += uuids.length;
        groups[parsed.key] = { label: parsed.label, adversaries: uuids };
      }

      flags.mappingGaps = (flags.mappingGaps ?? []).filter(g => g !== "system.potentialAdversaries:uuid-resolution");
      flags.potentialAdversariesResolution = {
        sourceText,
        groups: Object.keys(groups).length,
        linkedUuids: Object.values(groups).reduce((n, g) => n + g.adversaries.length, 0),
      };
      await doc.update({ "system.potentialAdversaries": groups, [`flags.${FLAG_SCOPE}`]: flags });
      resolvedEnvironments += 1;
    }
  } finally { await environmentPack.configure({ locked: true }); }

  return { resolvedEnvironments, linkedUuids, textOnlyGroups };
}

export async function importFullMapped() {
  if (!game.user?.isGM) throw new Error("P2.3.3o-a Blood Hunter feature import is GM-only.");
  const payload = await loadPayload();
  const equipmentFeatureCatalog = await ensureSourceEquipmentFeatureCatalog(payload.entries);
  const grouped = new Map(Object.values(ROUTES).map(r => [r.packId, []]));
  const buildFailures = [];

  for (const entry of payload.entries) {
    const route = ROUTES[entry.kind];
    if (!route) {
      buildFailures.push({ sourceId: entry.data?.id ?? null, kind: entry.kind, message: "Aucune route de compendium" });
      continue;
    }
    try {
      grouped.get(route.packId).push(markManaged(await route.build(entry), entry.kind));
    } catch (error) {
      buildFailures.push({ sourceId: entry.data?.id ?? null, kind: entry.kind, message: error?.message ?? String(error) });
      console.error(`${MODULE_ID} | full mapping failed`, entry, error);
    }
  }

  const packs = {};
  for (const [kind, route] of Object.entries(ROUTES)) {
    const docs = grouped.get(route.packId);
    packs[kind] = await replaceManaged(route.packId, docs, route.documentClass);
  }

  const subclassLinks = await resolveSubclassClassLinks();
  const bloodHunterFeatures = await resolveBloodHunterFeatures(payload);
  const environmentPotentialAdversaries = await resolveEnvironmentPotentialAdversaries();

  const created = Object.values(packs).reduce((n, r) => n + r.created, 0);
  const failed = Object.values(packs).reduce((n, r) => n + r.failed, 0);
  const result = { sourceEntries: payload.entries.length, created, failed, buildFailures, subclassLinks, bloodHunterFeatures, environmentPotentialAdversaries, equipmentFeatureCatalog, packs };

  console.table(Object.fromEntries(Object.entries(packs).map(([kind, r]) => [kind, {
    attempted: r.attempted,
    created: r.created,
    failed: r.failed,
  }])));
  console.table({ sourceEntries: result.sourceEntries, created, importFailed: failed, buildFailed: buildFailures.length });

  if (failed || buildFailures.length || created !== payload.entries.length || bloodHunterFeatures.unresolved) {
    ui.notifications.warn("Campaign Toolkit : P2.3.3 import incomplet — voir console");
  } else {
    ui.notifications.info("Campaign Toolkit : P2.3.3 import GREEN");
  }
  return result;
}

export async function fullStatus() {
  const rows = [];
  for (const [kind, route] of Object.entries(ROUTES)) {
    const pack = game.packs.get(`${MODULE_ID}.${route.packId}`);
    if (!pack) {
      rows.push({ kind, pack: route.packId, count: null, status: "ABSENT" });
      continue;
    }
    const index = await pack.getIndex({ fields: [`flags.${FLAG_SCOPE}.managed`] });
    const count = index.filter(x => foundry.utils.getProperty(x, `flags.${FLAG_SCOPE}.managed`) === true).length;
    rows.push({ kind, pack: route.packId, count, status: "OK" });
  }
  console.table(rows);
  return { total: rows.reduce((n, r) => n + (r.count ?? 0), 0), rows };
}
