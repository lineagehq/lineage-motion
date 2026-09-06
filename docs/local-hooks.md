# Local commit and push verification

Install dependencies with `npm ci` in each checkout to prepare Husky. Hooks are
local reassurance; required pull-request checks remain the merge authority.

The commit hook inspects Git's complete index, including partially staged files,
using blob IDs. It checks privacy patterns, forbidden local/generated artifacts,
a 5 MiB file cap, the existing 500-line code policy, and the staged verification
manifest's test ownership and tiers. It rejects symlinks/submodules and unresolved
conflicts rather than following unknown content. It does not stash, rewrite,
or stage anything. Diagnostics report entry numbers and reasons without printing
potentially sensitive snippets or filenames. Generic privacy patterns cannot
identify every form of private prose; inspect the complete diff before publishing.

The push hook reads Git's ref updates from standard input and verifies every
unique non-deletion commit tip in a temporary detached worktree. This includes
alternate branches, tags resolving to commits, new branches, force updates and
multiple refs. Missing remote base objects conservatively broaden selection.
Deletion-only pushes need no source verification. Renames consider both paths.
A dirty checkout cannot substitute its bytes for the pushed commit.

Every tip receives staged policy, the complete `fast` tier, type checking, the
production build and determinism. Changes outside the explicitly known prose
and editor CSS paths also run service integration and parity. New
branches run these stateful leaves too. The verification manifest remains the
single owner of test leaves; the hook only selects existing suites. Independent
leaves run concurrently, and every result must pass.

Dependencies are installed with lifecycle scripts disabled. For repositories
without linked workspace packages, an installation cache under the shared Git
metadata is keyed by exact package/lock bytes, Node/npm versions, architecture
and operating system. Concurrent installs use separate directories and publish
only a completed installation. Repository-linked dependencies use an isolated
installation inside the tested worktree instead. No install invokes Husky or
changes shared repository configuration. Snapshots are removed on normal
completion, failures and handled termination signals. A hard process kill can
leave a temporary worktree; inspect `git worktree list` before removing only the
identified abandoned snapshot.

To reproduce hooks directly, run `node scripts/check-staged.mjs`; for push,
provide the same four-column ref records Git sends to `scripts/check-push.mjs`.
An empty push input means no updates, so it is not an all-purpose test command.
Use `npm run verify:fast` or selected manifest suites for focused development.

Adversarial hook tests use disposable repositories and a local bare remote.
They exercise real rejection of a bad staged commit and alternate bad pushed
tip, partial staging in both directions, manifest drift, renames/deletions,
multiple refs, unknown changes, new branches and shared worktree preservation.
