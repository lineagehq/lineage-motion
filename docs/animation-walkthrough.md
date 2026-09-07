# Complete a two-shot animation

This replay uses two included public scenes. You can follow it yourself or ask
an agent to perform the same authoring steps. You do not need to write CSS.
The scenes deliberately share selectors and keyframe names so the final
animation also checks that shots remain isolated.

## Start a fresh project

After installing dependencies with `npm ci`, run the ordinary launcher in this
checkout. For a separate practice project, keep the temporary data path printed
by these commands and use it again when restarting:

```sh
MOTION_PRACTICE_DATA=$(mktemp -d)
printf 'Practice data: %s\n' "$MOTION_PRACTICE_DATA"
npm run dev:editor -- --data-dir "$MOTION_PRACTICE_DATA" --project 'Animation practice' --port 0
```

Open the named localhost address printed by the launcher. Keep that terminal
running. No fixture switch, credentials, or database setup is required.

## Make and assemble the shots

1. Open **Create a shot**. Name it **Opening**, choose the self-contained
   HTML/CSS starting point, and paste the complete contents of
   [the opening scene](../fixtures/public-synthetic/animation-opening.html).
   Create the shot. Choose **Caption** under **Object**, then **Fade**. Keep
   **Start (ms)** at `0`, set **Complete (ms)** to `2000`, and apply the action.
   Play the shot: the caption should fade in while the black tile moves right.
2. Create **Ending** from [the ending scene](../fixtures/public-synthetic/animation-ending.html).
   Add the same Caption Fade, completing at `3000` ms. Both shots have a
   320 × 180 canvas; Opening is red and lasts two seconds, Ending is blue and
   lasts three seconds.
3. Under **Build a full animation**, create an animation named **Practice**
   with Opening as its first shot. Choose Ending in **Saved shot to add** and
   add it. Move Ending earlier. Select its occurrence, set **End hold (seconds)**
   to `0.5`, and apply it. Undo the storyboard change, then redo it.
4. Use **Play all** and **Pause all**. The result should show blue for three
   seconds, hold its native endpoint for half a second, then cut to the
   two-second red shot. Total time is 5.5 seconds. At exactly 3.5 seconds the
   red shot owns the frame. Scrub backward and inspect reduced motion too.
5. Download the full animation. Reload the editor; the saved order and hold
   should remain. Stop the launcher with Ctrl-C and restart it with the same
   data path and project arguments. Open the saved Practice animation and
   download it again. Equal saved revisions should give identical files.
6. Stop the launcher, extract the ZIP, and open `animation.html` in a browser.
   The full animation should play without the editor or any service connection.

For a keyboard replay, use Tab and Shift-Tab to reach controls, arrow keys to
choose select options and scrub time, and Enter or Space to activate buttons.
Focus should remain visible. Try a negative end hold: it must preserve your
correctable draft and leave the saved animation unchanged. Correct the value
or discard the draft before continuing.

## Hand work to an agent

Use [shot command discovery](agent-cli.md) and the
[sequence command guide](agent-sequence-guide.md). Every CLI command must use
this launcher's data directory. In a second terminal, first set the variable
to the exact **Practice data** path printed before startup (replace the
placeholder below). Give that same path to an agent working in another shell.
Shell variables are not shared between terminals.

```sh
MOTION_PRACTICE_DATA='/replace/with/the/printed/practice/data/path'
npm run motion -- project --data-dir "$MOTION_PRACTICE_DATA"
npm run motion -- sequence-sources --data-dir "$MOTION_PRACTICE_DATA"
npm run motion -- sequences --data-dir "$MOTION_PRACTICE_DATA"
npm run motion -- sequence-clip-hold --help
```

Have the agent discover identities from these public receipts, acquire the
claim for the specific shot or animation, and name the current expected
revision in every mutation. For a complete CLI authoring replay, ask it to
admit the two provided files, add Caption Fade to each, assemble Ending then
Opening, set Ending's half-second end hold, undo/redo, release its claims, and
export the current sequence. The browser can inspect Play all without making
an authoring change. CLI export supplies the standalone artifact.

For a mixed replay, create Opening in the UI and let the agent create Ending.
Arrange the animation in the UI. Ask the agent to change a source shot, release
its claim, and read the updated source revision. The storyboard must keep its
old pin until you choose **Update this occurrence**. Human changes should then
appear in the agent's next public sequence read. A stale agent mutation must
fail explicitly; reconcile the newer state instead of silently changing its
expected revision. Claims expire after 60 seconds; the agent must inspect and
explicitly renew or reacquire as described in the command guide.

If the service stops during work, keep the same data directory, restart the
launcher, reopen the saved animation, and inspect its revision before editing.
An unconfirmed save offers retry of the original request; do not assume a
missing response means it was not saved.

## What the acceptance run measures

The automated replay measures UI-only authoring, CLI-only authoring, and three
fresh mixed runs, including keyboard-only UI editing. It records visible action
counts, time to first authored motion, time to finish the prescribed task,
viewport reachability, restart/recovery, and native cut/export behavior. The
approved targets after installation are two minutes to first authored motion
and ten minutes for the complete two-shot task, excluding CI/network queue
waits. These are automated-agent measurements, not a claim about every person's
speed or an independent human usability study. Owner participation is optional.
