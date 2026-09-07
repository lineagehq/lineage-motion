# Public browser failure evidence

Public Playwright failures retain a bounded diagnostic bundle under an invocation
UUID, suite, Playwright test identity and retry directory. A later smoke suite or
invocation cannot clear that directory. Successful tests keep no routine screenshot
or trace. Existing server diagnostics remain local and are never part of upload.

The fixture observes pointer activation, history-handler acceptance, dispatch queue
entry/start/result, projection/feedback, button availability, focus, numeric history
and revision state, publication state, and correlated HTTP status/endpoint classes.
The event buffer holds 200 entries, evicts unrelated network/mutation events first,
and reports dropped events. It is bounded evidence, not a complete execution trace.
Network entries do not pretend to contain a contemporaneous inspector snapshot.
DEV-only editor instrumentation is opt-in through the browser-test init script.
It does not change dispatch decisions or production authoring controls.

Only strict enum/numeric fields and a finite public-test source inventory may cross
the upload boundary. Assertion source line, matcher and numeric/boolean expected
and actual values identify the assertion without uploading its text or stack.
Unsupported assertion values are null. SHA, dirty flag, invocation, suite, hashed
test title, retry, viewport, browser and CI run/attempt identify provenance. CI
staging rejects dirty, wrong-commit, wrong-run, wrong-attempt and direct-run data.

`node --import tsx scripts/stage-browser-diagnostics.ts` validates candidate JSON
and regenerates a screenshot in an isolated browser context from the validated
state. **This is a rendered diagnostic-state screenshot, not editor pixels.**
No authored DOM, CSS, images, browser logs, raw assertion messages, raw URLs,
headers, bodies, traces or local server diagnostic files are uploaded. Raw browser
screenshots and traces are unsuitable for upload even with synthetic scenes.
Unknown candidate attachments, invalid values, symlinks, duplicate identities,
oversized candidates and renderer failure reject the staging set and leave an
explicit safe rejection JSON. Workflow uploads only the staging directory and
retains it for seven days. At most 100 candidate bundles of 150KB JSON each are
accepted; screenshots use a fixed 1280×900 viewport.

Focused coverage is in `apps/editor/tests/browser-diagnostics.spec.ts`. It injects
content/header/body/URL/log sentinels, checks strict schema rejection, main-frame
isolation and milestone survival under mutation bursts, and exercises real staging
with an unknown attachment. CI upload/download proof uses a temporary controlled
failure removed before the PR becomes ready; it is not a permanent failure switch.
