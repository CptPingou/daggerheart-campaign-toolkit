const MODULE_ID = "daggerheart-campaign-toolkit";

export const OWNED_CONTENT = Object.freeze({
  "dh-ancestries": { rootTypes: ["ancestry"], native: ["daggerheart.ancestries"] },
  "dh-communities": { rootTypes: ["community"], native: ["daggerheart.communities"] },
  "dh-classes": { rootTypes: ["class"], native: ["daggerheart.classes"] },
  "dh-subclasses": { rootTypes: ["subclass"], native: ["daggerheart.subclasses"] },
  "dh-domain-cards": { rootTypes: ["domainCard", "domain-card", "domain"], native: ["daggerheart.domains"] },
  "dh-weapons": { rootTypes: ["weapon"], native: ["daggerheart.weapons"] },
  "dh-armor": { rootTypes: ["armor"], native: ["daggerheart.armor", "daggerheart.armors"] },
});

function ownerFlag(doc) {
  return doc?.getFlag?.(MODULE_ID, "contentOwner")
    ?? doc?.flags?.[MODULE_ID]?.contentOwner
    ?? null;
}

export async function migrateOwnedContentFlags({ persist = true } = {}) {
  if (persist && !game.user?.isGM) return { skipped: "GM-only" };
  const result = {};
  for (const [packName] of Object.entries(OWNED_CONTENT)) {
    const pack = game.packs.get(`${MODULE_ID}.${packName}`);
    if (!pack) { result[packName] = { present: false }; continue; }
    const docs = await pack.getDocuments();
    const updates = [];
    let alreadyOwned = 0;
    for (const doc of docs) {
      if (ownerFlag(doc) === MODULE_ID) { alreadyOwned++; continue; }
      updates.push({
        _id: doc.id,
        [`flags.${MODULE_ID}.contentOwner`]: MODULE_ID,
        [`flags.${MODULE_ID}.contentOrigin`]:
          doc.getFlag?.(MODULE_ID, "contentOrigin") ?? "core",
      });
    }
    if (persist && updates.length) {
      await pack.configure({ locked: false });
      try { await Item.updateDocuments(updates, { pack: pack.collection }); }
      finally { await pack.configure({ locked: true }); }
    }
    result[packName] = {
      present: true, total: docs.length, alreadyOwned,
      migrated: persist ? updates.length : 0, pending: updates.length,
    };
  }
  return result;
}

export async function globalContentOwnershipStatus() {
  const owned = {};
  for (const [packName, config] of Object.entries(OWNED_CONTENT)) {
    const pack = game.packs.get(`${MODULE_ID}.${packName}`);
    if (!pack) { owned[packName] = { present: false }; continue; }
    const docs = await pack.getDocuments();
    const rootSet = new Set(config.rootTypes);
    owned[packName] = {
      present: true,
      total: docs.length,
      roots: docs.filter(d => rootSet.has(d.type)).length,
      owned: docs.filter(d => ownerFlag(d) === MODULE_ID).length,
      core: docs.filter(d => (d.getFlag?.(MODULE_ID, "contentOrigin")
        ?? d.flags?.[MODULE_ID]?.contentOrigin) === "core").length,
    };
  }
  return { owner: MODULE_ID, owned };
}
