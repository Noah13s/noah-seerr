# Development and testing

[Documentation](README.md) · [Architecture](architecture.md) · [Deployment](deployment.md)

Use a `codex/` branch from this fork's `main`. Read
[CONTRIBUTING.md](https://github.com/Noah13s/noah-seerr/blob/main/CONTRIBUTING.md) for upstream conventions and the
[installation boundary](installation.md) before running the whole server.

## Frontend/bridge gates

From the repository root, using the pinned toolchain:

```sh
node --experimental-transform-types --test scripts/test-player-bridge.cjs
pnpm typecheck:client
pnpm build:next
```

These match [custom CI](https://github.com/Noah13s/noah-seerr/blob/main/.github/workflows/noah-player.yml).
They do not certify every custom server route. For backend work, also inspect
`pnpm typecheck:server`, `pnpm build:server`, the relevant isolated tests and
the actual compiled runtime image. Document baseline failures rather than
silently claiming broad validation.

## Change checklist

| Change | Review together |
| --- | --- |
| Play overlay or messages | PlayButton, translated labels, PlayerBridge and player fork |
| Resume/rewatch | Seerr history calculations, movie/episode buttons and viewing-session progress |
| Anime visibility | User setting, discovery feeds/sliders, history filters and native TV consumer |
| Cast commands | Sender state, recovery utilities and actual receiver behavior |
| Authentication | Immutable linked identity, browser/native isolation, revocation and concurrent renewal |
| Request/deletion lifecycle | Active requests, actual files, tracker retention and re-request behavior |
| Database schema | Both supported database migration paths and backup/restore review |

## Useful interaction checks

Use a non-admin fixture for normal viewing and a separate admin test for admin
features. Cover fresh play, resume, watched-episode rewatch, subtitle changes,
seek, exit/reopen and stale iframe cancellation. Check navigation on narrow
mobile and wide desktop layouts. Keep anime disabled in one test profile.

Intercept watch-history and Jellyfin playback reports when testing real media
with the operator harness, so tests do not alter users' records. A browser UA
spoof does not verify physical Safari/Android/Cast behavior.

## Documentation changes

Keep README as an entry point and put procedures in `docs/noah/`. Verify local
links, command names and Mermaid diagrams. Preserve upstream attribution. Never
include production settings, cookies, PINs, signing material or raw request logs
in public documentation or pull requests. Ask the owner before committing,
pushing or merging Noah work.
