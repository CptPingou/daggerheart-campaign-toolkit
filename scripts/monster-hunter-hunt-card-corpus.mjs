export function huntCardMechanicFromDocument(document, huntApi) {
  const raw = document?.flags?.["daggerheart-campaign-toolkit"]?.huntCardMechanic;
  if (!raw) return null;
  return huntApi.define(raw);
}

export async function monsterHunterHuntCardCorpusStatus({
  pack = game.packs.get("daggerheart-campaign-toolkit.dh-domain-cards"),
  huntApi = game.modules.get("daggerheart-campaign-toolkit")?.api?.monsterHunterHuntCard,
} = {}) {
  if (!pack || !huntApi) {
    return { green: false, reason: "runtime-unavailable", cards: [] };
  }

  const docs = await pack.getDocuments();
  const mh = docs.filter((d) =>
    d.flags?.["daggerheart-campaign-toolkit"]?.sourceNamespace === "monster-hunter"
  );
  const mechanical = mh
    .map((d) => ({ document: d, mechanic: huntCardMechanicFromDocument(d, huntApi) }))
    .filter((row) => row.mechanic);

  const expected = ["opening", "conversion", "defensive-support"];
  const ids = mechanical.map((row) => row.mechanic.id);

  return {
    namespace: "monster-hunter",
    totalCards: mh.length,
    mechanicalCards: mechanical.length,
    expectedMechanicalIds: expected,
    missingMechanicalIds: expected.filter((id) => !ids.includes(id)),
    cards: mechanical.map(({ document, mechanic }) => ({
      id: document.id,
      name: document.name,
      mechanic,
    })),
    green:
      mh.length === 8 &&
      mechanical.length === 3 &&
      expected.every((id) => ids.includes(id)),
  };
}
