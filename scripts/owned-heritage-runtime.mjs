const MODULE_ID = "daggerheart-campaign-toolkit";

const HERITAGE_PACKS = Object.freeze([
  ["dh-ancestries", "ancestry"],
  ["dh-communities", "community"],
]);

function featureUuid(ref) {
  if (typeof ref === "string") return ref;
  if (typeof ref?.item === "string") return ref.item;
  if (typeof ref?.uuid === "string") return ref.uuid;
  return ref?.item?.uuid ?? null;
}

export async function ownedHeritageRuntimeStatus() {
  const packs = {};
  let green = true;

  for (const [packName, rootType] of HERITAGE_PACKS) {
    const collection = `${MODULE_ID}.${packName}`;
    const pack = game.packs.get(collection);
    if (!pack) {
      packs[packName] = { present: false };
      green = false;
      continue;
    }

    const docs = await pack.getDocuments();
    const roots = docs.filter(d => d.type === rootType);
    const features = docs.filter(d => d.type === "feature");
    const externalRefs = [];
    const missingRefs = [];

    for (const root of roots) {
      for (const ref of root.system?.features ?? []) {
        const uuid = featureUuid(ref);
        if (!uuid) {
          missingRefs.push({ root: root.name, uuid: null });
          continue;
        }
        if (!uuid.startsWith(`Compendium.${collection}.Item.`)) {
          externalRefs.push({ root: root.name, uuid });
          continue;
        }
        let target = null;
        try { target = await fromUuid(uuid); } catch {}
        if (!target) missingRefs.push({ root: root.name, uuid });
      }
    }

    const owned = docs.filter(d =>
      d.flags?.[MODULE_ID]?.contentOwner === MODULE_ID
    ).length;
    const french = docs.filter(d =>
      d.flags?.[MODULE_ID]?.contentLocale === "fr"
    ).length;

    const status = {
      present: true,
      total: docs.length,
      roots: roots.length,
      features: features.length,
      owned,
      french,
      externalRefs,
      missingRefs,
      green: owned === docs.length
        && french === docs.length
        && externalRefs.length === 0
        && missingRefs.length === 0,
    };
    packs[packName] = status;
    green &&= status.green;
  }

  return {
    owner: MODULE_ID,
    source: "toolkit-owned-compendiums",
    nativeSrdReadRequired: false,
    packs,
    green,
  };
}
