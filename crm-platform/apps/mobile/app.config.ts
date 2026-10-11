import type { ExpoConfig, ConfigContext } from 'expo/config';

/**
 * One codebase, three installable apps. `APP_VARIANT` (set by the EAS build profile, see eas.json) decides the bundle id,
 * the name under the icon and the URL scheme, so a development build, a preview build and the store app sit side by side
 * on one phone and a deep link never opens the wrong one.
 *
 * Everything that is a decision for the product owner rather than for code is read from the environment or kept in one
 * place below (ids, EAS project): see docs/mobile/handover.md, "Decisions before the first store build".
 */
type Variant = 'development' | 'preview' | 'production';

const VARIANTS: Record<Variant, { suffix: string; nameSuffix: string; scheme: string }> = {
  development: { suffix: '.dev', nameSuffix: ' (Dev)', scheme: 'crm-dev' },
  preview: { suffix: '.preview', nameSuffix: ' (Preview)', scheme: 'crm-preview' },
  production: { suffix: '', nameSuffix: '', scheme: 'crm' },
};

function variantOf(raw: string | undefined): Variant {
  if (raw === 'preview' || raw === 'production') return raw;
  return 'development';
}

// PLACEHOLDER until the owner picks the store identity. A bundle id cannot change after the first store upload.
const BASE_BUNDLE_ID = process.env.APP_BUNDLE_ID ?? 'ai.geta.crm';
const APP_NAME = process.env.APP_NAME ?? 'CRM';

/** Source-map upload at build time; needs the Sentry org and project. Without them the app still reports errors, minified. */
function sentryPlugin(): NonNullable<ExpoConfig['plugins']> {
  const { SENTRY_ORG: organization, SENTRY_PROJECT: project } = process.env;
  return organization && project ? [['@sentry/react-native/expo', { organization, project }]] : [];
}

export default ({ config }: ConfigContext): ExpoConfig => {
  const variant = variantOf(process.env.APP_VARIANT);
  const v = VARIANTS[variant];
  const bundleId = `${BASE_BUNDLE_ID}${v.suffix}`;
  const easProjectId = process.env.EAS_PROJECT_ID;
  const apiUrl = process.env.EXPO_PUBLIC_API_URL;

  // A store build that points at the wrong API is worse than a build that fails here.
  if (variant !== 'development' && !apiUrl) {
    throw new Error(
      `EXPO_PUBLIC_API_URL is required for the ${variant} variant (EAS environment variable).`,
    );
  }
  if (variant === 'production' && apiUrl && !apiUrl.startsWith('https://')) {
    throw new Error('The production variant must use an https:// EXPO_PUBLIC_API_URL.');
  }

  return {
    ...config,
    name: `${APP_NAME}${v.nameSuffix}`,
    slug: 'crm-mobile',
    version: '0.1.0',
    orientation: 'portrait',
    icon: './assets/images/icon.png',
    scheme: v.scheme,
    userInterfaceStyle: 'automatic',
    // JS-only OTA updates reach only binaries built from the same app version (docs/adr/0026).
    runtimeVersion: { policy: 'appVersion' },
    updates: {
      enabled: Boolean(easProjectId),
      url: easProjectId ? `https://u.expo.dev/${easProjectId}` : undefined,
      checkAutomatically: 'ON_LOAD',
      fallbackToCacheTimeout: 0,
    },
    ios: {
      bundleIdentifier: bundleId,
      supportsTablet: true,
      config: { usesNonExemptEncryption: false },
      infoPlist: {
        // Development builds talk to the API on the developer's machine over plain http; no other variant may.
        ...(variant === 'development'
          ? { NSAppTransportSecurity: { NSAllowsLocalNetworking: true } }
          : {}),
      },
    },
    android: {
      package: bundleId,
      adaptiveIcon: {
        backgroundColor: '#0B3D2E',
        foregroundImage: './assets/images/android-icon-foreground.png',
        backgroundImage: './assets/images/android-icon-background.png',
        monochromeImage: './assets/images/android-icon-monochrome.png',
      },
      predictiveBackGestureEnabled: true,
      // Backups would copy the keychain-backed token store to another device on restore.
      allowBackup: false,
    },
    plugins: [
      'expo-router',
      'expo-secure-store',
      'expo-localization',
      [
        'expo-splash-screen',
        { backgroundColor: '#0B3D2E', image: './assets/images/splash-icon.png', imageWidth: 120 },
      ],
      [
        'expo-build-properties',
        {
          android: { usesCleartextTraffic: variant === 'development' },
        },
      ],
      ...sentryPlugin(),
    ],
    experiments: { typedRoutes: true, reactCompiler: true },
    extra: {
      appVariant: variant,
      eas: easProjectId ? { projectId: easProjectId } : undefined,
    },
  };
};
