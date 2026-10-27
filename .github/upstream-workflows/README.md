# Archived upstream workflows

These definitions are retained for upstream comparisons. They are outside
`.github/workflows`, so GitHub Actions does not run them. They include upstream
release, preview, Helm, issue automation and security workflows that target
upstream branches or services. Do not move them back without reviewing triggers,
permissions, secrets and dependencies for this fork.

The active fork workflow is [`noah-player.yml`](../workflows/noah-player.yml).
It runs the bridge, type checks, tests, coverage, build, container and browser
fixture checks, followed by Sonar analysis when configured. This archive does
not itself provide upstream CodeQL or container vulnerability scanning.

When updating from upstream, compare upstream workflow changes with these files
and deliberately port useful changes to the fork workflow. Git merges may
restore or conflict with upstream workflow paths: inspect `.github/workflows`
after every upstream merge and keep only intentionally enabled workflows there.
GitHub may retain historical workflow entries and run history after a definition
is moved; their UI lifecycle is controlled by GitHub.
