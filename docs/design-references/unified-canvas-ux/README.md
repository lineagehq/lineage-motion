# Unified canvas interaction reference

User-facing claim: a beginner can select either synthetic object and any of three moments, then move, uniformly scale, rotate, edit a waypoint, optionally translate both objects, preview the authored states, and Undo or Redo from one coherent canvas without opening Advanced.

This is a self-contained interaction reference. It uses generic shapes, synthetic values, and browser Web Animations. It is not compiler output, production behavior, a product fixture, or evidence of compiler equivalence. It has no external assets, fonts, imports, requests, or production dependencies.

## Interaction boundary

The default surface keeps object choice and persistent Path/Move together toggles above one stable 16:9 canvas. Moment navigation and Play/Pause/Undo/Redo remain below it. Path is an overlay, not a mode. Move together is translation-only at the active moment: the selected object is primary and the other object is secondary. Scale and rotation always affect only the selected object.

Advanced starts closed and overlays the canvas context as a right drawer on desktop or bottom sheet at narrow width. It exposes X, Y, uniform scale, rotation, moment time, easing, settled hold, and a stable synthetic ID. Opening it never changes canvas bounds.

Pointer gestures preview continuously and commit once on release. Escape or pointer cancellation restores the exact pre-gesture state without creating history. Object and waypoint clicks only select. Selection, moment navigation, Path visibility, Move together state, playback, and Advanced visibility are UI state and do not create history. Transform handles are positioned in the same canvas coordinates but keep independent 44×44 CSS-pixel hit targets, so authored object scale never shrinks their operable area.

## Keyboard map

When an object body is focused:

- Arrow keys translate by 1 canvas unit; Shift+Arrow translates by 10.
- Alt+Left/Right rotates by 1 degree; Shift+Alt+Left/Right rotates by 15 degrees.
- Alt+Up/Down changes uniform scale by 0.05; Shift+Alt+Up/Down changes it by 0.25.
- Scale is clamped to 0.25–3 and the clamp is announced.

When a waypoint is focused, Arrow keys move it by 1 canvas unit and Shift+Arrow by 10. Move together applies the same translation delta to both objects at that moment. Enter or Space selects a button or waypoint. Escape cancels an active edit or closes Advanced. All pointer handles provide at least a 44×44 CSS-pixel target; their visible marks are 14px.

The scale and rotation handles expose slider semantics. On a focused handle, Arrow Up/Right increases and Arrow Down/Left decreases the value; Shift uses the larger scale or rotation step documented above. Rotation uses the inclusive −180° to +180° range: Home commits and exposes −180°, End commits and exposes +180°, and ordinary arrows wrap coherently (+180° followed by an increasing step becomes −179°; −180° followed by a decreasing step becomes +179°). Enter or Space announces the current exact value. Each keyboard change is one Undoable transaction with polite live feedback and visible focus.

Settled hold is a browser-native playback interval. The Web Animation reaches the authored Settled state at 1400ms, repeats that exact keyframe through the configured hold, and only then reports playback ended. No JavaScript interpolation loop is used.

## Existing-operation and reference-only map

| Interaction | Existing typed-operation concept or UI boundary |
| --- | --- |
| Set one pose translation, scale, or rotation | `motion.transform-pose.set` |
| Translate a waypoint or both objects at a moment | `motion.transform-waypoints.translate` |
| Set moment time | `motion.keyframe-group-time.set` |
| Set easing | `motion.keyframe-group-easing.set` |
| Set settled hold | `motion.settled-hold.set` |
| Undo / Redo | `motion.history.undo` / `motion.history.redo` |
| Selection, Path visibility, moment navigation | UI-only actions |
| Play / Pause | Browser-native preview action |
| Direct handles, keyboard gestures, responsive chrome | Reference-only proposed UI |
| Synthetic playback | Reference-only browser Web Animations demonstration; not compiler output |

Unsupported and intentionally absent: grouped scale or rotation, Bézier/freeform paths, compiler equivalence, JavaScript interpolation, persistence, branching, claims, CLI behavior, agent integration, product content, and production imports.

## Exact verification

From the repository root, run:

```sh
node docs/design-references/unified-canvas-ux/verify.mjs
npm run check:sensitive
npm run check:private-ignore
git diff --check -- docs/design-references/unified-canvas-ux/index.html docs/design-references/unified-canvas-ux/README.md docs/design-references/unified-canvas-ux/verify.mjs
```

The verifier launches installed Chrome at 1440×900 and 768×900. It statically rejects unsafe/local references, then checks the non-authoritative boundary, initial and responsive layout, stable canvas bounds, full no-Advanced flows for both objects, selection-only clicks, direct pointer precision, grouped translation with Undo/Redo, exact settled playback with measured hold and no drift, truthful handle slider keyboard edits and announcements, 44×44 handle targets for both objects at every moment and minimum scale, focus behavior, polite announcements, Escape behavior, clipping/overflow/handle collisions, console/page failures, and non-document network activity. It prints only a concise aggregate receipt.

Top realistic failure modes covered by direct verification are: the overlay or responsive chrome changes the coordinate space; selection or grouping accidentally mutates geometry or creates history; browser playback stops short of Settled or drifts after completion.
