import { expect, test, type Browser, type Page } from '@playwright/test';

/**
 * TW-WSP-015..022 against the running stack: the Members screen (list, search, role pills, invite, role change,
 * reset password, remove), the accept-invite page, and Teams (create, edit, delete). Signs in as the seeded local
 * workspace admin and agent (`pnpm --filter @crm/api seed:auth`), reads invite and reset mails from Mailpit, and only
 * ever creates or deletes rows tagged with this run's id, so it is safe on the shared dev database.
 */
const ORG = process.env.E2E_ORG ?? 'Admin';
const ADMIN = {
  email: process.env.E2E_ADMIN_EMAIL ?? 'nachiket.challawar@geta.ai',
  password: process.env.E2E_PASSWORD ?? 'Passw0rd!',
};
const AGENT = {
  email: process.env.E2E_AGENT_EMAIL ?? 'agent@admin.test',
  password: ADMIN.password,
};
const MAILPIT = process.env.MAILPIT_URL ?? 'http://localhost:58025';

const RUN = `e2e-wsp-${Date.now().toString(36)}`;
const INVITEE = { name: `Riya ${RUN}`, email: `${RUN}@example.test`, password: `Vk8#rT2$xQ9!mWp` };
const TEAM = { name: `E2E Team ${RUN}`, renamed: `E2E Team ${RUN} B` };

async function signIn(page: Page, who: { email: string; password: string }) {
  const res = await page.request.post('/api/auth/login', {
    data: { orgSlug: ORG, email: who.email, password: who.password },
  });
  expect(res.ok(), `sign in as ${who.email}`).toBe(true);
}

/** True once React has attached to the screen: before that, a click on the server-rendered HTML does nothing. */
async function hydrated(page: Page) {
  await page.waitForFunction(() => {
    const el = document.querySelector('main') ?? document.body;
    return Object.keys(el.firstElementChild ?? el).some((k) => k.startsWith('__react'));
  });
}

async function open(page: Page, path: string) {
  await page.goto(path);
  await hydrated(page);
}

/** The newest mail to `to` whose subject matches, as { text, html }. Polls: delivery runs through the outbox. */
async function mailTo(page: Page, to: string, subject: RegExp) {
  let found: { text: string; html: string } | null = null;
  await expect
    .poll(
      async () => {
        const res = await page.request.get(`${MAILPIT}/api/v1/search`, {
          params: { query: `to:${to}` },
        });
        const list = (await res.json()) as { messages: Array<{ ID: string; Subject: string }> };
        const hit = list.messages.find((m) => subject.test(m.Subject));
        if (!hit) return false;
        const msg = (await (
          await page.request.get(`${MAILPIT}/api/v1/message/${hit.ID}`)
        ).json()) as {
          Text: string;
          HTML: string;
        };
        found = { text: msg.Text, html: msg.HTML };
        return true;
      },
      { message: `mail to ${to} (${subject})`, timeout: 20_000 },
    )
    .toBe(true);
  return found!;
}

const linkIn = (mail: { text: string }, path: string) => {
  const m = new RegExp(`https?://[^\\s"<>]+${path}[^\\s"<>]*`).exec(mail.text);
  expect(m, `a ${path} link in the mail`).not.toBeNull();
  return m![0].replaceAll('&amp;', '&');
};

const row = (page: Page, email: string) => page.getByTestId(`member-row-${email}`);

async function freshContext(browser: Browser) {
  const context = await browser.newContext();
  return { context, page: await context.newPage() };
}

test.describe.configure({ mode: 'serial' });

test.afterAll(async ({ browser }) => {
  // Anything this run left behind (a failed test stops the serial run early): members and teams carrying the run id.
  const { context, page } = await freshContext(browser);
  try {
    await signIn(page, ADMIN);
    const members = (await (
      await page.request.get(`/api/v2/workspace/members?q=${RUN}&limit=50`)
    ).json()) as {
      data: Array<{ id: string }>;
    };
    for (const m of members.data) await page.request.delete(`/api/v2/workspace/members/${m.id}`);
    const teams = (await (await page.request.get('/api/v2/workspace/teams?limit=200')).json()) as {
      data: Array<{ id: string; name: string }>;
    };
    for (const t of teams.data.filter((x) => x.name.includes(RUN))) {
      await page.request.delete(`/api/v2/workspace/teams/${t.id}`);
    }
  } finally {
    await context.close();
  }
});

test.describe('Team members', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, ADMIN);
  });

  test('lists everyone with role, status and joined date, and the pill counts add up', async ({
    page,
  }) => {
    await open(page, '/team-members');
    await expect(page.getByRole('heading', { name: 'Team members' })).toBeVisible();
    await expect(page.getByText(/Everyone with access to/)).toBeVisible();
    await expect(row(page, ADMIN.email)).toBeVisible();
    await expect(page.getByTestId('role-filter-all')).toBeVisible();
    for (const label of ['Owners', 'Admins', 'Managers', 'Agents', 'Viewers']) {
      await expect(page.getByRole('button', { name: new RegExp(label) })).toBeVisible();
    }
    await expect(page.getByText('How roles work')).toBeVisible();
    for (const col of ['Name', 'Role', 'Status', 'Joined']) {
      await expect(page.getByRole('columnheader', { name: col })).toBeVisible();
    }
    const all = Number(await page.getByTestId('role-count-all').innerText());
    const shown = await page.locator('[data-testid^="member-row-"]').count();
    expect(shown).toBeLessThanOrEqual(all);
    await expect(page.getByTestId('member-count')).toContainText(`${all} member`);
  });

  test('searches by name or email on the server, and filters by role pill', async ({ page }) => {
    await open(page, '/team-members');
    const search = page.getByTestId('member-search');
    await search.fill(AGENT.email.slice(0, 8));
    await expect(row(page, AGENT.email)).toBeVisible();
    await expect(row(page, ADMIN.email)).toHaveCount(0);
    await search.fill('no-such-person-zzz');
    await expect(page.getByText('No data found')).toBeVisible();
    await expect(page.getByText('No members match this view.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Invite member' })).toBeVisible();
    await search.fill('');
    await page.getByTestId('role-filter-owner').click();
    await expect(page.getByTestId('role-filter-owner')).toHaveAttribute('aria-pressed', 'true');
    await expect(row(page, ADMIN.email)).toBeVisible();
    await expect(row(page, AGENT.email)).toHaveCount(0);
  });

  test('invites a teammate, who shows as pending, and the invite mail carries the link', async ({
    page,
  }) => {
    await open(page, '/team-members');
    await page.getByTestId('invite-button').click();
    const dialog = page.getByRole('dialog', { name: 'Invite a teammate' });
    await dialog.getByLabel('Full name').fill(INVITEE.name);
    await dialog.getByLabel('Email').fill(INVITEE.email);
    // The role list holds what the signed-in Owner may grant (RBAC's ladder): all five presets, Owner included.
    const options = await dialog.getByLabel('Workspace role').locator('option').allInnerTexts();
    expect(options.some((o) => o.startsWith('Owner'))).toBe(true);
    expect(options.some((o) => o.startsWith('Admin'))).toBe(true);
    await dialog.getByRole('button', { name: 'Send invite' }).click();
    await expect(dialog.getByTestId('invite-result')).toContainText(`${INVITEE.name} added.`);
    await dialog.getByRole('button', { name: 'Done' }).click();
    await expect(row(page, INVITEE.email)).toBeVisible();
    await expect(row(page, INVITEE.email).getByText('pending')).toBeVisible();
    await mailTo(page, INVITEE.email, /invited you/i);
  });

  test('rejects an empty name and an existing member without closing the dialog', async ({
    page,
  }) => {
    await open(page, '/team-members');
    await page.getByTestId('invite-button').click();
    const dialog = page.getByRole('dialog', { name: 'Invite a teammate' });
    await dialog.getByRole('button', { name: 'Send invite' }).click();
    await expect(dialog.getByText("Enter the person's name.")).toBeVisible();
    await dialog.getByLabel('Full name').fill('Someone');
    await dialog.getByLabel('Email').fill(INVITEE.email);
    await dialog.getByRole('button', { name: 'Send invite' }).click();
    await expect(dialog.getByRole('alert').filter({ hasText: 'already a member' })).toBeVisible();
    await expect(dialog).toBeVisible();
  });

  test('changes a role from the row, toasts, and the pill counts follow', async ({ page }) => {
    await open(page, '/team-members');
    const select = page.getByTestId(`role-select-${INVITEE.email}`);
    await expect(select).toBeVisible();
    const viewers = Number(await page.getByTestId('role-count-viewer').innerText());
    await select.selectOption({ label: 'Viewer' });
    await expect(page.getByText('Role updated.')).toBeVisible();
    await expect(page.getByTestId('role-count-viewer')).toHaveText(String(viewers + 1));
    await expect(select).toHaveValue(/.+/);
    await expect(select.locator('option:checked')).toHaveText('Viewer');
  });

  test('an invitee accepts the link, picks a password and lands signed in', async ({
    page,
    browser,
  }) => {
    const mail = await mailTo(page, INVITEE.email, /invited you/i);
    const link = linkIn(mail, '/accept-invite');
    const { context, page: invitee } = await freshContext(browser);
    try {
      await invitee.goto(link);
      await expect(invitee.getByText("You're invited to")).toBeVisible();
      await expect(invitee.getByTestId('invite-email')).toHaveText(INVITEE.email);
      await invitee.getByLabel('Password', { exact: true }).fill('short');
      await invitee.getByLabel('Confirm password').fill('different');
      await invitee.getByRole('button', { name: 'Accept invitation' }).click();
      await expect(invitee.getByText('Use at least 8 characters.')).toBeVisible();
      await expect(invitee.getByText('The passwords do not match.')).toBeVisible();
      await invitee.getByLabel('Password', { exact: true }).fill(INVITEE.password);
      await invitee.getByLabel('Confirm password').fill(INVITEE.password);
      await invitee.getByRole('button', { name: 'Accept invitation' }).click();
      await expect(invitee).toHaveURL(/\/(dashboard|inbox)/);
      // The same link is single use.
      await invitee.goto(link);
      await expect(
        invitee.getByRole('alert').getByText('This invitation no longer works'),
      ).toBeVisible();
    } finally {
      await context.close();
    }
    await open(page, '/team-members');
    await expect(row(page, INVITEE.email).getByText('pending')).toHaveCount(0);
  });

  test('a link that never existed says so', async ({ page }) => {
    await page.goto(`/accept-invite?org=${ORG}&token=${'x'.repeat(43)}`);
    await expect(
      page.getByRole('alert').getByText('This invitation no longer works'),
    ).toBeVisible();
    await page.goto('/accept-invite');
    await expect(
      page.getByRole('alert').getByText('This invitation no longer works'),
    ).toBeVisible();
  });

  test('reset password asks first, then mails a set-password link', async ({ page }) => {
    await open(page, '/team-members');
    await page.getByTestId(`reset-${INVITEE.email}`).click();
    const confirm = page.getByRole('dialog', { name: 'Reset password?' });
    await expect(confirm).toContainText(INVITEE.name);
    await confirm.getByRole('button', { name: 'Cancel' }).click();
    await expect(confirm).toBeHidden();
    await page.getByTestId(`reset-${INVITEE.email}`).click();
    await confirm.getByRole('button', { name: 'Send reset link' }).click();
    await expect(
      page.getByText(`We emailed ${INVITEE.email} a link to set a new password.`),
    ).toBeVisible();
    const mail = await mailTo(page, INVITEE.email, /reset/i);
    expect(linkIn(mail, '/reset-password')).toContain('token=');
  });

  test('removes the member after a confirm, and they vanish from the list', async ({ page }) => {
    await open(page, '/team-members');
    await page.getByTestId(`remove-${INVITEE.email}`).click();
    const confirm = page.getByRole('dialog', { name: 'Remove member?' });
    await expect(confirm).toContainText("They'll lose access immediately.");
    await confirm.getByRole('button', { name: 'Remove' }).click();
    await expect(page.getByText('Removed.')).toBeVisible();
    await expect(row(page, INVITEE.email)).toHaveCount(0);
  });

  test('offers the owner and oneself no remove or role change', async ({ page }) => {
    await open(page, '/team-members');
    await expect(row(page, ADMIN.email)).toBeVisible();
    await expect(page.getByTestId(`remove-${ADMIN.email}`)).toHaveCount(0);
    await expect(page.getByTestId(`role-select-${ADMIN.email}`)).toHaveCount(0);
  });
});

test.describe('Teams', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, ADMIN);
  });

  test('creates a team with a colour, a strategy and a member', async ({ page }) => {
    await open(page, '/teams');
    await expect(page.getByRole('heading', { name: 'Teams', exact: true })).toBeVisible();
    await page.getByTestId('create-team').first().click();
    const dialog = page.getByRole('dialog', { name: 'Create a team' });
    await dialog.getByRole('button', { name: 'Create team' }).click();
    await expect(dialog.getByText('Enter a team name.')).toBeVisible();
    await dialog.getByLabel('Team name').fill(TEAM.name);
    await dialog.getByRole('button', { name: /^Colour #13478A/ }).click();
    await expect(dialog.getByRole('button', { name: /^Colour #13478A/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await dialog.getByLabel('Auto-assignment strategy').selectOption('round_robin');
    await dialog.getByTestId('team-members').getByRole('checkbox').first().check();
    await expect(dialog.getByTestId('team-devices')).toHaveCount(0);
    await dialog.getByTestId('save-team').click();
    await expect(page.getByText('Team created.')).toBeVisible();
    const card = page.getByTestId(`team-card-${TEAM.name}`);
    await expect(card).toContainText('Round robin');
    await expect(card).toContainText('1 member');
  });

  test('refuses a second team with the same name', async ({ page }) => {
    await open(page, '/teams');
    await page.getByTestId('create-team').first().click();
    const dialog = page.getByRole('dialog', { name: 'Create a team' });
    await dialog.getByLabel('Team name').fill(TEAM.name);
    await dialog.getByTestId('save-team').click();
    await expect(dialog.getByText('A team with that name already exists.')).toBeVisible();
    await expect(page.getByText(/Create team failed/)).toBeVisible();
  });

  test('edits the team, and unticking the last member empties it', async ({ page }) => {
    await open(page, '/teams');
    await page.getByTestId(`edit-team-${TEAM.name}`).click();
    const dialog = page.getByRole('dialog', { name: 'Edit team' });
    await expect(dialog.getByLabel('Team name')).toHaveValue(TEAM.name);
    await dialog.getByLabel('Team name').fill(TEAM.renamed);
    await dialog.getByTestId('team-members').getByRole('checkbox').first().uncheck();
    await dialog.getByTestId('save-team').click();
    await expect(page.getByText('Team updated.')).toBeVisible();
    const card = page.getByTestId(`team-card-${TEAM.renamed}`);
    await expect(card).toContainText('No members');
  });

  test('deletes the team only after a confirm that names it', async ({ page }) => {
    await open(page, '/teams');
    await page.getByTestId(`edit-team-${TEAM.renamed}`).click();
    await page.getByRole('dialog', { name: 'Edit team' }).getByTestId('delete-team').click();
    const confirm = page.getByRole('dialog', { name: 'Delete this team?' });
    await expect(confirm).toContainText(`Delete team "${TEAM.renamed}"?`);
    await expect(confirm).toContainText(
      'Conversations assigned to this team will become unassigned.',
    );
    await confirm.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByTestId(`team-card-${TEAM.renamed}`)).toBeVisible();
    await page.getByRole('dialog', { name: 'Edit team' }).getByTestId('delete-team').click();
    await confirm.getByRole('button', { name: 'Delete team' }).click();
    await expect(page.getByText('Team deleted.')).toBeVisible();
    await expect(page.getByTestId(`team-card-${TEAM.renamed}`)).toHaveCount(0);
  });
});

test.describe('An agent', () => {
  test('can read the members and the teams but has no way to change them', async ({ page }) => {
    await signIn(page, AGENT);
    await open(page, '/team-members');
    await expect(page.getByRole('heading', { name: 'Team members' })).toBeVisible();
    await expect(row(page, AGENT.email)).toBeVisible();
    await expect(page.getByTestId('invite-button')).toHaveCount(0);
    await expect(page.locator('[data-testid^="role-select-"]')).toHaveCount(0);
    await expect(page.locator('[data-testid^="remove-"]')).toHaveCount(0);
    await open(page, '/teams');
    await expect(page.getByRole('heading', { name: 'Teams', exact: true })).toBeVisible();
    await expect(page.getByTestId('create-team')).toHaveCount(0);
  });
});
