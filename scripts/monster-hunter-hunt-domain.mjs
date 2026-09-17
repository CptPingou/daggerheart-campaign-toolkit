/**
 * Monster Hunter — native Foundryborne Hunt domain bridge.
 *
 * Foundryborne derives a character's domains from its embedded class item(s),
 * while domain definitions may be extended through the system Homebrew setting.
 */
const MODULE_ID = "daggerheart-campaign-toolkit";
export const HUNT_DOMAIN_ID = "hunt";

export const HUNT_DOMAIN = Object.freeze({
  id: HUNT_DOMAIN_ID,
  label: "Chasse",
  description: "Techniques de préparation, d’engagement et d’exploitation propres à la chasse aux monstres.",
  src: "icons/skills/melee/strike-axe-blood-red.webp",
  color: "#596b3f",
});

function homebrewSettingKey() {
  return CONFIG.DH.SETTINGS.gameSettings.Homebrew;
}

export function huntDomainStatus(actor = null) {
  const homebrew = game.settings.get(CONFIG.DH.id, homebrewSettingKey());
  const registered = Boolean(homebrew?.domains?.[HUNT_DOMAIN_ID]);
  const allDomains = CONFIG.DH.DOMAIN.allDomains();
  const visible = Boolean(allDomains?.[HUNT_DOMAIN_ID]);
  const granted = actor ? actor.system?.domains?.includes(HUNT_DOMAIN_ID) ?? false : null;
  return {
    domain: HUNT_DOMAIN_ID,
    registered,
    visible,
    granted,
    green: registered && visible && (actor ? granted : true),
  };
}

export async function ensureHuntDomainRegistered() {
  if (!game.user?.isGM) return huntDomainStatus();

  const key = homebrewSettingKey();
  const homebrew = foundry.utils.deepClone(game.settings.get(CONFIG.DH.id, key));
  homebrew.domains ??= {};

  const current = homebrew.domains[HUNT_DOMAIN_ID];
  const desired = { ...HUNT_DOMAIN };
  if (JSON.stringify(current) !== JSON.stringify(desired)) {
    homebrew.domains[HUNT_DOMAIN_ID] = desired;
    await game.settings.set(CONFIG.DH.id, key, homebrew);
  }
  return huntDomainStatus();
}

function primaryClass(actor) {
  return actor?.items?.find((item) => item.type === "class" && !item.system?.isMulticlass) ?? null;
}

export async function grantHuntDomain(actor) {
  if (!actor) throw new Error("An Actor is required.");
  if (!game.user?.isGM) throw new Error("GM permission is required to grant the Hunt domain.");

  await ensureHuntDomainRegistered();

  const cls = primaryClass(actor);
  if (!cls) throw new Error("The Actor has no primary class item.");

  const domains = [...(cls.system?.domains ?? [])];
  if (!domains.includes(HUNT_DOMAIN_ID)) {
    domains.push(HUNT_DOMAIN_ID);
    await cls.update({ "system.domains": domains });
  }

  return huntDomainStatus(actor);
}

export async function revokeHuntDomain(actor) {
  if (!actor) throw new Error("An Actor is required.");
  if (!game.user?.isGM) throw new Error("GM permission is required to revoke the Hunt domain.");

  const cls = primaryClass(actor);
  if (!cls) throw new Error("The Actor has no primary class item.");

  const domains = (cls.system?.domains ?? []).filter((id) => id !== HUNT_DOMAIN_ID);
  await cls.update({ "system.domains": domains });
  return huntDomainStatus(actor);
}
