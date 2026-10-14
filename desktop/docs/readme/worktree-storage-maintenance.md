# Worktree storage maintenance

Run from the repository to preview maintenance across its locally registered Git worktrees:

```sh
pnpm run reclaim:worktree-space
```

After stopping cross-version tests in all this repository's worktrees, apply cleanup with:

```sh
pnpm run reclaim:worktree-space --apply --tests-stopped
```

The command reuses the historical test cache, Electron distribution, and dev bundle cleanup scripts.
It shares complete Electron distributions through the repository cache and removes idle
`out/electron-dev` bundles, which development rebuilds on demand. It also removes stamped historical
test checkouts and shared seeds older than 30 days; tests regenerate them when needed. It leaves source files,
dependency installs, worktree registrations, and other build output alone. Reported sizes are
logical file data; APFS clones and hardlinks mean actual disk savings can be smaller.

Use `--release-cache-min-age-days 7` to shorten historical-cache retention, or `0` to select all
recognised completed historical checkouts. This age option applies only to test caches. Local
checkout age uses directory modification time, which ordinary reuse does not refresh. The
`--tests-stopped` flag acknowledges stopped tests; older harnesses cannot prove a completed
checkout is unused. Missing acknowledgement rejects manual apply before any cleanup begins.
Cache cleanup skips symlinks, malformed stamps, future formats, and publication/copy locks.
See [release source sharing](./release-source-sharing.md) for the cache and locking details.

Use `--repo DIRECTORY` to choose another local repository. Git's worktree list determines scope,
including registered worktrees outside Orca's workspace directory. Folder workspaces without Git
have no repository-wide sweep. These commands run on the local host: they do not inspect or delete
anything on SSH hosts. Run maintenance on the execution host when maintaining remote repositories.

## Keeping installs shared

Healthy Electron installs join the shared distribution cache during native dependency setup,
without waiting for an Electron upgrade. The manual command migrates older installs immediately.
Read-only Electron package directories are retained and reported as skipped. Cache publication
or copying failures are also reported as skipped rather than silently omitted.

Historical test cache cleanup runs only in this explicit manual command. Automatic invocations
exclude it because tests may still be importing source.
The repository lock prevents competing cleanup commands. Dev bundle removal checks active
processes and recent unfinished builds, then rechecks eligibility immediately before deletion.
An unreadable process table prevents removal.

To retain older bundles during a manual sweep, run the underlying command with an age limit:

```sh
node config/scripts/reclaim-dev-electron-bundles.mjs --min-age-days 7 --apply
```

That limit uses the bundle directory's modification time. The underlying command also accepts
`--exclude-worktree DIRECTORY` to protect an entire worktree. A missing exclusion path is an error;
filesystem aliases resolve to the same worktree. Neither option schedules cleanup.
