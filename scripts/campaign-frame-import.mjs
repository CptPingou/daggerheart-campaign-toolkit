const MODULE_ID = "daggerheart-campaign-toolkit";
const FLAG_SCOPE = MODULE_ID;
const PACK_ID = "dh-campaign-frames";
const INDEX_URL = `modules/${MODULE_ID}/data/campaign-frames/index.json`;
const MAPPING_VERSION = "P2.4.2f";

async function loadCampaignFrameIndex() {
  const response = await fetch(INDEX_URL, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`campaign-frames/index.json introuvable (${response.status}). Lance export_foundry_campaign_frames.py.`);
  }

  const payload = await response.json();
  if (payload?.phase !== "P2.4.2e" || payload?.audit?.green !== true) {
    throw new Error(`campaign-frames/index.json non supporté ou audit RED (phase: ${payload?.phase ?? "absente"})`);
  }

  if (!Array.isArray(payload.frames) || payload.frames.length !== 5) {
    throw new Error(`campaign-frames/index.json invalide: ${payload?.frames?.length ?? 0} frame(s), 5 attendues.`);
  }

  for (const entry of payload.frames) {
    if (entry?.data?.kind !== "campaign_frame") {
      throw new Error(`Campaign Frame invalide: ${entry?.data?.id ?? entry?.slug ?? "inconnue"} (kind=${entry?.data?.kind ?? "absent"})`);
    }
  }

  return payload;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function normalizeWhitespace(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function escapeRegExp(value) {
  return String(value ?? "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function headingPattern(rawHeading) {
  const words = normalizeWhitespace(rawHeading)
    .split(" ")
    .filter(Boolean)
    .map(escapeRegExp);

  return new RegExp(words.join("\\s+"), "u");
}

function sectionToHtml(section) {
  let text = String(section.rules_text ?? "").replace(/\r\n/g, "\n").trim();
  const subsections = Array.isArray(section.subsections) ? section.subsections : [];
  const markers = [];

  for (const subsection of subsections) {
    const rawHeading = subsection.raw_heading ?? subsection.name;
    const pattern = headingPattern(rawHeading);

    if (!pattern.test(text)) {
      console.warn(
        `[${MODULE_ID}] Sous-titre canonique introuvable dans ${section.name}:`,
        rawHeading,
      );
      continue;
    }

    const marker = `@@DCT_SUBSECTION_${markers.length}@@`;
    text = text.replace(pattern, `\n\n${marker}\n\n`);
    markers.push({
      marker,
      name: subsection.name,
      sourceId: subsection.id ?? null,
    });
  }

  const blocks = text
    .split(/\n{2,}/)
    .map(block => block.trim())
    .filter(Boolean);

  const body = blocks.map(block => {
    const heading = markers.find(item => item.marker === block);
    if (heading) {
      const sourceAttr = heading.sourceId
        ? ` data-source-id="${escapeHtml(heading.sourceId)}"`
        : "";
      return `<h2${sourceAttr}>${escapeHtml(heading.name)}</h2>`;
    }

    if (section.name === "Session Zero Questions") {
      const lines = block
        .split("\n")
        .map(line => line.trim())
        .filter(Boolean);

      if (lines.length > 1) {
        return `<ul>${lines.map(line => `<li>${escapeHtml(line)}</li>`).join("")}</ul>`;
      }
    }

    return `<p>${escapeHtml(normalizeWhitespace(block))}</p>`;
  });

  return body.join("\n");
}

function buildPage(section, sort) {
  return {
    name: section.name,
    type: "text",
    sort,
    text: {
      content: sectionToHtml(section),
      format: CONST.JOURNAL_ENTRY_PAGE_FORMATS.HTML,
    },
    flags: {
      [FLAG_SCOPE]: {
        managed: true,
        kind: "campaign_frame_section",
        sourceId: section.id,
        rawHeading: section.raw_heading ?? null,
        subsectionCount: Array.isArray(section.subsections) ? section.subsections.length : 0,
        mappingVersion: MAPPING_VERSION,
      },
    },
  };
}

function frameDisplayName(frame) {
  return frame.identity?.name ?? frame.name ?? frame.id;
}

function buildJournal(frame, sourcePath, corpus = null, slug = null) {
  const pages = frame.sections.map((section, index) => buildPage(section, (index + 1) * 10));
  const subsectionCount = frame.sections.reduce(
    (total, section) => total + (Array.isArray(section.subsections) ? section.subsections.length : 0),
    0,
  );

  return {
    name: frameDisplayName(frame),
    pages,
    flags: {
      [FLAG_SCOPE]: {
        managed: true,
        kind: "campaign_frame",
        sourceId: frame.id,
        sourcePath,
        corpus,
        slug,
        source: frame.source ?? null,
        provenance: frame.provenance ?? null,
        complexityRating: frame.complexity_rating ?? null,
        sectionCount: pages.length,
        subsectionCount,
        mappingVersion: MAPPING_VERSION,
      },
    },
  };
}

async function replaceManagedFrames(pack, frameEntries) {
  await pack.configure({ locked: false });
  try {
    const sourceIds = new Set(frameEntries.map(entry => entry.data.id));
    const docs = await pack.getDocuments();
    const staleIds = docs
      .filter(doc => foundry.utils.getProperty(doc, `flags.${FLAG_SCOPE}.managed`) === true)
      .filter(doc => sourceIds.has(foundry.utils.getProperty(doc, `flags.${FLAG_SCOPE}.sourceId`)))
      .map(doc => doc.id);

    if (staleIds.length) {
      await JournalEntry.deleteDocuments(staleIds, { pack: pack.collection });
    }

    const created = [];
    for (const entry of frameEntries) {
      const journalData = buildJournal(
        entry.data,
        entry.source_path ?? null,
        entry.corpus ?? null,
        entry.slug ?? null,
      );
      created.push(await JournalEntry.create(journalData, { pack: pack.collection }));
    }
    return created;
  } finally {
    await pack.configure({ locked: true });
  }
}

export async function importCampaignFrames() {
  if (!game.user?.isGM) throw new Error("P2.4.2f Campaign Frame import is GM-only.");

  const pack = game.packs.get(`${MODULE_ID}.${PACK_ID}`);
  if (!pack) throw new Error(`Compendium absent: ${PACK_ID}`);

  const payload = await loadCampaignFrameIndex();
  const created = await replaceManagedFrames(pack, payload.frames);

  const entries = created.map((journal, index) => {
    const frameEntry = payload.frames[index];
    const frame = frameEntry.data;
    const pageCount = journal?.pages?.size ?? journal?.pages?.length ?? 0;
    const expectedSubsections = frame.sections.reduce(
      (total, section) => total + (Array.isArray(section.subsections) ? section.subsections.length : 0),
      0,
    );

    return {
      sourceId: frame.id,
      name: frameDisplayName(frame),
      journalId: journal?.id ?? null,
      pageCount,
      expectedPages: frame.sections.length,
      expectedSubsections,
      green: Boolean(journal) && pageCount === frame.sections.length,
    };
  });

  const pageCount = entries.reduce((total, entry) => total + entry.pageCount, 0);
  const expectedPages = payload.frames.reduce((total, entry) => total + entry.data.sections.length, 0);
  const result = {
    pack: PACK_ID,
    created: created.length,
    expectedFrames: payload.frames.length,
    pageCount,
    expectedPages,
    entries,
    green:
      created.length === payload.frames.length &&
      pageCount === expectedPages &&
      entries.every(entry => entry.green),
  };

  console.table(entries);
  console.log(`${MODULE_ID} | P2.4.2f Campaign Frames`, result);
  ui.notifications[result.green ? "info" : "warn"](
    `Campaign Toolkit : P2.4.2f Campaign Frames ${result.green ? "GREEN" : "incomplet — voir console"}`
  );
  return result;
}

export const importCampaignFramePilot = importCampaignFrames;

export async function campaignFrameStatus() {
  const pack = game.packs.get(`${MODULE_ID}.${PACK_ID}`);
  if (!pack) return { pack: PACK_ID, count: null, status: "ABSENT" };

  const index = await pack.getIndex({
    fields: [
      `flags.${FLAG_SCOPE}.managed`,
      `flags.${FLAG_SCOPE}.sourceId`,
      `flags.${FLAG_SCOPE}.sectionCount`,
      `flags.${FLAG_SCOPE}.subsectionCount`,
      `flags.${FLAG_SCOPE}.mappingVersion`,
      "name",
    ],
  });

  const managed = index.filter(
    row => foundry.utils.getProperty(row, `flags.${FLAG_SCOPE}.managed`) === true
  );

  const entries = managed.map(row => ({
    id: row._id,
    name: row.name,
    sourceId: foundry.utils.getProperty(row, `flags.${FLAG_SCOPE}.sourceId`) ?? null,
    sectionCount: foundry.utils.getProperty(row, `flags.${FLAG_SCOPE}.sectionCount`) ?? null,
    subsectionCount: foundry.utils.getProperty(row, `flags.${FLAG_SCOPE}.subsectionCount`) ?? null,
    mappingVersion: foundry.utils.getProperty(row, `flags.${FLAG_SCOPE}.mappingVersion`) ?? null,
  }));

  const totalSections = entries.reduce((total, entry) => total + (Number(entry.sectionCount) || 0), 0);
  const result = {
    pack: PACK_ID,
    count: managed.length,
    expectedFrames: 5,
    totalSections,
    expectedSections: 66,
    entries,
    green: managed.length === 5 && totalSections === 66,
    status: "OK",
  };

  console.table(entries);
  return result;
}
