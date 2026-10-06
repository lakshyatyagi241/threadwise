import { describe, expect, it } from 'vitest';
import {
  brandFromTitle,
  buildCurl,
  buildReference,
  endpointMatches,
  filterReference,
  locate,
  pickBody,
  resolveRef,
  sampleFor,
  typeOf,
} from './spec-model';

const ORIGIN = 'https://api.example.com';

const spec = {
  openapi: '3.0.0',
  info: { title: 'Acme API', version: 'v1' },
  tags: [
    { name: 'Message', description: 'Send messages.\n\nInternal note that must not show.' },
    { name: 'Contact', description: 'The address book.' },
    { name: 'Empty', description: 'No operations here.' },
  ],
  paths: {
    '/api/v1/contacts': {
      get: {
        tags: ['Contact'],
        summary: 'List contacts',
        parameters: [
          {
            name: 'limit',
            in: 'query',
            required: false,
            schema: { type: 'integer', description: 'Page size' },
          },
          { $ref: '#/components/parameters/Cursor' },
        ],
        responses: {
          '200': {
            description: 'OK',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/ContactList' } },
            },
          },
          '401': { description: 'Unauthenticated' },
        },
      },
      post: {
        tags: ['Contact'],
        summary: 'Create a contact',
        requestBody: {
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/ContactInput' } },
          },
        },
        responses: {
          '201': {
            description: 'Created',
            content: { 'application/json': { example: { data: { id: 'x' } } } },
          },
        },
      },
    },
    '/api/v1/messages': {
      post: {
        tags: ['Message'],
        summary: 'Send a message',
        description: 'Sends one message.',
        requestBody: {
          content: {
            'multipart/form-data': {
              schema: {
                type: 'object',
                required: ['to'],
                properties: {
                  to: { type: 'string' },
                  file: { type: 'string', format: 'binary' },
                },
              },
            },
          },
        },
        responses: {},
      },
    },
    '/api/v1/weird': { get: { summary: 'No tag', responses: {} } },
    '/api/v1/zebra': { get: { tags: ['Zeta'], summary: 'Unlisted tag', responses: {} } },
    '/api/v1/alpha': { get: { tags: ['Alpha'], summary: 'Another unlisted tag', responses: {} } },
  },
  components: {
    parameters: {
      Cursor: {
        name: 'cursor',
        in: 'query',
        required: false,
        schema: { type: 'string' },
        description: 'Opaque cursor',
      },
    },
    schemas: {
      ContactInput: {
        type: 'object',
        required: ['name'],
        properties: {
          name: { type: 'string', description: 'Full name' },
          email: { type: 'string', format: 'email' },
          status: { type: 'string', enum: ['lead', 'customer'] },
          tags: { type: 'array', items: { type: 'string' } },
        },
      },
      ContactList: {
        type: 'object',
        properties: {
          data: { type: 'array', items: { $ref: '#/components/schemas/Contact' } },
          meta: { type: 'object', properties: { next_cursor: { type: 'string' } } },
        },
      },
      Contact: {
        allOf: [
          { $ref: '#/components/schemas/Base' },
          { type: 'object', properties: { name: { type: 'string' } } },
        ],
      },
      Base: { type: 'object', properties: { id: { type: 'string', format: 'uuid' } } },
      Loop: { type: 'object', properties: { self: { $ref: '#/components/schemas/Loop' } } },
    },
  },
};

describe('resolveRef', () => {
  it('follows a local pointer and returns the node itself when it has none', () => {
    expect(resolveRef({ $ref: '#/components/schemas/Base' }, spec)).toMatchObject({
      type: 'object',
    });
    expect(resolveRef({ type: 'string' }, spec)).toEqual({ type: 'string' });
  });
  it('gives an empty schema for a missing, external or looping pointer', () => {
    expect(resolveRef({ $ref: '#/components/schemas/Nope' }, spec)).toEqual({});
    expect(resolveRef({ $ref: 'https://evil.example/schema.json' }, spec)).toEqual({});
    const loop = { a: { $ref: '#/a' } };
    expect(resolveRef({ $ref: '#/a' }, loop)).toEqual({});
    expect(resolveRef(null, spec)).toEqual({});
  });
});

describe('buildReference', () => {
  const ref = buildReference(spec, ORIGIN);

  it('orders groups as the document lists its tags, then unlisted tags alphabetically, then General', () => {
    expect(ref.groups.map((g) => g.tag)).toEqual([
      'Message',
      'Contact',
      'Alpha',
      'Zeta',
      'General',
    ]);
  });

  it('drops a listed tag that has no operation, and counts the endpoints', () => {
    expect(ref.groups.map((g) => g.tag)).not.toContain('Empty');
    expect(ref.endpointCount).toBe(6);
  });

  it('shows only the first paragraph of a tag overview', () => {
    expect(ref.groups[0]!.description).toBe('Send messages.');
  });

  it("lists a path's verbs create-first and splits the /api/v1 prefix off the path", () => {
    const contact = ref.groups[1]!.endpoints;
    expect(contact.map((e) => e.method)).toEqual(['post', 'get']);
    expect(contact[0]).toMatchObject({
      prefix: '/api/v1',
      shortPath: '/contacts',
      url: 'https://api.example.com/api/v1/contacts',
    });
  });

  it('merges path-level and operation parameters, resolving $ref', () => {
    const list = ref.groups[1]!.endpoints.find((e) => e.method === 'get')!;
    expect(list.params).toEqual([
      { name: 'limit', place: 'query', type: 'integer', required: false, description: 'Page size' },
      {
        name: 'cursor',
        place: 'query',
        type: 'string',
        required: false,
        description: 'Opaque cursor',
      },
    ]);
  });

  it('lists body fields with required flags, types and enum hints', () => {
    const create = ref.groups[1]!.endpoints.find((e) => e.method === 'post')!;
    expect(create.bodyType).toBe('application/json');
    expect(create.bodyFields).toEqual([
      { name: 'name', type: 'string', required: true, description: 'Full name' },
      { name: 'email', type: 'string (email)', required: false, description: '' },
      { name: 'status', type: 'string', required: false, description: ' (lead, customer)'.trim() },
      { name: 'tags', type: 'array<string>', required: false, description: '' },
    ]);
  });

  it('takes a response example from the document, else builds one from the schema (allOf flattened), else none', () => {
    const create = ref.groups[1]!.endpoints.find((e) => e.method === 'post')!;
    expect(create.responses[0]).toMatchObject({
      code: '201',
      example: { data: { id: 'x' } },
      hasExample: true,
    });
    const list = ref.groups[1]!.endpoints.find((e) => e.method === 'get')!;
    expect(list.responses.find((r) => r.code === '200')!.example).toEqual({
      data: [{ id: '0192f1c4-7a52-7d3e-9c1b-3f4a5b6c7d8e', name: 'Acme Corp' }],
      meta: { next_cursor: 'string' },
    });
    expect(list.responses.find((r) => r.code === '401')).toMatchObject({
      hasExample: false,
      description: 'Unauthenticated',
    });
  });

  it('puts an operation without a tag in General and gives each endpoint a stable anchor id', () => {
    const general = ref.groups.at(-1)!;
    expect(general.endpoints[0]!.id).toBe('op-get-api-v1-weird');
    expect(general.id).toBe('grp-general');
  });

  it('copes with a document that is not an object or has no paths', () => {
    for (const bad of [null, 'x', 5, [], {}, { paths: 5 }, { paths: { '/x': 'nope' } }]) {
      expect(buildReference(bad, ORIGIN)).toMatchObject({ groups: [], endpointCount: 0 });
    }
  });

  it('uses the base URL for a path that does not carry /api/v1', () => {
    const r = buildReference({ paths: { '/ping': { get: { responses: {} } } } }, `${ORIGIN}/`);
    expect(r.groups[0]!.endpoints[0]).toMatchObject({
      prefix: '',
      shortPath: '/ping',
      url: 'https://api.example.com/api/v1/ping',
    });
  });

  it('ignores methods it does not document', () => {
    const r = buildReference(
      { paths: { '/x': { options: { responses: {} }, head: {}, get: { responses: {} } } } },
      ORIGIN,
    );
    expect(r.endpointCount).toBe(1);
  });
});

describe('buildCurl', () => {
  const ref = buildReference(spec, ORIGIN);
  const find = (m: string, p: string) =>
    ref.groups.flatMap((g) => g.endpoints).find((e) => e.method === m && e.path === p)!;

  it('puts the bearer header and the base-URL address in a GET with no body', () => {
    expect(find('get', '/api/v1/contacts').curl).toBe(
      [
        "curl -X GET 'https://api.example.com/api/v1/contacts' \\",
        "  -H 'Authorization: Bearer YOUR_API_KEY'",
      ].join('\n'),
    );
  });

  it('sends a JSON body with -d', () => {
    const curl = find('post', '/api/v1/contacts').curl;
    expect(curl).toContain("-H 'Content-Type: application/json' \\");
    expect(curl).toContain(
      `-d '{"name":"Acme Corp","email":"jane@example.com","status":"lead","tags":["string"]}'`,
    );
    expect(curl.endsWith("'")).toBe(true);
    expect(curl).not.toMatch(/\\$/);
  });

  it('sends multipart with -F, a file as @path, and no Content-Type header', () => {
    const curl = find('post', '/api/v1/messages').curl;
    expect(curl).toContain("-F 'to=919812345678' \\");
    expect(curl).toContain("-F 'file=@/path/to/file'");
    expect(curl).not.toContain('Content-Type');
  });

  it('escapes a single quote in the body for the shell', () => {
    const curl = buildCurl({
      method: 'post',
      url: `${ORIGIN}/x`,
      bodyType: 'application/json',
      bodyExample: { text: "it's" },
      bodySchema: null,
      spec,
    });
    expect(curl).toContain(`-d '{"text":"it'\\''s"}'`);
  });

  it('sends a url-encoded form with -d', () => {
    const curl = buildCurl({
      method: 'post',
      url: `${ORIGIN}/x`,
      bodyType: 'application/x-www-form-urlencoded',
      bodyExample: { a: '1', b: 'two words' },
      bodySchema: null,
      spec,
    });
    expect(curl).toContain("-d 'a=1&b=two+words'");
  });
});

describe('sampleFor and typeOf', () => {
  it('prefers an example, a default, then the first enum value', () => {
    expect(sampleFor({ type: 'string', example: 'x', default: 'y' }, spec)).toBe('x');
    expect(sampleFor({ type: 'string', default: 'y' }, spec)).toBe('y');
    expect(sampleFor({ type: 'string', enum: ['a', 'b'] }, spec)).toBe('a');
  });
  it('stops on a self-referencing schema instead of looping', () => {
    const v = sampleFor({ $ref: '#/components/schemas/Loop' }, spec) as Record<string, unknown>;
    expect(v).toHaveProperty('self');
  });
  it("builds an array of one item and uses oneOf's first branch", () => {
    expect(sampleFor({ type: 'array', items: { type: 'integer' } }, spec)).toEqual([1]);
    expect(sampleFor({ oneOf: [{ type: 'boolean' }, { type: 'string' }] }, spec)).toBe(true);
  });
  it('names the type of nested and nullable schemas', () => {
    expect(typeOf({ type: ['null', 'integer'] }, spec)).toBe('integer');
    expect(
      typeOf({ type: 'array', items: { type: 'array', items: { type: 'string' } } }, spec),
    ).toBe('array<array<string>>');
    expect(typeOf({}, spec)).toBe('string');
  });
});

describe('pickBody', () => {
  it('prefers JSON, then multipart, then anything else, and reports none without content', () => {
    const both = {
      content: {
        'multipart/form-data': { schema: {} },
        'application/json': { schema: { type: 'object' } },
      },
    };
    expect(pickBody(both, spec).type).toBe('application/json');
    expect(pickBody({ content: { 'text/plain': {} } }, spec).type).toBe('text/plain');
    expect(pickBody(undefined, spec)).toEqual({ type: null, schema: null, example: undefined });
  });
  it('reads an example from `examples`', () => {
    const b = pickBody(
      { content: { 'application/json': { schema: {}, examples: { one: { value: { a: 1 } } } } } },
      spec,
    );
    expect(b.example).toEqual({ a: 1 });
  });
});

describe('filter', () => {
  const ref = buildReference(spec, ORIGIN);
  const all = ref.groups.flatMap((g) => g.endpoints);

  it('matches every word against method, path, summary and group', () => {
    const create = all.find((e) => e.summary === 'Create a contact')!;
    expect(endpointMatches(create, 'post contacts')).toBe(true);
    expect(endpointMatches(create, 'CONTACT create')).toBe(true);
    expect(endpointMatches(create, 'delete')).toBe(false);
    expect(endpointMatches(create, '   ')).toBe(true);
  });

  it('drops groups with no match left and counts what remains', () => {
    const f = filterReference(ref, 'send');
    expect(f.groups.map((g) => g.tag)).toEqual(['Message']);
    expect(f.endpointCount).toBe(1);
    expect(filterReference(ref, 'zzz-nothing').groups).toEqual([]);
  });

  it('returns the same reference for an empty query', () => {
    expect(filterReference(ref, '  ')).toBe(ref);
  });
});

describe('locate and brandFromTitle', () => {
  it('locates a path under /api/v1 on the origin and any other path under the base URL', () => {
    expect(locate('/api/v1/me', 'https://a.test/', 'https://a.test/api/v1')).toEqual({
      prefix: '/api/v1',
      shortPath: '/me',
      url: 'https://a.test/api/v1/me',
    });
    expect(locate('/api/v1', 'https://a.test', 'https://a.test/api/v1').shortPath).toBe('/');
    expect(locate('/api/v10/x', 'https://a.test', 'https://a.test/api/v1').prefix).toBe('');
  });
  it('takes the brand out of "<brand> API"', () => {
    expect(brandFromTitle('Acme Corp API')).toBe('Acme Corp');
    expect(brandFromTitle('')).toBe('');
  });
});
