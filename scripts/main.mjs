import { localizeNativeEquipmentConfigLabels } from "./equipment-native-fr.mjs";
import "./content-locale-settings.mjs";
import { importFullMapped, fullStatus } from "./full-import.mjs";
import { importCampaignFrames, importCampaignFramePilot, campaignFrameStatus } from "./campaign-frame-import.mjs";
import { semanticAudit } from "./semantic-audit.mjs";
import { localizationAudit } from "./localization-audit.mjs";
import { weaponProgressionApi } from "./weapon-progression.mjs";
import { engagementOpportunityApi } from "./engagement-opportunity.mjs";
import { createEngagementOpenerApi, registerEngagementOpenerChatHook } from "./engagement-opener.mjs";
import { createEngagementFinisherApi, registerEngagementFinisherChatHook } from "./engagement-finisher.mjs";
import { createEngagementSupportApi, registerEngagementSupportActionHook } from "./engagement-support.mjs";
import { createEngagementApi } from "./engagement.mjs";
import { huntingCardsApi } from "./hunting-cards.mjs";
import { registerHuntingDomain, registerContextualDomainCardBypass } from "./hunting-domain-card-bridge.mjs";
import { motherboardAugmentCatalogApi } from "./weapon-augment-catalog.mjs";
import { createWeaponAugmentStateApi } from "./weapon-augment-state.mjs";
import { registerWeaponAugmentSheetIntegration } from "./weapon-augment-sheet.mjs";
import {
  registerWeaponAugmentNativeFeatures,
} from "./weapon-augment-native.mjs";

const MODULE_ID = "daggerheart-campaign-toolkit";
const SMOKE_MACRO_NAME = "Campaign Toolkit - Smoke Test";
const DATA_PACKS = [
  "dh-classes",
  "dh-subclasses",
  "dh-domain-cards",
  "dh-weapons",
  "dh-armor",
  "dh-adversaries",
  "dh-environments",
  "dh-campaign-frames",
];

function registerBloodDomain() {
  const domainConfig = CONFIG?.DH?.DOMAIN;
  if (!domainConfig?.domains) {
    console.error(`${MODULE_ID} | unable to register Blood domain: CONFIG.DH.DOMAIN.domains unavailable`);
    return false;
  }
  if (!domainConfig.domains.blood) {
    domainConfig.domains.blood = {
      id: "blood",
      label: "Blood",
      src: "icons/svg/blood.svg",
      description: "Blood domain (The Void v1.5 playtest).",
    };
  }
  console.log(`${MODULE_ID} | Blood domain registered`);
  return true;
}

// Register custom schema choices during module evaluation, before Foundry prepares
// persisted world documents. Registering this only from the init hook is too late:
// Item documents containing system.domain = "blood" may already be validated then.
const bloodDomainBootstrapped = registerBloodDomain();
const huntingDomainBootstrapped = registerHuntingDomain();

Hooks.once("init", () => {
  console.log(`${MODULE_ID} | init`);
  if (!bloodDomainBootstrapped && !CONFIG?.DH?.DOMAIN?.domains?.blood) {
    registerBloodDomain();
  }
  if (!huntingDomainBootstrapped && !CONFIG?.DH?.DOMAIN?.domains?.hunting) {
    registerHuntingDomain();
  }
  registerContextualDomainCardBypass();

  game.modules.get(MODULE_ID).api = {
    version: "0.5.47",
    async smokeTest() {
      const systemOk = game.system?.id === "daggerheart";
      const packs = Object.fromEntries([
        ["toolkit-macros", Boolean(game.packs.get(`${MODULE_ID}.toolkit-macros`))],
        ...DATA_PACKS.map(id => [id, Boolean(game.packs.get(`${MODULE_ID}.${id}`))]),
      ]);
      const result = {
        module: MODULE_ID,
        system: game.system?.id ?? null,
        systemVersion: game.system?.version ?? null,
        foundryVersion: game.version ?? null,
        packs,
        systemOk,
      };
      console.table(result);
      const green = systemOk && Object.values(packs).every(Boolean);
      ui.notifications[green ? "info" : "warn"](`Campaign Toolkit : smoke test ${green ? "GREEN" : "incomplet - voir console"}`);
      return result;
    },
    importFullMapped,
    fullStatus,
    importCampaignFrames,
    importCampaignFramePilot,
    campaignFrameStatus,
    semanticAudit,
    localizationAudit,
    engagementOpportunity: engagementOpportunityApi,
    engagementOpener: createEngagementOpenerApi(engagementOpportunityApi),
    engagementFinisher: createEngagementFinisherApi(engagementOpportunityApi),
    engagementSupport: createEngagementSupportApi(),
    huntingCards: huntingCardsApi,
    weaponProgression: weaponProgressionApi,
    weaponAugments: motherboardAugmentCatalogApi,
    weaponAugmentState: createWeaponAugmentStateApi(motherboardAugmentCatalogApi),
  };

  const toolkitApi = game.modules.get(MODULE_ID).api;
  toolkitApi.engagement = createEngagementApi({
    opportunity: toolkitApi.engagementOpportunity,
    opener: toolkitApi.engagementOpener,
    finisher: toolkitApi.engagementFinisher,
    support: toolkitApi.engagementSupport,
  });

  const huntingCardsBaseApi = toolkitApi.huntingCards;
  toolkitApi.huntingCards = Object.freeze({
    ...huntingCardsBaseApi,
    async installPrototypeActions(actor, sourceItem, sourceAction) {
      return huntingCardsBaseApi.installPrototypeActionsFrom(
        actor,
        sourceItem,
        sourceAction,
        {
          opener: toolkitApi.engagementOpener,
          finisher: toolkitApi.engagementFinisher,
        },
      );
    },
    async installSupportAction(actor) {
      return huntingCardsBaseApi.installSupportAction(
        actor,
        toolkitApi.engagementSupport,
      );
    },
  });

  registerEngagementOpenerChatHook(toolkitApi.engagementOpener);
  registerEngagementFinisherChatHook(toolkitApi.engagementFinisher);
  registerEngagementSupportActionHook(toolkitApi.engagementSupport);
  registerWeaponAugmentSheetIntegration();
});

Hooks.once("ready", async () => {
  console.log(`${MODULE_ID} | ready`);

  try {
    const nativeAugments = await registerWeaponAugmentNativeFeatures(
      motherboardAugmentCatalogApi,
    );
    console.info(`${MODULE_ID} | native Weapon Augments ready`, nativeAugments);
  } catch (error) {
    console.error(`${MODULE_ID} | unable to register native Weapon Augments`, error);
  }
  const locale = game.settings.get(MODULE_ID, "contentLocale") ?? "en";
  const nativeLabels = localizeNativeEquipmentConfigLabels(locale);
  if (nativeLabels) console.info(`${MODULE_ID} | localized native equipment labels`, nativeLabels);
  if (!game.user?.isGM) return;
  const pack = game.packs.get(`${MODULE_ID}.toolkit-macros`);
  if (!pack) return;
  try {
    const index = await pack.getIndex({ fields: ["name"] });
    if (!index.some((entry) => entry.name === SMOKE_MACRO_NAME)) {
      await pack.configure({ locked: false });
      await Macro.create({
        name: SMOKE_MACRO_NAME,
        type: "script",
        scope: "global",
        command: `await game.modules.get("${MODULE_ID}").api.smokeTest();`,
        ownership: { default: 0 },
      }, { pack: pack.collection });
      await pack.configure({ locked: true });
    }
  } catch (error) {
    console.error(`${MODULE_ID} | smoke macro seed failed`, error);
    try { await pack.configure({ locked: true }); } catch {}
  }
});
