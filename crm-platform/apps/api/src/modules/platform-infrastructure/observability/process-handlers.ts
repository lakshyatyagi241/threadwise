import { flushSentry, reportServerError, type ServiceName } from './sentry';

let installed = false;

/** One JSON line to stderr: the logger may be buffered or gone by the time a process is dying, and this is the last word. */
function fatal(service: ServiceName, kind: string, err: unknown): void {
  const e = err instanceof Error ? err : new Error(String(err));
  process.stderr.write(
    `${JSON.stringify({
      level: 60,
      time: Date.now(),
      service,
      msg: `${kind}: process is exiting`,
      err: { type: e.name, message: e.message, stack: e.stack },
    })}\n`,
  );
}

/**
 * The handler for a dying process: log once, tell Sentry, let the report out, exit non-zero. Calling it twice does nothing the
 * second time (an exception while handling an exception must not loop). `exit` is injectable for tests.
 */
export function createFatalHandler(
  service: ServiceName,
  kind: string,
  exit: (code: number) => void,
  state: { dying: boolean } = { dying: false },
): (err: unknown) => void {
  return (err) => {
    if (state.dying) return;
    state.dying = true;
    fatal(service, kind, err);
    reportServerError(err, {});
    void flushSentry(2000).finally(() => exit(1));
  };
}

/**
 * A process that hit an uncaught exception or an unhandled rejection is in an unknown state: log it once, tell Sentry, let the
 * report out, and exit non-zero so the orchestrator restarts it clean (TW-INFRA-018). Node already crashes on both; this makes
 * the last line structured, and gives the report time to leave.
 */
export function installProcessHandlers(service: ServiceName): void {
  if (installed) return;
  installed = true;
  const state = { dying: false };
  const exit = (code: number) => process.exit(code);
  process.on('uncaughtException', createFatalHandler(service, 'uncaught exception', exit, state));
  process.on('unhandledRejection', createFatalHandler(service, 'unhandled rejection', exit, state));
}
