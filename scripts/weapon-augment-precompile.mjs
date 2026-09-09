const SUPPORTED_LEAF_PRIMITIVES = new Set([
  "tier",
  "evasion",
  "trait",
  "domain",
  "class",
]);

function normalizeString(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function normalizeNumber(value) {
  if (Number.isFinite(value)) return Number(value);
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function firstNumber(values) {
  for (const value of values) {
    const normalized = normalizeNumber(value);
    if (normalized !== null) return normalized;
  }
  return null;
}

function normalizeTier(value) {
  const direct = normalizeNumber(value);
  if (Number.isInteger(direct) && direct >= 1 && direct <= 4) return direct;

  if (typeof value === "string") {
    const match = value.match(/[1-4]/);
    if (match) return Number(match[0]);
  }

  return null;
}

function itemIdentity(item) {
  return [
    item?.id,
    item?._id,
    item?.name,
    item?.system?.name,
    item?.system?.identifier,
    item?.system?.slug,
  ]
    .map(normalizeString)
    .filter(Boolean);
}

function actorItems(actor) {
  if (!actor?.items) return [];
  if (Array.isArray(actor.items)) return actor.items;
  if (Array.isArray(actor.items.contents)) return actor.items.contents;
  try {
    return [...actor.items];
  } catch {
    return [];
  }
}

function matchesIdentity(item, expected) {
  const needle = normalizeString(expected);
  if (!needle) return false;
  return itemIdentity(item).includes(needle);
}

function resolveTier(actor) {
  const candidates = [
    actor?.system?.tier,
    actor?.system?.level?.tier,
    actor?.system?.levelData?.tier,
    actor?.system?.advancement?.tier,
  ];

  for (const candidate of candidates) {
    const tier = normalizeTier(candidate);
    if (tier !== null) return tier;
  }

  return null;
}

function resolveEvasion(actor) {
  return firstNumber([
    actor?.system?.evasion,
    actor?.system?.evasion?.value,
    actor?.system?.defenses?.evasion,
    actor?.system?.defenses?.evasion?.value,
  ]);
}

function resolveTrait(actor, trait) {
  const key = normalizeString(trait);
  if (!key) return null;

  const aliases = new Set([
    key,
    key.replace(/\s+/g, ""),
    key.replace(/[-_ ]+/g, ""),
  ]);

  const containers = [
    actor?.system?.traits,
    actor?.system?.characteristics,
    actor?.system?.abilities,
  ];

  for (const container of containers) {
    if (!container || typeof container !== "object") continue;

    for (const [candidateKey, raw] of Object.entries(container)) {
      const normalizedKey = normalizeString(candidateKey).replace(/[-_ ]+/g, "");
      if (![...aliases].some(alias => alias.replace(/[-_ ]+/g, "") === normalizedKey)) {
        continue;
      }

      const value = firstNumber([
        raw,
        raw?.value,
        raw?.score,
        raw?.modifier,
        raw?.mod,
      ]);
      if (value !== null) return value;
    }
  }

  return null;
}

function resolveOwnedIdentity(actor, primitive, expected) {
  const wantedType = primitive === "class" ? "class" : "domain";
  const expectedNormalized = normalizeString(expected);
  if (!expectedNormalized) return null;

  // Prefer embedded documents because they are the stable Foundry boundary.
  for (const item of actorItems(actor)) {
    const type = normalizeString(item?.type);
    const typeLooksRight =
      type === wantedType
      || (wantedType === "domain" && type.includes("domain"))
      || (wantedType === "class" && type.includes("class"));

    if (typeLooksRight && matchesIdentity(item, expectedNormalized)) {
      return true;
    }
  }

  // Fallbacks for systems that mirror identity on actor.system.
  const candidates = wantedType === "class"
    ? [
        actor?.system?.class,
        actor?.system?.class?.name,
        actor?.system?.class?.id,
        actor?.system?.class?.slug,
        actor?.system?.classes,
      ]
    : [
        actor?.system?.domains,
        actor?.system?.domain,
      ];

  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      if (candidate.some(value => {
        if (typeof value === "string") return normalizeString(value) === expectedNormalized;
        return [
          value?.id,
          value?.name,
          value?.slug,
          value?.identifier,
        ].some(entry => normalizeString(entry) === expectedNormalized);
      })) return true;
      continue;
    }

    if (typeof candidate === "string" && normalizeString(candidate) === expectedNormalized) {
      return true;
    }

    if (candidate && typeof candidate === "object") {
      const directValues = [
        candidate.id,
        candidate.name,
        candidate.slug,
        candidate.identifier,
      ];
      if (directValues.some(value => normalizeString(value) === expectedNormalized)) {
        return true;
      }

      if (Object.keys(candidate).some(key => normalizeString(key) === expectedNormalized)) {
        return true;
      }
    }
  }

  return false;
}

function result({
  eligible,
  primitive,
  reason = null,
  expected = null,
  actual = null,
  children = null,
}) {
  return {
    green: true,
    eligible: Boolean(eligible),
    primitive,
    reason,
    expected,
    actual,
    ...(children ? { children } : {}),
  };
}

function evaluateLeaf(actor, condition) {
  const primitive = condition?.primitive;

  if (!SUPPORTED_LEAF_PRIMITIVES.has(primitive)) {
    return result({
      eligible: false,
      primitive: primitive ?? "unknown",
      reason: `Unsupported precompile primitive: ${primitive ?? "missing"}.`,
    });
  }

  if (primitive === "tier") {
    const minimum = normalizeNumber(condition.minimum);
    if (!Number.isInteger(minimum) || minimum < 1 || minimum > 4) {
      return result({
        eligible: false,
        primitive,
        reason: "Tier precompile requires integer minimum between 1 and 4.",
      });
    }

    const actual = resolveTier(actor);
    return result({
      eligible: actual !== null && actual >= minimum,
      primitive,
      expected: { minimum },
      actual,
      reason: actual === null
        ? "Unable to resolve the parent PC tier."
        : actual >= minimum
          ? null
          : `Requires Tier ${minimum}; parent PC is Tier ${actual}.`,
    });
  }

  if (primitive === "evasion") {
    const minimum = normalizeNumber(condition.minimum);
    if (minimum === null) {
      return result({
        eligible: false,
        primitive,
        reason: "Evasion precompile requires numeric minimum.",
      });
    }

    const actual = resolveEvasion(actor);
    return result({
      eligible: actual !== null && actual >= minimum,
      primitive,
      expected: { minimum },
      actual,
      reason: actual === null
        ? "Unable to resolve parent PC Evasion."
        : actual >= minimum
          ? null
          : `Requires Evasion ${minimum}; parent PC has ${actual}.`,
    });
  }

  if (primitive === "trait") {
    const trait = condition.trait ?? condition.id ?? condition.name;
    const minimum = normalizeNumber(condition.minimum ?? condition.value);
    if (!normalizeString(trait) || minimum === null) {
      return result({
        eligible: false,
        primitive,
        reason: "Trait precompile requires trait and numeric minimum.",
      });
    }

    const actual = resolveTrait(actor, trait);
    return result({
      eligible: actual !== null && actual >= minimum,
      primitive,
      expected: { trait, minimum },
      actual,
      reason: actual === null
        ? `Unable to resolve parent PC trait: ${trait}.`
        : actual >= minimum
          ? null
          : `Requires ${trait} ${minimum}; parent PC has ${actual}.`,
    });
  }

  const expected = condition.id ?? condition.name ?? condition.value;
  if (!normalizeString(expected)) {
    return result({
      eligible: false,
      primitive,
      reason: `${primitive} precompile requires id, name, or value.`,
    });
  }

  const actual = resolveOwnedIdentity(actor, primitive, expected);
  return result({
    eligible: actual === true,
    primitive,
    expected,
    actual,
    reason: actual
      ? null
      : `Requires ${primitive}: ${expected}.`,
  });
}

function evaluateNode(actor, condition) {
  if (!condition) {
    return result({
      eligible: true,
      primitive: null,
    });
  }

  if (Array.isArray(condition.all)) {
    const children = condition.all.map(child => evaluateNode(actor, child));
    const eligible = children.every(child => child.eligible);
    return result({
      eligible,
      primitive: "all",
      children,
      reason: eligible
        ? null
        : children.find(child => !child.eligible)?.reason ?? "All precompile conditions are required.",
    });
  }

  if (Array.isArray(condition.any)) {
    const children = condition.any.map(child => evaluateNode(actor, child));
    const eligible = children.some(child => child.eligible);
    return result({
      eligible,
      primitive: "any",
      children,
      reason: eligible
        ? null
        : "At least one precompile condition is required.",
    });
  }

  if (condition.not) {
    const child = evaluateNode(actor, condition.not);
    return result({
      eligible: !child.eligible,
      primitive: "not",
      children: [child],
      reason: !child.eligible ? null : "Negated precompile condition is met.",
    });
  }

  return evaluateLeaf(actor, condition);
}

function describeLeaf(condition, evaluation) {
  const primitive = condition?.primitive;

  if (primitive === "tier") {
    const required = condition.minimum;
    const actual = evaluation?.actual;
    return actual === null || actual === undefined
      ? `Tier ${required} · PC tier unresolved`
      : `Tier ${required} · PC Tier ${actual}`;
  }

  if (primitive === "evasion") {
    const actual = evaluation?.actual;
    return actual === null || actual === undefined
      ? `Evasion ${condition.minimum} · unresolved`
      : `Evasion ${condition.minimum} · PC ${actual}`;
  }

  if (primitive === "trait") {
    const trait = condition.trait ?? condition.id ?? condition.name ?? "trait";
    const required = condition.minimum ?? condition.value;
    const actual = evaluation?.actual;
    return actual === null || actual === undefined
      ? `${trait} ${required} · unresolved`
      : `${trait} ${required} · PC ${actual}`;
  }

  if (primitive === "domain" || primitive === "class") {
    return `${primitive}: ${condition.id ?? condition.name ?? condition.value ?? "?"}`;
  }

  return primitive ?? "unknown";
}

function describeNode(condition, evaluation) {
  if (!condition) return "none";

  if (Array.isArray(condition.all)) {
    return `all(${condition.all.map((child, index) =>
      describeNode(child, evaluation?.children?.[index])
    ).join("; ")})`;
  }

  if (Array.isArray(condition.any)) {
    return `any(${condition.any.map((child, index) =>
      describeNode(child, evaluation?.children?.[index])
    ).join("; ")})`;
  }

  if (condition.not) {
    return `not(${describeNode(condition.not, evaluation?.children?.[0])})`;
  }

  return describeLeaf(condition, evaluation);
}

export function evaluateWeaponAugmentPrecompile(weapon, condition) {
  const actor = weapon?.parent;
  if (!actor || actor.documentName !== "Actor") {
    throw new Error("Weapon Augment precompile requires an actor-embedded weapon.");
  }

  return evaluateNode(actor, condition);
}

export function describeWeaponAugmentPrecompile(condition, evaluation) {
  return `Precompile: ${describeNode(condition, evaluation)}`;
}

export const WEAPON_AUGMENT_PRECOMPILE_PRIMITIVES = Object.freeze([
  "tier",
  "evasion",
  "trait",
  "domain",
  "class",
  "all",
  "any",
  "not",
]);
