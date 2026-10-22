# dsh-timeline-ui

Two optional UI enhancements for the [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) Web client:

1. **Conversation timeline** — the sidebar list grouped by local calendar day (Today / Yesterday / `Oct 20` / `Dec 20, 2025`), newest first, numbered, with search, an archived filter, and show-all.
2. **Rail on the left** — the per-turn navigation rail moves from the right edge to the left margin of the conversation, with a gaussian fisheye hover: the mark under the pointer grows, neighbours taper off, and everything returns to a uniform short line on leave.

Both features have their own switch under **Settings → General**; turning one off restores the native UI immediately.

## Install

Add this repository in the DSH plugin manager: https://github.com/darkknight2333/dsh-timeline-ui

Or use the DSH CLI, replacing `desktop` with your active profile (for example `web`):

```sh
dsh plugin --profile desktop add github:darkknight2333/dsh-timeline-ui
```

Restart DSH and refresh the UI. If the CLI is not in PATH, use its full installed path. The package-manager method below is an alternative.


Requires the DeepSeek Harness Web UI (the desktop app loads the same client). Install into a **profile**, not the application directory:

```bash
cd "$DSH_HOME/profiles/<profile>"          # e.g. ~/.dsh/profiles/desktop
pnpm add /path/to/dsh-timeline-ui-0.1.0.tgz
```

Add `dsh-timeline-ui` to `dsh.profile.bundles` in that profile's `package.json`, then restart the harness. Installing straight from git works too (`pnpm add github:darkknight2333/dsh-timeline-ui`) because `lib/` is committed.

The profile a desktop app and `dsh web` use is the same directory; pick it with `DSH_PROFILE` (defaults to `desktop` here). Never install into the application install folder — an upgrade wipes it.

## Compatibility

Tested with DeepSeek Harness `0.2.1-rc.2` on Windows desktop. The rail is not a slot, so the plugin discovers it at runtime (a `<nav>` with a `*_frame` class whose `button[data-index]` children share a `*_mark` class inside a `*_slot` parent) and generates styles from the discovered prefix — no CSS hash is baked in. If a future version changes that shape, the rail feature disables itself and says so in its settings row.

Automated: build, 56 offline checks (grouping, filtering, numbering, discovery, switches, teardown). Manual: screenshots, resize/collapse behaviour, fisheye feel — see `docs/VERIFICATION.md`.

## Uninstall

Disable the bundle in Settings → Plugins, or `pnpm remove dsh-timeline-ui` and drop it from `dsh.profile.bundles`. No session, archive state, or harness setting is touched. Preferences live in `localStorage` (`dsh-timeline-ui/prefs@1`).

## Development

```bash
npm run build   # src/client.js -> lib/client.js, plus portability checks
npm test        # 56 offline checks against the built module
```

MIT licensed. The icon is original artwork from this repository.
