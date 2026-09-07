const NATIVE_EQUIPMENT_FR = Object.freeze({
  reliable: "Fiable", heavy: "Lourd", powerful: "Puissant", massive: "Massif",
  cumbersome: "Encombrant", persuasive: "Persuasif", accelerator: "Accélérateur",
  brave: "Brave", sharpwing: "Aile tranchante", protective: "Protecteur",
  freezing: "Givrant", catalytic: "Catalytique", venomous: "Venimeux",
  serrated: "Dentelé", bonded: "Lié", greedy: "Avide", destructive: "Destructeur",
  padded: "Rembourré", focused: "Focalisé", followUp: "Enchaînement", paired: "Apparié",
  barrier: "Barrière", deflecting: "Déviation", entangling: "Entravant",
  doubleDuty: "Double usage", charged: "Chargé", trusty: "Digne de confiance",
  bulky: "Volumineux", lined: "Doublé", veryheavy: "Très lourd", flexible: "Flexible",
  enchanted: "Enchanté", gilded: "Doré", physical: "Physique", channeling: "Canalisateur",
  aquatic: "Aquatique", warded: "Protégé", fortified: "Fortifié", magnificent: "Magnifique",
  reinforced: "Renforcé", vitreous: "Vitreux", attuned: "Harmonisé", difficult: "Difficile",
  vigilant: "Vigilant", wallCrawling: "Grimpe-mur", sharp: "Tranchant"
});

export function nativeEquipmentFrLabel(key) {
  return NATIVE_EQUIPMENT_FR[key] ?? null;
}

export function localizeNativeEquipmentEmbedded(mapped, key, locale = "en") {
  if (locale !== "fr") return mapped;
  const label = nativeEquipmentFrLabel(key);
  if (!label) return mapped;
  for (const effect of mapped?.effects ?? []) {
    if (typeof effect?.name === "string" && effect.name.trim()) effect.name = label;
  }
  for (const action of mapped?.actions ?? []) {
    if (typeof action?.name === "string" && action.name.trim()) action.name = label;
  }
  return mapped;
}

// Foundryborne feature selectors are system configuration choices. Their exact
// nesting has changed between releases, so update only exact known feature keys
// and only label-like values. Mechanics, ids, effects and actions are untouched.
export function localizeNativeEquipmentConfigLabels(locale = "en") {
  if (locale !== "fr" || !globalThis.CONFIG?.DH) return 0;
  const seen = new WeakSet();
  let changed = 0;

  function visit(node) {
    if (!node || typeof node !== "object" || seen.has(node)) return;
    seen.add(node);
    for (const [key, value] of Object.entries(node)) {
      const label = nativeEquipmentFrLabel(key);
      if (label) {
        if (typeof value === "string") {
          node[key] = label;
          changed++;
          continue;
        }
        if (value && typeof value === "object") {
          for (const prop of ["label", "name"]) {
            if (typeof value[prop] === "string") {
              value[prop] = label;
              changed++;
            }
          }
        }
      }
      visit(node[key]);
    }
  }

  visit(CONFIG.DH);
  return changed;
}
