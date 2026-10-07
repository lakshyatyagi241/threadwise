// Ours-only: priority, assignee and due date are required when creating a task.
export default () => ({
  feature: 'adhoc:task-required-fields',
  title: 'New task needs priority, assignee and due date',
  pages: [{ id: 'tasks', title: 'Tasks', path: '/tasks', ready: 'main', probes: ['load', 'a11y'] }],
  scenarios: [
    {
      id: 'task-required.dialog',
      title: 'Empty New task dialog shows three errors and no escape hatches',
      tags: ['edge'],
      run: async (c) => {
        const o = c.obs;
        await c.goto('/tasks', { ready: 'main' });
        await c.click({ role: 'button', name: /new task/i });
        const dlg = c.page.getByRole('dialog');
        await dlg.waitFor();
        o.flag('assignee.noNobody', (await dlg.locator('option', { hasText: /^nobody$/i }).count()) === 0);
        o.flag('due.noClearButton', (await dlg.getByRole('button', { name: /clear date/i }).count()) === 0);
        await dlg.locator('#task-title').fill(c.tag('req'));
        await dlg.getByRole('button', { name: /^(create|add|save)/i }).click();
        await c.afterAction({ quiet: 300 });
        o.flag('dialog.stillOpen', await dlg.isVisible());
        o.flag('due.errorShown', await dlg.getByText(/choose a due date/i).isVisible());
      },
    },
    {
      id: 'task-required.quick-add',
      title: 'Quick add refuses a missing due date',
      tags: ['edge'],
      run: async (c) => {
        const o = c.obs;
        await c.goto('/tasks', { ready: 'main' });
        const input = c.page.getByPlaceholder(/add a task/i);
        await input.fill(c.tag('quick'));
        await input.press('Enter');
        await c.afterAction({ quiet: 300 });
        o.flag('quick.dueErrorShown', await c.page.getByText(/choose a due date/i).first().isVisible());
        o.flag('quick.titleKept', (await input.inputValue()) !== '');
      },
    },
  ],
});
