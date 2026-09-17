const MODULE_ID = "daggerheart-campaign-toolkit";
const INDEX_URL = `modules/${MODULE_ID}/data/source-index.json`;

function urlFor(path) {
  return `modules/${MODULE_ID}/${path}`;
}

async function fetchJson(path) {
  const response = await fetch(urlFor(path), { cache: "no-store" });
  if (!response.ok) throw new Error(`Unable to load ${path}: HTTP ${response.status}`);
  return response.json();
}

async function sourceIndex() {
  const response = await fetch(INDEX_URL, { cache: "no-store" });
  if (!response.ok) throw new Error(`Unable to load source index: HTTP ${response.status}`);
  return response.json();
}

function packSources(index) {
  const result = new Map();

  function register(origin, namespace, packName, spec) {
    const rows = result.get(packName) ?? [];
    rows.push({ origin, namespace, ...spec });
    result.set(packName, rows);
  }

  for (const [origin, originData] of Object.entries(index.origins ?? {})) {
    for (const [packName, spec] of Object.entries(originData.packs ?? {})) {
      register(origin, null, packName, spec);
    }

    // Homebrew is namespaced so independent corpora (Monster Hunter,
    // Eberron, etc.) can target the same runtime compendiums without being
    // merged together in the source tree.
    for (const [namespace, namespaceData] of Object.entries(originData.namespaces ?? {})) {
      for (const [packName, spec] of Object.entries(namespaceData.packs ?? {})) {
        register(origin, namespace, packName, spec);
      }
    }
  }

  return result;
}

async function loadPackSources(index, packName) {
  const specs = packSources(index).get(packName) ?? [];
  const rows = [];
  for (const spec of specs) {
    const payload = await fetchJson(spec.file);
    if (!Array.isArray(payload)) throw new Error(`${spec.file} must contain a JSON array`);
    rows.push(...payload);
  }
  rows.sort((a, b) => String(a._id).localeCompare(String(b._id)));
  return rows;
}

function stripRuntimeMetadata(value, { root = false } = {}) {
  if (Array.isArray(value)) {
    for (const entry of value) stripRuntimeMetadata(entry);
    return value;
  }

  if (!value || typeof value !== "object") return value;

  // Foundry injects _stats not only on the Item but also on embedded
  // ActiveEffects. These values are runtime persistence metadata and are
  // deliberately absent/null in the autonomous source tree.
  delete value._stats;

  if (root) {
    delete value.folder;
    delete value.sort;
    delete value.ownership;
  }

  for (const child of Object.values(value)) {
    stripRuntimeMetadata(child);
  }
  return value;
}

function comparable(source) {
  const copy = stripRuntimeMetadata(foundry.utils.deepClone(source), { root: true });

  // sourceNamespace is provenance carried by the autonomous source tree.
  // Existing compendium documents created before the cutover do not
  // necessarily carry it, so it must not count as a content divergence.
  const toolkitFlags = copy.flags?.[MODULE_ID];
  if (toolkitFlags) {
    delete toolkitFlags.sourceNamespace;
  }

  return copy;
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (!value || typeof value !== "object") return JSON.stringify(value);
  return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${stableJson(value[k])}`).join(",")}}`;
}

function normalizeSourceThroughFoundry(source, pack) {
  // Construct an in-memory Item with the same document class/schema used by
  // Foundryborne. This applies schema defaults and type normalization without
  // writing anything to the compendium.
  const DocumentClass = CONFIG.Item.documentClass;
  const normalized = new DocumentClass(foundry.utils.deepClone(source), {
    pack: pack?.collection,
  });
  const result = normalized.toObject();

  // Daggerheart's domainCard ActionField does not hydrate actions during bare
  // document construction/createDocuments, while the same field accepts them
  // through Document#update. Preserve the authoritative source actions in the
  // comparable representation so verification checks the materialized field
  // instead of normalizing it away.
  const sourceActions = source?.type === "domainCard"
    ? source?.system?.actions
    : null;
  if (
    sourceActions &&
    typeof sourceActions === "object" &&
    Object.keys(sourceActions).length > 0
  ) {
    result.system ??= {};
    result.system.actions = foundry.utils.deepClone(sourceActions);
  }

  return result;
}

function sourceValueIsPreserved(runtime, source) {
  if (Array.isArray(source)) {
    if (!Array.isArray(runtime) || runtime.length !== source.length) return false;
    return source.every((value, index) => sourceValueIsPreserved(runtime[index], value));
  }

  if (source !== null && typeof source === "object") {
    if (runtime === null || typeof runtime !== "object" || Array.isArray(runtime)) return false;
    return Object.entries(source).every(
      ([key, value]) => Object.prototype.hasOwnProperty.call(runtime, key)
        && sourceValueIsPreserved(runtime[key], value),
    );
  }

  return Object.is(runtime, source);
}

function comparisonPair(doc, source, pack) {
  const runtime = comparable(doc.toObject());
  const normalizedSource = comparable(normalizeSourceThroughFoundry(source, pack));

  if (source?.type !== "domainCard") {
    return { runtime, normalizedSource, actionsGreen: true };
  }

  const sourceActions = source?.system?.actions;
  if (
    !sourceActions ||
    typeof sourceActions !== "object" ||
    Object.keys(sourceActions).length === 0
  ) {
    return { runtime, normalizedSource, actionsGreen: true };
  }

  const runtimeActions = runtime?.system?.actions;
  const actionsGreen = sourceValueIsPreserved(runtimeActions, sourceActions);

  // Document#update hydrates Daggerheart ActionField defaults into the runtime
  // representation. Compare every authoritative source field recursively, but
  // ignore additional schema-generated action fields in the ordinary whole-item
  // equality check.
  if (runtime.system) delete runtime.system.actions;
  if (normalizedSource.system) delete normalizedSource.system.actions;

  return { runtime, normalizedSource, actionsGreen };
}

function sourceMatches(doc, source, pack) {
  const { runtime, normalizedSource, actionsGreen } = comparisonPair(doc, source, pack);
  return actionsGreen
    && stableJson(runtime) === stableJson(normalizedSource);
}


function diffPaths(left, right, path = "", out = [], limit = 100) {
  if (out.length >= limit) return out;

  const leftArray = Array.isArray(left);
  const rightArray = Array.isArray(right);
  if (leftArray || rightArray) {
    if (!(leftArray && rightArray)) {
      out.push({ path: path || "<root>", source: left, runtime: right });
      return out;
    }
    if (left.length !== right.length) {
      out.push({
        path: `${path || "<root>"}.length`,
        source: left.length,
        runtime: right.length,
      });
    }
    const length = Math.max(left.length, right.length);
    for (let i = 0; i < length && out.length < limit; i++) {
      diffPaths(left[i], right[i], `${path}[${i}]`, out, limit);
    }
    return out;
  }

  const leftObject = left !== null && typeof left === "object";
  const rightObject = right !== null && typeof right === "object";
  if (leftObject || rightObject) {
    if (!(leftObject && rightObject)) {
      out.push({ path: path || "<root>", source: left, runtime: right });
      return out;
    }
    const keys = [...new Set([...Object.keys(left), ...Object.keys(right)])].sort();
    for (const key of keys) {
      if (out.length >= limit) break;
      const child = path ? `${path}.${key}` : key;
      if (!(key in left)) {
        out.push({ path: child, source: "<missing>", runtime: right[key] });
      } else if (!(key in right)) {
        out.push({ path: child, source: left[key], runtime: "<missing>" });
      } else {
        diffPaths(left[key], right[key], child, out, limit);
      }
    }
    return out;
  }

  if (!Object.is(left, right)) {
    out.push({ path: path || "<root>", source: left, runtime: right });
  }
  return out;
}

export async function autonomousSourceDiff(packName, { id = null, name = null, limit = 100 } = {}) {
  const index = await sourceIndex();
  const pack = game.packs.get(`${MODULE_ID}.${packName}`);
  if (!pack) throw new Error(`Owned pack unavailable: ${MODULE_ID}.${packName}`);

  const sources = await loadPackSources(index, packName);
  const docs = await pack.getDocuments();

  let source = null;
  if (id) source = sources.find(row => row._id === id);
  if (!source && name) source = sources.find(row => row.name === name);
  if (!source) {
    source = sources.find(row => {
      const doc = docs.find(d => d.id === row._id);
      return doc && !sourceMatches(doc, row, pack);
    });
  }
  if (!source) return { pack: packName, green: true, differences: [] };

  const doc = docs.find(d => d.id === source._id);
  if (!doc) {
    return { pack: packName, id: source._id, name: source.name, missingRuntimeDocument: true };
  }

  const { normalizedSource, runtime, actionsGreen } = comparisonPair(doc, source, pack);
  const differences = diffPaths(normalizedSource, runtime, "", [], limit);
  if (!actionsGreen) {
    differences.unshift({
      path: "system.actions",
      source: "authoritative source fields",
      runtime: "missing or changed after ActionField hydration",
    });
  }

  return {
    pack: packName,
    id: source._id,
    name: source.name,
    differenceCountShown: differences.length,
    limit,
    differences,
  };
}

export async function autonomousSourceDiffSummary({ perPack = 1, limitPerDocument = 100 } = {}) {
  const index = await sourceIndex();
  const result = {};

  for (const packName of packSources(index).keys()) {
    const pack = game.packs.get(`${MODULE_ID}.${packName}`);
    if (!pack) {
      result[packName] = [{ error: "pack unavailable" }];
      continue;
    }

    const sources = await loadPackSources(index, packName);
    const docs = await pack.getDocuments();
    const byId = new Map(docs.map(doc => [doc.id, doc]));
    const divergent = sources.filter(row => {
      const doc = byId.get(row._id);
      return doc && !sourceMatches(doc, row, pack);
    }).slice(0, perPack);

    result[packName] = divergent.map(source => {
      const doc = byId.get(source._id);
      const { normalizedSource, runtime, actionsGreen } = comparisonPair(doc, source, pack);
      const differences = diffPaths(normalizedSource, runtime, "", [], limitPerDocument);
      if (!actionsGreen) {
        differences.unshift({
          path: "system.actions",
          source: "authoritative source fields",
          runtime: "missing or changed after ActionField hydration",
        });
      }
      return {
        id: source._id,
        name: source.name,
        differences,
      };
    });
  }

  return result;
}

async function inspectPack(index, packName) {
  const pack = game.packs.get(`${MODULE_ID}.${packName}`);
  if (!pack) return { present: false, expected: 0, actual: 0, missing: [], extra: [], changed: [] };

  const sources = await loadPackSources(index, packName);
  const docs = await pack.getDocuments();
  const byId = new Map(docs.map(doc => [doc.id, doc]));
  const sourceIds = new Set(sources.map(row => row._id));
  const missing = sources.filter(row => !byId.has(row._id)).map(row => row._id);
  const extra = docs.filter(doc => !sourceIds.has(doc.id)).map(doc => doc.id);
  const changed = sources
    .filter(row => byId.has(row._id) && !sourceMatches(byId.get(row._id), row, pack))
    .map(row => row._id);

  return {
    present: true,
    expected: sources.length,
    actual: docs.length,
    missing,
    extra,
    changed,
    green: missing.length === 0 && extra.length === 0 && changed.length === 0,
  };
}

export async function autonomousSourceStatus() {
  const index = await sourceIndex();
  const packs = {};
  let actual = 0;
  let green = true;

  for (const packName of packSources(index).keys()) {
    const status = await inspectPack(index, packName);
    packs[packName] = status;
    actual += status.actual ?? 0;
    green &&= status.green === true;
  }

  return {
    schema: index.schema,
    sourceNamespace: index.sourceNamespace,
    expected: index.total,
    actual,
    packs,
    green,
  };
}

async function replacePack(packName, sources) {
  const pack = game.packs.get(`${MODULE_ID}.${packName}`);
  if (!pack) throw new Error(`Owned pack unavailable: ${MODULE_ID}.${packName}`);

  await pack.configure({ locked: false });
  try {
    const current = await pack.getDocuments();
    if (current.length) {
      await Item.deleteDocuments(current.map(doc => doc.id), { pack: pack.collection });
    }
    if (sources.length) {
      // Domain-card actions must be materialized after Item creation.
      // Foundryborne accepts the ActionField through Document#update (the same
      // path used by our native Hunting action adapter), but drops it when the
      // field is supplied to Item.createDocuments().
      const createSources = sources.map(source => {
        const copy = foundry.utils.deepClone(source);
        if (
          copy?.type === "domainCard" &&
          copy?.system?.actions &&
          typeof copy.system.actions === "object" &&
          Object.keys(copy.system.actions).length > 0
        ) {
          copy.system.actions = {};
        }
        return copy;
      });

      const created = await Item.createDocuments(createSources, {
        pack: pack.collection,
        keepId: true,
      });

      const sourceById = new Map(sources.map(source => [source._id, source]));
      for (const doc of created) {
        const actions = sourceById.get(doc.id)?.system?.actions;
        if (
          doc.type === "domainCard" &&
          actions &&
          typeof actions === "object" &&
          Object.keys(actions).length > 0
        ) {
          await doc.update({
            "system.actions": foundry.utils.deepClone(actions),
          });
        }
      }
    }
  } finally {
    await pack.configure({ locked: true });
  }
  return sources.length;
}

export async function syncAutonomousSources({ force = false } = {}) {
  if (!game.user?.isGM) return { changed: false, skipped: "GM-only" };

  const index = await sourceIndex();
  const result = { changed: false, total: 0, packs: {} };

  for (const packName of packSources(index).keys()) {
    const before = await inspectPack(index, packName);
    if (before.green && !force) {
      result.packs[packName] = { changed: false, total: before.actual };
      result.total += before.actual;
      continue;
    }

    const sources = await loadPackSources(index, packName);
    const total = await replacePack(packName, sources);
    result.packs[packName] = {
      changed: true,
      total,
      before: {
        actual: before.actual,
        missing: before.missing.length,
        extra: before.extra.length,
        changed: before.changed.length,
      },
    };
    result.total += total;
    result.changed = true;
  }

  result.status = await autonomousSourceStatus();
  if (!result.status.green) {
    throw new Error("Autonomous source sync completed but verification is not GREEN");
  }
  return result;
}

export async function rebuildAutonomousSources() {
  return syncAutonomousSources({ force: true });
}
