// probes/copilot-t3/budget.js
// The request budget of trial stage T3 (spec 2026-11-10-copilot-return-design.md, section 7): 10 requests for the stage, and no
// stage that would take the month past 150. Every `copilot -p` run is reserved before it starts, so the stage stops before it
// goes over, never after.

export const STAGE_BUDGET = 10;
export const MONTH_CEILING = 150;

export class BudgetStop extends Error {
  constructor(message) {
    super(message);
    this.name = 'BudgetStop';
  }
}

const isCount = (n) => Number.isFinite(n) && n >= 0;

// `monthUsed` is the month's use before the stage (null when it can't be read, which is refused: a stage that can't see the month
// doesn't start). A run's use is the CLI's count, cumulative for a session across resumes, so each run is settled as the rise
// since the session's last figure. A run that leaves no figure (killed before its usage file was written) counts as one request,
// the least a started run costs, and the entry says so.
export function makeBudget({ limit = STAGE_BUDGET, monthUsed, ceiling = MONTH_CEILING } = {}) {
  if (!isCount(monthUsed)) throw new BudgetStop("The month's use can't be read, so the stage doesn't start");
  const steps = [];
  const last = new Map();
  let used = 0;
  let open = null;

  const budget = {
    get used() { return used; },
    get steps() { return steps.map((s) => ({ ...s })); },
    remaining: () => limit - used,
    // Before a run: refuses when one more request would pass the stage's budget or the month's ceiling.
    reserve(step, { worst = 1 } = {}) {
      if (open !== null) throw new Error(`${open} has not been settled`);
      if (used + worst > limit) throw new BudgetStop(`${step} would take the stage to ${used + worst} of its ${limit} requests`);
      if (monthUsed + used + worst > ceiling) throw new BudgetStop(`${step} would take the month to ${monthUsed + used + worst} of ${ceiling}`);
      open = step;
    },
    // After a run: `cumulative` is the session's figure as the CLI reports it, or null when none was left.
    settle(step, { session, cumulative = null }) {
      if (open !== step) throw new Error(`${step} was not reserved`);
      open = null;
      const before = last.get(session) ?? 0;
      const known = isCount(cumulative);
      const requests = known ? Math.max(0, cumulative - before) : 1;
      // The session's figure is cumulative, so a run counted as one without a figure is already inside the next run's figure.
      last.set(session, known ? cumulative : before + 1);
      used += requests;
      steps.push({ step, session, requests, assumed: !known, total: used });
      return requests;
    },
    // A resumed stage: the steps an earlier attempt settled, and the session's last figure.
    restore(done) {
      for (const s of done) {
        steps.push({ ...s });
        used += s.requests;
        if (s.session !== undefined) last.set(s.session, (last.get(s.session) ?? 0) + s.requests);
      }
    },
    // A run that was reserved and never started.
    release(step) {
      if (open === step) open = null;
    },
  };
  return budget;
}
