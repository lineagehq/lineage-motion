# Assemble an animation with the agent CLI

Start the normal editor with `npm run dev:editor`. In that same checkout,
`npm run motion -- help` discovers both shot authoring and sequence commands.
The launcher stores the local service connection privately. Select an open
project with `--project NAME` when several exist; use the same `--data-dir` as
its launcher when configured. No capability or claim secret needs copying.

## Discover the saved shots and storyboard

```sh
npm run motion -- projects
npm run motion -- sequence-sources
npm run motion -- sequences
npm run motion -- sequence --sequence-id story
npm run motion -- sequence-clip-add --help
```

`sequence-sources` reports each saved shot's document ID, revision, canonical
digest, duration in milliseconds and certified viewport. An unsupported shot
has a null viewport and a reason. Choose supported sources with the same
viewport. A sequence holds exact source revisions, so editing a shot does not
silently change an assembled animation. The sequence snapshot exposes stable
clip IDs, source pins, end holds, revision, history availability and the active
claim's lease version and expiration.

An omitted sequence ID is accepted only when the project has exactly one
sequence. Creation always requires an explicit new ID. Names are labels;
commands select stable IDs. Shot selectors such as `--shot` and `--document-id`
are rejected on sequence commands. Use `--source-document-id` for a clip's shot.

## Create and assemble two shots

These examples assume discovery returned `shot_two` at revision 0 with a
320×180 viewport and a two-second duration, and `shot_three` at revision 0 with
the same viewport and a three-second duration. Substitute the actual discovered
IDs, revisions and dimensions. Operation IDs identify one exact request.

```sh
npm run motion -- sequence-create --sequence-id story --name 'Product animation' --viewport-width 320 --viewport-height 180 --claim assembly --operation-id create-story --expected-revision 0
npm run motion -- sequence-clip-add --sequence-id story --clip-id opening --name Opening --index 0 --source-document-id shot_two --source-revision 0 --claim assembly --operation-id add-opening --expected-revision 0
npm run motion -- sequence-clip-add --sequence-id story --clip-id ending --name Ending --index 1 --source-document-id shot_three --source-revision 0 --claim assembly --operation-id add-ending --expected-revision 1
npm run motion -- sequence-clip-move --sequence-id story --clip-id ending --index 0 --claim assembly --operation-id move-ending --expected-revision 2
npm run motion -- sequence-clip-hold --sequence-id story --clip-id ending --end-hold-seconds 0.125 --claim assembly --operation-id hold-ending --expected-revision 3
npm run motion -- sequence-undo --sequence-id story --claim assembly --operation-id undo-hold --expected-revision 4
npm run motion -- sequence-redo --sequence-id story --claim assembly --operation-id redo-hold --expected-revision 5
```

Indices are zero-based. Seconds convert exactly to integer milliseconds;
`0.125` means 125 ms, while `0.0001` fails visibly. `--end-hold-ms` is an
alternative to `--end-hold-seconds`; passing both fails. The hold extends the
shot at its native end, including CSS fill behavior. It does not alter its
source document. Hard cuts and reduced-motion behavior follow the
[sequence contract](sequence-contract.md).

Creation can atomically include the first clip: add `--clip-id`, `--clip-name`,
`--source-document-id` and `--source-revision` together, optionally with
`--end-hold-seconds`. Otherwise it creates an empty storyboard that cannot yet
be exported. Sequence revisions start at 0; successful edits and undo/redo each
advance one revision. Claim controls preserve the sequence revision.

Other available commands are `sequence-rename`, `sequence-clip-rename`,
`sequence-clip-duplicate`, `sequence-clip-remove` and
`sequence-clip-update-source`. Each command's `--help` lists its exact inputs.
Duplicated clips get an explicit new clip ID and independent names and holds.
To adopt a human's saved shot changes, read `sequence-sources` again and run:

```sh
npm run motion -- sequence-clip-update-source --sequence-id story --clip-id ending --source-document-id shot_three --source-revision 1 --claim assembly --operation-id update-ending --expected-revision 6
```

This is an explicit revision change and participates in undo/redo. Sources
must still satisfy the fixed viewport and supported native-animation contract.
No command silently retries a stale revision with a newer one.

## Claims, races and interruption recovery

`sequence-create` acquires a sequence claim for the managed agent. To edit an
existing unclaimed sequence, use `sequence-claim-acquire` with a fresh handle,
operation ID and its current expected revision. Handles are private local
names scoped to this checkout, service session, project and exact sequence.
Sequence claim handles are stored separately from shot claim handles; neither
can authorize the other's operations.

Read the current sequence before renewing or releasing. Supply its current
revision and the exact active lease version:

```sh
npm run motion -- sequence --sequence-id story
npm run motion -- sequence-claim-renew --sequence-id story --claim assembly --operation-id renew-assembly --expected-revision 7 --lease-version 1
npm run motion -- sequence-claim-release --sequence-id story --claim assembly --operation-id release-assembly --expected-revision 7 --lease-version 2
```

Claims last 60 seconds and are never renewed automatically. After expiry or
release, inspect the current sequence and explicitly acquire a new handle.
A human cannot change a sequence while an agent owns its active claim. The
human can revoke it using `sequence-claim-revoke` with explicit human transport,
claim ID and lease version. Shot edits use their own shot claims independently.
After releasing the sequence claim, human storyboard changes appear in the
next `sequence` read. Two writes with the same expected revision have one
winner; reconcile the losing draft before sending a new operation ID.

If a process dies or a response is lost, repeat the original command with its
original handle, operation ID, revision and arguments. Private immutable
records preserve the request and its resolved source pins before sending it.
A committed request replays its original receipt even if its source has since
changed. The same recovery applies to create/acquire, renew and release.
Successful retries never duplicate clips or history entries. Reusing an
operation ID for different inputs is rejected. Source discovery is consulted
when preparing a new source edit, so a stale requested source revision fails
rather than pinning a different revision.

An acquisition with no local receipt is pending: retry the original
`sequence-create` or `sequence-claim-acquire` first. If a service restart changes
the endpoint, capability or stored project identity, old handles cannot authorize
the new session.
Inspect the saved sequence and active claim, then acquire a new handle after
release, revocation or expiry. Do not delete private claim files to bypass an
uncertain result. Previously recorded requests can be replayed after release
within the same session; new edits with that released handle are rejected.

## Export the exact saved sequence

```sh
npm run motion -- sequence-export --sequence-id story --expected-revision 7 --output /tmp/product-animation.zip
```

Export requires the exact current committed sequence revision and no claim.
The service compiles its pinned source revisions and returns a validated
receipt. The CLI writes `animation.html`, `animation.css` and `receipt.json` in
a deterministic ZIP. Open the extracted HTML to play the native composition
without the service. The same committed sequence exports identical bytes from
the CLI and UI. The receipt records sequence identity, revision, digest and
source pins; the CLI also reports the archive digest.

Existing destinations are never overwritten. The archive is fully written and
synced in private staging before exclusive publication. Standard output
contains the receipt and archive digest, never HTML/CSS, private credentials or
output paths. A staging-cleanup warning means publication succeeded; inspect
the destination rather than treating it as an uncommitted export.
