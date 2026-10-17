/** The slice of a BullMQ `Job` that `addOrRevive` uses. */
export interface ReviveJob {
  getState(): Promise<string>;
  remove(): Promise<unknown>;
}

/** The slice of a BullMQ `Queue` that `addOrRevive` uses. Structural, so it is testable without Redis. */
export interface ReviveQueue {
  getJob(id: string): Promise<ReviveJob | undefined>;
  add(name: string, data: never, opts?: never): Promise<unknown>;
}

/**
 * `queue.add` with a stable job id, for a producer whose provider redelivers the same payload (a webhook, a resumed broadcast).
 *
 * BullMQ ignores an `add` whose id still exists. That is the dedup the id is for, but a job that FAILED is kept for days
 * (`removeOnFail`), so the redelivery was absorbed by the dead job and the producer still answered success: the work stayed undone
 * until someone noticed (ASYNC-018/050). A failed job is removed and the work is queued afresh; a waiting, active, delayed or
 * completed job is left alone.
 *
 * Not atomic: a concurrent producer can add between the remove and the add, in which case BullMQ simply ignores the second add.
 */
export async function addOrRevive<Q extends ReviveQueue>(
  queue: Q,
  name: string,
  data: unknown,
  opts: { jobId?: string } & Record<string, unknown>,
): Promise<void> {
  if (opts.jobId !== undefined) {
    const existing = await queue.getJob(opts.jobId);
    if (existing && (await existing.getState()) === 'failed') await existing.remove();
  }
  await queue.add(name, data as never, opts as never);
}
