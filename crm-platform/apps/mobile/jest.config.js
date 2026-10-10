/** @type {import('jest').Config} */
module.exports = {
  preset: 'jest-expo',
  testTimeout: 20000,
  setupFiles: ['<rootDir>/jest.env.js'],
  setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
  moduleNameMapper: { '^@/(.*)$': '<rootDir>/src/$1' },
  testPathIgnorePatterns: ['/node_modules/', '/.expo-export/', '/.maestro/'],
  collectCoverageFrom: [
    'src/**/*.{ts,tsx}',
    '!src/**/*.d.ts',
    // Route files only re-export a screen; the screens are what is tested.
    '!src/app/**',
    '!src/messages/**',
    '!src/test/**',
  ],
  // Floors, not goals (ADR-0025): a PR may raise them, never lower them. lib/ carries the security-relevant logic (tokens, refresh,
  // errors) and is held higher.
  coverageThreshold: {
    global: { statements: 85, branches: 75, functions: 80, lines: 85 },
    './src/lib/': { statements: 90, branches: 80, functions: 85, lines: 90 },
  },
};
