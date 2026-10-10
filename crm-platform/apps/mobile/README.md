# Reference mobile (Expo, Android + iOS)

Talks to the same NestJS API as the web app (`/v2/*`, bearer tokens, socket.io `/realtime`).

```
cp .env.example .env     # EXPO_PUBLIC_API_URL = your API (LAN IP on a phone, never localhost)
npm install
npm start                # Expo Go: login, inbox, chat, contacts, dashboard, more
```

Push notifications need a real device and a development/production build (Expo Go on Android no longer receives remote push):

1. `npx eas-cli login` then `npx eas-cli init` (writes `extra.eas.projectId` into app.json).
2. Android: add an FCM v1 key (`eas credentials`). iOS: needs an Apple Developer account; EAS creates the APNs key.
3. `eas build -p android --profile preview` (APK) / `eas build -p ios --profile preview`, then `eas build --profile production` and `eas submit`.

The app registers its Expo push token at `POST /v2/notifications/push/mobile`; the API sends through the Expo push service.
