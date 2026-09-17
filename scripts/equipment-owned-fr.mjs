import { loadLocaleDictionary } from "./content-locale.mjs";

const MODULE_ID = "daggerheart-campaign-toolkit";
const PACKS = Object.freeze({ weapon: "dh-weapons", armor: "dh-armor" });

const FEATURE_NAMES = Object.freeze({
  Reliable:"Fiable", Heavy:"Lourd", Powerful:"Puissant", Massive:"Massif", Cumbersome:"Encombrant",
  Persuasive:"Persuasif", Accelerator:"Accélérateur", Brave:"Brave", Sharpwing:"Aile tranchante",
  Protective:"Protecteur", Freezing:"Givrant", Catalytic:"Catalytique", Venomous:"Venimeux",
  Serrated:"Dentelé", Bonded:"Lié", Greedy:"Avide", Destructive:"Destructeur", Padded:"Rembourré",
  Focused:"Focalisé", "Follow-Up":"Enchaînement", Paired:"Apparié", Barrier:"Barrière",
  Deflecting:"Déviation", Entangling:"Entravant", "Double Duty":"Double usage", Charged:"Chargé",
  Trusty:"Digne de confiance", Bulky:"Volumineux", Lined:"Doublé", "Very Heavy":"Très lourd",
  Flexible:"Flexible", Enchanted:"Enchanté", Gilded:"Doré", Physical:"Physique", Channeling:"Canalisateur",
  Aquatic:"Aquatique", Warded:"Protégé", Fortified:"Fortifié", Magnificent:"Magnifique",
  Reinforced:"Renforcé", Vitreous:"Vitreux", Attuned:"Harmonisé", Difficult:"Difficile", Vigilant:"Vigilant",
  "Wall-Crawling":"Grimpe-mur", Sharp:"Tranchant", Quick:"Rapide", Hooked:"Crochu", Returning:"Retour",
  Brutal:"Brutal", Deadly:"Mortel", Otherworldly:"Surnaturel", Piercing:"Perforant", Reloading:"Rechargement",
  Scattershot:"Dispersion", Ricochet:"Ricochet", Roped:"Cordé", Sightline:"Ligne de mire", "Quick Shot":"Tir rapide",
  Resonant:"Résonant", Startling:"Saisissant", Stockpiled:"Stocké", Retractable:"Rétractable", Scary:"Effrayant",
  Invigorating:"Revigorant", Bouncing:"Rebondissant", Concussive:"Percutant", Grappling:"Grappin",
  Resilient:"Résilient", Blessed:"Béni", Divine:"Divin", Hopeful:"Porteur d’espoir", Impenetrable:"Impénétrable",
  Resplendent:"Resplendissant", "Self-Healing":"Auto-réparant", Sheltering:"Protecteur", Shifting:"Changeant",
  Timeslowing:"Ralentissement temporel", Truthseeking:"Détecteur de vérité", Absorbing:"Absorbant"
});

const EXACT_TEXT = new Map([
  ["+1 to attack rolls", "+1 aux jets d’attaque."],
  ["−1 to Evasion", "−1 à l’Esquive."], ["−1 to Evasion.", "−1 à l’Esquive."],
  ["−1 to Finesse", "−1 en Finesse."], ["+1 to Evasion", "+1 à l’Esquive."],
  ["+2 to Evasion", "+2 à l’Esquive."], ["+1 to Presence", "+1 en Présence."],
  ["+1 to Spellcast Rolls", "+1 aux jets d’Incantation."],
  ["Gain a bonus to your damage rolls equal to your level.", "Ajoutez votre niveau à vos jets de dégâts."],
  ["On a successful attack, roll an additional damage die and discard the lowest result.", "Lors d’une attaque réussie, lancez un dé de dégâts supplémentaire et écartez le résultat le plus faible."],
  ["When you roll the maximum value on a damage die, roll an additional damage die.", "Lorsque vous obtenez la valeur maximale sur un dé de dégâts, lancez un dé de dégâts supplémentaire."],
  ["When you deal Severe damage, the target must mark an additional HP.", "Lorsque vous infligez des dégâts Sévères, la cible doit marquer 1 PV supplémentaire."],
  ["When you roll a 1 on a damage die, it deals 8 damage instead.", "Lorsque vous obtenez 1 sur un dé de dégâts, ce dé inflige 8 dégâts à la place."],
  ["When you deal Major or greater damage with this weapon, the target becomes temporarily Vulnerable.", "Lorsque cette arme inflige des dégâts Majeurs ou supérieurs, la cible devient temporairement Vulnérable."],
  ["On a successful attack, you can pull the target into Melee range.", "Lors d’une attaque réussie, vous pouvez attirer la cible à portée de Mêlée."],
  ["When this weapon is thrown within its range, it appears in your hand immediately after the attack.", "Lorsque vous lancez cette arme à portée, elle réapparaît dans votre main immédiatement après l’attaque."],
  ["When you make an attack, you can mark a Stress to target another creature within range.", "Lorsque vous effectuez une attaque, vous pouvez marquer 1 Stress pour cibler une autre créature à portée."],
  ["When you make an attack, target all creatures in front of you within range.", "Lorsque vous effectuez une attaque, ciblez toutes les créatures devant vous à portée."],
  ["When an attack from this weapon causes a target to mark 2 or more HP, they become temporarily Restrained.", "Lorsqu’une attaque avec cette arme fait marquer au moins 2 PV à une cible, elle devient temporairement Entravée."],
  ["On a successful attack, you can mark a Stress to give an ally within Close range a +3 bonus to their next attack roll.", "Lors d’une attaque réussie, vous pouvez marquer 1 Stress pour donner à un allié à portée Proche un bonus de +3 à son prochain jet d’attaque."],
  ["−1 to Evasion; when you take Severe damage, you must mark a Stress.", "−1 à l’Esquive ; lorsque vous subissez des dégâts Sévères, vous devez marquer 1 Stress."],
  ["Mark a Stress to negate Minor damage.", "Marquez 1 Stress pour annuler des dégâts Mineurs."],
  ["When you mark an Armor Slot, you reduce the severity of an attack by two thresholds instead of one.", "Lorsque vous marquez un emplacement d’Armure, réduisez la gravité d’une attaque de deux seuils au lieu d’un."],
  ["When you mark your last Armor Slot, increase your damage thresholds by +2 until you clear at least 1 Armor Slot.", "Lorsque vous marquez votre dernier emplacement d’Armure, augmentez vos seuils de dégâts de +2 jusqu’à ce que vous effaciez au moins 1 emplacement d’Armure."],
  ["+2 to Evasion", "+2 à l’Esquive."],
]);

function translateText(text) {
  if (typeof text !== "string" || !text.trim()) return text;
  if (EXACT_TEXT.has(text.trim())) return EXACT_TEXT.get(text.trim());
  let out = text;
  const replacements = [
    [/Armor Score/g,"Score d’Armure"],[/Armor Slot/g,"emplacement d’Armure"],[/Armor Slots/g,"emplacements d’Armure"],
    [/Evasion/g,"Esquive"],[/Hit Points/g,"Points de vie"],[/Hit Point/g,"Point de vie"],[/\bHP\b/g,"PV"],
    [/Stress/g,"Stress"],[/Hope/g,"Espoir"],[/Severe/g,"Sévères"],[/Major/g,"Majeurs"],[/Minor/g,"Mineurs"],
    [/Melee range/g,"portée de Mêlée"],[/Very Close range/g,"portée Très proche"],[/Close range/g,"portée Proche"],
    [/Far range/g,"portée Lointaine"],[/Very Far range/g,"portée Très lointaine"],[/Vulnerable/g,"Vulnérable"],
    [/Restrained/g,"Entravé"],[/Spellcast/g,"Incantation"],[/attack rolls/g,"jets d’attaque"],[/damage rolls/g,"jets de dégâts"]
  ];
  for (const [a,b] of replacements) out = out.replace(a,b);
  return out;
}

function canonicalId(doc) {
  const f = doc.flags?.[MODULE_ID] ?? {};
  return f.canonicalSourceId ?? f.sourceId ?? null;
}

function translateEmbedded(source) {
  let changed = 0;
  const visit = (node) => {
    if (!node || typeof node !== "object") return;
    if (typeof node.name === "string" && FEATURE_NAMES[node.name]) { node.name = FEATURE_NAMES[node.name]; changed++; }
    for (const key of ["description", "text"]) {
      if (typeof node[key] === "string") {
        const next = translateText(node[key]); if (next !== node[key]) { node[key] = next; changed++; }
      }
    }
    for (const value of Object.values(node)) if (value && typeof value === "object") visit(value);
  };
  visit(source.system);
  for (const a of source.actions ?? []) visit(a);
  for (const e of source.effects ?? []) visit(e);
  return changed;
}

export async function ownAndLocalizeEquipment(locale = "fr") {
  if (!game.user?.isGM || locale !== "fr") return { skipped: true, reason: "gm-fr-only" };
  const dictionary = await loadLocaleDictionary("fr");
  const result = {};
  for (const [kind, packName] of Object.entries(PACKS)) {
    const pack = game.packs.get(`${MODULE_ID}.${packName}`);
    if (!pack) { result[packName] = { present:false }; continue; }
    const docs = await pack.getDocuments();
    let localized=0, embedded=0, owned=0, fallback=0;
    await pack.configure({ locked:false });
    try {
      for (const doc of docs) {
        const id = canonicalId(doc);
        const source = doc.toObject();
        const overlay = id ? dictionary.entries?.[id] : null;
        const update = { _id:doc.id, [`flags.${MODULE_ID}.contentOwner`]:MODULE_ID, [`flags.${MODULE_ID}.contentOrigin`]:"core", [`flags.${MODULE_ID}.contentLocale`]:"fr" };
        owned++;
        if (overlay?.name && overlay.name !== doc.name) { update.name=overlay.name; localized++; }
        embedded += translateEmbedded(source);
        if (source.system) update.system=source.system;
        if (source.actions) update.actions=source.actions;
        if (source.effects) update.effects=source.effects;
        if (!overlay?.name) fallback++;
        await doc.update(update);
      }
    } finally { await pack.configure({ locked:true }); }
    result[packName] = { present:true, total:docs.length, owned, localizedNames:localized, embeddedChanges:embedded, missingFrenchName:fallback };
  }
  return result;
}

export async function equipmentOwnershipStatus() {
  const dictionary = await loadLocaleDictionary("fr");
  const result = {};
  for (const [kind, packName] of Object.entries(PACKS)) {
    const pack=game.packs.get(`${MODULE_ID}.${packName}`);
    if (!pack) { result[packName]={present:false}; continue; }
    const docs=await pack.getDocuments();
    let owned=0, frenchName=0, missingCanonical=0;
    const missing=[];
    for (const doc of docs) {
      if (doc.flags?.[MODULE_ID]?.contentOwner===MODULE_ID) owned++;
      const id=canonicalId(doc); if (!id) { missingCanonical++; continue; }
      if (dictionary.entries?.[id]?.name) frenchName++; else missing.push({name:doc.name, canonicalId:id});
    }
    result[packName]={present:true,total:docs.length,owned,frenchName,missingCanonical,missingFrenchName:missing.length,missing:missing.slice(0,20)};
  }
  return result;
}
