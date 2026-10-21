# Noah Seerr documentation

[Project overview](https://github.com/Noah13s/noah-seerr) · [Standard Seerr settings](../README.md)

| Read this when… | Guide |
| --- | --- |
| You need the global picture or source map | [Architecture](architecture.md) |
| You are setting up a checkout | [Installation](installation.md) |
| You are changing the bridge, UI or backend | [Development](development.md) |
| You are releasing or updating a fork | [Deployment and updates](deployment.md) |
| You need playback, history, pairing or profile behavior | [Playback and features](playback.md) |
| Something is slow, unavailable or inconsistent | [Troubleshooting](troubleshooting.md) |

## Source ownership

This public fork contains the website, bridge and custom server source.
The public [player fork](https://github.com/Noah13s/noah-jellyfin-web) contains
browser playback hooks. The private integration repo contains the native app,
scoped-session runtime helper, deployment gates and exact release manifests.
Never copy production settings, session databases, signed URLs or credentials
into either public repository.

## Keeping docs useful

Each guide links to maintained source and has one operational purpose. Update
commands and diagrams when changing behavior. Keep incident timing/screenshots
in dated verification records; identify the browser/device and what was actually
tested. Prefer diagrams for architecture and sanitized screenshots for UI tasks.
The root README stays short; upstream generic settings remain in the existing
documentation rather than being duplicated here.

Diagrams include SVG images for viewers without Mermaid support and collapsible
definitions for maintenance. Open the image for full-size labels. Regenerate
SVGs from their Markdown definitions using Mermaid 12.2.0, `htmlLabels: false`
and a white background; keep source and image in sync. Source-code links use
GitHub URLs so the upstream docs generator does not import application modules.
