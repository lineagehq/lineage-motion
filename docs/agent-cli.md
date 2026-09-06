# Create motion with an agent

Start the app with `npm run dev:editor`. From this checkout, or any directory
inside it, run `npm run motion -- help`. The CLI reads the launcher's private
local session and acts as an agent. No capability or claim secret needs to be
copied into a command, shell history or chat.

Use `npm run motion -- projects` to list open projects in this checkout.
Choose one with `--project "My animation"` when more than one is open. If the
launcher used a custom external data directory, pass the same `--data-dir` to
the CLI. A different worktree has separate sessions, even for the same project
name. `context` reports the selected project and actor without credentials.

Run `project` or `shots` to discover the catalog, stable document IDs and shot
names. Run `workspace --document-id DOCUMENT_ID` to inspect a shot's revision,
objects, tracks, moments, cues and eligibility. Use `--shot "Shot name"` only
when the name is unambiguous. Once editing, keep the exact document ID; the CLI
never changes an explicit target because another shot appeared. Branches are
listed by `branches`; select one explicitly with `--branch-id`, otherwise the
branch is `main`.

Create a new shot with `shot-admit --help`. Choose a stable new document ID
and handle; the service admits the shot and its document claim atomically.
For example, use values from `project` in:

```sh
npm run motion -- shot-admit --project-id PROJECT_ID --expected-catalog-revision CATALOG_REVISION --document-id intro --name "Intro" --starter trajectory --claim intro-edit --operation-id admit-intro
```

The available starters are `trajectory` and `reusable-cues`. To import your own
standalone HTML/CSS, replace `--starter trajectory` with `--html-file PATH`.
The response includes imported/unsupported/missing inventories; rejected
imports leave the project unchanged. The `intro-edit` handle already owns the
new document claim, so it can be used directly for authoring, renewal and
release. Do not acquire a second claim over that same document.

The following command templates use values from those responses. Append the
same `--project` and `--data-dir` options to every command when needed. Replace
uppercase placeholders; do not guess source selectors or IDs. Executable
argument arrays for this workflow are also included in `help` under `examples`.

```sh
npm run motion -- claim-acquire --document-id DOCUMENT_ID --claim edit --scope document --expected-revision REVISION --operation-id acquire-edit
npm run motion -- track-create --document-id DOCUMENT_ID --claim edit --element-id ELEMENT_ID --expected-revision REVISION --operation-id create-motion --validate-only
npm run motion -- track-create --document-id DOCUMENT_ID --claim edit --element-id ELEMENT_ID --expected-revision REVISION --operation-id create-motion
npm run motion -- head --document-id DOCUMENT_ID
npm run motion -- claim-renew --document-id DOCUMENT_ID --claim edit --expected-revision NEW_REVISION --operation-id renew-edit --lease-version LEASE_VERSION
npm run motion -- claim-release --document-id DOCUMENT_ID --claim edit --expected-revision NEW_REVISION --operation-id release-edit --lease-version NEW_LEASE_VERSION
```

Select an object whose advertised action is available. `--validate-only` checks
without writing; remove it to submit that exact operation. Read the new head
and claim receipt after success. Claims last 60 seconds. Renewal and release
require the exact lease version, expected revision and an explicit operation
ID. The CLI never updates those expectations, renews, reacquires, revokes,
changes actor or picks a different claim on your behalf. A document claim is
still bound to the branch selected by this local handle; use a separate handle
for a different editing context.

Each handle stores only credentials and immutable request/receipt metadata in
a private directory alongside the external launcher session. It does not
write product state. A new acquisition uses a new handle and fresh secret.
The app service alone decides whether a claim is active, expired or revoked.
Explicit transport commands remain available through `--service`,
`--capability`, `--actor` and `--claim-secret`, but cannot be mixed with a managed
handle or managed project selection. `claim-secret` is for explicit transport;
its secret output must be kept private.

## Recovery without changing the request

If the CLI is killed or loses the response during acquisition, repeat the
original `claim-acquire` with the same handle, operation ID, scope and expected
revision. The private credential is published atomically before any request;
the retry uses exactly that secret. There is no lock to delete or steal.
A pending handle rejects authoring until the acquisition receipt is recovered.
For interrupted shot admission, retry the exact `shot-admit` command and source
with its original catalog revision; only a request digest and claim metadata
are cached locally, never imported source bytes.
Renewal and release retries likewise require their original lease version and
revision. Release stays terminal for authoring while its exact retry remains
available. A different request with the same operation ID is rejected locally.

If the app restarts, its capability rotates and old handles report
`CLI_SESSION_CHANGED`. Inspect the new workspace and active claims, reconcile
your draft, then explicitly acquire a new handle when appropriate. An overlapping claim must be released by its owner or expire before another
acquisition succeeds. An expired or revoked claim produces an authorization failure; a stale edit produces a
revision failure. Neither changes the document. The service can be restarted
and the exact request retried, but a new session never silently inherits the
old capability. Malformed, unsafe or missing context errors contain no secret,
local filename, command-file contents or private source text.

## Units and command discovery

Every public command supports `COMMAND --help`, including review dispatch,
annotations, comparison and handoff. The main help includes all commands and
the recovery codes. Command files use the shared protocol; managed dispatch
and validation reject document or branch identities different from the
selected handle.

Use decimal seconds instead of milliseconds by replacing a `-ms` suffix with
`-seconds`: `--time-seconds 1.25` means exactly 1250 ms. Values finer than a
millisecond are rejected. `--translate-x-pixels -0.5` and
`--translate-y-pixels 20` convert exactly to canonical microunits. Relative
`--delta-x-pixels` and `--delta-y-pixels` require `--viewport-width` and
`--viewport-height`; a value that cannot be represented exactly in viewport
parts per million is rejected. Canonical integer flags remain available.
Do not supply both forms of the same option. Unknown, duplicate, missing,
overflowing and inexact arguments fail before mutation.

`track-create` accepts `--duration-seconds`, `--delay-seconds`, `--start-value`
and `--end-value` for a fade on any eligible discovered object. The default
fade runs from opacity 0 to 1 for one second after a 0.61-second delay. Choose
values inside the loaded shot's duration and use `--validate-only` first.
`hold-insert --cue-id CUE_ID --duration-seconds 0.43` pauses the whole shot at
a discovered timeline cue, including later motion. This differs from a
reusable `cue-create --semantic hold`, which holds selected objects. Whole-shot
pauses visibly reject unsupported animation crossings or attached cue bundles.

## Download a standalone shot

Use `export --help` after inspecting the saved head. For example:

```sh
npm run motion -- export --document-id DOCUMENT_ID --expected-revision REVISION --output /path/to/animation.zip
```

The ZIP contains standalone HTML, CSS and a verification receipt. An authoring
claim is not required for this read. Existing destinations are never replaced;
choose another output filename to export again. A stale expected revision or
wrong project fails without writing an artifact. Standard output contains only
identity/digests and inventory counts, never exported HTML/CSS or the output path.
See [standalone export](standalone-export.md) for independent playback and recovery.
