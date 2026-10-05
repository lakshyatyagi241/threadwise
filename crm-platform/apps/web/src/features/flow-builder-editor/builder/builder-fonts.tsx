/**
 * The builder's type, the same families as WaDesk's builder: a rounded sans (Plus Jakarta Sans) for text and a display
 * serif (Fraunces) for the flow name and headings, both open-licence (SIL OFL). They load the way the platform's own font
 * setting loads Google fonts (a stylesheet link), so the glyph metrics are exactly WaDesk's. Ids and eyebrows use the
 * system monospace: WaDesk names a JetBrains Mono family with doubled quotes that never resolves, so its builder has
 * always shown the default monospace. `.flb-root` in builder.css maps all three onto `--font-sans|serif|mono`.
 */
export const FLB_FONTS_HREF =
  'https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,400;0,9..144,500;0,9..144,600;0,9..144,700;1,9..144,400;1,9..144,500&family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap';

export function BuilderFonts() {
  return (
    <>
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      <link rel="stylesheet" href={FLB_FONTS_HREF} precedence="default" />
    </>
  );
}
