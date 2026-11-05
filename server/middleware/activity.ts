import { getRepository } from '@server/datasource';
import { User } from '@server/entity/User';
import { activityText, recordActivity, userLabel } from '@server/lib/activity';
import type { RequestHandler } from 'express';

export function mutationAction(
  method: string,
  route: string,
  body: Record<string, unknown> = {}
) {
  const parts = route
    .replace(/^\/admin-tools\/cleanup(?=\/|$)/, '/cleanup-reviews')
    .replace(/^\/parties(?=\/|$)/, '/party')
    .split('/')
    .filter(Boolean);
  const category = parts[0];
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) return undefined;
  if (category === 'auth')
    return /^(?:jellyfin|local|plex|logout)$/.test(parts[1] || '')
      ? {
          category: 'account',
          action: parts[1] === 'logout' ? 'account.logout' : 'account.login',
        }
      : undefined;
  if (
    ![
      'request',
      'watchlist',
      'watch-history',
      'cleanup-reviews',
      'blocklist',
      'issue',
      'issueComment',
      'user',
      'settings',
      'party',
    ].includes(category)
  )
    return undefined;
  if (
    parts.some((part) =>
      ['playback', 'override-preview', 'preview', 'cast-diagnostics'].includes(
        part
      )
    )
  )
    return undefined;
  const action =
    category === 'cleanup-reviews' && parts[2] === 'decision'
      ? ['keep', 'delete', 'delete-now', 'reconsider'].includes(
          String(body.action)
        )
        ? String(body.action)
        : 'decision'
      : ['approve', 'decline', 'retry', 'rating', 'rewatch'].includes(
            parts.at(-1) || ''
          )
        ? parts.at(-1)
        : method === 'DELETE'
          ? 'removed'
          : method === 'POST' && parts.length === 1
            ? 'created'
            : 'updated';
  return {
    category: category === 'cleanup-reviews' ? 'cleanup' : category,
    action: `${category}.${action}`,
  };
}
export const auditMutations: RequestHandler = (req, res, next) => {
  const actor = req.user;
  const route = req.path;
  let title = '';
  let media: { tmdbId?: number; mediaType?: string } = {};
  let resultId: number | undefined;
  const originalJson = res.json;
  res.json = function (body) {
    if (body && typeof body === 'object') {
      title = activityText(body.title);
      const candidate = body.media;
      if (
        candidate &&
        Number.isSafeInteger(candidate.tmdbId) &&
        ['movie', 'tv'].includes(candidate.mediaType)
      )
        media = { tmdbId: candidate.tmdbId, mediaType: candidate.mediaType };
      if (Number.isSafeInteger(body.id)) resultId = body.id;
    }
    return originalJson.call(this, body);
  };
  const action = mutationAction(req.method, req.path, req.body);
  if (action) {
    res.once('finish', () => {
      const save = async () => {
        const user =
          actor ||
          req.user ||
          (req.session?.userId
            ? await getRepository(User).findOneBy({ id: req.session.userId })
            : null);
        if (!user) return;
        // Deliberately exclude bodies, URLs/query strings, cookies, IPs and credentials.
        const agent = req.get('user-agent') || '';
        const device = /Noah|Dart/i.test(agent)
          ? 'Noah Stream app'
          : /Edg/i.test(agent)
            ? 'Edge'
            : /Firefox/i.test(agent)
              ? 'Firefox'
              : /Chrome/i.test(agent)
                ? 'Chrome'
                : /Safari/i.test(agent)
                  ? 'Safari'
                  : 'API client';
        const resource = route
          .split('/')
          .slice(1)
          .filter((p) => /^\d+$|^[a-f0-9-]{36}$/i.test(p))
          .join('/')
          .slice(0, 100);
        await recordActivity({
          userId: user.id,
          userName: userLabel(user),
          ...action,
          action: action.action + (res.statusCode >= 400 ? '.failed' : ''),
          device,
          title:
            title ||
            (media.tmdbId ? `${media.mediaType} · TMDB #${media.tmdbId}` : ''),
          details: JSON.stringify({
            resource: resource || resultId,
            status: res.statusCode,
            ...media,
          }),
        });
      };
      void save().catch(() => undefined);
    });
  }
  next();
};
