import { describe, expect, it } from 'vitest';
import { readWabaEnv } from '../../../src/config/domains/whatsapp-cloud-api-waba.env';
import { toComplianceDto } from '../../../src/modules/whatsapp-cloud-api-waba/waba-compliance.mapper';
import type { WabaConnection } from '../../../src/infra/providers/whatsapp-cloud-api-waba/waba-admin.port';
import { WabaAdminClient } from '../../../src/infra/providers/whatsapp-cloud-api-waba/waba-admin.client';
import {
  WabaHttp,
  type FetchLike,
} from '../../../src/infra/providers/whatsapp-cloud-api-waba/waba-http';

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  json: Record<string, unknown> | undefined;
  body: unknown;
}

function setup(replies: Array<[number, unknown]>, env = readWabaEnv({ META_APP_ID: 'app1' })) {
  const calls: Call[] = [];
  const http = new WabaHttp(env);
  const impl: FetchLike = async (url, init) => {
    calls.push({
      url,
      method: String(init?.method),
      headers: Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>)),
      json: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
      body: init?.body,
    });
    const [status, body] = replies[Math.min(calls.length - 1, replies.length - 1)]!;
    return new Response(JSON.stringify(body), { status });
  };
  http.fetchImpl = impl;
  return { calls, admin: new WabaAdminClient(env, http) };
}

const meta: WabaConnection = {
  provider: 'meta',
  wabaId: '111',
  phoneNumberId: '222',
  accessToken: 'tok',
};

const empty = {
  entityName: null,
  entityType: null,
  entityTypeCustom: null,
  isRegistered: null,
  customerCare: { email: null, mobileNumber: null, landlineNumber: null },
  grievanceOfficer: { name: null, email: null, mobileNumber: null, landlineNumber: null },
};

describe('profile picture upload', () => {
  it('sends the picture as a Meta upload session and returns the handle', async () => {
    const { calls, admin } = setup([
      [200, { id: 'upload:abc' }],
      [200, { h: '4::logo' }],
    ]);
    const handle = await admin.uploadProfilePicture(meta, {
      bytes: new Uint8Array([1, 2, 3]),
      fileName: 'logo.png',
      mimeType: 'image/png',
    });
    expect(handle).toBe('4::logo');
    expect(calls[0]!.url).toContain('/app1/uploads?file_name=logo.png&file_length=3');
    expect(calls[0]!.headers.authorization).toBe('OAuth tok');
    expect(calls[1]!.url).toContain('/upload:abc');
  });

  it('refuses when the platform app id is not configured', async () => {
    const { admin } = setup([[200, {}]], readWabaEnv({}));
    await expect(
      admin.uploadProfilePicture(meta, {
        bytes: new Uint8Array([1]),
        fileName: 'logo.png',
        mimeType: 'image/png',
      }),
    ).rejects.toThrow(/META_APP_ID/);
  });
});

describe('business compliance record', () => {
  it("reads Meta's entity type value as it is", async () => {
    const { calls, admin } = setup([
      [
        200,
        {
          data: [
            {
              entity_name: 'Acme Pvt Ltd',
              entity_type: 'PRIVATE_COMPANY',
              customer_care_details: { email: 'care@acme.example', mobile_number: '+919876543210' },
              grievance_officer_details: { name: 'Asha Rao', landline_number: '+911204567890' },
            },
          ],
        },
      ],
    ]);
    const info = await admin.getBusinessComplianceInfo(meta);
    expect(calls[0]!.method).toBe('GET');
    expect(calls[0]!.url).toContain('/222/business_compliance_info');
    expect(info.entityType).toBe('PRIVATE_COMPANY');
    expect(info.customerCare).toEqual({
      email: 'care@acme.example',
      mobileNumber: '+919876543210',
      landlineNumber: null,
    });
    expect(info.grievanceOfficer.landlineNumber).toBe('+911204567890');
  });

  it("maps the form wording back to Meta's value when a record holds the label", async () => {
    const { admin } = setup([[200, { data: [{ entity_type: 'Limited liability partnership' }] }]]);
    expect((await admin.getBusinessComplianceInfo(meta)).entityType).toBe(
      'LIMITED_LIABILITY_PARTNERSHIP',
    );
  });

  it('reads as empty when Meta has no record yet', async () => {
    const { admin } = setup([[200, { data: [] }]]);
    expect(await admin.getBusinessComplianceInfo(meta)).toEqual(empty);
  });

  it('sends the custom type only for Other, and the registration answer only where asked', async () => {
    const contacts = {
      customerCare: { email: 'care@acme.example', mobileNumber: '', landlineNumber: '' },
      grievanceOfficer: {
        name: 'Asha Rao',
        email: '',
        mobileNumber: '',
        landlineNumber: '+911204567890',
      },
    };
    const { calls, admin } = setup([[200, { success: true }]]);
    await admin.updateBusinessComplianceInfo(meta, {
      ...empty,
      entityName: 'Acme',
      entityType: 'OTHER',
      entityTypeCustom: 'Trust',
      isRegistered: false,
      ...contacts,
    });
    expect(calls[0]!.method).toBe('POST');
    expect(calls[0]!.url).toContain('/222/business_compliance_info');
    expect(calls[0]!.json).toEqual({
      messaging_product: 'whatsapp',
      entity_name: 'Acme',
      entity_type: 'OTHER',
      entity_type_custom: 'Trust',
      is_registered: false,
      customer_care_details: { email: 'care@acme.example', mobile_number: '', landline_number: '' },
      grievance_officer_details: {
        name: 'Asha Rao',
        email: '',
        mobile_number: '',
        landline_number: '+911204567890',
      },
    });

    const sole = setup([[200, { success: true }]]);
    await sole.admin.updateBusinessComplianceInfo(meta, {
      ...empty,
      entityName: 'Asha Rao Tailoring',
      entityType: 'SOLE_PROPRIETORSHIP',
      entityTypeCustom: 'ignored',
      isRegistered: null,
      ...contacts,
    });
    expect(sole.calls[0]!.json).not.toHaveProperty('is_registered');
    expect(sole.calls[0]!.json).not.toHaveProperty('entity_type_custom');
  });
});

describe('compliance record as the API returns it', () => {
  it('shows an entity type this app does not know as empty', () => {
    const dto = toComplianceDto({ ...empty, entityType: 'NEW_KIND' });
    expect(dto.entityType).toBeNull();
  });

  it("renames the contact sides to the form's names", () => {
    const dto = toComplianceDto({
      ...empty,
      customerCare: { email: 'a@b.co', mobileNumber: null, landlineNumber: null },
    });
    expect(dto.customerCare).toEqual({ email: 'a@b.co', mobile: null, landline: null });
  });
});
