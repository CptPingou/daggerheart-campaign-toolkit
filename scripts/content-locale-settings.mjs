const MODULE_ID = "daggerheart-campaign-toolkit";

Hooks.once("init", () => {
  game.settings.register(MODULE_ID, "contentLocale", {
    name: "Langue du contenu importé",
    hint: "Choisit la couche de localisation appliquée aux données canoniques lors de l’import.",
    scope: "world",
    config: true,
    type: String,
    choices: {
      en: "English (canonical source)",
      fr: "Français (fallback anglais si traduction absente)",
    },
    default: "en",
    requiresReload: false,
  });
});
