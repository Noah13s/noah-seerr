import { getRepository } from '@server/datasource';
import { User } from '@server/entity/User';
import axios from 'axios';
import {
  activityText,
  playbackChanges,
  recordActivity,
  userLabel,
  type PlaybackObservation,
} from './activity';
import { getSettings } from './settings';

// Observes existing sessions; never controls a player or creates a playback session.
let running = false;
let started = false;
let lastSuccessAt = 0;
let hasBaseline = false;
export const playbackObservationStatus = () => ({
  lastSuccessAt: lastSuccessAt ? new Date(lastSuccessAt).toISOString() : null,
  available: !!lastSuccessAt && Date.now() - lastSuccessAt < 20000,
});
const previous = new Map<string, { state: PlaybackObservation; user: User }>();
export async function observePlayback() {
  if (running) return;
  running = true;
  try {
    const config = getSettings().jellyfin;
    if (!config.apiKey || !config.ip) return;
    const client = axios.create({
      baseURL: `http${config.useSsl ? 's' : ''}://${config.ip}:${config.port}${config.urlBase || ''}`,
      timeout: 4000,
      headers: { Authorization: `MediaBrowser Token="${config.apiKey}"` },
    });
    const { data: sessions } = await client.get('/Sessions');
    if (!Array.isArray(sessions)) return;
    const users = await getRepository(User).find();
    const active = new Set<string>();
    for (const session of sessions.slice(0, 100)) {
      if (typeof session.UserId !== 'string' || !session.UserId || !session.Id)
        continue;
      const user = users.find(
        (u) =>
          !!u.jellyfinUserId &&
          u.jellyfinUserId.replace(/-/g, '') ===
            session.UserId?.replace(/-/g, '')
      );
      if (!user) continue;
      const key = `${user.id}:${session.Id}`;
      const item = session.NowPlayingItem;
      if (!item?.Id) continue;
      active.add(key);
      const play = session.PlayState || {};
      const language = (type: string, index: number) => {
        if (type === 'Subtitle' && index === -1) return 'off';
        const stream = item.MediaStreams?.find(
          (s: { Type: string; Index: number }) =>
            s.Type === type && s.Index === index
        );
        return activityText(
          stream?.Language ||
            (Number.isInteger(index) ? `track ${index}` : 'unknown'),
          50
        );
      };
      const state: PlaybackObservation = {
        item: item.Id,
        at: Date.now(),
        position: Math.max(0, Number(play.PositionTicks || 0) / 10000000),
        paused: !!play.IsPaused,
        title: activityText(
          `${item.SeriesName ? item.SeriesName + ' \u00b7 S' + item.ParentIndexNumber + ' E' + item.IndexNumber + ' \u00b7 ' : ''}${item.Name || ''}`
        ),
        device: activityText(
          `${session.DeviceName || 'Unknown device'} \u00b7 ${session.Client || ''}`
        ),
        audio: language('Audio', play.AudioStreamIndex),
        subtitle: language('Subtitle', play.SubtitleStreamIndex),
        method: activityText(play.PlayMethod, 30),
      };
      if (!Number.isFinite(state.position)) continue;
      for (const change of playbackChanges(previous.get(key)?.state, state))
        await recordActivity({
          userId: user.id,
          userName: userLabel(user),
          category: 'playback',
          action:
            !hasBaseline && change.action === 'playback.started'
              ? 'playback.detected'
              : change.action,
          device: state.device,
          title: state.title,
          details: JSON.stringify({ ...change.details, observed: true }),
        });
      previous.set(key, { state, user });
    }
    for (const [key, entry] of previous)
      if (!active.has(key)) {
        // Sessions disappearing can mean a closed client, so label this as observed end.
        await recordActivity({
          userId: entry.user.id,
          userName: userLabel(entry.user),
          category: 'playback',
          action: 'playback.ended',
          device: entry.state.device,
          title: entry.state.title,
          details: JSON.stringify({
            position: entry.state.position,
            observed: true,
          }),
        });
        previous.delete(key);
      }
    lastSuccessAt = Date.now();
    hasBaseline = true;
  } catch {
    /* A failed poll does not invent stops or interfere with playback. */
  } finally {
    running = false;
  }
}
export function startPlaybackActivity() {
  if (started || process.env.NODE_ENV === 'test') return;
  started = true;
  setInterval(() => void observePlayback(), 5000).unref();
}
