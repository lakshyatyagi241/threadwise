import { HttpStatus } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { ERROR_CODES, registrationSettingsSchema } from '@crm/contracts';
import { AppError } from '../../../src/common/errors/app-error';
import { SignupService, type SignupData } from '../../../src/modules/auth/flows/signup.service';

/**
 * `create` is the one place an organization is written, for plain, code-verified and social
 * sign-ups. These cover what happens when two sign-ups pick the same address in the same instant
 * (TW-AUTH-008) and how the session is opened (TW-AUTH-004).
 */
const taken = () => new AppError(ERROR_CODES.AUTH_SLUG_TAKEN, 'taken', HttpStatus.CONFLICT);

function make(opts: { provision: (slug: string) => Promise<unknown>; remember?: boolean }) {
  const slugs: string[] = [];
  const completeLogin = vi.fn(async (input: unknown) => ({ status: 'authenticated', input }));
  const svc = new SignupService(
    {
      registration: async () => ({
        ...registrationSettingsSchema.parse({}),
        emailVerification: 'off' as const,
      }),
      policy: async () => ({ rememberMeEnabled: opts.remember ?? true }),
    } as never,
    {} as never,
    {} as never,
    {} as never,
    {
      provisionOrganization: async (input: { slug: string }) => {
        slugs.push(input.slug);
        return opts.provision(input.slug);
      },
    } as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    { completeLogin } as never,
    {} as never,
    {} as never,
    {} as never,
  );
  return { svc, slugs, completeLogin };
}

const created = (slug: string) => ({
  org: { id: 1, uuid: 'o', slug, name: 'Acme' },
  user: { id: 2, uuid: 'u' },
  adminRoleId: 3,
  plan: { planSlug: 'free', trialEndsAt: null },
});

const data = (over: Partial<SignupData> = {}): SignupData => ({
  orgName: 'Acme',
  slug: 'acme',
  slugExplicit: false,
  fullName: 'A Person',
  email: 'a@example.test',
  phoneE164: null,
  passwordHash: 'x',
  referralCode: null,
  ...over,
});

describe('SignupService.create: the address is taken in the same instant', () => {
  it('draws a fresh derived address instead of failing (Reference retries with a random suffix)', async () => {
    let first = true;
    const { svc, slugs, completeLogin } = make({
      provision: async (slug) => {
        if (first) {
          first = false;
          throw taken();
        }
        return created(slug);
      },
    });
    await svc.create(data(), { phoneVerified: false }, {});
    expect(slugs).toHaveLength(2);
    expect(slugs[0]).toBe('acme');
    expect(slugs[1]).toMatch(/^acme-[0-9a-f]{6}$/);
    expect(completeLogin.mock.calls[0]![0]).toMatchObject({ org: { slug: slugs[1] } });
  });

  it('tells the person when the address they typed is taken (the form is still on screen)', async () => {
    const { svc, slugs } = make({
      provision: async () => {
        throw taken();
      },
    });
    const err = await svc
      .create(data({ slug: 'my-co', slugExplicit: true }), { phoneVerified: false }, {})
      .catch((e: unknown) => e as AppError);
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).code).toBe(ERROR_CODES.AUTH_SLUG_TAKEN);
    expect((err as AppError).details).toEqual([{ path: 'orgSlug', message: 'Already taken.' }]);
    expect(slugs).toEqual(['my-co']);
  });

  it('does not strand a person whose one-time code is already spent: a typed address gets a suffix', async () => {
    let first = true;
    const { svc, slugs } = make({
      provision: async (slug) => {
        if (first) {
          first = false;
          throw taken();
        }
        return created(slug);
      },
    });
    await svc.create(
      data({ slug: 'my-co', slugExplicit: true }),
      { phoneVerified: true, slugFallback: true },
      {},
    );
    expect(slugs[0]).toBe('my-co');
    expect(slugs[1]).toMatch(/^my-co-[0-9a-f]{6}$/);
  });

  it('gives up after five attempts', async () => {
    const { svc, slugs } = make({
      provision: async () => {
        throw taken();
      },
    });
    await expect(svc.create(data(), { phoneVerified: false }, {})).rejects.toMatchObject({
      code: ERROR_CODES.AUTH_SLUG_TAKEN,
    });
    expect(slugs).toHaveLength(5);
  });

  it('lets every other failure through at once', async () => {
    const { svc, slugs } = make({
      provision: async () => {
        throw new Error('database is down');
      },
    });
    await expect(svc.create(data(), { phoneVerified: false }, {})).rejects.toThrow(
      'database is down',
    );
    expect(slugs).toHaveLength(1);
  });
});

describe('SignupService.create: how the first session is opened', () => {
  const open = async (
    remember: boolean | undefined,
    policyOn: boolean,
    loginMethod?: 'signup' | 'social',
  ) => {
    const { svc, completeLogin } = make({
      provision: async (slug) => created(slug),
      remember: policyOn,
    });
    await svc.create(data(), { phoneVerified: false, remember, loginMethod }, {});
    return completeLogin.mock.calls[0]![0] as { remember: boolean; method: string };
  };

  it('a plain sign-up is not remembered, as in Reference', async () => {
    expect(await open(undefined, true)).toMatchObject({ remember: false, method: 'signup' });
  });

  it('a social sign-up is remembered, but only while the administrator allows "keep me signed in"', async () => {
    expect(await open(true, true, 'social')).toMatchObject({ remember: true, method: 'social' });
    expect(await open(true, false, 'social')).toMatchObject({ remember: false, method: 'social' });
  });
});
