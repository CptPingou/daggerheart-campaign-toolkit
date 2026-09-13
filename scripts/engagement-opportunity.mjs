const COUNTDOWN_NAME = "Opportunity";

function countdownsUi() {
  const countdowns = globalThis.ui?.countdowns;
  if (!countdowns) {
    throw new Error("Campaign Toolkit | Foundryborne countdown UI is unavailable");
  }
  return countdowns;
}

function countdownData() {
  return Object.values(countdownsUi().previousCountdownData ?? {});
}

export function getOpportunityCountdown() {
  return countdownData().find((countdown) => countdown?.name === COUNTDOWN_NAME) ?? null;
}

export function getOpportunityValue() {
  const opportunity = getOpportunityCountdown();
  return Number(opportunity?.progress?.current ?? 0);
}

function getOpportunityContainer() {
  const countdowns = countdownsUi();
  const root = countdowns.element;
  if (!root?.querySelectorAll) {
    throw new Error("Campaign Toolkit | Foundryborne countdown DOM is unavailable");
  }

  const containers = [...root.querySelectorAll("[data-countdown]")];
  return containers.find((container) => container.textContent?.includes(COUNTDOWN_NAME)) ?? null;
}

function getCountdownActionButton(action) {
  const container = getOpportunityContainer();
  if (!container) {
    throw new Error(`Campaign Toolkit | ${COUNTDOWN_NAME} countdown not found`);
  }

  const button = container.querySelector(`[data-action='${action}']`);
  if (!button) {
    throw new Error(`Campaign Toolkit | ${COUNTDOWN_NAME} ${action} button not found`);
  }
  return button;
}

function normalizeAmount(amount) {
  const value = Number(amount);
  if (!Number.isInteger(value) || value < 0) {
    throw new TypeError("Campaign Toolkit | Opportunity amount must be a non-negative integer");
  }
  return value;
}

export async function increaseOpportunity(amount = 1) {
  const steps = normalizeAmount(amount);
  if (steps === 0) return getOpportunityValue();

  const countdowns = countdownsUi();
  const button = getCountdownActionButton("increaseCountdown");
  for (let i = 0; i < steps; i += 1) {
    await countdowns.options.actions.increaseCountdown(null, button);
  }
  return getOpportunityValue();
}

export async function decreaseOpportunity(amount = 1) {
  const requested = normalizeAmount(amount);
  const current = getOpportunityValue();
  const steps = Math.min(requested, current);
  if (steps === 0) return current;

  const countdowns = countdownsUi();
  const button = getCountdownActionButton("decreaseCountdown");
  for (let i = 0; i < steps; i += 1) {
    await countdowns.options.actions.decreaseCountdown(null, button);
  }
  return getOpportunityValue();
}

export async function clearOpportunity() {
  return decreaseOpportunity(getOpportunityValue());
}

export const engagementOpportunityApi = Object.freeze({
  countdownName: COUNTDOWN_NAME,
  getOpportunityCountdown,
  getOpportunityValue,
  increaseOpportunity,
  decreaseOpportunity,
  clearOpportunity,
});
