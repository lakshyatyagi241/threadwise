/**
 * The client side of the step budget (the server counts the same calls and is the authority: `HELP_AGENT_STEP_LIMIT`). One step is one
 * model call. Used before every step, so a task that reaches its limit stops by itself and says why.
 */
export class StepBudget {
  private taken = 0;

  constructor(readonly max: number) {
    if (!Number.isInteger(max) || max < 1)
      throw new Error('A step budget needs a whole number of at least 1');
  }

  /** Takes one step. False when the budget is spent (nothing is taken). */
  take(): boolean {
    if (this.taken >= this.max) return false;
    this.taken += 1;
    return true;
  }

  get used(): number {
    return this.taken;
  }

  get exhausted(): boolean {
    return this.taken >= this.max;
  }
}
