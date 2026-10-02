import type { PublicSiteConfig } from '@crm/contracts';
import { fontAssets } from './fonts';

/**
 * Head additions from the saved settings: the colour overrides (TW-SET-013 to 015) and the UI font (TW-SET-006). The CSS
 * is built by the API from validated colours only, never from free text, so it is safe to print as it is. The font comes
 * from Google's stylesheet, as in Reference (a privacy cost the port keeps and documents; self-hosting needs the file module).
 */
export function SiteHead({ cfg }: { cfg: PublicSiteConfig }) {
  const font = fontAssets(cfg.brand.fontFamily);
  return (
    <>
      {cfg.themeCss !== '' && (
        <style id="set-theme" dangerouslySetInnerHTML={{ __html: cfg.themeCss }} />
      )}
      {font && (
        <>
          <link rel="preconnect" href="https://fonts.googleapis.com" />
          <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
          <link rel="stylesheet" href={font.href} />
          <style id="set-font" dangerouslySetInnerHTML={{ __html: font.css }} />
        </>
      )}
    </>
  );
}

/**
 * The admin's own CSS and JavaScript for the public marketing pages (TW-SET-034): printed raw, only when the master
 * switch is on (the API withholds both otherwise) and only on the public site, never on sign-in, the app or the console.
 * Raw by design, which is why only a super admin can save it.
 */
export function PublicCustomCode({ cfg }: { cfg: PublicSiteConfig }) {
  const { css, js } = cfg.customCode;
  return (
    <>
      {css !== '' && <style id="tw-custom-css" dangerouslySetInnerHTML={{ __html: css }} />}
      {js !== '' && <script id="tw-custom-js" dangerouslySetInnerHTML={{ __html: js }} />}
    </>
  );
}
