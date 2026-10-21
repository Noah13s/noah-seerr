// Preserve deletion-review links across sign-in without allowing open redirects.
export function cleanupReturnPath(value: unknown): string {
  if (typeof value !== 'string' || !value.startsWith('/admin-tools?'))
    return '/';
  const query = new URLSearchParams(value.slice('/admin-tools?'.length));
  const review = query.get('review');
  const intent = query.get('intent');
  if (
    !review ||
    !/^[a-f0-9-]{36}$/.test(review) ||
    !intent ||
    !['delete', 'keep'].includes(intent)
  )
    return '/';
  return `/admin-tools?review=${review}&intent=${intent}`;
}
