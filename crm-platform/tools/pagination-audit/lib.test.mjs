import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  capOfSchema,
  checkRegister,
  maxPageOf,
  offsetSites,
  queryRoutesOf,
  schemasOf,
  styleOfSchema,
} from './lib.mjs';

test('the style of a schema is read from its keys', () => {
  assert.equal(styleOfSchema('{ limit: z.number(), cursor: z.string() }'), 'cursor');
  assert.equal(styleOfSchema('{ page: z.coerce.number().min(1) }'), 'page');
  assert.equal(styleOfSchema('{ limit: z.number(), offset: z.number() }'), 'offset');
  assert.equal(styleOfSchema('{ limit: z.number() }'), 'limit-only');
  assert.equal(styleOfSchema('{ q: z.string() }'), 'none');
});

test('a size cap is found over several lines, through a constant, or as a clamp; no max is null; no size key is undefined', () => {
  assert.equal(
    capOfSchema(
      '{\n  limit: z.coerce\n    .number()\n    .max(MAX_LIMIT)\n    .default(20),\n  cursor: z.string()\n}',
    ),
    'MAX_LIMIT',
  );
  assert.equal(
    capOfSchema('{\n  limit: z.coerce.number().int().default(20),\n  cursor: z.string()\n}'),
    null,
  );
  assert.equal(
    capOfSchema(
      '{\n  limit: z.coerce.number().transform((n) => Math.min(MAX, n)),\n  before: z.string()\n}',
    ),
    'clamped',
  );
  assert.equal(capOfSchema('{\n  page: z.number(),\n  q: z.string()\n}'), undefined);
  assert.equal(capOfSchema('{ cursor: z.string() } paginationQuerySchema'), '200');
});

test('a page number with no max is reported, one with a max or a named constant is not, an id named page is not a number', () => {
  assert.equal(
    maxPageOf('{\n  page: z.coerce.number().int().min(1).default(1),\n  q: z.string()\n}'),
    null,
  );
  assert.equal(
    maxPageOf('{\n  page: z.coerce.number().int().max(100_000).default(1),\n  q: z.string()\n}'),
    '100_000',
  );
  assert.equal(
    maxPageOf('{\n  q: z.string(),\n  page: pageSchema,\n}', { pageSchema: 'z.number().max(500)' }),
    '500',
  );
  assert.equal(maxPageOf('{\n  page: uuidSchema.optional(),\n}'), undefined);
});

test('OFFSET in SQL and Drizzle is found; a comment is not', () => {
  const src =
    'const a = sql`SELECT 1 LIMIT ${n} OFFSET ${o}`;\n// OFFSET ${x}\nawait db.select().from(t).offset(10);\n';
  assert.deepEqual(
    offsetSites(src).map((s) => s.line),
    [1, 3],
  );
});

test('a controller query schema is tied to its handler', () => {
  const src =
    "@Get('items')\n  async list(@Query(zodPipe(listItemsQuerySchema)) q: X) {}\n  @Get(':id')\n  async one(@Param('id') id: string) {}";
  assert.deepEqual(
    queryRoutesOf(src).map((r) => r.schema),
    ['listItemsQuerySchema'],
  );
  assert.deepEqual(
    Object.keys(schemasOf('export const aSchema = z.object({ page: z.number() });')),
    ['aSchema'],
  );
});

test('the register: a new site with no decision is High, a decision with fewer sites than found is High, a gone site is Medium', () => {
  const reg = [
    { file: 'a.ts', sites: 1, status: 'accepted', reason: 'r', owner: 'o' },
    { file: 'gone.ts', sites: 1, status: 'accepted', reason: 'r', owner: 'o' },
  ];
  const f = checkRegister({
    sites: [{ file: 'a.ts' }, { file: 'a.ts' }, { file: 'new.ts' }],
    register: reg,
  });
  assert.equal(f.filter((x) => x.severity === 'High').length, 2);
  assert.equal(f.filter((x) => x.severity === 'Medium').length, 1);
});
