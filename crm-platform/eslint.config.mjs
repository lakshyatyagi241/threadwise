// @ts-check
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';
import reactHooks from 'eslint-plugin-react-hooks';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/.next/**',
      '**/coverage/**',
      '**/.turbo/**',
      'eslint.config.mjs',
      '**/*.config.{js,cjs,mjs,ts}',
      // Tooling config, not application code — outside every tsconfig project.
      '**/.dependency-cruiser.cjs',
      'commitlint.config.cjs',
      // Plain-node build helper, outside the app tsconfig.
      'apps/web/scripts/**',
      '**/next-env.d.ts',
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      // Nest DI relies on parameter decorators with empty constructors
      '@typescript-eslint/no-empty-function': ['error', { allow: ['constructors'] }],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      eqeqeq: ['error', 'smart'],
    },
  },
  {
    // Tests live outside the build tsconfig's rootDir, so they are typed by
    // their own project. Without this the type-aware rules cannot parse them.
    files: ['apps/api/test/**/*.ts'],
    languageOptions: {
      parserOptions: {
        projectService: false,
        project: ['apps/api/tsconfig.spec.json'],
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    // Migrations, seeds and CLI scripts legitimately write to stdout — that
    // output is the interface.
    files: [
      'packages/db/src/**',
      'apps/api/src/tools/**',
      'tools/**',
      '**/*.spec.ts',
      '**/*.test.ts',
    ],
    rules: { 'no-console': 'off' },
  },
  {
    // React apps: hooks rules, and JSX event handlers may be async (the promise is handled inside).
    files: ['apps/web/**/*.{ts,tsx}', 'packages/ui/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs['recommended-latest'].rules,
      '@typescript-eslint/no-misused-promises': [
        'error',
        { checksVoidReturn: { attributes: false } },
      ],
    },
  },
  prettier,
);
