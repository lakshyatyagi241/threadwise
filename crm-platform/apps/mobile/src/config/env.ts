import Constants from 'expo-constants';
import { z } from 'zod';

/**
 * The only place that reads the environment. Everything else imports `env`, so a missing or malformed value fails loudly
 * on launch with a message that names the variable, instead of as `undefined` in a request URL on one screen.
 *
 * Expo inlines `process.env.EXPO_PUBLIC_*` only when it is written as a plain property access, so these reads must stay
 * literal (no destructuring, no computed keys). The lint rule `no-restricted-properties` keeps `process.env` out of the
 * rest of the app.
 */
const envSchema = z.object({
  apiUrl: z
    .string({ required_error: 'EXPO_PUBLIC_API_URL is not set (see apps/mobile/.env.example)' })
    .url('EXPO_PUBLIC_API_URL must be a full URL such as http://localhost:3000')
    .transform((u) => u.replace(/\/+$/, '')),
  sentryDsn: z
    .string()
    .optional()
    .transform((v) => (v ? v : undefined)),
  variant: z.enum(['development', 'preview', 'production']),
});

export type AppEnv = z.infer<typeof envSchema>;

export const env: AppEnv = envSchema.parse({
  apiUrl: process.env.EXPO_PUBLIC_API_URL,
  sentryDsn: process.env.EXPO_PUBLIC_SENTRY_DSN,
  variant: Constants.expoConfig?.extra?.appVariant ?? 'development',
});
