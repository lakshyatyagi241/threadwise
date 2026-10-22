// Entry: bridge + (optional) slow-query watcher in one process. Env: PORT (9095), see watcher.mjs for the SLOW_* settings.
import { startBridge } from './bridge.mjs';
import { startWatcher } from './watcher.mjs';
const b = startBridge();
b.server.listen(Number(process.env.PORT ?? 9095), '0.0.0.0', () => b.log({ evt: 'bridge_listening', port: Number(process.env.PORT ?? 9095) }));
if (process.env.SLOW_WATCHER !== '0') startWatcher({ env: process.env, metrics: b.metrics, send: b.send, log: b.log });
for (const s of ['SIGTERM', 'SIGINT']) process.on(s, () => b.server.close(() => process.exit(0)));
