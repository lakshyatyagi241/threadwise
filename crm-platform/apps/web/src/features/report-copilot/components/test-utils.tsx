import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

/** English messages of every domain this feature draws from: its own and the shared chart strings. */
const dir = join(process.cwd(), 'messages', 'en');
const messages = readdirSync(dir)
  .filter((f) => f === 'report-copilot.json' || f === 'dashboards-analytics-charts.json')
  .reduce<Record<string, unknown>>(
    (acc, f) => ({ ...acc, ...(JSON.parse(readFileSync(join(dir, f), 'utf8')) as object) }),
    {},
  );

export const html = (el: ReactElement): string =>
  renderToStaticMarkup(
    <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
      {el}
    </NextIntlClientProvider>,
  );
