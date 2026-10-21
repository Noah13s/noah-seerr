# Noah Seerr

<img src="public/logo_full.svg" alt="Seerr" width="220">

The customized **Noah Stream website and playback host**, forked from
[Seerr](https://github.com/seerr-team/seerr) v3.5.0. Users browse and request
media here, manage their own watch history, and play through the integrated
[Jellyfin Web fork](https://github.com/Noah13s/noah-jellyfin-web).

## What belongs here?

| Area | Responsibility |
| --- | --- |
| Browsing | Movies, series, optional anime, discovery sliders, watchlist and Continue Watching |
| Watch history | Per-profile progress, rewatch resume, episode overrides and star ratings |
| Playback host | Preparation, scoped Jellyfin sessions, protocol 1 bridge and Seerr Cast controls |
| Accounts | Login, device pairing, preferences and permissions |
| Administration | Integrated service tools, notifications and media cleanup review |
| Upstream foundation | Request workflows, Sonarr/Radarr integration, library sync and settings |

**Deployment boundary:** current fork CI validates the bridge and Next frontend.
Production retains a separately validated custom backend image. This checkout's
auth routes reference a runtime helper maintained in the private integration
repo; a fresh full-server build is not a drop-in production replacement.
Read [installation scope](docs/noah/installation.md) before starting.

## Documentation

| Goal | Guide |
| --- | --- |
| Global summary and source ownership | [Documentation index](docs/noah/README.md) |
| Understand requests, progress and player hosting | [Architecture](docs/noah/architecture.md) |
| Install dependencies or set up development | [Installation](docs/noah/installation.md) |
| Change and test the code | [Development](docs/noah/development.md) |
| Deploy, update upstream or roll back | [Deployment and updates](docs/noah/deployment.md) |
| Understand playback and profile behavior | [Playback and user features](docs/noah/playback.md) |
| Investigate an issue | [Troubleshooting](docs/noah/troubleshooting.md) |
| Configure standard Seerr features | [Upstream documentation](docs/README.md) |

## Related projects and release policy

The browser engine lives in **noah-jellyfin-web**. The private **Noah Stream**
repo owns the Flutter/native TV app, operational integration and release records.
Jellyfin Server owns authorized media delivery and transcoding. The TV app uses
media_kit/libmpv rather than the browser player.

Keep custom work on reviewed `codex/` branches and preserve upstream ancestry.
The fork tracks reviewed stable releases; upstream `develop` can legitimately
contain unreleased commits. Build success does not prove live backend parity.

## Upstream and license

Seerr builds on the work of Seerr, Jellyseerr and Overseerr contributors. This
fork retains the [MIT license](LICENSE), [contribution guide](CONTRIBUTING.md),
[security policy](SECURITY.md) and upstream history. Report custom integration
issues here with credentials removed from all evidence.
