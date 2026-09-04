import payload from 'virtual:motion-document';
import {
  authoring, creationChoices, reusableCueWorkspace, reusableHoldTargetOptions, reusableTargetOptions,
  reusableTextTargetOptions, serviceClient, statusCopyElementId,
} from './main.js';

export function editorShellMarkup(): string {
return `
  <main class="editor-shell">
    <header class="topbar">
      <div><p class="eyebrow">Motion Editor</p><h1>Bring one element into motion</h1><p class="purpose">Choose what moves, shape its opacity, set its timing, then preview the compiled CSS.</p></div>
      ${serviceClient ? `<section class="branch-controls collaboration-bar" aria-label="Durable collaboration status">
        <div class="collaboration-summary" aria-label="Current durable context">
          <span><small>Branch</small><strong data-collaboration-branch>main</strong></span>
          <span><small>Revision</small><strong data-collaboration-revision>0</strong></span>
          <span><small>Latest actor</small><strong data-collaboration-actor>Awaiting activity</strong></span>
          <span><small>Active claim</small><strong data-collaboration-claim>None</strong></span>
        </div>
        <label class="branch-switch">Switch branch<select data-active-branch><option value="main">main</option></select></label>
        <details class="collaboration-details"><summary>Activity &amp; access</summary><div class="collaboration-details-body">
          <div class="collaboration-actions">
            <form data-branch-form><label>New branch <input data-new-branch value="feature" pattern="[A-Za-z0-9_]+"></label><button type="submit">Create branch</button></form>
            <form data-revoke-form><label>Claim ID <input data-claim-id placeholder="claim_…"></label><label>Lease version <input data-lease-version type="number" min="1" value="1"></label><button type="submit">Revoke claim</button></form>
          </div>
          <section aria-labelledby="activity-heading"><h2 id="activity-heading">Recent activity</h2><ol data-collaboration-activity></ol></section>
          <section aria-labelledby="eligibility-heading"><h2 id="eligibility-heading">Operation eligibility</h2><ul data-collaboration-eligibility></ul></section>
        </div></details>
        <output data-service-diagnostic role="alert" hidden></output>
      </section>` : ''}
    </header>
    ${payload.cueWorkspace ? `<section class="cue-workspace" data-cue-workspace data-cue-family="${reusableCueWorkspace ? 'reusable' : 'cursor-click-reveal'}" aria-labelledby="cue-workspace-heading">
      <header><div><p class="eyebrow">Current action</p><h2 id="cue-workspace-heading">Click the cursor on the canvas</h2><p data-cue-guidance>The canvas is already active—no setup button required.</p></div><span class="cue-progress-count" data-cue-progress-count>Choose objects</span></header>
      <section class="cue-role-step" aria-labelledby="cue-role-heading"><h3 id="cue-role-heading">Choose the three objects</h3>
        <div class="cue-role-grid">
          <article data-cue-role-card="cursor"><span class="cue-step-number">1</span><div><strong>Cursor</strong><output data-cue-role-status="cursor">Click on canvas</output></div><button type="button" data-cue-pick="cursor" aria-pressed="false" hidden>Change</button></article>
          <article data-cue-role-card="pulse"><span class="cue-step-number">2</span><div><strong>Click target</strong><output data-cue-role-status="pulse">Waiting</output></div><button type="button" data-cue-pick="pulse" aria-pressed="false" hidden>Change</button></article>
          <article data-cue-role-card="reveal"><span class="cue-step-number">3</span><div><strong>Reveal target</strong><output data-cue-role-status="reveal">Waiting</output></div><button type="button" data-cue-pick="reveal" aria-pressed="false" hidden>Change</button></article>
        </div>
        <details class="cue-target-advanced"><summary>Choose targets from a list</summary><div>
          <label>Cursor element<select data-cue-cursor><option value="">Not selected</option>${authoring.value.document.elements.map((element, index) => `<option value="${element.id}">Element ${index + 1}</option>`).join('')}</select></label>
          <label>Click target<select data-cue-pulse><option value="">Not selected</option>${authoring.value.document.elements.map((element, index) => `<option value="${element.id}">Element ${index + 1}</option>`).join('')}</select></label>
          <label>Reveal target<select data-cue-reveal><option value="">Not selected</option>${authoring.value.document.elements.map((element, index) => `<option value="${element.id}">Element ${index + 1}</option>`).join('')}</select></label>
        </div></details>
      </section>
      <div class="cue-cards">
        <form data-cue-form="cursor-path" hidden><h3>Move the cursor</h3><p data-cue-path-guidance>Create the movement, then drag Start and Arrive on the canvas.</p><details class="cue-timing"><summary>Timing · 0 to 700 ms</summary><div class="cue-fields"><label>Start (ms)<input name="start" type="number" min="0" value="0"></label><label>Arrive (ms)<input name="arrive" type="number" min="1" value="700"></label></div></details><details class="cue-coordinate-advanced"><summary>Exact coordinates</summary><div class="cue-fields"><label>Start X (%)<input name="startX" type="number" step="0.0001" value="8"></label><label>Start Y (%)<input name="startY" type="number" step="0.0001" value="12"></label><label>End X (%)<input name="endX" type="number" step="0.0001" value="62"></label><label>End Y (%)<input name="endY" type="number" step="0.0001" value="55"></label></div></details><div class="cue-form-actions"><button type="submit" disabled>Create cursor movement</button><button type="button" data-cue-cancel-edit hidden>Done</button></div></form>
        <form data-cue-form="reveal" hidden><h3>Reveal the content</h3><p>Use the suggested timing or open Timing to fine-tune it.</p><details class="cue-timing"><summary>Timing · 800 to 1200 ms</summary><div class="cue-fields"><label>Start (ms)<input name="start" type="number" min="0" value="800"></label><label>Complete (ms)<input name="complete" type="number" min="1" value="1200"></label></div></details><div class="cue-form-actions"><button type="submit" disabled>Create reveal</button><button type="button" data-cue-cancel-edit hidden>Done</button></div></form>
        <form data-cue-form="click" hidden><h3>Add the click</h3><p>Use the suggested press and pulse, or open Details to tune them.</p><details class="cue-timing"><summary>Click details · 700 to 1300 ms</summary><div class="cue-fields"><label>Arrive (ms)<input name="arrive" type="number" min="0" value="700"></label><label>Press (ms)<input name="press" type="number" min="1" value="800"></label><label>Release (ms)<input name="release" type="number" min="2" value="920"></label><label>Pulse end (ms)<input name="pulseEnd" type="number" min="3" value="1300"></label><label>Press scale (%)<input name="scale" type="number" min="1" value="82"></label><label>Pulse radius (px)<input name="radius" type="number" min="1" value="18"></label></div></details><div class="cue-form-actions"><button type="submit" disabled>Create click</button><button type="button" data-cue-cancel-edit hidden>Done</button></div></form>
        ${reusableCueWorkspace ? `
        <form data-cue-form="type" hidden><h3>Type text</h3><p>Choose existing text directly on the canvas.</p><label>Text target<select name="target" data-reusable-target>${reusableTextTargetOptions}</select></label><button type="button" data-reusable-pick="target">Choose text on canvas</button><details class="cue-timing"><summary>Timing</summary><div class="cue-fields"><label>Start (ms)<input name="start" type="number" min="0" value="100"></label><label>Complete (ms)<input name="complete" type="number" min="1" value="600"></label><label>Steps<input name="stepCount" type="number" min="1" value="5"></label></div></details><div class="cue-form-actions"><button type="submit">Create type</button><button type="button" data-cue-cancel-edit hidden>Done</button></div></form>
        <form data-cue-form="select" hidden><h3>Select an object</h3><p>Choose each role directly on the canvas; dropdowns remain as the keyboard fallback.</p><div class="cue-fields"><label>Cursor<select name="cursor" data-reusable-target>${reusableTargetOptions}</select><button type="button" data-reusable-pick="cursor">Choose cursor on canvas</button></label><label>Selected object<select name="selected" data-reusable-target>${reusableTargetOptions}</select><button type="button" data-reusable-pick="selected">Choose object on canvas</button></label><label>Highlight<select name="highlight" data-reusable-target>${reusableTargetOptions}</select><button type="button" data-reusable-pick="highlight">Choose highlight on canvas</button></label></div><details class="cue-timing"><summary>Timing</summary><div class="cue-fields"><label>Approach<input name="approach" type="number" value="100"></label><label>Choose<input name="choose" type="number" value="300"></label><label>Settle<input name="settle" type="number" value="500"></label></div></details><div class="cue-form-actions"><button type="submit">Create select</button><button type="button" data-cue-cancel-edit hidden>Done</button></div></form>
        <form data-cue-form="drag" hidden><h3>Drag an object</h3><p>Choose both roles and shape their shared path directly on the canvas.</p><div class="cue-fields"><label>Cursor<select name="cursor" data-reusable-target>${reusableTargetOptions}</select><button type="button" data-reusable-pick="cursor">Choose cursor on canvas</button></label><label>Dragged object<select name="dragged" data-reusable-target>${reusableTargetOptions}</select><button type="button" data-reusable-pick="dragged">Choose object on canvas</button></label></div><details class="cue-timing"><summary>Timing and exact geometry</summary><div class="cue-fields"><label>Approach<input name="approach" type="number" value="0"></label><label>Press<input name="press" type="number" value="100"></label><label>Move start<input name="moveStart" type="number" value="200"></label><label>Arrive<input name="arrive" type="number" value="600"></label><label>Release<input name="release" type="number" value="700"></label><label>Start X (%)<input name="startX" type="number" value="10"></label><label>Start Y (%)<input name="startY" type="number" value="20"></label><label>End X (%)<input name="endX" type="number" value="60"></label><label>End Y (%)<input name="endY" type="number" value="50"></label><label>Grip X (%)<input name="gripX" type="number" value="1"></label><label>Grip Y (%)<input name="gripY" type="number" value="-2"></label></div></details><div class="cue-form-actions"><button type="submit">Create drag</button><button type="button" data-cue-cancel-edit hidden>Done</button></div></form>
        <form data-cue-form="hold" hidden><h3>Hold a motion beat</h3><p>Choose animated motion directly on the canvas at an explicit source boundary.</p><label>Motion targets<select name="target" data-reusable-target multiple><option value="">Choose motion on canvas</option>${reusableHoldTargetOptions}</select></label><button type="button" data-reusable-pick="target">Choose motion on canvas</button><details class="cue-timing"><summary>Timing</summary><div class="cue-fields"><label>Enter<input name="enter" type="number" value="1000"></label><label>Duration<input name="duration" type="number" value="300"></label></div></details><div class="cue-form-actions"><button type="submit">Create hold</button><button type="button" data-cue-cancel-edit hidden>Done</button></div></form>` : ''}
      </div>
      <section class="cue-complete" data-cue-complete hidden><div><span aria-hidden="true">&#10003;</span><div><strong>Interaction ready</strong><p>Drag the cursor handles on the canvas, press Play, or edit a beat below.</p></div></div></section>
      <div class="cue-history-slot" data-cue-history-slot></div>
      <output data-cue-status role="status" aria-live="polite">Choose the cursor, then click its object on the canvas.</output>
      <details class="cue-advanced"><summary>Edit completed beats</summary><div data-authored-cues class="authored-cues"></div></details>
    </section>` : ''}
    <div class="primary-layout">
      <div class="workflow" aria-label="Animation workflow">
        <section class="workflow-card choose-create" aria-labelledby="choose-create-heading">
          <div class="step-heading"><span>1</span><div><h2 id="choose-create-heading">Choose &amp; Create</h2><p data-structural-status>Select an available element to begin.</p></div></div>
          <fieldset class="target-choices" data-target-choices><legend>What should fade?</legend>
            ${creationChoices.map((choice) => `<label><input type="radio" name="creation-target" value="${choice.elementId}"><span><strong>${choice.label}</strong><small>Opacity · <span data-choice-reason="${choice.elementId}">Available</span></small></span></label>`).join('')}
            <div class="unavailable-choice" data-status-copy><span><strong>Status copy</strong><small>Opacity · <span data-choice-reason="${statusCopyElementId}">Already animated</span></small></span></div>
          </fieldset>
          <button class="primary-action" type="button" data-create-track disabled>Select an element</button>
        </section>
        <section class="workflow-card shape-card" aria-labelledby="shape-heading">
          <div class="step-heading"><span>2</span><div><h2 id="shape-heading">Shape</h2><p>Add a midpoint for a softer fade, or edit exact keyframes in Inspect.</p></div></div>
          <div class="shape-actions"><button type="button" data-add-midpoint>Add midpoint</button><button type="button" data-remove-midpoint>Remove midpoint</button></div>
          <div class="authoring-panel" aria-label="Selected keyframe authoring">
            <div class="selection" data-selection></div>
            <div class="keyframe-fields">
              <form data-value-form><label>Opacity value <input data-value type="number" min="0" max="1" step="0.000001" required disabled></label><button type="submit" disabled>Set value</button></form>
              <form data-time-form><label>Master time (ms) <input data-time type="number" min="0" step="1" required disabled></label><button type="submit" disabled>Set time</button></form>
            </div>
          </div>
        </section>
        <section class="workflow-card timing-card" aria-labelledby="time-heading">
          <div class="step-heading"><span>3</span><div><h2 id="time-heading">Time</h2><p>Applied values are canonical. Draft fields do not change the preview until applied.</p></div></div>
          <div class="timing-controls">
            <div class="timing-control"><output data-applied-duration>Applied — create a track first</output><label><span>Duration draft <em hidden>Not applied</em></span><input data-duration type="number" min="1" step="1" value="1000"></label><button type="button" data-set-duration>Apply duration</button></div>
            <div class="timing-control"><output data-applied-delay>Applied — create a track first</output><label><span>Delay draft <em hidden>Not applied</em></span><input data-delay type="number" min="0" step="1" value="610"></label><button type="button" data-set-delay>Apply delay</button></div>
            <div class="timing-control"><output data-applied-easing>Applied — create a track first</output><label><span>Easing draft <em hidden>Not applied</em></span><select data-easing><option value="linear">linear</option><option value="ease-in-out">ease-in-out</option></select></label><button type="button" data-set-easing>Apply easing</button></div>
          </div>
          <div class="hold-control" data-hold-control>
            <div><strong>Extend the reveal beat</strong><span>Insert one fixed 600 ms hold before Pair crosses. Every later cue and motion beat ripples together.</span></div>
            <button type="button" data-insert-hold>Insert 600 ms hold</button>
            <output data-hold-status>No hold inserted · Pair crosses at 2870 ms</output>
          </div>
        </section>
        <section class="workflow-footer" aria-label="Change history">
          <div class="history"><button type="button" data-undo>Undo</button><button type="button" data-redo>Redo</button></div>
          <output class="operation-status" data-operation-status role="status" aria-live="polite">Revision 0 ready.</output>
        </section>
      </div>
      <section class="preview-panel" aria-labelledby="preview-heading">
        <div class="preview-title"><div><span>4</span><div><h2 id="preview-heading">Preview</h2><p>Exact compiler output · native CSS animation</p></div></div><span data-preview-selection-label></span></div>
        <div class="preview-shot-toolbar" data-preview-shot-toolbar hidden>
          <div class="preview-shot-context"><strong data-preview-shot-object>Object 1</strong><output data-preview-shot-state>Editing 700 ms</output></div>
          <div class="preview-shot-actions" data-preview-shot-actions role="group" aria-label="Preview-side Shot controls"></div>
        </div>
        <section class="shot-workspace" data-shot-workspace data-active="false" aria-labelledby="shot-workspace-heading">
          <h2 class="visually-hidden" id="shot-workspace-heading">Shape motion directly on the canvas</h2>
          <div class="shot-object-bar" data-shot-object-bar><fieldset data-shot-targets><legend>Object</legend></fieldset><button class="path-toggle" type="button" data-shot-mode="path" aria-label="Path" aria-pressed="true">Hide path</button><label class="move-together"><input type="checkbox" data-move-together aria-label="Edit together"><span><strong>Edit together</strong><small>Position changes apply to both selected objects.</small></span></label></div>
          <p class="shot-guidance visually-hidden" data-shot-guidance role="note"></p>
          <div class="preview-stage"><div class="preview-canvas" data-preview-canvas><iframe data-preview title="Compiled motion preview"></iframe><div class="preview-object-overlay" data-preview-object-overlay aria-label="Selectable preview objects"></div><div class="cue-target-overlay" data-cue-target-overlay hidden aria-label="Choose a cue target on the canvas"></div><div class="cue-path-overlay" data-cue-path-overlay aria-label="Cursor path handles"></div><div class="preview-selection" data-preview-selection hidden><span>Selected element</span></div><div class="trajectory-overlay" data-trajectory-overlay aria-label="Compiler-native trajectory waypoints"></div></div></div>
          <div class="preview-control-rail" data-preview-control-rail>
            <div class="transport" aria-label="Preview transport"><button type="button" data-play>Play</button><button type="button" data-pause>Pause</button><label>Preview time <input data-scrub type="range" min="0" max="${authoring.value.document.durationMs}" step="1" value="0"></label><output data-playhead>0 ms</output></div>
            <fieldset class="shot-moments" data-shot-moments hidden><legend>Animation moments</legend><div data-shot-moment-sequence></div></fieldset>
          </div>
          <section class="shot-context-dock" data-shot-context-dock aria-label="Selected moment controls">
            <section class="moment-editor" aria-labelledby="moment-editor-heading">
              <div class="moment-heading"><div><strong id="moment-editor-heading" data-shot-context-name>Moments</strong><span>Select a moment. Use + to add a point.</span></div><button type="button" data-shot-context-remove data-shot-remove-moment disabled>Remove point</button></div>
              <div class="moment-transition" data-shot-moment-transition><label><span>When this moment happens</span><input data-shot-context-time data-shot-moment-time type="range" min="1" max="2099" step="1"><output data-shot-moment-time-output></output></label><label><span>Movement after this moment</span><select data-shot-context-easing data-shot-easing><option value="custom" disabled>Custom</option><option value="ease">Smooth</option><option value="ease-out">Glide in</option><option value="ease-in">Build speed</option><option value="ease-in-out">Soft in &amp; out</option><option value="linear">Constant speed</option></select></label><button type="button" data-shot-apply-easing>Apply movement</button></div>
            </section>
            <div class="shot-advanced" data-shot-advanced><button type="button" data-shot-advanced-toggle aria-controls="shot-advanced-drawer" aria-expanded="false">Advanced motion controls</button></div>
            <output class="shot-control-feedback" data-shot-control-feedback role="status" aria-live="polite" hidden></output>
          </section>
          <aside class="shot-advanced-drawer" id="shot-advanced-drawer" data-shot-advanced-drawer hidden aria-label="Advanced motion controls"><header><strong>Advanced motion controls</strong><button type="button" data-shot-advanced-close>Close</button></header><details><summary>Exact pose</summary><form class="pose-fields" data-pose-form><label>X (px)<input name="x" type="number" step="0.000001" required></label><label>Y (px)<input name="y" type="number" step="0.000001" required></label><label>Scale<input name="scale" type="number" step="0.000001" min="0.25" max="3" required></label><label>Rotation (deg)<input name="rotate" type="number" step="0.000001" min="-180" max="180" required></label><button type="submit">Apply pose</button></form></details><details><summary>Settled hold</summary><div class="shot-timing"><label>Hold begins (ms)<input data-shot-settled type="number" min="2" max="2099" value="1820"></label><button type="button" data-shot-hold>Hold final pose through Settle</button></div></details><div data-shot-advanced-technical></div></aside>
          <div class="shot-history-slot" data-shot-history-slot></div>
          <output data-shot-status role="status" aria-live="polite"></output>
          <section class="shot-recovery" data-shot-recovery hidden aria-labelledby="shot-recovery-heading"><div><strong id="shot-recovery-heading">Manual Shot editing is unavailable</strong><span data-shot-recovery-copy></span></div><div><button type="button" data-shot-retry>Retry Shot workspace</button><button type="button" data-shot-inspect>Open track inspector</button></div></section>
        </section>
      </section>
    </div>
    <section class="draft-conflict" data-draft-conflict hidden role="alert"><div><strong>Remote revision available</strong><span>Your unsubmitted draft is still here and has not been applied. Choose how to resolve it.</span></div><button type="button" data-keep-draft>Keep draft</button><button type="button" data-discard-draft>Discard draft</button></section>
    <details class="inspect-panel">
      <summary><span><strong>Inspect all tracks</strong><small>Complete timeline, cues, keyframes, stable IDs, and reduced motion</small></span><span data-track-count></span></summary>
      <div class="inspection-content">
        <aside class="cue-panel" aria-label="Narrative cues"><div class="panel-heading"><span>Narrative cues</span><span data-cue-count></span></div><div data-cues class="cue-list"></div></aside>
        <section class="timeline-panel" aria-label="Master timeline"><div data-timeline class="timeline"></div></section>
        <button class="reduced-toggle" type="button" data-reduced-toggle aria-expanded="false">Inspect reduced motion</button>
        <section data-reduced-motion-panel data-mode="${authoring.value.document.reducedMotion.mode}" data-css="${authoring.value.document.reducedMotion.css}" class="reduced-panel" hidden>
          <strong>source-snapshot</strong><p>Inspection only. The canonical document and compiler output remain unchanged.</p><pre></pre>
        </section>
      </div>
    </details>
  </main>`;
}
