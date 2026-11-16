import semver from "semver";

/**
 * Keep the build part: DeepCode versions are 3.16.2-<date>.<build>, and plain coerce()
 * dropped it, so every release compared equal to every other. A newer release then never
 * replaced an older download (updates arrived one restart at a time).
 */
export function normalizeVersionForCompare(version: string): string | null {
  const trimmed = version.trim();
  return semver.valid(trimmed) ?? semver.valid(semver.coerce(trimmed, { includePrerelease: true }));
}

export function isVersionGreaterThan(candidateVersion: string, baselineVersion: string): boolean {
  const candidate = normalizeVersionForCompare(candidateVersion);
  const baseline = normalizeVersionForCompare(baselineVersion);
  if (candidate && baseline) {
    return semver.gt(candidate, baseline);
  }

  return candidateVersion.trim() !== baselineVersion.trim();
}
