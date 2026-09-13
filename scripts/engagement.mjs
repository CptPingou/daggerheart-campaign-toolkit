export const ENGAGEMENT_CONTRACT = Object.freeze({
  minimumHunters: 2,
  openerHopeCost: 2,
  finisherHopeCost: 1,
  openerSuccessOpportunity: 2,
  openerFailureOpportunity: 1,
  finisherConsumesAllOpportunity: true,
  support: Object.freeze({
    optional: true,
    hopeCost: 1,
    modes: Object.freeze({
      defensive: Object.freeze({
        timing: "monster reaction against Opener",
        modifier: "-1d4",
        appliesTo: "monster attack roll against Opener",
      }),
      offensive: Object.freeze({
        timing: "Finisher attack",
        modifier: "+1d6",
        appliesTo: "Finisher attack roll",
      }),
    }),
    maximumGenericInterventionsPerWindow: 1,
  }),
  automationScope: Object.freeze({
    opportunityCountdown: true,
    openerOutcome: true,
    finisherConsumption: true,
    supportReminderOnly: false,
    hopeSpending: true,
    supportHopeSpending: true,
    finisherDesignation: false,
    distinctHunterEnforcement: false,
    monsterReactions: false,
    damageConversion: false,
  }),
});

export function createEngagementApi({
  opportunity,
  opener,
  finisher,
  support,
}) {
  if (!opportunity || !opener || !finisher || !support) {
    throw new TypeError("Campaign Toolkit | Engagement requires Opportunity, Opener, Finisher and Support APIs");
  }

  function snapshot() {
    return Object.freeze({
      opportunity: opportunity.getOpportunityValue(),
      countdownName: opportunity.countdownName,
      contract: ENGAGEMENT_CONTRACT,
      reminders: Object.freeze({
        opener: opener.reminder,
        finisher: finisher.reminder,
        support: support.reminder,
      }),
    });
  }

  async function reset() {
    const before = opportunity.getOpportunityValue();
    const after = await opportunity.clearOpportunity();
    const result = Object.freeze({
      before,
      after,
      cleared: before - after,
    });
    console.info(`Campaign Toolkit | Engagement reset (${before} → ${after})`, result);
    return result;
  }

  function remind() {
    const result = snapshot();
    console.info("Campaign Toolkit | Engagement vertical slice", result);
    globalThis.ui?.notifications?.info?.(
      "Engagement : Opener → Opportunity → fenêtre Support → Finisher.",
    );
    return result;
  }

  return Object.freeze({
    contract: ENGAGEMENT_CONTRACT,
    snapshot,
    reset,
    remind,
    opportunity,
    opener,
    finisher,
    support,
  });
}
