// Entry: bridge + (optional) slow-query watcher + incident resolver in one process. Env: PORT (9095), see watcher.mjs / resolver.mjs.
import { startBridge } from './bridge.mjs';
import { startWatcher } from './watcher.mjs';
import { createResolver } from './resolver.mjs';
let watcherDb = {}, offenders = () => [];
const b = startBridge({ resolverFactory: ({ post, promQuery, metrics }) => createResolver({ env: process.env, post, promQuery, metrics, log: (o) => console.log(JSON.stringify({ t: new Date().toISOString(), ...o })), db: new Proxy({}, { get: (_, k) => watcherDb[k] }), offenders: () => offenders() }) });
b.server.listen(Number(process.env.PORT ?? 9095), '0.0.0.0', () => b.log({ evt: 'bridge_listening', port: Number(process.env.PORT ?? 9095), auto_remediate: b.resolver.mode }));
if (process.env.SLOW_WATCHER !== '0') startWatcher({ env: process.env, metrics: b.metrics, send: b.send, log: b.log, resolverFactory: ({ db, offenders: o }) => { watcherDb = db; offenders = o; return b.resolver; } });
for (const s of ['SIGTERM', 'SIGINT']) process.on(s, () => b.server.close(() => process.exit(0)));
