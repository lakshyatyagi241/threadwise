/** The slice of a BullMQ `Queue<D>` that `addOrRevive` uses. Structural, so it is testable without Redis and keeps the job data type. */
export interface ReviveQueue<D> {
  /** One round trip; `'unknown'` when no job has that id. */
  getJobState(id: string): Promise<string>;
  getJob(id: string): Promise<{ remove(): Promise<unknown> } | undefined>;
  add(name: string, data: D, opts?: { jobId?: string }): Promise<unknown>;
}

/**
 * `queue.add` with a stable job id, for a producer whose provider redelivers the same payload (a webhook, a resumed broadcast).
 *
 * BullMQ ignores an `add` whose id still exists. That is the dedup the id is for, but a job that FAILED is kept for days
 * (`removeOnFail`), so the redelivery was absorbed by the dead job and the producer still answered success: the work stayed undone
 * until someone noticed (ASYNC-018/050). A failed job is removed and the work is queued afresh; a waiting, active, delayed or
 * completed job is left alone.
 *
 * A producer that only re-adds when its own record says nothing is queued (a resumed broadcast) may also replace a `completed` job, which
 * is then stale: pass `replaceStates`. The common case (no job with that id) costs one extra Redis call. Not atomic: a concurrent producer can add between the remove and
 * the add, in which case BullMQ simply ignores the second add.
 */
export async function addOrRevive<D>(
  queue: ReviveQueue<D>,
  name: string,
  data: D,
  { replaceStates = ['failed'], ...opts }: { jobId?: string; replaceStates?: string[] } = {},
): Promise<void> {
  if (opts.jobId !== undefined && replaceStates.includes(await queue.getJobState(opts.jobId))) {
    await (await queue.getJob(opts.jobId))?.remove();
  }
  await queue.add(name, data, opts);
}
