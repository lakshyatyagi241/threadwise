// Expo's default config already understands a pnpm monorepo (watchFolders and node_modules resolution for the workspace root),
// so `@crm/contracts` resolves from ../../packages/contracts without any extra setting here. If a workspace package ever fails
// to resolve, fix it in this file with a comment saying why; do not copy packages into the app.
const { getDefaultConfig } = require('expo/metro-config');

module.exports = getDefaultConfig(__dirname);
