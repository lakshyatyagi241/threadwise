/**
 * The `release` label every series of a process carries (EL-B18), so a dashboard can put two releases side by side by NAME instead of
 * by a time offset. It comes from `OBS_RELEASE` (the compose overlay sets it to the image tag), else `GIT_SHA`, else `IMAGE_TAG`.
 * A full 40-character commit hash is shortened to 12; anything else is cleaned to `[A-Za-z0-9._-]` and cut at 40 characters, so the
 * label is always a safe, short value. Undefined when none is set: the series then carry no `release` label at all.
 *
 * Cardinality: one value per deployed release, and a process has exactly one, so the cost is one extra series set per release that is
 * still inside Prometheus's retention.
 */
export function releaseFromEnv(env: Record<string, string | undefined>): string | undefined {
  const raw = env.OBS_RELEASE?.trim() || env.GIT_SHA?.trim() || env.IMAGE_TAG?.trim();
  if (!raw) return undefined;
  if (/^[0-9a-f]{40}$/i.test(raw)) return raw.slice(0, 12).toLowerCase();
  const clean = raw.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 40);
  return clean === '' ? undefined : clean;
}
