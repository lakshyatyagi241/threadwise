// EXPO_PUBLIC_* values are compiled into the app and readable by anyone who installs it. Fails when a variable with that prefix
// is named like a secret, anywhere in the app's config or source. Run: pnpm --filter @crm/mobile env:check
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SECRETISH =
  /EXPO_PUBLIC_[A-Z0-9_]*(SECRET|PASSWORD|PASSWD|PRIVATE|TOKEN|API_KEY|ACCESS_KEY|CREDENTIAL)[A-Z0-9_]*/g;
// Named like a key but meant to be public (a DSN is write-only; a publishable key is designed to ship in clients).
const OK = /PUBLISHABLE|PUBLIC_KEY|_DSN$/;

const targets = ['.env.example', 'eas.json', 'app.config.ts'];
const walk = (d) =>
  fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(d, e.name);
    return e.isDirectory() ? walk(p) : /\.(ts|tsx|js|json)$/.test(e.name) ? [p] : [];
  });
const files = [
  ...targets.map((t) => path.join(root, t)).filter(fs.existsSync),
  ...walk(path.join(root, 'src')),
];

const problems = [];
for (const file of files) {
  for (const m of fs.readFileSync(file, 'utf8').matchAll(SECRETISH)) {
    if (!OK.test(m[0]))
      problems.push(
        `${path.relative(root, file)}: ${m[0]} looks like a secret but is bundled into the app`,
      );
  }
}
if (problems.length) {
  console.error(problems.join('\n'));
  process.exit(1);
}
console.log(`env: no secret-looking EXPO_PUBLIC_* variables in ${files.length} files`);
