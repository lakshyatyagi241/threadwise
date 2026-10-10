// @ts-check
/**
 * ESLint rules for the mobile app, spread into the root eslint.config.mjs. Kept next to the app so the people who change the
 * app's architecture (docs/adr/0021 to 0026) change the rules that enforce it in the same place.
 *
 * Every rule here names the decision it protects. If a rule is in your way, the answer is an ADR, not an eslint-disable.
 */

const WEB_ONLY = 'Web only. This is a native app.';

export default [
  {
    files: ['apps/mobile/src/**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      'no-console': 'error',
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'react-native',
              importNames: ['Text'],
              message:
                'Use Text from @/components/ui/text: it carries the theme, the type scale and font scaling.',
            },
            {
              name: 'react-native',
              importNames: ['TextInput'],
              message:
                'Use TextField from @/components/ui/text-field: it carries the label, the error and the accessibility wiring.',
            },
            {
              name: 'react-native',
              importNames: ['Alert'],
              message:
                'Alert text cannot be translated or tested like screen text. Render the message in the screen.',
            },
            {
              name: '@react-native-async-storage/async-storage',
              message:
                'Unencrypted storage. Credentials go through lib/auth/token-store (SecureStore); anything else needs an ADR (docs/adr/0023).',
            },
            {
              name: 'react-native-mmkv',
              message:
                'Unencrypted by default. Credentials go through lib/auth/token-store (SecureStore); anything else needs an ADR (docs/adr/0023).',
            },
            { name: 'react-dom', message: WEB_ONLY },
            { name: 'server-only', message: WEB_ONLY },
          ],
          patterns: [
            {
              group: ['next', 'next/*', 'next-intl', 'next-intl/*'],
              message: 'Web only (Next.js). Nothing from apps/web can be imported here.',
            },
            {
              group: ['@crm/ui', '@crm/ui/*'],
              message:
                '@crm/ui is DOM and Tailwind. Mobile has its own components in src/components/ui.',
            },
            {
              group: ['@crm/db', '@crm/db/*', '@crm/api', '@crm/api/*'],
              message: 'Server code. The app talks to the API over HTTP with @crm/contracts types.',
            },
            {
              group: ['../*'],
              message:
                "Use the '@/...' alias instead of climbing out of the folder; same-folder './x' imports are fine.",
            },
          ],
        },
      ],
      'no-restricted-globals': [
        'error',
        {
          name: 'fetch',
          message:
            'Call the API with apiFetch from @/lib/api (auth, rotation, errors, contract parsing).',
        },
      ],
      'no-restricted-properties': [
        'error',
        {
          object: 'process',
          property: 'env',
          message: "Read configuration from '@/config/env' (validated once at launch).",
        },
        {
          // The base config lets console.warn/error through; the app has one logger.
          object: 'console',
          message:
            'Use log from @/lib/observability/logger: console output is invisible in a release build.',
        },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector: 'JSXText[value=/[^\\s{}]/]',
          message: 'Visible text must come from t(): no literals in JSX (docs/mobile/i18n.md).',
        },
        {
          selector:
            'JSXAttribute[name.name=/^(label|placeholder|title|accessibilityLabel|accessibilityHint)$/] > Literal',
          message:
            'Visible and spoken text must come from t(): no string literals here (docs/mobile/i18n.md).',
        },
        {
          selector: 'Literal[value=/^#[0-9a-fA-F]{3,8}$/]',
          message:
            'No hex colours in screens or components: use the theme (src/lib/theme/tokens.ts).',
        },
      ],
    },
  },
  {
    // The few files that are the sanctioned exception to a rule above.
    files: ['apps/mobile/src/lib/api/client.ts', 'apps/mobile/src/lib/auth/session-manager.ts'],
    rules: { 'no-restricted-globals': 'off' },
  },
  {
    files: ['apps/mobile/src/config/env.ts'],
    rules: { 'no-restricted-properties': 'off' },
  },
  {
    files: ['apps/mobile/src/lib/observability/logger.ts'],
    rules: {
      'no-console': 'off',
      'no-restricted-properties': 'off',
    },
  },
  {
    files: [
      'apps/mobile/src/components/ui/text.tsx',
      'apps/mobile/src/components/ui/text-field.tsx',
    ],
    rules: { 'no-restricted-imports': 'off' },
  },
  {
    // Tokens are where colours are defined.
    files: ['apps/mobile/src/lib/theme/tokens.ts'],
    rules: { 'no-restricted-syntax': 'off' },
  },
  {
    files: [
      'apps/mobile/**/*.test.{ts,tsx}',
      'apps/mobile/jest.setup.ts',
      'apps/mobile/src/test/**',
    ],
    rules: {
      'no-restricted-globals': 'off',
      'no-restricted-properties': 'off',
      'no-restricted-syntax': 'off',
      'no-restricted-imports': 'off',
      'no-console': 'off',
    },
  },
];
