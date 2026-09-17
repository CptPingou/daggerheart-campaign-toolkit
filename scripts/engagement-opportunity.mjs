const COUNTDOWN_NAME = "Opportunity";
const COUNTDOWN_ID = "DCTOpportunity01";
const COUNTDOWN_START = 4;

function countdownSettingKey() {
  return CONFIG?.DH?.SETTINGS?.gameSettings?.Countdowns ?? "Countdowns";
}

function countdownSetting() {
  return game.settings.get(CONFIG.DH.id, countdownSettingKey());
}

function countdownSource(setting = countdownSetting()) {
  return foundry.utils.deepClone(setting?._source ?? {
    countdowns: {},
    hideNewCountdowns: false,
  });
}

function storedCountdownEntries(setting = countdownSetting()) {
  const countdowns = setting?.countdowns ?? setting?._source?.countdowns ?? {};
  return Object.entries(countdowns);
}

function findStoredOpportunity(setting = countdownSetting()) {
  const entries = storedCountdownEntries(setting);

  const canonical = entries.find(([id]) => id === COUNTDOWN_ID);
  if (canonical) return { id: canonical[0], countdown: canonical[1] };

  const legacy = entries.find(([, countdown]) => countdown?.name === COUNTDOWN_NAME);
  if (legacy) return { id: legacy[0], countdown: legacy[1] };

  return null;
}

function defaultOwnership() {
  return Array.from(game.users ?? []).reduce((ownership, user) => {
    ownership[user.id] = CONST.DOCUMENT_OWNERSHIP_LEVELS.INHERIT;
    return ownership;
  }, { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.INHERIT });
}

function defaultOpportunitySource() {
  return {
    type: CONFIG?.DH?.GENERAL?.countdownTypes?.misc?.id ?? "misc",
    name: COUNTDOWN_NAME,
    img: "icons/skills/ranged/target-bullseye-arrow-green.webp",
    hidden: false,
    ownership: defaultOwnership(),
    progress: {
      current: 0,
      start: COUNTDOWN_START,
      startFormula: null,
      looping: CONFIG?.DH?.GENERAL?.countdownLoopingTypes?.noLooping?.id ?? "noLooping",
      type: CONFIG?.DH?.GENERAL?.countdownProgressionTypes?.custom?.id ?? "custom",
    },
  };
}

export async function ensureOpportunityCountdown() {
  const setting = countdownSetting();
  const existing = findStoredOpportunity(setting);

  if (existing) {
    return Object.freeze({
      green: true,
      changed: false,
      id: existing.id,
      name: existing.countdown?.name ?? COUNTDOWN_NAME,
      reason: existing.id === COUNTDOWN_ID ? "already-present" : "legacy-present",
    });
  }

  if (!game.user?.isGM) {
    return Object.freeze({
      green: false,
      changed: false,
      id: null,
      name: COUNTDOWN_NAME,
      reason: "gm-required",
    });
  }

  const source = countdownSource(setting);
  source.countdowns ??= {};
  source.countdowns[COUNTDOWN_ID] = defaultOpportunitySource();

  await game.settings.set(CONFIG.DH.id, countdownSettingKey(), source);

  // The setting is authoritative. Re-render the Foundryborne application when
  // it already exists so the newly bootstrapped countdown becomes visible
  // without requiring a world reload.
  try {
    await globalThis.ui?.countdowns?.render?.({ force: true });
  } catch (error) {
    console.warn("Campaign Toolkit | Opportunity created but countdown UI refresh failed", error);
  }

  const persisted = findStoredOpportunity();
  const result = Object.freeze({
    green: Boolean(persisted),
    changed: true,
    id: persisted?.id ?? COUNTDOWN_ID,
    name: persisted?.countdown?.name ?? COUNTDOWN_NAME,
    reason: persisted ? "created" : "persistence-check-failed",
  });

  console.info("Campaign Toolkit | Opportunity countdown bootstrap", result);
  return result;
}

function countdownData() {
  const uiData = Object.values(globalThis.ui?.countdowns?.previousCountdownData ?? {});
  if (uiData.length > 0) return uiData;

  return storedCountdownEntries().map(([, countdown]) => countdown);
}

export function getOpportunityCountdown() {
  const stored = findStoredOpportunity();
  if (stored?.countdown) return stored.countdown;

  return countdownData().find((countdown) => countdown?.name === COUNTDOWN_NAME) ?? null;
}

export function getOpportunityValue() {
  const opportunity = getOpportunityCountdown();
  return Number(opportunity?.progress?.current ?? 0);
}

function normalizeAmount(amount) {
  const value = Number(amount);
  if (!Number.isInteger(value) || value < 0) {
    throw new TypeError("Campaign Toolkit | Opportunity amount must be a non-negative integer");
  }
  return value;
}

function opportunityProgress(entry) {
  return entry?.countdown?.progress ?? null;
}

async function writeOpportunityValue(nextValue) {
  if (!game.user?.isGM) {
    throw new Error("Campaign Toolkit | Opportunity can only be changed by a GM");
  }

  const setting = countdownSetting();
  const entry = findStoredOpportunity(setting);
  if (!entry) {
    throw new Error(`Campaign Toolkit | ${COUNTDOWN_NAME} countdown not found`);
  }

  const progress = opportunityProgress(entry);
  const start = Math.max(0, Number(progress?.start ?? COUNTDOWN_START));
  const current = Math.max(0, Number(progress?.current ?? 0));
  const requested = Number(nextValue);

  if (!Number.isFinite(requested)) {
    throw new TypeError("Campaign Toolkit | Opportunity value must be a finite number");
  }

  const value = Math.max(0, Math.min(start, Math.trunc(requested)));
  if (value === current) return current;

  const source = countdownSource(setting);
  const stored = source.countdowns?.[entry.id];
  if (!stored) {
    throw new Error(`Campaign Toolkit | ${COUNTDOWN_NAME} source data not found`);
  }

  stored.progress ??= {};
  stored.progress.current = value;

  await game.settings.set(CONFIG.DH.id, countdownSettingKey(), source);

  // The World setting is authoritative. Re-render Foundryborne's countdown
  // application only when it is already present; no DOM interaction is needed.
  try {
    if (globalThis.ui?.countdowns?.rendered) {
      await globalThis.ui.countdowns.render({ force: true });
    }
  } catch (error) {
    console.warn("Campaign Toolkit | Opportunity updated but countdown UI refresh failed", error);
  }

  return getOpportunityValue();
}

export async function setOpportunity(value) {
  return writeOpportunityValue(value);
}

export async function increaseOpportunity(amount = 1) {
  const steps = normalizeAmount(amount);
  return writeOpportunityValue(getOpportunityValue() + steps);
}

export async function decreaseOpportunity(amount = 1) {
  const steps = normalizeAmount(amount);
  return writeOpportunityValue(getOpportunityValue() - steps);
}

export async function clearOpportunity() {
  return writeOpportunityValue(0);
}

export function opportunityBootstrapStatus() {
  const stored = findStoredOpportunity();
  return Object.freeze({
    green: Boolean(stored),
    id: stored?.id ?? null,
    canonicalId: COUNTDOWN_ID,
    name: stored?.countdown?.name ?? COUNTDOWN_NAME,
    value: Number(stored?.countdown?.progress?.current ?? 0),
    start: Number(stored?.countdown?.progress?.start ?? COUNTDOWN_START),
    legacy: Boolean(stored && stored.id !== COUNTDOWN_ID),
  });
}

export const engagementOpportunityApi = Object.freeze({
  countdownName: COUNTDOWN_NAME,
  countdownId: COUNTDOWN_ID,
  ensure: ensureOpportunityCountdown,
  status: opportunityBootstrapStatus,
  getOpportunityCountdown,
  getOpportunityValue,
  setOpportunity,
  increaseOpportunity,
  decreaseOpportunity,
  clearOpportunity,
});

// World portability bootstrap. Only the active GM writes the world setting.
// Existing prototype worlds are preserved by recognizing a legacy countdown
// named "Opportunity"; fresh worlds receive the stable Toolkit id.
Hooks.once("ready", async () => {
  if (!game.user?.isGM) return;

  try {
    await ensureOpportunityCountdown();
  } catch (error) {
    console.error("Campaign Toolkit | Opportunity countdown bootstrap failed", error);
  }
});
