// Stand-in for `expo-notifications`, used only when Metro is started with EXPO_GO=1 (`pnpm start:go`). Expo Go on Android ships
// without the notifications native module, so the real library throws the moment the app imports it. This answers "granted" so
// the first-run permission flow has nothing to ask for. Push and notification features do nothing here; use a development
// build for those.
const granted = { status: 'granted', granted: true, canAskAgain: true, expires: 'never' };

module.exports = {
  AndroidImportance: { DEFAULT: 3 },
  getPermissionsAsync: async () => granted,
  requestPermissionsAsync: async () => granted,
  setNotificationChannelAsync: async () => null,
};
