#!/usr/bin/env node
// The limits a compose file gives one service, as JSON: node tools/container-limits/limits-of.mjs <compose-file> <service>
// Reads them with the same parser the resource-limits check uses, so the container test runs with the numbers that ship.
import { readFileSync } from 'node:fs';
import {
  parseCompose,
  serviceCpuLimit,
  serviceMemLimit,
  servicePidsLimit,
} from '../resource-limits/lib.mjs';

const [file, name] = process.argv.slice(2);
const svc = parseCompose(readFileSync(file, 'utf8')).services?.[name];
if (!svc) {
  console.error(`no service ${name} in ${file}`);
  process.exit(2);
}
console.log(
  JSON.stringify({
    memoryBytes: serviceMemLimit(svc),
    cpus: serviceCpuLimit(svc),
    pids: servicePidsLimit(svc),
  }),
);
