# Lineage Motion

Lineage Motion is an experimental local app for creating CSS animation shots
and assembling them into a complete animation. Use the editor, an agent CLI,
or both: they submit the same typed operations to one persistent local service.

Start with the [two-shot walkthrough](docs/animation-walkthrough.md). Agents can
use [shot command discovery](docs/agent-cli.md) and the
[sequence command guide](docs/agent-sequence-guide.md). The
[storyboard guide](docs/storyboard-guide.md) explains assembly and Play all;
[local hooks](docs/local-hooks.md) and [verification](docs/verification.md)
explain the development loop.

## Run the editor locally

Install Node.js 22.22 or newer, then run:

```sh
npm ci
npm run dev:editor
```

Open the named localhost address printed by the command. The included public
starter is ready for editing: choose Cursor or Orb under **Object**, then
choose **Fade**, set its timing and apply the action. Changes are committed by
the local service and survive Ctrl+C and restarting the same command.

Use `npm run dev:editor -- --project "Second animation" --port 0` to open another
isolated project on an available port. Project names select separate local data;
worktrees are isolated even when their project names match. Reuse the same
checkout and project name to reopen existing edits. Moving a checkout changes
its local identity; retain its old data when relocating work.

Data lives outside Git in `~/.local/share/lineage-motion`, in private directories
keyed by checkout and project. Override the base using `--data-dir /external/path`.
The printed local session file is private and contains the current agent
connection capability; do not copy it into prompts, commits, or reports.
It is removed at clean shutdown and recreated on launch. Stop with Ctrl+C;
closing the browser alone leaves the service running.

If the port is occupied, use `--port 0` or stop its other listener. If storage
cannot open, choose a writable external data directory. If the browser cannot
connect, keep the launcher running and use Retry connection. An already-open
project must be stopped before another launcher can acquire its database lock.
Direct Vite startup is a development inspection surface; use the command above
for durable authoring.

## Create, assemble and export

Create a shot from a provided starter or import supported self-contained
HTML/CSS. Select an object to add a Fade, edit supported timing and motion,
inspect the compiled preview, and undo or redo saved changes. Eligible trajectory
shots also offer direct canvas editing; unsupported operations explain their
restriction. Pending, saved and rejected changes remain distinct.

Build a full animation from saved shots. Each occurrence pins an exact source
revision and has its own name and end hold. Reorder, duplicate or remove
occurrences, inspect reduced motion, and use **Play all** or the full-animation
scrubber. Source edits enter an occurrence only through an explicit update.
Composition currently requires finite supported shots with the same certified
fixed viewport and uses hard cuts. Infinite, authored-paused and unsupported
sources cannot be added; an empty storyboard cannot be played or exported.

Download a shot or the full animation as a deterministic ZIP containing HTML,
CSS and a verification receipt. Extract it and open the HTML without the editor
or service. Sequence output isolates shots in scriptless embedded documents and
includes a generated JavaScript clock that controls browser-native CSS
animations. It does not interpolate CSS property values. Preview and export use
the same compiler output. See the [sequence contract](docs/sequence-contract.md)
and [standalone export guide](docs/standalone-export.md) for exact boundaries.

## Work with an agent

Keep the ordinary launcher running, then use another terminal in this checkout:

```sh
npm run motion -- help
npm run motion -- project
npm run motion -- shots
npm run motion -- sequence-sources
npm run motion -- sequences
npm run motion -- shot-admit --help
npm run motion -- sequence-create --help
npm run motion -- sequence-export --help
```

Pass the same `--data-dir` and `--project` options to discovery and authoring
commands when the launcher uses them. Command help needs no session selection.
Discover IDs and revisions from public receipts before editing. Managed CLI
handles keep connection capabilities and claim credentials private; do not copy
those credentials into prompts. Agent writes require a claim for the selected
shot or sequence and an exact expected revision. Claims have explicit leases,
renewal and release; stale writes fail atomically. After a service restart,
inspect saved state and reconcile the new session before acquiring a new handle.
The linked command guides cover interrupted requests and exact retries.

## Status and boundaries

This remains a standalone experimental product, separate from
[lineagehq/lineage](https://github.com/lineagehq/lineage). There is no published
package, stable public schema, hosted service or Lineage database integration.
Crossfades, audio, video export, nested animations, arbitrary responsive
composition and imported script execution are outside this delivery. Private scenes, customer
content, local databases and credentials must never enter repository evidence.

The [current phase status](docs/phase-status.md) distinguishes merged delivery
from accepted local work awaiting integration. The
[delivery evidence index](docs/animation-delivery-evidence.md) maps product claims
to tests and records measured synthetic journeys. These results do not establish
private-corpus fitness or replace a human usability study. Final completion still
requires verification on the delivered main commit.

The [approved delivery plan](docs/animation-delivery-plan.md) records dependencies
and acceptance criteria. The [incubation plan](docs/incubation-plan.md) preserves
the original roadmap; [architecture](docs/architecture.md),
[private-corpus policy](docs/acceptance-corpus.md) and
[agent execution workflow](docs/agent-workflow.md) define working boundaries.

## License

[MIT](LICENSE)
