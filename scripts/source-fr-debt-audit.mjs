const MODULE_ID = "daggerheart-campaign-toolkit";

const ENGLISH_WORDS = new Set(`
the and you your yours when while until if then this that these those with without within into from
for of to a an or as at by on in is are be can may must spend gain take make deal roll add use using
each any all another target targets attack attacks damage hope fear stress armor evasion proficiency
trait class feature domain card weapon enemy creature ally allies action reaction once per rest long
short choose chosen equal additional before after success failure successful failed mark become
becomes have has do does their they them it its value result range melee close far very
`.trim().split(/\s+/));

const FRENCH_WORDS = new Set(`
le la les un une des du de et ou vous votre vos quand lorsque si alors ce cette ces avec sans dans
depuis pour par sur est sont être peut devez dépenser gagnez gagner prenez infligez lancez ajoutez
utilisez chaque tout toute autre cible attaque attaques dégâts espoir peur stress armure esquive
maîtrise caractéristique classe domaine carte arme ennemi créature allié alliés action réaction fois
repos choisissez choisi avant après réussite échec marquez devient avez leur ils elles valeur résultat
portée mêlée proche loin très
`.trim().split(/\s+/));

const SHORT_ENGLISH_MARKERS = new Set(`
efficient amphibious resilient relentless unstoppable recall recharge vulnerable temporary permanent
prepared favored focused versatile adaptable bonded blood hunter order transformation mastery instinct
rage beast strike guard warding
`.trim().split(/\s+/));

const SKIP_KEYS = new Set([
  "_id", "img", "sourceId", "sourcePath", "sourceNamespace", "canonicalId",
  "contentOwner", "contentOrigin", "folder", "sort", "ownership",
]);

function stripMarkup(value) {
  return String(value ?? "")
    .replace(/<[^>]+>/g, " ")
    .replace(/Compendium\.[^\s<]+/g, " ")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function englishScore(value) {
  const text = stripMarkup(value).toLowerCase();
  const words = text.match(/[a-zà-ÿ']+/g) ?? [];
  if (!words.length) return { score: 0, english: 0, french: 0 };

  const english = words.filter(word => ENGLISH_WORDS.has(word)).length;
  const french = words.filter(word => FRENCH_WORDS.has(word)).length;
  let score = english - french;

  if (words.length <= 4 && words.some(word => SHORT_ENGLISH_MARKERS.has(word))) score += 2;
  return { score, english, french };
}

function pathClass(path) {
  if (/\.system\.changes\[\d+\]\.key$/.test(path)) return "technical";
  if (/\.sourceText(?:\.|$)/.test(path)) return "reference";
  if (/^(?:flags\.)/.test(path)) return "metadata";
  return "presentation";
}

function walkStrings(value, path = "", out = []) {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => walkStrings(entry, `${path}[${index}]`, out));
    return out;
  }

  if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      if (SKIP_KEYS.has(key)) continue;
      walkStrings(child, path ? `${path}.${key}` : key, out);
    }
    return out;
  }

  if (typeof value === "string" && value.trim().length >= 4) {
    out.push({ path, value });
  }
  return out;
}

async function sourceIndex() {
  const response = await fetch(`modules/${MODULE_ID}/data/source-index.json`, { cache: "no-store" });
  if (!response.ok) throw new Error(`source-index.json HTTP ${response.status}`);
  return response.json();
}

async function loadJson(relativePath) {
  const response = await fetch(`modules/${MODULE_ID}/${relativePath}`, { cache: "no-store" });
  if (!response.ok) throw new Error(`${relativePath} HTTP ${response.status}`);
  return response.json();
}

function sourceEntries(index) {
  const entries = [];
  for (const origin of ["core", "playtest", "homebrew"]) {
    const packs = index.origins?.[origin]?.packs ?? {};
    for (const [pack, info] of Object.entries(packs)) {
      if (!info?.file || !info?.count) continue;
      entries.push({ origin, pack, file: info.file });
    }
  }
  return entries;
}

export async function frenchSourceDebtAudit({ minScore = 2, includeReference = true, limit = null } = {}) {
  const index = await sourceIndex();
  const findings = [];

  for (const entry of sourceEntries(index)) {
    const documents = await loadJson(entry.file);
    for (const document of documents) {
      for (const candidate of walkStrings(document)) {
        const language = englishScore(candidate.value);
        if (language.english < 1 || language.score < minScore) continue;

        const category = pathClass(candidate.path);
        if (category === "technical") continue;
        if (!includeReference && category === "reference") continue;

        findings.push({
          origin: entry.origin,
          pack: entry.pack,
          id: document._id ?? null,
          name: document.name ?? null,
          path: candidate.path,
          category,
          score: language.score,
          englishMarkers: language.english,
          frenchMarkers: language.french,
          text: stripMarkup(candidate.value),
        });
      }
    }
  }

  findings.sort((a, b) =>
    a.origin.localeCompare(b.origin) ||
    a.pack.localeCompare(b.pack) ||
    a.name.localeCompare(b.name, "fr") ||
    a.path.localeCompare(b.path)
  );

  const selected = Number.isInteger(limit) && limit >= 0 ? findings.slice(0, limit) : findings;
  const byPack = {};
  const affected = new Map();

  for (const finding of findings) {
    const key = `${finding.origin}:${finding.pack}`;
    byPack[key] ??= { origin: finding.origin, pack: finding.pack, presentation: 0, reference: 0, metadata: 0, total: 0, documents: 0 };
    byPack[key][finding.category] += 1;
    byPack[key].total += 1;
    affected.set(`${key}:${finding.id}`, key);
  }
  for (const key of affected.values()) byPack[key].documents += 1;

  const totals = Object.values(byPack).reduce((acc, row) => {
    acc.presentation += row.presentation;
    acc.reference += row.reference;
    acc.metadata += row.metadata;
    acc.total += row.total;
    return acc;
  }, { presentation: 0, reference: 0, metadata: 0, total: 0 });

  return {
    schema: `${MODULE_ID}/fr-source-debt-audit@1`,
    sourceDocuments: index.total ?? null,
    heuristic: true,
    minScore,
    totals,
    byPack,
    findings: selected,
  };
}

export async function frenchSourceDebtSummary(options = {}) {
  const audit = await frenchSourceDebtAudit({ ...options, limit: 0 });
  console.table(Object.fromEntries(
    Object.entries(audit.byPack).map(([key, row]) => [key, {
      documents: row.documents,
      presentation: row.presentation,
      reference: row.reference,
      metadata: row.metadata,
      total: row.total,
    }])
  ));
  console.log(`${MODULE_ID} | FR source debt candidates`, audit.totals);
  return audit;
}
