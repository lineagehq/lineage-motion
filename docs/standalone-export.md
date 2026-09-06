# Download and play a shot independently

In the normal editor, finish applying or discarding your editing drafts, inspect
**Reduced motion**, then choose **Download animation** beside the preview.
The download captures the selected shot's saved branch and revision. Editing or
switching that context while the export request is pending prevents its download;
wait for the new saved state and try again.

An agent uses the same export service with:

```sh
npm run motion -- export --document-id DOCUMENT_ID --expected-revision REVISION --output /path/to/animation.zip
```

Use the ID and revision from `workspace` or `head`, plus the normal `--project`
and `--data-dir` options when needed. No authoring claim is needed to read an
export. An explicit `--project-id` must match the selected service's project.
The output filename must end in `.zip`. Existing files and symlinks are never
overwritten. The browser handles its own download filenames and destination.

Unzip the archive and open **animation.html** in a browser. It includes its CSS
and plays without the editor or local service. **animation.css** is an identical
copy of the compiled stylesheet for inspection or reuse; the HTML does not need
to fetch that separate file. **receipt.json** records the project, shot, branch,
revision, content hashes and animation inventory. Equal committed content and
identity produce identical archive bytes across UI/CLI runs and service restarts.
Browser reduced-motion preferences use the same compiled rules shown in the editor.

Exports contain your authored presentation locally. Keep private artifacts out
of source control or public uploads. Receipts contain identifiers, digests and
counts rather than presentation text; CLI output never prints exported HTML/CSS.

A stale revision requires inspecting the current saved head and explicitly
choosing which revision to export. Unsupported animation constructs block export;
correct the shot before retrying. A lost service connection produces no confirmed
download. For CLI `EXPORT_OUTPUT_EXISTS`, choose a new filename; for
`EXPORT_OUTPUT_UNAVAILABLE`, check that the destination directory exists and is
writable. `EXPORT_STAGING_CLEANUP_FAILED` accompanies a successful complete export
when removing its temporary sibling directory failed; the returned archive digest
still identifies the output. `EXPORT_OUTPUT_AND_CLEANUP_FAILED` means publication
failed and temporary cleanup also failed. Inspect the destination and any
`.motion-export-*` sibling left by that attempt before retrying.
