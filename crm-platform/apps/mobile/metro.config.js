// Expo's default config already understands a pnpm monorepo (watchFolders and node_modules resolution for the workspace root),
// so `@crm/contracts` resolves from ../../packages/contracts without any extra setting here. If a workspace package ever fails
// to resolve, fix it in this file with a comment saying why; do not copy packages into the app.
const path = require('node:path');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// `EXPO_GO=1` (see `pnpm start:go`) is for looking at the app in Expo Go, which has no native module for notifications. It swaps
// the library for a stand-in; it is off by default and never part of a development build or a release.
if (process.env.EXPO_GO === '1') {
  const standIn = path.join(__dirname, 'scripts/expo-go/expo-notifications.js');
  const resolveRequest = config.resolver.resolveRequest;
  config.resolver.resolveRequest = (context, moduleName, platform) =>
    moduleName === 'expo-notifications'
      ? { type: 'sourceFile', filePath: standIn }
      : (resolveRequest ?? context.resolveRequest)(context, moduleName, platform);
}

module.exports = config;
