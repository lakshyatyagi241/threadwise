import type { ConfigContext } from 'expo/config';
import appConfig from '@/../app.config';
import { BRAND_NAME } from './brand';

/** The config of one build variant, as Expo reads it. */
function configFor(variant: 'development' | 'preview' | 'production') {
  const before = { ...process.env };
  process.env.APP_VARIANT = variant;
  process.env.EXPO_PUBLIC_API_URL = 'https://api.example.test';
  try {
    return appConfig({ config: {} } as ConfigContext);
  } finally {
    process.env = before;
  }
}

/** Loads a file the config points at (`./assets/...`); Jest fails the test when the file is not there. */
const loads = (file: string | undefined) => {
  expect(file).toBeTruthy();
  expect(() => jest.requireActual(`@/../${(file as string).replace(/^\.\//, '')}`)).not.toThrow();
};

describe('the app name and logo', () => {
  it('is Geta under the icon, with the suffix that tells a development or preview build apart', () => {
    expect(BRAND_NAME).toBe('Geta');
    expect(configFor('production').name).toBe(BRAND_NAME);
    expect(configFor('development').name).toBe(`${BRAND_NAME} (Dev)`);
    expect(configFor('preview').name).toBe(`${BRAND_NAME} (Preview)`);
  });

  it('points the icons and the splash at files that exist', () => {
    const config = configFor('production');
    loads(config.icon);
    loads(config.android?.adaptiveIcon?.foregroundImage);
    loads(config.android?.adaptiveIcon?.monochromeImage);
    const splash = config.plugins?.find((p) => Array.isArray(p) && p[0] === 'expo-splash-screen');
    loads(Array.isArray(splash) ? (splash[1] as { image: string }).image : undefined);
    loads('src/assets/images/logo.png');
  });
});
