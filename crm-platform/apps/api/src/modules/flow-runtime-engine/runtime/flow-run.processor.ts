import { Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { UnrecoverableError, type Job } from 'bullmq';
import { RequestContextStore } from '../../../common/context/request-context';
import { AppError } from '../../../common/errors/app-error';
import { QUEUES } from '../../../infra/queue/queues';
import { FlowEngine } from './engine.service';
import type { FlowRunJob } from './flow-run.publisher';

/**
 * Does one step of a run per job (TW-FLR-015, 016). Registered only in the worker process (FlowRuntimeWorkerModule, imported by
 * WorkersModule): the HTTP app never picks up a job. Concurrency is plain parallelism; two jobs for one run cannot both write,
 * because the step number is compared and set in the same statement.
 */
@Processor(QUEUES.FLOW_RUN, { concurrency: 8 })
export class FlowRunProcessor extends WorkerHost {
  private readonly logger = new Logger(FlowRunProcessor.name);

  constructor(private readonly engine: FlowEngine) {
    super();
  }

  async process(job: Job<FlowRunJob>): Promise<string> {
    const { orgId, runId, seq } = job.data;
    return RequestContextStore.run(
      { requestId: `flr-${runId}-${seq}`, orgId, actorType: 'system', actorId: null, userId: null },
      async () => {
        try {
          return await this.engine.advance(orgId, runId, seq);
        } catch (err) {
          // A rule the data broke will break again; anything else (database, network, Redis) retries with backoff.
          if (err instanceof AppError) throw new UnrecoverableError(err.message);
          this.logger.error({ orgId, runId, seq, err }, '[FLR] step crashed');
          throw err;
        }
      },
    );
  }
}
