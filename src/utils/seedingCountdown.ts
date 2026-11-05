export function seedingCountdown(
  remaining: number | null | undefined,
  checkedAt: string | undefined,
  seeding: boolean | undefined,
  now: number
) {
  if (
    typeof remaining !== 'number' ||
    !Number.isFinite(remaining) ||
    remaining < 0
  )
    return null;
  const checked = checkedAt ? Date.parse(checkedAt) : NaN;
  const age = now - checked;
  if (!Number.isFinite(checked) || age < -30000 || age > 600000)
    return { seconds: remaining, stale: true, running: false };
  return {
    seconds: Math.max(
      0,
      remaining - (seeding ? Math.floor(Math.max(0, age) / 1000) : 0)
    ),
    stale: false,
    running: !!seeding,
  };
}
