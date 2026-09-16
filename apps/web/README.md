# apps/web — staff CRM (Next.js App Router)

**Slot, not yet populated.** Your existing Next.js app moves in here.

## How to move it in

```bash
# from the repo root
cp -R /path/to/your/next-app/. apps/web/
rm -rf apps/web/node_modules apps/web/.next apps/web/.git
pnpm install
```

Then, in `apps/web/package.json`:

```jsonc
{
  "name": "@crm/web",
  "dependencies": {
    "@crm/contracts": "workspace:*", // shared zod schemas + types
  },
}
```

pnpm picks the directory up automatically — `apps/*` is already in
`pnpm-workspace.yaml`. Nothing else needs changing.

## Talking to the API

Import types from the contracts package instead of redeclaring them. That is
the entire reason the package exists: a field renamed in the API becomes a
TypeScript error here, in the same commit, rather than a runtime `undefined` in
production.

```ts
import { contactResponseSchema, type ContactResponse } from '@crm/contracts';

const res = await fetch(`${API_URL}/v1/contacts`, {
  headers: { Authorization: `Bearer ${accessToken}` },
});
// Parse at the boundary — the server is a different deployable and can be
// older than this build.
const page = await res.json();
const contacts: ContactResponse[] = page.data.map((row: unknown) =>
  contactResponseSchema.parse(row),
);
```

## Conventions this app must follow

| Rule                                  | Why                                                           |
| ------------------------------------- | ------------------------------------------------------------- |
| Identifiers are uuids                 | The API never emits internal bigint ids                       |
| Lists paginate by cursor              | `?limit=50&cursor=...`; there is no page number               |
| Errors are `application/problem+json` | Switch on `code`, never on `title`                            |
| Send `Idempotency-Key` on mutations   | A retried POST must not double-charge or double-send          |
| Send `X-Request-Id`                   | It comes back on the response and is in every server log line |

## Environment

```
NEXT_PUBLIC_API_URL=http://localhost:3000
NEXT_PUBLIC_REALTIME_URL=http://localhost:3000/realtime
```

## Realtime

Socket.IO, namespace `/realtime`, authenticated with the same access token:

```ts
io(`${process.env.NEXT_PUBLIC_REALTIME_URL}`, { auth: { token: accessToken } });
```

Rooms are joined server-side. A client cannot join an arbitrary conversation
room by asking — that check lives in the gateway.
