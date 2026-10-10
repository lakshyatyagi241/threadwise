import * as Sentry from '@sentry/react-native';

/**
 * The only logger. `console.*` is a lint error outside tests: it is invisible in a release build and it is how tokens and
 * customer data end up in a device log. Fields are structured and short; never pass a token, a password, a message body,
 * a phone number or an email address (docs/mobile/security.md).
 */
type Fields = Record<string, string | number | boolean | undefined | string[]>;

function emit(level: 'debug' | 'info' | 'warn' | 'error', event: string, fields?: Fields): void {
  Sentry.addBreadcrumb({
    category: 'app',
    level: level === 'warn' ? 'warning' : level,
    message: event,
    data: fields,
  });
  if (__DEV__) {
    const line = fields ? `${event} ${JSON.stringify(fields)}` : event;
    if (level === 'error') console.error(line);
    else if (level === 'warn') console.warn(line);
  }
}

export const log = {
  debug: (event: string, fields?: Fields) => emit('debug', event, fields),
  info: (event: string, fields?: Fields) => emit('info', event, fields),
  warn: (event: string, fields?: Fields) => emit('warn', event, fields),
  error: (event: string, fields?: Fields) => emit('error', event, fields),
  /** An unexpected exception. Sent to Sentry when it is configured. */
  exception: (error: unknown, event: string, fields?: Fields) => {
    Sentry.captureException(error, { extra: { event, ...fields } });
    emit('error', event, fields);
  },
};
