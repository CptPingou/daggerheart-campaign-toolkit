const MODULE_ID = "daggerheart-campaign-toolkit";
const FLAG_KEY = "contextualCard";
const HUNTING_DOMAIN_ID = "hunting";

let patched = false;

function contextualMarkerFromModel(model) {
  const item = model?.parent;
  if (!item) return null;

  if (typeof item.getFlag === "function") {
    return item.getFlag(MODULE_ID, FLAG_KEY) ?? null;
  }

  return item.flags?.[MODULE_ID]?.[FLAG_KEY] ?? null;
}

function toolkitCardMarkerFromModel(model) {
  const item = model?.parent;
  if (!item) return null;

  if (typeof item.getFlag === "function") {
    return item.getFlag(MODULE_ID, "toolkitCard") ?? null;
  }

  return item.flags?.[MODULE_ID]?.toolkitCard ?? null;
}

function isToolkitManagedDomainCard(model) {
  const toolkitCard = toolkitCardMarkerFromModel(model);
  if (toolkitCard?.eligibility === "toolkit" && toolkitCard?.family) {
    return true;
  }

  // Legacy compatibility for the pre-family contextual Hunting implementation.
  const marker = contextualMarkerFromModel(model);
  return marker?.contextual === true && marker?.domainId === HUNTING_DOMAIN_ID;
}

export function registerHuntingDomain() {
  const domains = CONFIG?.DH?.DOMAIN?.domains;
  if (!domains) {
    console.error(
      `${MODULE_ID} | unable to register Hunting domain: CONFIG.DH.DOMAIN.domains unavailable`,
    );
    return false;
  }

  if (!domains[HUNTING_DOMAIN_ID]) {
    domains[HUNTING_DOMAIN_ID] = {
      id: HUNTING_DOMAIN_ID,
      label: "Hunting",
      src: "icons/svg/target.svg",
      description: "Contextual Hunting domain managed by Campaign Toolkit.",
    };
  }

  console.log(`${MODULE_ID} | Hunting contextual domain registered`);
  return true;
}

export function registerContextualDomainCardBypass() {
  if (patched) return true;

  const DomainCardModel = CONFIG?.Item?.dataModels?.domainCard;
  if (!DomainCardModel?.prototype?._preCreate) {
    console.error(
      `${MODULE_ID} | unable to patch DHDomainCard._preCreate: model unavailable`,
    );
    return false;
  }

  const prototype = DomainCardModel.prototype;
  const original = prototype._preCreate;
  const basePrototype = Object.getPrototypeOf(prototype);
  const basePreCreate = basePrototype?._preCreate;

  prototype._preCreate = async function (data, options, user) {
    if (!isToolkitManagedDomainCard(this)) {
      return original.call(this, data, options, user);
    }

    // Keep Daggerheart's inherited document validation. We bypass only the
    // "class must own this domain" guard for Toolkit contextual Hunting cards.
    if (typeof basePreCreate === "function") {
      const allowed = await basePreCreate.call(this, data, options, user);
      if (allowed === false) return false;
    }

    if (this.actor?.type === "character") {
      const actorClasses = this.actor.items.filter(x => x.type === "class");

      if (!actorClasses.length) {
        ui.notifications.error(
          game.i18n.localize("DAGGERHEART.UI.Notifications.noClassSelected"),
        );
        return false;
      }

      // Intentionally omitted for Toolkit Hunting cards:
      // actorClasses.some(c => c.system.domains.includes(this.domain))

      if (this.actor.system.domainCards.total.find(x => x.name === this.parent.name)) {
        ui.notifications.error(
          game.i18n.localize("DAGGERHEART.UI.Notifications.duplicateDomainCard"),
        );
        return false;
      }

      // Hunting cards use loadoutIgnore=true and carry a +1 maxLoadout effect.
      // Retain native vault behavior for any contextual card that does not.
      if (!this.actor.system.loadoutSlot.available && !this.loadoutIgnore) {
        data.system.inVault = true;
        await this.updateSource({ inVault: true });
        ui.notifications.warn(
          game.i18n.localize("DAGGERHEART.UI.Notifications.loadoutMaxReached"),
        );
      }
    }

    return true;
  };

  patched = true;
  console.log(
    `${MODULE_ID} | Toolkit-managed domainCard preCreate bypass registered`,
  );
  return true;
}
