const identity = (value: unknown): value is string =>
  typeof value === 'string' &&
  /^[a-zA-Z0-9_-]{1,160}$/.test(value) &&
  !['local', 'development'].includes(value);

export function clientBuildId(value: unknown): string | undefined {
  const candidate = (value as { buildId?: unknown } | null)?.buildId;
  return identity(candidate) ? candidate : undefined;
}

export function frontendUpdated({
  serverBuildId,
  currentBuildId,
  serverCommit,
  currentCommit,
}: {
  serverBuildId?: string;
  currentBuildId?: string;
  serverCommit?: string;
  currentCommit?: string;
}): boolean {
  if (identity(serverBuildId)) {
    return identity(currentBuildId) && currentBuildId !== serverBuildId;
  }
  // Compatibility with older servers; unknown build provenance is not an update.
  return (
    identity(serverCommit) &&
    identity(currentCommit) &&
    serverCommit !== currentCommit
  );
}
