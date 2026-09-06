# Browser test lifecycle

Run `npm ci` and `npx playwright install chromium` before `npm run test:browser`.
CI uses `npx playwright install --with-deps chromium`. The lockfile pins the
Playwright package and its bundled Chromium revision; the default browser tests
select that bundled browser. `MOTION_TEST_BROWSER=chrome npm run test:browser`
selects installed Chrome explicitly. Existing `npm run qa:chrome` checks remain
installed-Chrome acceptance, including the public canvas QA subprocess exercised
by the reconciliation suite.

The shared `apps/editor/tests/test-server.ts` helper starts detached test process
groups, reads complete JSON readiness lines, and reports a bounded 8 KiB stderr
tail. Credential values, credential-shaped fields, URLs and local user/temp paths
are redacted before diagnostics leave memory. The helper terminates processes on
startup error or timeout; fixture teardown handles failed tests; worker signals
and process exit handle interruptions. A two-second termination grace period is
followed by a process-group kill. Test databases stay in isolated temporary
folders and are removed after the process closes.

Durable launchers request editor port zero. The launcher binds its actual HTTP
server to an OS-assigned port; it does not choose from a small random range or
release a reserved port before rebinding it. The nonpersistent layout/rejection
fixture also binds an OS-assigned port and supplies its URL through global setup.
No fixed-port background editor is required for this suite.

Import `test` from `test-fixture.ts` for server-backed tests. Spawn through
`spawnTestServer`, await `waitForTestServer`, and close with `stopTestServer` before
removing a database. Failed tests save a sanitized `server-diagnostics.txt` in
their `apps/editor/test-results` directory and attach it to the test result.
Upload those text files in CI; do not enable network traces containing local
capabilities as a substitute for sanitized diagnostics.

## Startup regression evidence

Main runs 34046205777 and 33896860963 failed in reconciliation/workspace setup
with `PHASE3_SERVER_EXIT_1`. Their helpers discarded stderr. Those historical
logs cannot establish which startup error caused the exit; a passing rerun
cannot recover that missing evidence.

An occupied listener reproduces exit 1 on the same launcher path and now reports
`Port ... is already in use`. The regression probe holds that listener open,
checks the actual diagnostic, then successfully starts with port zero and reopens
the same database. This demonstrates the collision failure class and its fix;
it does not claim that collision is the proven cause of either historical run.
Other launcher failures remain visible with the child exit status and sanitized
stderr instead of an unexplained exit code.

The public `server-lifecycle.spec.ts` exercises 20 start/edit/stop cycles with
concurrent isolated instances and database reopen, occupied-port failure,
early exit, missing executable, readiness timeout, interrupted-worker cleanup,
and forced termination of an uncooperative process. Reconciliation/workspace
remain real browser tests; lifecycle probes do not replace their assertions.

To verify that a deliberately failed test leaves readable artifacts, run:

```sh
MOTION_DIAGNOSTIC_PROBE=1 npx playwright test apps/editor/tests/server-lifecycle.spec.ts -g 'early exit' --config apps/editor/playwright.config.ts
```

This command intentionally exits nonzero. Its saved server diagnostic must show
`injected early failure token=[redacted]`, the child exit status, and the timeout
message, with no generated capability. The normal suite runs with the probe
variable unset and must pass without retries or quarantines.
