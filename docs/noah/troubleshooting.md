# Troubleshooting

[Documentation](README.md) · [Deployment](deployment.md)

Identify the profile, request/media ID, deployed image/player source, client and
failure phase. Capture sanitized status/timing evidence before editing settings.

| Symptom | Check | Avoid |
| --- | --- | --- |
| Fresh server checkout fails to load auth routes | Required runtime helper and full deployment prerequisites | Treating frontend CI as backend parity |
| Linking error after previously successful playback | Immutable mapping, token status, auth route response and network | Clearing users or shared tokens before finding the cause |
| No Play button despite a downloaded torrent | Import path, actual files, Jellyfin library scan and Seerr availability | Equating 100% torrent data with available library media |
| Loading before any stream request | Auth preparation and bridge ready/firstFrame/error events | Changing FFmpeg settings before the player reaches streaming |
| Resume absent on a watched episode | Seerr rewatch/viewing position and button calculation | Replacing history with Jellyfin's played flag |
| Cast receiver plays but controls fail | Sender SDK session, page lifecycle, actual receiver state | Assuming OS controls imply Seerr has a live SDK control object |
| Deleted media still appears or cannot be requested | File state, deletion review, retained seeding and request lifecycle | Wiping unrelated history to unblock a request |
| Downloads stopped or queue growing | qBittorrent state, storage, trackers and Sonarr/Radarr import errors | Restart loops that conceal persistent disk/auth/import failures |
| Anime preference seems ignored | Authenticated settings, discovery filters and client cache/profile | Mixing another profile's feeds or preference cache |

## Playback evidence

Separate these phases: account/session preparation, player assets/handshake,
PlaybackInfo, encoder/first-segment generation, transfer, decode/first frame.
Correlate timestamps across browser and server rather than treating the spinner
as one network delay. Record Direct Play vs remux/transcode and subtitle codec.

Use a fixture when possible. Preserve history and other viewers' sessions.
Strip tokens, cookies, API keys and signed URLs from browser errors, screenshots
and reports. Physical Mac/iPhone/Android/Cast claims require the corresponding
device/browser test; list verification limits in the incident record.
