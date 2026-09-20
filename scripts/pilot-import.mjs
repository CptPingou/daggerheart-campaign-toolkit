import { localizeNativeEquipmentEmbedded } from "./equipment-native-fr.mjs";
import { applyContentLocale, getImportLocale } from "./content-locale.mjs";
const MODULE_ID = "daggerheart-campaign-toolkit";
const PILOT_URL = `modules/${MODULE_ID}/data/pilot.json`;
const CLASS_PRESENTATION_URL = `modules/${MODULE_ID}/data/class-presentation.json`;
const FLAG_SCOPE = MODULE_ID;
const PILOT_MAPPING_VERSION = "P2.3.4e-fix2c";
const FALLBACK_CLASS_IMAGE = "icons/svg/mystery-man.svg";

let classPresentationPromise = null;

async function classPresentation() {
  classPresentationPromise ??= fetch(CLASS_PRESENTATION_URL, { cache: "no-store" })
    .then(response => {
      if (!response.ok) throw new Error(`class-presentation.json introuvable (${response.status})`);
      return response.json();
    })
    .catch(error => {
      console.error(`${MODULE_ID} | unable to load owned class presentation`, error);
      return { entries: {} };
    });
  return classPresentationPromise;
}

async function ownedClassImage(raw) {
  const explicit = raw?.presentation?.img ?? raw?.img;
  if (typeof explicit === "string" && explicit.trim()) return explicit.trim();

  const sourceId = raw?.id;
  const catalog = await classPresentation();
  const mapped = sourceId ? catalog?.entries?.[sourceId]?.img : null;
  return typeof mapped === "string" && mapped.trim()
    ? mapped.trim()
    : FALLBACK_CLASS_IMAGE;
}

function textValue(v) {
  if (typeof v === "string") return v;
  if (v && typeof v === "object") {
    for (const key of ["rules_text", "description", "text", "summary", "notes"]) {
      if (typeof v[key] === "string") return v[key];
    }
  }
  return "";
}

function nameOf(raw, fallback) {
  return raw?.identity?.name ?? raw?.name ?? raw?.label ?? fallback;
}

function rules(raw) {
  return raw?.rules ?? raw?.mechanics ?? raw?.system ?? {};
}

function provenanceFlags(raw, sourcePath) {
  return {
    [FLAG_SCOPE]: {
      pilot: true,
      sourceId: raw?.id ?? null,
      sourcePath,
      source: raw?.source ?? null,
      mappingVersion: PILOT_MAPPING_VERSION,
    }
  };
}

function setMappingGaps(data, gaps = []) {
  data.flags ??= {};
  data.flags[FLAG_SCOPE] ??= {};
  data.flags[FLAG_SCOPE].mappingGaps = [...new Set(gaps.filter(Boolean))];
}

function clearItemLinks(value) {
  // ItemLinkFields serializes as an array in current Foundryborne.
  // Keep this helper defensive so sanitation survives minor schema changes.
  if (Array.isArray(value)) return [];
  if (value && typeof value === "object") return [];
  return [];
}

function sanitizeEmbeddedActorData(data) {
  // Native SRD Actor templates carry their own feature Items/effects. They are
  // never valid defaults for another imported Actor.
  data.items = [];
  // Remove cloned-document effects entirely. Foundry will restore only the
  // neutral schema default, never the source template semantics.
  data.effects = [];
}

function baseDescription(raw) {
  const content = raw?.content ?? {};
  const desc = textValue(content.rules_text) || textValue(content) || textValue(raw?.description);
  if (!desc) return "";
  // Canonical DH-DATA may deliberately carry sanitized rich text (notably
  // class/class-feature prose bootstrapped from the SRD Foundry source).
  // Preserve that markup; plain-text sources are escaped as before.
  if (/<\/?[a-z][\s\S]*>/i.test(desc)) return desc;
  return `<p>${foundry.utils.escapeHTML(desc)}</p>`;
}

function normalizedChoice(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : value;
}

const DOMAIN_ICON_BASE =
  "modules/daggerheart-campaign-toolkit/assets/icons/domains";

const DOMAIN_ICON_KEYS = new Set([
  "arcana",
  "blade",
  "bone",
  "codex",
  "dread",
  "grace",
  "midnight",
  "sage",
  "splendor",
  "valor",
]);

function domainIcon(domain) {
  const key = normalizedChoice(domain);
  if (!key || !DOMAIN_ICON_KEYS.has(key)) return null;
  return `${DOMAIN_ICON_BASE}/${key}.png`;
}

function normalizedToken(value) {
  return typeof value === "string"
    ? value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "")
    : "";
}


function mapTrait(value) {
  const token = normalizedToken(value);
  const aliases = {
    agility: "agility",
    strength: "strength",
    finesse: "finesse",
    instinct: "instinct",
    presence: "presence",
    knowledge: "knowledge",
  };
  return aliases[token] ?? null;
}

function mapRange(value) {
  const token = normalizedToken(value);
  const aliases = {
    melee: "melee",
    veryclose: "veryClose",
    close: "close",
    far: "far",
    veryfar: "veryFar",
  };
  return aliases[token] ?? null;
}

function mapDamageTypes(value) {
  const token = String(value ?? "").trim().toLowerCase();
  if (token === "phy") return ["physical"];
  if (token === "mag") return ["magical"];
  if (token === "phy/mag" || token === "mag/phy") return ["physical", "magical"];
  return [];
}

function parseWeaponDamage(value) {
  const text = String(value ?? "").replace(/\s+/g, "");
  const match = /^d(4|6|8|10|12|20)([+-]\d+)?$/i.exec(text);
  if (!match) return null;
  return { dice: `d${match[1]}`, bonus: Number(match[2] ?? 0) };
}

function appendFeatureDescription(existing, feature, label = "Feature") {
  if (!feature || typeof feature !== "object") return existing ?? "";
  const name = typeof feature.name === "string" ? feature.name.trim() : "";
  const text = typeof feature.text === "string" ? feature.text.trim() : "";
  if (!name && !text) return existing ?? "";
  const safeName = foundry.utils.escapeHTML(name || label);
  const safeText = foundry.utils.escapeHTML(text);
  return `${existing ?? ""}<p><strong>${safeName}.</strong>${safeText ? ` ${safeText}` : ""}</p>`;
}

const SOURCE_FEATURE_PREFIX = "dctSource";
const sourceEquipmentFeatureKeys = {
  weapon: new Map(),
  armor: new Map(),
};

const nativeEquipmentFeatureSpecimens = {
  weapon: new Map(),
  armor: new Map(),
};
let nativeEquipmentFeatureSpecimensReady = false;

function featureFieldName(kind) {
  return kind === "weapon" ? "weaponFeatures" : "armorFeatures";
}

function ownedEquipmentPackId(kind) {
  return kind === "weapon"
    ? `${MODULE_ID}.dh-weapons`
    : `${MODULE_ID}.dh-armor`;
}

async function ensureNativeEquipmentFeatureSpecimens() {
  if (nativeEquipmentFeatureSpecimensReady) return nativeEquipmentFeatureSpecimens;

  for (const kind of ["weapon", "armor"]) {
    const pack = game.packs.get(ownedEquipmentPackId(kind));
    if (!pack) {
      console.warn(`${MODULE_ID} | owned equipment pack absent`, ownedEquipmentPackId(kind));
      continue;
    }

    const fieldName = featureFieldName(kind);
    const index = await pack.getIndex();
    for (const row of index) {
      const doc = await pack.getDocument(row._id);
      if (!doc) continue;
      const raw = doc.toObject();
      const features = Array.isArray(raw?.system?.[fieldName]) ? raw.system[fieldName] : [];
      const effects = Array.isArray(raw?.effects) ? raw.effects : [];
      const actions = Array.isArray(raw?.system?.actions) ? raw.system.actions : [];

      for (const feature of features) {
        const key = feature?.value;
        if (!key || nativeEquipmentFeatureSpecimens[kind].has(key)) continue;
        const effectIds = Array.isArray(feature?.effectIds) ? feature.effectIds : [];
        const actionIds = Array.isArray(feature?.actionIds) ? feature.actionIds : [];
        const linkedEffects = effects.filter(effect => effectIds.includes(effect?._id));
        const linkedActions = actions.filter(action => actionIds.includes(action?._id));

        // A text-only native feature is not an automation specimen. Keep
        // looking for another SRD item carrying the same feature with actual
        // linked behavior.
        if (!linkedEffects.length && !linkedActions.length) continue;

        nativeEquipmentFeatureSpecimens[kind].set(key, {
          sourceUuid: doc.uuid,
          feature: foundry.utils.deepClone(feature),
          effects: foundry.utils.deepClone(linkedEffects),
          actions: foundry.utils.deepClone(linkedActions),
        });
      }
    }
  }

  nativeEquipmentFeatureSpecimensReady = true;
  console.info(`${MODULE_ID} | P2.7.5f owned equipment specimens`, {
    weapon: nativeEquipmentFeatureSpecimens.weapon.size,
    armor: nativeEquipmentFeatureSpecimens.armor.size,
  });
  return nativeEquipmentFeatureSpecimens;
}

function remapSpecimenIds(specimen, key) {
  const effectMap = new Map();
  const actionMap = new Map();

  const effects = (specimen?.effects ?? []).map(effect => {
    const clone = foundry.utils.deepClone(effect);
    const oldId = clone._id;
    clone._id = foundry.utils.randomID();
    if (oldId) effectMap.set(oldId, clone._id);
    // The source compendium UUID is provenance only. Embedded behavior must
    // belong to the imported Item.
    if (clone.origin) clone.origin = null;
    return clone;
  });

  const actions = (specimen?.actions ?? []).map(action => {
    const clone = foundry.utils.deepClone(action);
    const oldId = clone._id;
    clone._id = foundry.utils.randomID();
    if (oldId) actionMap.set(oldId, clone._id);
    return clone;
  });

  const mapped = {
    effects,
    actions,
    effectIds: (specimen?.feature?.effectIds ?? []).map(id => effectMap.get(id)).filter(Boolean),
    actionIds: (specimen?.feature?.actionIds ?? []).map(id => actionMap.get(id)).filter(Boolean),
    sourceUuid: specimen?.sourceUuid ?? null,
  };
  // P2.3.4e-fix2b: use the same normalized locale resolver as the document
  // overlay. This avoids a mismatch between the importer locale and a raw
  // world-setting lookup while cloning native Foundryborne specimens.
  return localizeNativeEquipmentEmbedded(mapped, key, getImportLocale());
}

async function applyNativeEquipmentFeature(data, kind, key) {
  await ensureNativeEquipmentFeatureSpecimens();
  const specimen = nativeEquipmentFeatureSpecimens[kind].get(key);
  if (!specimen) return null;

  const mapped = remapSpecimenIds(specimen, key);
  data.effects = [...(Array.isArray(data.effects) ? data.effects : []), ...mapped.effects];
  if (Array.isArray(data.system.actions)) data.system.actions.push(...mapped.actions);

  const fieldName = featureFieldName(kind);
  data.system[fieldName] = [{
    value: key,
    effectIds: mapped.effectIds,
    actionIds: mapped.actionIds,
  }];

  data.flags ??= {};
  data.flags[FLAG_SCOPE] ??= {};
  data.flags[FLAG_SCOPE].nativeEquipmentFeature = {
    key,
    specimen: mapped.sourceUuid,
    effects: mapped.effectIds.length,
    actions: mapped.actionIds.length,
  };
  return mapped;
}

function sourceFeatureHash(value) {
  let hash = 0x811c9dc5;
  for (const ch of String(value ?? "")) {
    hash ^= ch.charCodeAt(0);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(36).slice(0, 6);
}

function sourceFeatureKey(kind, name) {
  const token = normalizedToken(name) || "feature";
  return `${SOURCE_FEATURE_PREFIX}_${kind}_${token}_${sourceFeatureHash(`${kind}:${name}`)}`;
}

function configuredFeatureKey(kind, feature) {
  const name = typeof feature?.name === "string" ? feature.name.trim() : "";
  if (!name) return null;
  const wanted = normalizedToken(name);
  const all = kind === "weapon"
    ? CONFIG?.DH?.ITEM?.allWeaponFeatures?.()
    : CONFIG?.DH?.ITEM?.allArmorFeatures?.();
  if (all && typeof all === "object") {
    for (const [key, data] of Object.entries(all)) {
      const candidates = [key, data?.name, data?.label]
        .filter(v => typeof v === "string")
        .flatMap(v => [v, game.i18n?.localize?.(v)]);
      if (candidates.some(v => normalizedToken(v) === wanted)) return key;
    }
  }
  return sourceEquipmentFeatureKeys[kind]?.get(wanted) ?? null;
}

function collectSourceFeatureDefinitions(entries, kind) {
  const out = new Map();
  for (const entry of entries ?? []) {
    if (entry?.kind !== kind) continue;
    const feature = entry?.data?.feature ?? entry?.data?.rules?.feature;
    const name = typeof feature?.name === "string" ? feature.name.trim() : "";
    if (!name) continue;
    const token = normalizedToken(name);
    if (!token || out.has(token)) continue;
    out.set(token, {
      name,
      description: typeof feature?.text === "string" ? feature.text.trim() : "",
      actions: [],
      effects: [],
    });
  }
  return out;
}

export async function ensureSourceEquipmentFeatureCatalog(entries) {
  if (!game.user?.isGM) throw new Error("Source equipment feature catalog registration is GM-only.");
  const settingKey = CONFIG?.DH?.SETTINGS?.gameSettings?.Homebrew;
  if (!settingKey) throw new Error("Foundryborne Homebrew setting key introuvable.");

  const current = foundry.utils.deepClone(game.settings.get(CONFIG.DH.id, settingKey) ?? {});
  current.itemFeatures ??= {};
  current.itemFeatures.weaponFeatures ??= {};
  current.itemFeatures.armorFeatures ??= {};

  const report = { weapon: { existing: 0, registered: 0 }, armor: { existing: 0, registered: 0 }, changed: false };

  for (const kind of ["weapon", "armor"]) {
    sourceEquipmentFeatureKeys[kind].clear();
    const definitions = collectSourceFeatureDefinitions(entries, kind);
    const targetKey = kind === "weapon" ? "weaponFeatures" : "armorFeatures";
    const target = current.itemFeatures[targetKey];

    for (const [token, feature] of definitions) {
      const nativeKey = configuredFeatureKey(kind, feature);
      if (nativeKey) {
        sourceEquipmentFeatureKeys[kind].set(token, nativeKey);
        report[kind].existing += 1;
        continue;
      }

      const key = sourceFeatureKey(kind, feature.name);
      // Toolkit-owned source catalog entries are identity/description only.
      // Never overwrite an existing user/native entry and never invent actions/effects.
      if (!target[key]) {
        target[key] = feature;
        report[kind].registered += 1;
        report.changed = true;
      }
      sourceEquipmentFeatureKeys[kind].set(token, key);
    }
  }

  if (report.changed) await game.settings.set(CONFIG.DH.id, settingKey, current);
  return report;
}



function mapFeatureForm(value) {
  const token = normalizedToken(value);
  if (["passive", "action", "reaction"].includes(token)) return token;
  return "passive";
}

async function buildEmbeddedSourceFeature(feature, parentRaw, sourcePath, index) {
  const data = await nativeTemplate("Item", "feature");
  data._id = foundry.utils.randomID();
  data.name = typeof feature?.name === "string" && feature.name.trim()
    ? feature.name.trim()
    : `Feature ${index + 1}`;
  data.flags = foundry.utils.mergeObject(
    data.flags ?? {},
    {
      [FLAG_SCOPE]: {
        embeddedSourceFeature: true,
        parentSourceId: parentRaw?.id ?? null,
        parentSourcePath: sourcePath,
        sourceFeatureIndex: index,
        sourceFeatureType: feature?.type ?? null,
        mappingVersion: PILOT_MAPPING_VERSION,
      }
    },
    { inplace: false }
  );

  // Native feature template provides only schema shape. Strip every source
  // semantic that could leak from that template; P2.3.3k imports source text
  // and presentation form only. Actions/effects/resources remain manual.
  // Remove cloned-document effects entirely. Foundry will restore only the
  // neutral schema default, never the source template semantics.
  data.effects = [];
  if (data.system) {
    data.system.description = typeof feature?.text === "string" && feature.text.trim()
      ? `<p>${foundry.utils.escapeHTML(feature.text.trim())}</p>`
      : "";
    if ("gmNotes" in data.system) data.system.gmNotes = "";
    // Delete template-owned automation/resource payloads rather than forcing
    // a guessed container shape. Foundryborne may normalize these fields into
    // DataModels/TypedObjects on creation; the semantic audit compares them to
    // a fresh blank feature baseline.
    if ("actions" in data.system) delete data.system.actions;
    if ("resource" in data.system) delete data.system.resource;
    if ("granter" in data.system) data.system.granter = null;
    if ("actorResources" in data.system) data.system.actorResources = [];
    if ("featureForm" in data.system) data.system.featureForm = mapFeatureForm(feature?.type);
  }
  return data;
}

export async function buildLinkedSourceFeature(feature, parentRaw, sourcePath, index, linkType) {
  const data = await nativeTemplate("Item", "feature");
  const featureSlug = String(feature?.name ?? `feature-${index + 1}`)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const sourceFeatureId = parentRaw?.id
    ? `${parentRaw.id}.feature.${featureSlug}`
    : null;
  data._id = foundry.utils.randomID();
  data.name = typeof feature?.name === "string" && feature.name.trim()
    ? feature.name.trim()
    : `Feature ${index + 1}`;
  data.flags = foundry.utils.mergeObject(data.flags ?? {}, {
      [FLAG_SCOPE]: {
        supportManaged: true,
        sourceFeature: true,
        sourceId: sourceFeatureId,
      parentSourceId: parentRaw?.id ?? null,
      parentSourcePath: sourcePath,
      sourceFeatureIndex: index,
      sourceFeatureType: linkType ?? null,
      source: parentRaw?.source ?? null,
      mappingVersion: PILOT_MAPPING_VERSION,
    }
  }, { inplace: false });
  data.effects = [];
  if (data.system) {
    data.system.description = typeof feature?.text === "string" && feature.text.trim()
      ? `<p>${foundry.utils.escapeHTML(feature.text.trim())}</p>`
      : "";
    if ("gmNotes" in data.system) data.system.gmNotes = "";
    if ("actions" in data.system) delete data.system.actions;
    if ("resource" in data.system) delete data.system.resource;
    if ("granter" in data.system) data.system.granter = null;
    if ("actorResources" in data.system) data.system.actorResources = [];
    if ("featureForm" in data.system) data.system.featureForm = "passive";
  }
  await applyContentLocale(data, sourceFeatureId, getImportLocale());
  return data;
}

async function mapEmbeddedSourceFeatures(raw, sourcePath, gaps) {
  const features = Array.isArray(raw?.features) ? raw.features : [];
  if (!features.length) {
    if (raw?.features_text) gaps.push("embeddedItems:features");
    return [];
  }
  const out = [];
  for (let index = 0; index < features.length; index += 1) {
    const feature = features[index];
    if (!feature || typeof feature !== "object") {
      gaps.push("embeddedItems:features:invalid-source-record");
      continue;
    }
    out.push(await buildEmbeddedSourceFeature(feature, raw, sourcePath, index));
  }
  return out;
}

function parseAdversaryExperiences(value) {
  // A handful of SRD rows still carry extraction control tokens such as
  // "+/two.tnum" and "/comma.tab". They are deterministic OCR artifacts,
  // not rules text, so normalize only this closed vocabulary before parsing.
  const text = String(value ?? "")
    .replace(/\/comma\.tab/gi, ", ")
    .replace(/\+\/one\.tnum/gi, "+1")
    .replace(/\+\/two\.tnum/gi, "+2")
    .replace(/\+\/three\.tnum/gi, "+3")
    .replace(/\+\/four\.tnum/gi, "+4")
    .replace(/\+\/five\.tnum/gi, "+5")
    .trim();
  if (!text) return {};
  const out = {};
  for (const part of text.split(/\s*,\s*/)) {
    const match = /^(.*?)(?:\s*([+-]\d+))$/.exec(part.trim());
    if (!match) continue;
    const name = match[1].trim();
    const score = Number(match[2]);
    if (!name || !Number.isFinite(score)) continue;
    out[foundry.utils.randomID()] = { name, value: score, description: "" };
  }
  return out;
}

function mapAdversaryAttack(templateAttack, attack, gaps) {
  if (!attack || typeof attack !== "object") return null;
  const data = foundry.utils.deepClone(templateAttack);
  if (!data || typeof data !== "object") return null;

  data._id = foundry.utils.randomID();
  data.name = typeof attack.name === "string" && attack.name.trim() ? attack.name.trim() : "Attack";
  data.systemPath = "attack";
  data.chatDisplay = false;
  data.type = "attack";
  data.baseAction = true;

  const range = mapRange(attack.range);
  if (range) data.range = range;
  else gaps.push("system.attack.range");

  if (data.roll && typeof data.roll === "object") {
    data.roll.type = "attack";
    const modifier = Number(attack.modifier);
    if (Number.isFinite(modifier)) data.roll.bonus = modifier;
    else gaps.push("system.attack.roll.bonus");
  }

  const damageTypes = mapDamageTypes(attack.damage_type);
  const sourceDamage = String(attack.damage ?? "").trim();
  const compactDamage = sourceDamage.replace(/\s+/g, "");
  // Canonical SRD attack damage is normally a dice/flat Roll formula. One known
  // SRD row uses the rules phrase "40 direct". Feeding that literal phrase to
  // Foundry's Roll parser makes it interpret the word as DiceTerm syntax
  // (denomination "i"), so normalize only the numeric part and retain an
  // explicit semantic gap for the unsupported "direct" rider.
  const directMatch = /^(\d+)\s+direct$/i.exec(sourceDamage);
  const formula = directMatch ? directMatch[1] : compactDamage;
  const validFormula = /^(?:\d+|\d*d\d+(?:[+-]\d+)?)$/i.test(formula);

  if (data.damage?.main) {
    if (damageTypes.length) data.damage.main.type = damageTypes;
    else gaps.push("system.attack.damage.type");
    if (data.damage.main.value && formula && validFormula) {
      data.damage.main.value.multiplier = "flat";
      if (data.damage.main.value.custom) {
        data.damage.main.value.custom.enabled = true;
        data.damage.main.value.custom.formula = formula;
        if (directMatch) gaps.push("system.attack.damage:direct-semantics");
      } else {
        gaps.push("system.attack.damage.value.custom");
      }
    } else {
      // Never serialize arbitrary extracted text as a Foundry Roll formula.
      // Keep the template's ActionField structurally valid and surface the
      // source value as a mapping gap instead of crashing document creation.
      if (data.damage.main.value?.custom) {
        data.damage.main.value.custom.enabled = false;
        data.damage.main.value.custom.formula = "";
      }
      gaps.push("system.attack.damage.value");
    }
  }
  return data;
}

function mapWeaponBurden(value) {
  const token = normalizedToken(value);
  const burden = CONFIG?.DH?.GENERAL?.burden;

  // Foundryborne exposes the canonical enum values through CONFIG.
  // Map neutral/source labels to those values instead of writing display labels
  // such as "One-Handed" directly into a ChoiceField.
  if (token === "onehanded") return burden?.oneHanded?.value ?? null;
  if (token === "twohanded") return burden?.twoHanded?.value ?? null;

  // If DH-DATA already contains a canonical Foundryborne enum value, preserve it.
  for (const option of Object.values(burden ?? {})) {
    if (option?.value === value) return value;
  }

  return null;
}

/*
 * P2.7.5f doctrine:
 * Owned Item imports must never bootstrap their schema from a native SRD
 * compendium. Foundryborne's configured Item document class is the schema
 * authority; constructing an in-memory Item applies the current defaults
 * without reading any daggerheart.* content pack.
 *
 * Actor imports remain on the legacy specimen path for now because adversary /
 * environment autonomy is outside the seven owned content families cut over in
 * P2.7.5.
 */
async function nativeTemplate(documentName, type) {
  if (documentName === "Item") {
    const DocumentClass = CONFIG?.Item?.documentClass;
    if (!DocumentClass) {
      throw new Error(`CONFIG.Item.documentClass indisponible pour Item:${type}`);
    }

    // Daggerheart 2.9.4 runs legacy migration as soon as a DHItem is
    // constructed. Armor migration expects the legacy system.armor container
    // even for this neutral schema specimen.
    const seed = {
      name: `Toolkit schema ${type}`,
      type,
    };
    if (type === "armor") {
      seed.system = { armor: {} };
    }

    const doc = new DocumentClass(seed);
    const source = doc.toObject();

    delete source._id;
    delete source.folder;
    delete source.sort;
    delete source.ownership;
    delete source._stats;

    return source;
  }

  // Legacy Actor-only fallback. It is intentionally isolated from owned Item
  // families and will be removed when adversaries/environments get their own
  // autonomous source cutover.
  for (const pack of game.packs) {
    if (pack.metadata?.packageName !== "daggerheart") continue;
    if (pack.documentName !== documentName) continue;

    const index = await pack.getIndex({ fields: ["type"] });
    const hit = index.find((e) => e.type === type);
    if (!hit) continue;

    const doc = await pack.getDocument(hit._id);
    if (!doc) continue;

    const source = doc.toObject();
    delete source._id;
    delete source.folder;
    delete source.sort;
    delete source.ownership;
    delete source._stats;
    return source;
  }

  throw new Error(`Aucun template Foundryborne trouvé pour ${documentName}:${type}`);
}


function parseVersatileProfile(feature) {
  if (String(feature?.name ?? "").trim().toLowerCase() !== "versatile") return null;
  const text = String(feature?.text ?? "");
  const match = text.match(/statistics[—-]\s*([^,]+),\s*([^,]+),\s*(d\d+(?:[+-]\d+)?)(?:\s+(phy|mag))?/i);
  if (!match) return { raw: text, parseStatus: "text-preserved" };
  return {
    trait: match[1].trim().toLowerCase(),
    range: match[2].trim().toLowerCase(),
    damage: match[3].trim(),
    damageType: match[4]?.toLowerCase() ?? null,
    parseStatus: "structured",
  };
}

function recordEquipmentFeatureDisposition(data, kind, feature, key, status, extra = {}) {
  data.flags ??= {};
  data.flags[FLAG_SCOPE] ??= {};
  const list = data.flags[FLAG_SCOPE].equipmentFeatureDispositions ??= [];
  const behavior = String(feature?.name ?? key ?? "feature").trim();
  list.push({
    kind,
    key: key ?? null,
    behavior,
    status,
    sourceText: String(feature?.text ?? ""),
    ...extra,
  });
}

export async function buildItem(entry) {
  const raw = entry.data;
  const r = rules(raw);

  const typeByKind = {
    class: "class",
    subclass: "subclass",
    domain_card: "domainCard",
    weapon: "weapon",
    armor: "armor",
    class_feature: "feature",
  };
  const type = typeByKind[entry.kind];
  if (!type) throw new Error(`Unsupported pilot Item kind: ${entry.kind}`);

  const data = await nativeTemplate("Item", type);
  data.name = nameOf(raw, entry.key);
  data.flags = foundry.utils.mergeObject(
    data.flags ?? {},
    provenanceFlags(raw, entry.source_path),
    { inplace: false }
  );

  // P2.3.4e-fix3: nativeTemplate() is a schema/default specimen, never a semantic
  // source. Always discard its prose before applying canonical DH-DATA.
  // This prevents the first native Item of a type (for example Assassin)
  // from leaking its description into every imported document of that type.
  if (data.system && "description" in data.system) data.system.description = "";
  const description = baseDescription(raw);
  if (description) data.system.description = description;

  const gaps = [];

  if (entry.kind === "class") {
    // The schema Item is a structure/default specimen only. Class artwork belongs to our
    // presentation source and must never leak from the first native specimen
    // (currently Assassin).
    data.img = await ownedClassImage(raw);

    // Sanitize every source-specific relation carried by the SRD template.
    // The in-memory document is used only to obtain a valid Foundryborne schema.
    // No specimen-specific prose, effects, links or recommendations may leak.
    data.effects = [];
    data.system.domains = [];
    data.system.classItems = [];
    data.system.features = clearItemLinks(data.system.features);
    if (data.system.inventory && typeof data.system.inventory === "object") {
      data.system.inventory.take = [];
      data.system.inventory.choiceA = [];
      data.system.inventory.choiceB = [];
    }
    if (data.system.characterGuide && typeof data.system.characterGuide === "object") {
      // Preserve the native schema shape but neutralize every recommendation
      // inherited from the specimen.
      if (data.system.characterGuide.suggestedTraits) {
        for (const key of Object.keys(data.system.characterGuide.suggestedTraits)) {
          data.system.characterGuide.suggestedTraits[key] = 0;
        }
      }
      data.system.characterGuide.suggestedPrimaryWeapon = null;
      data.system.characterGuide.suggestedSecondaryWeapon = null;
      data.system.characterGuide.suggestedArmor = null;
    }
    data.system.backgroundQuestions = ["", "", ""];
    data.system.connections = ["", "", ""];
    data.system.isMulticlass = false;
    if ("levelupOptionTiers" in data.system) data.system.levelupOptionTiers = { 2: {}, 3: {}, 4: {} };

    // Neutral schema defaults: do not inherit another class's HP/evasion.
    if ("hitPoints" in data.system) data.system.hitPoints = 5;
    if ("evasion" in data.system) data.system.evasion = 0;

    if (Array.isArray(r.domains ?? raw?.domains)) data.system.domains = r.domains ?? raw.domains;
    else gaps.push("system.domains");

    const evasion = Number(r.starting_evasion ?? r.evasion ?? raw?.starting_evasion ?? raw?.evasion);
    if (Number.isFinite(evasion)) data.system.evasion = evasion;
    else gaps.push("system.evasion");

    const hitPoints = Number(r.starting_hit_points ?? r.hitPoints ?? raw?.starting_hit_points ?? raw?.hitPoints);
    if (Number.isFinite(hitPoints)) data.system.hitPoints = hitPoints;

    const content = raw?.content ?? {};
    if (Array.isArray(content.background_questions)) data.system.backgroundQuestions = [...content.background_questions];
    if (Array.isArray(content.connections)) data.system.connections = [...content.connections];

    const guide = raw?.character_guide ?? {};
    if (data.system.characterGuide && guide.suggested_traits && typeof guide.suggested_traits === "object") {
      for (const [trait, value] of Object.entries(guide.suggested_traits)) {
        if (trait in data.system.characterGuide.suggestedTraits && Number.isFinite(Number(value))) {
          data.system.characterGuide.suggestedTraits[trait] = Number(value);
        }
      }
    }
    // Equipment recommendations are stable semantic slugs in DH-DATA. Their
    // Foundry ItemLink payloads are resolved in a later pass; never borrow the
    // specimen's recommendations.
    if (guide.suggested_primary_weapon) gaps.push("system.characterGuide.suggestedPrimaryWeapon");
    if (guide.suggested_secondary_weapon) gaps.push("system.characterGuide.suggestedSecondaryWeapon");
    if (guide.suggested_armor) gaps.push("system.characterGuide.suggestedArmor");

    // Canonical SRD class features are separate class_feature entities. The
    // parent links are resolved after all family packs have been imported.
    if (Array.isArray(raw?.feature_refs) && raw.feature_refs.length) gaps.push("system.features");
    // Blood Hunter still carries embedded feature definitions and uses its
    // dedicated resolver below.
    if (Array.isArray(r.features) && r.features.length) gaps.push("system.features");
  }

  if (entry.kind === "class_feature") {
    // Feature specimens may contain executable automation/effects belonging to
    // an unrelated native feature. Keep only schema + canonical prose.
    data.effects = [];
    if (data.system) {
      if ("actions" in data.system) delete data.system.actions;
      if ("resource" in data.system) delete data.system.resource;
      if ("gmNotes" in data.system) data.system.gmNotes = "";
      if ("granter" in data.system) data.system.granter = null;
      if ("actorResources" in data.system) data.system.actorResources = [];
      if ("featureForm" in data.system) data.system.featureForm = "passive";
    }
    data.flags[FLAG_SCOPE].parentSourceId = raw?.class_id ?? null;
    data.flags[FLAG_SCOPE].sourceFeatureType = raw?.feature_type ?? null;
  }

  if (entry.kind === "subclass") {
    // As with classes, the schema subclass is a structure/default specimen only.
    data.effects = [];
    data.system.features = clearItemLinks(data.system.features);
    data.system.featureState = 1; // native schema default, not template semantics
    data.system.linkedClass = null;
    data.system.spellcastingTrait = null;
    if ("isMulticlass" in data.system) data.system.isMulticlass = false;

    const hasExplicitSpellcast = Object.prototype.hasOwnProperty.call(r, "spellcast_trait")
      || Object.prototype.hasOwnProperty.call(r, "spellcastingTrait")
      || Object.prototype.hasOwnProperty.call(raw ?? {}, "spellcast_trait");
    const sourceTrait = r.spellcast_trait ?? r.spellcastingTrait ?? raw?.spellcast_trait ?? null;
    const trait = normalizedChoice(sourceTrait);
    if (trait) data.system.spellcastingTrait = trait;
    else if (!hasExplicitSpellcast) gaps.push("system.spellcastingTrait");

    // Preserve the neutral parent identity for a later UUID-resolution pass.
    const linkedClassSourceId = raw?.class_id ?? raw?.classId ?? raw?.class ?? null;
    data.flags[FLAG_SCOPE].linkedClassSourceId = linkedClassSourceId;
    if (linkedClassSourceId) gaps.push("system.linkedClass");
    if (Array.isArray(r.features) && r.features.length) gaps.push("system.features");
  }

  if (entry.kind === "domain_card") {
    // Domain-card specimens can carry executable Actions and Active Effects.
    // Never inherit them: only explicitly mapped canonical mechanics belong
    // on the imported card.
    data.effects = [];
    if ("actions" in data.system) data.system.actions = [];
    if ("resource" in data.system) data.system.resource = null;

    const domain = r.domain ?? raw?.domain;
    if (domain) {
      data.system.domain = normalizedChoice(domain);

      const icon = domainIcon(domain);
      if (icon) data.img = icon;
      else gaps.push("img.domain");
    }

    const level = Number(r.level ?? raw?.level);
    if (Number.isFinite(level)) data.system.level = level;

    const recall = Number(r.recall_cost ?? r.recallCost ?? raw?.recall_cost);
    if (Number.isFinite(recall)) data.system.recallCost = recall;

    // Domain-card type is canonical DH-DATA semantics, not a template default.
    // Explicitly map it so a spell/grimoire never inherits the specimen's
    // neutral "ability" value. Unknown future values remain visible as gaps.
    const cardType = normalizedChoice(r.card_type ?? r.cardType ?? raw?.card_type);
    if (["ability", "spell", "grimoire"].includes(cardType)) data.system.type = cardType;
    else if (cardType) gaps.push("system.type");
  }

  if (entry.kind === "weapon" || entry.kind === "armor") {
    const tier = Number(r.tier ?? raw?.tier);
    if (Number.isFinite(tier)) data.system.tier = tier;
  }

  if (entry.kind === "weapon") {
    if ("equipped" in data.system) data.system.equipped = false;
    if ("secondary" in data.system) data.system.secondary = raw?.slot === "secondary";
    if (typeof raw?.burden === "string" && "burden" in data.system) {
      const burden = mapWeaponBurden(raw.burden);
      if (burden) data.system.burden = burden;
      else console.warn(`${MODULE_ID} | unmapped weapon burden`, raw.burden, raw?.id ?? data.name);
    }
    data.system.weaponFeatures = [];
    if (Array.isArray(data.system.actions)) data.system.actions = [];
    if ("resource" in data.system) data.system.resource = null;

    // P2.3.3e: map the complete neutral weapon stat line into Foundryborne's
    // native attack ActionField while preserving the template's required shape.
    if (data.system.attack && typeof data.system.attack === "object") {
      data.system.attack.name = "Attack";
      data.system.attack.img = "icons/svg/sword.svg";
      data.system.attack._id = foundry.utils.randomID();
      data.system.attack.baseAction = true;
      data.system.attack.chatDisplay = false;
      data.system.attack.systemPath = "attack";
      data.system.attack.type = "attack";

      const mappedRange = mapRange(raw?.range ?? r?.range);
      if (mappedRange) data.system.attack.range = mappedRange;
      else gaps.push("system.attack.range");

      const sourceTrait = raw?.trait ?? r?.trait;
      const mappedTrait = mapTrait(sourceTrait);
      const spellcastTrait = normalizedToken(sourceTrait) === "spellcast";
      if (data.system.attack.roll) {
        data.system.attack.roll.type = "attack";
        if (mappedTrait) {
          data.system.attack.roll.trait = mappedTrait;
        } else if (spellcastTrait) {
          // "Spellcast" is a DH rules-level pseudo-trait: the actual trait is
          // supplied by the character's subclass. Foundryborne's Action roll
          // ChoiceField only accepts the six concrete actor abilities, so never
          // serialize the literal string "spellcast" here. Keep the action
          // nullable/default-driven and retain an explicit mapping gap until we
          // wire the equipped weapon to character.spellcastModifierTrait.
          data.system.attack.roll.trait = null;
          if ("useDefault" in data.system.attack.roll) data.system.attack.roll.useDefault = true;
          data.flags[FLAG_SCOPE].sourceAttackTrait = "spellcast";
          data.flags[FLAG_SCOPE].spellcastTraitResolution = "actor-default";
        } else {
          gaps.push("system.attack.roll.trait");
        }
      }

      const parsedDamage = parseWeaponDamage(raw?.damage ?? r?.damage);
      const damageTypes = mapDamageTypes(raw?.damage_type ?? r?.damage_type);
      if (data.system.attack.damage?.main) {
        if (damageTypes.length) data.system.attack.damage.main.type = damageTypes;
        else gaps.push("system.attack.damage.type");
        if (parsedDamage && data.system.attack.damage.main.value) {
          const value = data.system.attack.damage.main.value;
          value.multiplier = "prof";
          value.dice = parsedDamage.dice;
          if (value.custom) {
            value.custom.enabled = parsedDamage.bonus !== 0;
            value.custom.formula = parsedDamage.bonus !== 0
              ? `@prof${parsedDamage.dice}${parsedDamage.bonus > 0 ? "+" : ""}${parsedDamage.bonus}`
              : "";
          }
        } else gaps.push("system.attack.damage.value");
      }
    } else gaps.push("system.attack");

    const feature = raw?.feature ?? r?.feature;
    if (feature && (feature.name || feature.text)) {
      const key = configuredFeatureKey("weapon", feature);
      if (key) {
        const nativeMapping = await applyNativeEquipmentFeature(data, "weapon", key);
        if (nativeMapping) {
          recordEquipmentFeatureDisposition(data, "weapon", feature, key, "nativeMapped", {
            nativeSourceUuid: nativeMapping.sourceUuid ?? null,
          });
        } else {
          data.system.weaponFeatures = [{ value: key, effectIds: [], actionIds: [] }];
          const versatile = parseVersatileProfile(feature);
          if (versatile) {
            recordEquipmentFeatureDisposition(data, "weapon", feature, key, "mappedStructured", {
              family: "versatile",
              alternateProfile: versatile,
            });
          } else {
            recordEquipmentFeatureDisposition(data, "weapon", feature, key, "deferredAutomation");
          }
        }
        // Configured feature rendering owns the visible rule text. Keep source
        // provenance without duplicating the rule in description.
      } else {
        data.system.description = appendFeatureDescription(data.system.description, feature, "Weapon Feature");
        gaps.push("system.weaponFeatures:catalog");
      }
    }
  }

  if (entry.kind === "armor") {
    if ("equipped" in data.system) data.system.equipped = false;
    const score = Number(raw?.base_score ?? r.base_score);
    if (Number.isFinite(score) && data.system.armor && typeof data.system.armor === "object") {
      if ("max" in data.system.armor) data.system.armor.max = score;
      if ("current" in data.system.armor) data.system.armor.current = score;
    }
    const thresholds = raw?.base_thresholds ?? r.base_thresholds;
    if (thresholds && data.system.baseThresholds && typeof data.system.baseThresholds === "object") {
      const major = Number(thresholds.major);
      const severe = Number(thresholds.severe);
      if (Number.isFinite(major) && "major" in data.system.baseThresholds) data.system.baseThresholds.major = major;
      if (Number.isFinite(severe) && "severe" in data.system.baseThresholds) data.system.baseThresholds.severe = severe;
    }
    data.system.armorFeatures = [];
    if (Array.isArray(data.system.actions)) data.system.actions = [];
    if ("resource" in data.system) data.system.resource = null;

    const feature = raw?.feature ?? r?.feature;
    if (feature && (feature.name || feature.text)) {
      const key = configuredFeatureKey("armor", feature);
      if (key) {
        const nativeMapping = await applyNativeEquipmentFeature(data, "armor", key);
        if (nativeMapping) {
          recordEquipmentFeatureDisposition(data, "armor", feature, key, "nativeMapped", {
            nativeSourceUuid: nativeMapping.sourceUuid ?? null,
          });
        } else {
          data.system.armorFeatures = [{ value: key, effectIds: [], actionIds: [] }];
          recordEquipmentFeatureDisposition(data, "armor", feature, key, "deferredAutomation");
        }
        // Native catalog rendering owns the visible rule text; avoid duplicating
        // the same source feature in the generic description.
      } else {
        data.system.description = appendFeatureDescription(data.system.description, feature, "Armor Feature");
        gaps.push("system.armorFeatures:catalog");
      }
    }
  }

  setMappingGaps(data, gaps);
  await applyContentLocale(data, entry.id ?? entry.sourceId ?? data.flags?.["daggerheart-campaign-toolkit"]?.sourceId, getImportLocale());
  return data;
}


function huntingNotesHtml(raw) {
  const hunting = raw?.hunting;
  if (!hunting || typeof hunting !== "object" || Array.isArray(hunting)) return "";

  const esc = (value) => foundry.utils.escapeHTML(String(value ?? ""));
  const labelTag = (tag) => {
    const labels = {
      herbivore: "Herbivore",
      burrower: "Fouisseur",
      flying: "Volant",
      carnivore: "Carnivore",
    };
    return labels[tag] ?? String(tag);
  };

  const lines = [];
  lines.push("<h3>Hunting</h3>");

  if (Array.isArray(hunting.tags) && hunting.tags.length) {
    lines.push(`<p><strong>Tags :</strong> ${hunting.tags.map(labelTag).map(esc).join(", ")}</p>`);
  }

  if (hunting.footprint?.width && hunting.footprint?.height) {
    lines.push(
      `<p><strong>Empreinte :</strong> ${esc(hunting.footprint.width)}×${esc(hunting.footprint.height)}</p>`
    );
  }

  if (hunting.mobility?.mode) {
    const mobility = hunting.mobility.state
      ? `${hunting.mobility.mode} (${hunting.mobility.state})`
      : hunting.mobility.mode;
    lines.push(`<p><strong>Mobilité :</strong> ${esc(mobility)}</p>`);
  }

  const normal = hunting.reactions?.normal;
  const fear = hunting.reactions?.fear;
  const normalName = normal?.name ?? "Réaction normale";
  const fearName = fear?.name ?? "Réaction renforcée";

  lines.push("<h4>Matrice d'Engagement</h4>");
  lines.push("<ul>");
  lines.push("<li><strong>Succès + Hope :</strong> 2 OP — aucune réaction hostile — Spotlight → Finisher.</li>");
  lines.push(`<li><strong>Succès + Fear :</strong> 2 OP — ${esc(normalName)}.</li>`);
  lines.push(`<li><strong>Échec + Hope :</strong> 1 OP — ${esc(normalName)}.</li>`);
  lines.push(`<li><strong>Échec + Fear :</strong> 1 OP — ${esc(fearName)}.</li>`);
  lines.push("</ul>");

  const reactionDetails = (reaction, key) => {
    if (!reaction || typeof reaction !== "object") return;

    lines.push(`<h4>${esc(reaction.name ?? key)}</h4>`);

    if (reaction.baseReaction === "normal" && normal?.name) {
      lines.push(`<p>Résoudre d'abord <strong>${esc(normal.name)}</strong>, puis appliquer la conséquence ci-dessous.</p>`);
    }

    const resolution = reaction.resolution;
    if (!resolution || typeof resolution !== "object") return;

    if (resolution.kind === "attack") {
      const attack = resolution.attack ?? {};
      const mod = Number(attack.modifier);
      const modText = Number.isFinite(mod) ? (mod >= 0 ? `+${mod}` : `${mod}`) : "?";
      lines.push(
        `<p><strong>Attaque contre l'Opener :</strong> ${esc(modText)} | ` +
        `${esc(attack.range ?? "?")} | ${esc(attack.damage ?? "?")} ${esc(attack.damage_type ?? "")}</p>`
      );
      if (reaction.supportWindow) {
        lines.push("<p><strong>Support :</strong> 1 Hope → −1d4 au jet d'attaque du monstre.</p>");
      }
      if (resolution.onHit?.markStress) {
        lines.push(`<p><strong>Sur une touche :</strong> la cible marque ${esc(resolution.onHit.markStress)} Stress.</p>`);
      }
    } else if (resolution.kind === "forcedMovement") {
      lines.push(
        `<p>Projeter l'Opener de <strong>${esc(resolution.steps ?? "?")} bandes de portée</strong>.`
      );
      if (resolution.collision?.damagePerUnspentStep) {
        lines.push(
          ` Chaque bande non parcourue à cause d'un obstacle solide inflige ` +
          `<strong>${esc(resolution.collision.damagePerUnspentStep)} ${esc(resolution.collision.damage_type ?? "")}</strong> de collision.</p>`
        );
      } else {
        lines.push("</p>");
      }
    } else if (resolution.kind === "consequence" && resolution.text) {
      lines.push(`<p>${esc(resolution.text)}</p>`);
    }
  };

  reactionDetails(normal, "Réaction normale");
  reactionDetails(fear, "Réaction renforcée");

  return lines.join("");
}

export async function buildActor(entry) {
  const raw = entry.data;
  const r = rules(raw);
  const type = entry.kind === "adversary"
    ? "adversary"
    : entry.kind === "environment"
      ? "environment"
      : null;

  if (!type) throw new Error(`Unsupported pilot Actor kind: ${entry.kind}`);

  const data = await nativeTemplate("Actor", type);
  data.name = nameOf(raw, entry.key);

  // P2.6.4a1: Actor templates are cloned from a native Foundryborne specimen.
  // Never keep the specimen's prototype-token identity (e.g. "Cult Adept").
  if (data.prototypeToken && typeof data.prototypeToken === "object") {
    data.prototypeToken.name = data.name;
  }

  data.flags = foundry.utils.mergeObject(
    data.flags ?? {},
    provenanceFlags(raw, entry.source_path),
    { inplace: false }
  );
  sanitizeEmbeddedActorData(data);

  // P2.3.3p / P2.3.4e-fix2c: Actor templates may carry specimen-specific
  // descriptive prose. Never inherit that prose implicitly. Preserve only
  // an explicit description supplied by canonical DH-DATA.
  data.system.description = "";
  const sourceDescription = baseDescription(raw);
  if (sourceDescription) data.system.description = sourceDescription;

  const gaps = [];
  const tier = Number(r.tier ?? raw?.tier);
  if (Number.isFinite(tier)) data.system.tier = tier;

  const difficulty = Number(r.difficulty ?? raw?.difficulty);
  if (Number.isFinite(difficulty)) data.system.difficulty = difficulty;

  if (entry.kind === "adversary") {
    const role = normalizedChoice(r.role ?? raw?.role);
    if (role) data.system.type = role;

    const motives = raw?.motives_tactics ?? raw?.motives_and_tactics ?? raw?.motivesAndTactics;
    data.system.motivesAndTactics = typeof motives === "string" ? motives : "";

    // Preserve the valid ActionField shape from the native template, but replace
    // every semantic attack value with DH-DATA. Never keep the template attack.
    const attackTemplate = foundry.utils.deepClone(data.system.attack);
    data.system.attack = null;
    data.system.experiences = {};
    data.system.hordeHp = 1;
    data.system.criticalThreshold = 20;

    const thresholds = raw?.thresholds ?? r?.thresholds ?? raw?.damageThresholds;
    if (data.system.damageThresholds && typeof data.system.damageThresholds === "object") {
      data.system.damageThresholds.major = 0;
      data.system.damageThresholds.severe = 0;
      const major = Number(thresholds?.major);
      const severe = Number(thresholds?.severe);
      if (Number.isFinite(major)) data.system.damageThresholds.major = major;
      if (Number.isFinite(severe)) data.system.damageThresholds.severe = severe;
      // Minions canonically have no damage thresholds; absence is semantic, not
      // a mapping failure. Other partial/missing threshold rows remain explicit.
      const isMinion = normalizedToken(r.role ?? raw?.role) === "minion";
      if (!isMinion && (!Number.isFinite(major) || !Number.isFinite(severe))) gaps.push("system.damageThresholds");
    }

    // Creature resources are simple neutral fields and are safe to map now.
    const hp = Number(raw?.hp ?? r?.hp);
    const stress = Number(raw?.stress ?? r?.stress);
    if (data.system.resources?.hitPoints) {
      if (Number.isFinite(hp)) {
        data.system.resources.hitPoints.max = hp;
        data.system.resources.hitPoints.value = 0;
      } else gaps.push("system.resources.hitPoints");
    }
    if (data.system.resources?.stress) {
      if (Number.isFinite(stress)) {
        data.system.resources.stress.max = stress;
        data.system.resources.stress.value = 0;
      } else if (raw?.stress_none === true) {
        // Explicit source semantics: this adversary cannot mark Stress.
        data.system.resources.stress.max = 0;
        data.system.resources.stress.value = 0;
        data.flags[FLAG_SCOPE].stressNone = true;
      } else gaps.push("system.resources.stress");
    }

    // P2.3.3f: standard adversary attack and Experiences are sufficiently
    // structured in DH-DATA to map natively. Complex FEATURES remain source text
    // until the extraction is normalized into discrete feature records.
    if (raw?.attack) {
      data.system.attack = mapAdversaryAttack(attackTemplate, raw.attack, gaps);
      if (!data.system.attack) gaps.push("system.attack");

      // P2.3.3m: "direct" is a damage semantic, not part of the Roll formula.
      // Foundryborne has no dedicated direct-damage field on this ActionField,
      // so retain the exact semantic as provenance instead of treating it as
      // missing data. The numeric formula remains natively rollable.
      const sourceDamage = String(raw.attack.damage ?? "").trim();
      const directMatch = /^(\d+)\s+direct$/i.exec(sourceDamage);
      if (directMatch) {
        data.flags[FLAG_SCOPE].sourceAttackDamage = {
          raw: sourceDamage,
          formula: directMatch[1],
          direct: true,
          meaning: "cannot-be-reduced-by-armor-slots",
        };
        for (let i = gaps.length - 1; i >= 0; i--) {
          if (gaps[i] === "system.attack.damage:direct-semantics") gaps.splice(i, 1);
        }
      }
    }

    if (raw?.experience_text) {
      const experiences = parseAdversaryExperiences(raw.experience_text);
      data.system.experiences = experiences;
      if (!Object.keys(experiences).length) gaps.push("system.experiences:parse");
    }

    const huntingNote = huntingNotesHtml(raw);
    data.system.notes = huntingNote || "";
    data.items = await mapEmbeddedSourceFeatures(raw, entry.source_path, gaps);
    data.flags[FLAG_SCOPE].sourceFeatureCount = Array.isArray(raw?.features) ? raw.features.length : 0;

    // P2.6.3e / P2.6.4a: preserve the complete canonical Hunting extension
    // losslessly in Toolkit flags. The note above is presentation only.
    if (raw?.hunting && typeof raw.hunting === "object" && !Array.isArray(raw.hunting)) {
      data.flags[FLAG_SCOPE].hunting = foundry.utils.deepClone(raw.hunting);
    }
  }

  if (entry.kind === "environment") {
    const envType = normalizedChoice(r.type ?? raw?.type);
    if (envType) data.system.type = envType;

    const impulses = raw?.impulses ?? r.impulses;
    data.system.impulses = typeof impulses === "string" ? impulses : Array.isArray(impulses) ? impulses.join(", ") : "";
    data.system.potentialAdversaries = {};
    if (typeof raw?.potential_adversaries_text === "string" && raw.potential_adversaries_text.trim()) {
      data.flags[FLAG_SCOPE].potentialAdversariesSourceText = raw.potential_adversaries_text.trim();
    }

    const noteParts = [raw?.description, raw?.potential_adversaries_text].filter(v => typeof v === "string" && v.trim());
    data.system.notes = noteParts.length
      ? `<p>${foundry.utils.escapeHTML(noteParts.join("\n\n"))}</p>`
      : "";
    if (raw?.potential_adversaries_text) gaps.push("system.potentialAdversaries:uuid-resolution");
    data.items = await mapEmbeddedSourceFeatures(raw, entry.source_path, gaps);
    data.flags[FLAG_SCOPE].sourceFeatureCount = Array.isArray(raw?.features) ? raw.features.length : 0;
  }

  setMappingGaps(data, gaps);
  await applyContentLocale(data, raw?.id ?? entry.id ?? entry.sourceId ?? data.flags?.[FLAG_SCOPE]?.sourceId, getImportLocale());
  return data;
}

async function loadPilot() {
  const response = await fetch(PILOT_URL, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`pilot.json introuvable (${response.status}). Lance d'abord export_foundry_pilot.py.`);
  }
  const payload = await response.json();
  if (payload?.phase !== "P2.3.1") throw new Error("pilot.json n'est pas un payload P2.3.1");
  return payload;
}

export async function seedPack(packId, docs, documentClass) {
  const pack = game.packs.get(`${MODULE_ID}.${packId}`);
  if (!pack) throw new Error(`Compendium absent: ${packId}`);

  await pack.configure({ locked: false });
  try {
    const index = await pack.getIndex({ fields: [`flags.${FLAG_SCOPE}.pilot`] });
    const pilotIds = index
      .filter((e) => foundry.utils.getProperty(e, `flags.${FLAG_SCOPE}.pilot`) === true)
      .map((e) => e._id);

    for (const id of pilotIds) {
      const doc = await pack.getDocument(id);
      if (doc) await doc.delete();
    }

    for (const data of docs) {
      await documentClass.create(data, { pack: pack.collection });
    }
  } finally {
    await pack.configure({ locked: true });
  }
}

export async function importPilot() {
  if (!game.user?.isGM) throw new Error("P2.3.1 pilot import is GM-only.");

  const payload = await loadPilot();
  const itemEntries = payload.entries.filter((e) =>
    ["class", "subclass", "domain_card", "weapon", "armor"].includes(e.kind)
  );
  const actorEntries = payload.entries.filter((e) =>
    ["adversary", "environment"].includes(e.kind)
  );

  const itemDocs = [];
  for (const entry of itemEntries) itemDocs.push(await buildItem(entry));

  const actorDocs = [];
  for (const entry of actorEntries) actorDocs.push(await buildActor(entry));

  await seedPack("pilot-items", itemDocs, Item);
  await seedPack("pilot-actors", actorDocs, Actor);

  const result = await pilotStatus();
  console.log(`${MODULE_ID} | P2.3.2 mapped pilot imported`, result);
  ui.notifications.info("Campaign Toolkit : P2.3.2 mapping importé");
  return result;
}

export async function clearPilot() {
  if (!game.user?.isGM) throw new Error("P2.3.1 pilot clear is GM-only.");
  await seedPack("pilot-items", [], Item);
  await seedPack("pilot-actors", [], Actor);
  return pilotStatus();
}

export async function pilotStatus() {
  const result = {};
  for (const [key, packId] of [["items", "pilot-items"], ["actors", "pilot-actors"]]) {
    const pack = game.packs.get(`${MODULE_ID}.${packId}`);
    if (!pack) {
      result[key] = { available: false, count: 0 };
      continue;
    }
    const index = await pack.getIndex({
      fields: [`flags.${FLAG_SCOPE}.pilot`, "type", "name"]
    });
    const pilot = index.filter((e) =>
      foundry.utils.getProperty(e, `flags.${FLAG_SCOPE}.pilot`) === true
    );
    result[key] = {
      available: true,
      count: pilot.length,
      documents: pilot.map((e) => ({ name: e.name, type: e.type })),
    };
  }

  console.table({
    pilotItems: result.items.count,
    pilotActors: result.actors.count,
  });
  return result;
}


export async function mappingAudit() {
  const rows = [];
  for (const packId of ["pilot-items", "pilot-actors"]) {
    const pack = game.packs.get(`${MODULE_ID}.${packId}`);
    if (!pack) continue;
    const index = await pack.getIndex({ fields: [`flags.${FLAG_SCOPE}.pilot`] });
    for (const entry of index.filter((e) => foundry.utils.getProperty(e, `flags.${FLAG_SCOPE}.pilot`) === true)) {
      const doc = await pack.getDocument(entry._id);
      const source = doc?.toObject();
      if (!source) continue;
      rows.push({
        pack: packId,
        name: source.name,
        type: source.type,
        sourceId: foundry.utils.getProperty(source, `flags.${FLAG_SCOPE}.sourceId`) ?? null,
        mappingVersion: foundry.utils.getProperty(source, `flags.${FLAG_SCOPE}.mappingVersion`) ?? null,
        tier: source.system?.tier ?? null,
        domain: source.system?.domain ?? null,
        level: source.system?.level ?? null,
        evasion: source.system?.evasion ?? null,
        difficulty: source.system?.difficulty ?? null,
      });
    }
  }
  console.table(rows);
  return rows;
}
