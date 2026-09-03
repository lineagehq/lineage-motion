import payload from 'virtual:motion-document';
import { compileMotionDocument } from '../../../packages/css-compiler/src/index.js';
import {
  canonicalJson,
  canonicalContentBytes,
  createAuthoringState,
  cueTargetSnapshots,
  dispatchAuthoringOperation,
  projectShotWorkspace,
  projectTrajectorySelection,
  projectTransformTrajectory,
  projectTrackCreationEligibility,
  sha256Hex,
  type AuthoringOperation,
  type AuthoringCue,
  type CueAuthoringOperation,
  type CueSemantic,
  type StructuralAuthoringElementId,
  type TimingFunction,
  type OperationIntentPayload,
  type PreparedOperationIntent,
} from '../../../packages/domain/src/index.js';
import {
  buildTimeline,
  createPreviewOverlayProjection,
  previewPointerDeltaToPpm,
  NativePreviewController,
  projectContentBounds,
  type PreviewOverlayProjection,
  type PreviewCssCommitPromotion,
  type ProjectionRect,
  type TimelineRow,
} from '../../../packages/preview-runtime/src/index.js';
import { MotionPreparationError, MotionServiceClient, commandSchema, makeBranchCreateCommand, makeClaimControlCommand,
  makeOperationIntentCommand, makeTrajectoryCommand,
  type CommitMetadata, type MotionCommand, type MotionDiagnostic } from '../../../packages/motion-protocol/src/index.ts';
import './styles.css';

let authoring = createAuthoringState(payload.document);
let compiled = payload.compiled;
const serviceClient = payload.serviceBacked && payload.humanCapability
  ? new MotionServiceClient('', (...args) => fetch(...args), { actor: 'human', capability: payload.humanCapability })
  : payload.serviceBacked ? (() => { throw new Error('EDITOR_CAPABILITY_REQUIRED'); })() : null;
let lastCommit: CommitMetadata | null = null;
let immutableRefetchCount = 0;
let pendingRevision: number | null = null;
type PublicationState = 'settled' | 'pending' | 'failed';
let publicationState: PublicationState = 'settled';
let publicationFailureCode: string | null = null;
let activeBranchId = 'main';
type DurableWorkspace = Awaited<ReturnType<MotionServiceClient['workspace']>>;
type DurableBranches = Awaited<ReturnType<MotionServiceClient['branches']>>;
type DurableClaims = Awaited<ReturnType<MotionServiceClient['activeClaims']>>;
type DurableActivity = Awaited<ReturnType<MotionServiceClient['activity']>>;
type DurableContextSnapshot = { workspace: DurableWorkspace; branches: DurableBranches; claims: DurableClaims; activity: DurableActivity };
let durableWorkspace: DurableWorkspace | null = null;
let durableBranches: DurableBranches | null = null;
let durableClaims: DurableClaims | null = null;
let durableActivity: DurableActivity | null = null;
let lastServiceDiagnostic: MotionDiagnostic | null = null;
let publicationTestGate: { promise: Promise<void>; release: () => void } | null = null;
let failNextPublicationForTest = false;
if (serviceClient) {
  const head = await serviceClient.head(payload.document.documentId);
  authoring = createAuthoringState(head.document);
  compiled = compileMotionDocument(head.document);
}
const operationClientId = crypto.randomUUID();
let operationSequence = 0;
const creationChoices = [
  { elementId: 'el_a2849ff826f3e167', label: 'Cursor' },
  { elementId: 'el_2dbee68b1ea318c8', label: 'Orb' },
] as const;
const statusCopyElementId = 'el_1f3f2908e4fd2401';
let selectedCreationElementId: StructuralAuthoringElementId | null = null;
let creationDraftDirty = false;
let selectedTrackId: string | null = null;
let selectedKeyframeId: string | null = null;
let hasExplicitKeyframeSelection = false;
let unavailableSelection = false;
let unavailableCreation = false;
let lastCommitSeq = 0;
let reconciliation = Promise.resolve();
let branchGeneration = 0;
let eventSubscription: { close(): void } | null = null;
let eventSubscriptionGeneration = 0;
const reconciliationFailures = new Map<number, number>();
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let draftConflictRevision: number | null = null;
let draftStaleBaseRevision: number | null = null;
const detachedCueKinds = new Set<CueSemantic['kind']>();
let cuePathDefaultsInitialized = false;

document.body.innerHTML = `
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
    ${payload.cueWorkspace ? `<section class="cue-workspace" data-cue-workspace aria-labelledby="cue-workspace-heading">
      <header><div><p class="eyebrow">Current action</p><h2 id="cue-workspace-heading">Click the cursor on the canvas</h2><p data-cue-guidance>The canvas is already active—no setup button required.</p></div><span class="cue-progress-count" data-cue-progress-count>Choose objects</span></header>
      <section class="cue-role-step" aria-labelledby="cue-role-heading"><h3 id="cue-role-heading">Choose the three objects</h3>
        <div class="cue-role-grid">
          <article data-cue-role-card="cursor"><span class="cue-step-number">1</span><div><strong>Cursor</strong><output data-cue-role-status="cursor">Click on canvas</output></div><button type="button" data-cue-pick="cursor" aria-pressed="false" hidden>Change</button></article>
          <article data-cue-role-card="pulse"><span class="cue-step-number">2</span><div><strong>Click target</strong><output data-cue-role-status="pulse">Waiting</output></div><button type="button" data-cue-pick="pulse" aria-pressed="false" hidden>Change</button></article>
          <article data-cue-role-card="reveal"><span class="cue-step-number">3</span><div><strong>Reveal target</strong><output data-cue-role-status="reveal">Waiting</output></div><button type="button" data-cue-pick="reveal" aria-pressed="false" hidden>Change</button></article>
        </div>
        <details class="cue-target-advanced"><summary>Choose targets from a list</summary><div>
          <label>Cursor element<select data-cue-cursor><option value="">Not selected</option>${authoring.document.elements.map((element, index) => `<option value="${element.id}">Element ${index + 1}</option>`).join('')}</select></label>
          <label>Click target<select data-cue-pulse><option value="">Not selected</option>${authoring.document.elements.map((element, index) => `<option value="${element.id}">Element ${index + 1}</option>`).join('')}</select></label>
          <label>Reveal target<select data-cue-reveal><option value="">Not selected</option>${authoring.document.elements.map((element, index) => `<option value="${element.id}">Element ${index + 1}</option>`).join('')}</select></label>
        </div></details>
      </section>
      <div class="cue-cards">
        <form data-cue-form="cursor-path" hidden><h3>Move the cursor</h3><p data-cue-path-guidance>Create the movement, then drag Start and Arrive on the canvas.</p><details class="cue-timing"><summary>Timing · 0 to 700 ms</summary><div class="cue-fields"><label>Start (ms)<input name="start" type="number" min="0" value="0"></label><label>Arrive (ms)<input name="arrive" type="number" min="1" value="700"></label></div></details><details class="cue-coordinate-advanced"><summary>Exact coordinates</summary><div class="cue-fields"><label>Start X (%)<input name="startX" type="number" step="0.0001" value="8"></label><label>Start Y (%)<input name="startY" type="number" step="0.0001" value="12"></label><label>End X (%)<input name="endX" type="number" step="0.0001" value="62"></label><label>End Y (%)<input name="endY" type="number" step="0.0001" value="55"></label></div></details><div class="cue-form-actions"><button type="submit" disabled>Create cursor movement</button><button type="button" data-cue-cancel-edit hidden>Done</button></div></form>
        <form data-cue-form="reveal" hidden><h3>Reveal the content</h3><p>Use the suggested timing or open Timing to fine-tune it.</p><details class="cue-timing"><summary>Timing · 800 to 1200 ms</summary><div class="cue-fields"><label>Start (ms)<input name="start" type="number" min="0" value="800"></label><label>Complete (ms)<input name="complete" type="number" min="1" value="1200"></label></div></details><div class="cue-form-actions"><button type="submit" disabled>Create reveal</button><button type="button" data-cue-cancel-edit hidden>Done</button></div></form>
        <form data-cue-form="click" hidden><h3>Add the click</h3><p>Use the suggested press and pulse, or open Details to tune them.</p><details class="cue-timing"><summary>Click details · 700 to 1300 ms</summary><div class="cue-fields"><label>Arrive (ms)<input name="arrive" type="number" min="0" value="700"></label><label>Press (ms)<input name="press" type="number" min="1" value="800"></label><label>Release (ms)<input name="release" type="number" min="2" value="920"></label><label>Pulse end (ms)<input name="pulseEnd" type="number" min="3" value="1300"></label><label>Press scale (%)<input name="scale" type="number" min="1" value="82"></label><label>Pulse radius (px)<input name="radius" type="number" min="1" value="18"></label></div></details><div class="cue-form-actions"><button type="submit" disabled>Create click</button><button type="button" data-cue-cancel-edit hidden>Done</button></div></form>
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
        <section class="shot-workspace" data-shot-workspace hidden aria-labelledby="shot-workspace-heading">
          <h2 class="visually-hidden" id="shot-workspace-heading">Shape motion directly on the canvas</h2>
          <div class="shot-object-bar" data-shot-object-bar><fieldset data-shot-targets><legend>Object</legend></fieldset><button class="path-toggle" type="button" data-shot-mode="path" aria-label="Path" aria-pressed="true">Hide path</button><label class="move-together"><input type="checkbox" data-move-together aria-label="Edit together"><span><strong>Edit together</strong><small>Position changes apply to both selected objects.</small></span></label></div>
          <p class="shot-guidance visually-hidden" data-shot-guidance role="note"></p>
          <section class="shot-context-dock" data-shot-context-dock aria-label="Selected moment controls">
            <section class="moment-editor" aria-labelledby="moment-editor-heading">
              <div class="moment-heading"><div><strong id="moment-editor-heading" data-shot-context-name>Moments</strong><span>Select a moment. Use + to add a point.</span></div><button type="button" data-shot-context-remove data-shot-remove-moment disabled>Remove point</button></div>
              <div class="moment-transition" data-shot-moment-transition><label><span>When this moment happens</span><input data-shot-context-time data-shot-moment-time type="range" min="1" max="2099" step="1"><output data-shot-moment-time-output></output></label><label><span>Movement after this moment</span><select data-shot-context-easing data-shot-easing><option value="custom" disabled>Custom</option><option value="ease">Smooth</option><option value="ease-out">Glide in</option><option value="ease-in">Build speed</option><option value="ease-in-out">Soft in &amp; out</option><option value="linear">Constant speed</option></select></label><button type="button" data-shot-apply-easing>Apply movement</button></div>
            </section>
            <details class="shot-advanced" data-shot-advanced><summary data-shot-advanced-toggle>Inspect &amp; fine-tune</summary><div class="advanced-content"><form class="pose-fields" data-pose-form><label>X (px)<input name="x" type="number" step="0.000001" required></label><label>Y (px)<input name="y" type="number" step="0.000001" required></label><label>Scale<input name="scale" type="number" step="0.000001" min="0.25" max="3" required></label><label>Rotation (deg)<input name="rotate" type="number" step="0.000001" min="-180" max="180" required></label><button type="submit">Apply pose</button></form><div class="shot-timing"><label>Hold begins (ms)<input data-shot-settled type="number" min="2" max="2099" value="1820"></label><button type="button" data-shot-hold>Hold final pose through Settle</button></div></div></details>
          </section>
          <aside class="shot-advanced-drawer" data-shot-advanced-drawer hidden aria-label="Advanced motion controls"></aside>
          <div class="shot-history-slot" data-shot-history-slot></div>
          <output data-shot-status role="status" aria-live="polite"></output>
          <section class="shot-recovery" data-shot-recovery hidden aria-labelledby="shot-recovery-heading"><div><strong id="shot-recovery-heading">Manual Shot editing is unavailable</strong><span data-shot-recovery-copy></span></div><div><button type="button" data-shot-retry>Retry Shot workspace</button><button type="button" data-shot-inspect>Open track inspector</button></div></section>
        </section>
      <div class="preview-stage"><div class="preview-canvas" data-preview-canvas><iframe data-preview title="Compiled motion preview"></iframe><div class="preview-object-overlay" data-preview-object-overlay aria-label="Selectable preview objects"></div><div class="cue-target-overlay" data-cue-target-overlay hidden aria-label="Choose a cue target on the canvas"></div><div class="cue-path-overlay" data-cue-path-overlay aria-label="Cursor path handles"></div><div class="preview-selection" data-preview-selection hidden><span>Selected element</span></div><div class="trajectory-overlay" data-trajectory-overlay aria-label="Compiler-native trajectory waypoints"></div></div></div>
        <div class="preview-control-rail" data-preview-control-rail>
          <div class="transport" aria-label="Preview transport"><button type="button" data-play>Play</button><button type="button" data-pause>Pause</button><label>Preview time <input data-scrub type="range" min="0" max="${authoring.document.durationMs}" step="1" value="0"></label><output data-playhead>0 ms</output></div>
          <fieldset class="shot-moments" data-shot-moments hidden><legend>Animation moments</legend><div data-shot-moment-sequence></div></fieldset>
        </div>
      </section>
    </div>
    <section class="draft-conflict" data-draft-conflict hidden role="alert"><div><strong>Remote revision available</strong><span>Your unsubmitted draft is still here and has not been applied. Choose how to resolve it.</span></div><button type="button" data-keep-draft>Keep draft</button><button type="button" data-discard-draft>Discard draft</button></section>
    <details class="inspect-panel">
      <summary><span><strong>Inspect all tracks</strong><small>Complete timeline, cues, keyframes, stable IDs, and reduced motion</small></span><span data-track-count></span></summary>
      <div class="inspection-content">
        <aside class="cue-panel" aria-label="Narrative cues"><div class="panel-heading"><span>Narrative cues</span><span data-cue-count></span></div><div data-cues class="cue-list"></div></aside>
        <section class="timeline-panel" aria-label="Master timeline"><div data-timeline class="timeline"></div></section>
        <button class="reduced-toggle" type="button" data-reduced-toggle aria-expanded="false">Inspect reduced motion</button>
        <section data-reduced-motion-panel data-mode="${authoring.document.reducedMotion.mode}" data-css="${authoring.document.reducedMotion.css}" class="reduced-panel" hidden>
          <strong>source-snapshot</strong><p>Inspection only. The canonical document and compiler output remain unchanged.</p><pre></pre>
        </section>
      </div>
    </details>
  </main>`;

const iframe = required<HTMLIFrameElement>('[data-preview]');
const controller = new NativePreviewController(iframe);
const scrubber = required<HTMLInputElement>('[data-scrub]');
const playhead = required<HTMLOutputElement>('[data-playhead]');
const status = required<HTMLOutputElement>('[data-operation-status]');
const valueInput = required<HTMLInputElement>('[data-value]');
const timeInput = required<HTMLInputElement>('[data-time]');
const valueButton = required<HTMLButtonElement>('[data-value-form] button');
const timeButton = required<HTMLButtonElement>('[data-time-form] button');
const undoButton = required<HTMLButtonElement>('[data-undo]');
const redoButton = required<HTMLButtonElement>('[data-redo]');
const createTrackButton = required<HTMLButtonElement>('[data-create-track]');
const addMidpointButton = required<HTMLButtonElement>('[data-add-midpoint]');
const removeMidpointButton = required<HTMLButtonElement>('[data-remove-midpoint]');
const durationInput = required<HTMLInputElement>('[data-duration]');
const delayInput = required<HTMLInputElement>('[data-delay]');
const easingInput = required<HTMLSelectElement>('[data-easing]');
const setDurationButton = required<HTMLButtonElement>('[data-set-duration]');
const setDelayButton = required<HTMLButtonElement>('[data-set-delay]');
const setEasingButton = required<HTMLButtonElement>('[data-set-easing]');
const previewStage = required<HTMLElement>('.preview-stage');
const previewCanvas = required<HTMLElement>('[data-preview-canvas]');
const previewObjectOverlay = required<HTMLElement>('[data-preview-object-overlay]');
const previewSelection = required<HTMLElement>('[data-preview-selection]');
const previewShotToolbar = required<HTMLElement>('[data-preview-shot-toolbar]');
const previewShotObject = required<HTMLElement>('[data-preview-shot-object]');
const previewShotState = required<HTMLOutputElement>('[data-preview-shot-state]');
const previewShotActions = required<HTMLElement>('[data-preview-shot-actions]');
const branchSelect = document.querySelector<HTMLSelectElement>('[data-active-branch]');
const branchForm = document.querySelector<HTMLFormElement>('[data-branch-form]');
const revokeForm = document.querySelector<HTMLFormElement>('[data-revoke-form]');
const draftConflict = required<HTMLElement>('[data-draft-conflict]');
const shotWorkspace = required<HTMLElement>('[data-shot-workspace]');
const shotTargets = required<HTMLFieldSetElement>('[data-shot-targets]');
const shotMoments = required<HTMLFieldSetElement>('[data-shot-moments]');
const shotOverlay = required<HTMLElement>('[data-trajectory-overlay]');
const shotPoseForm = required<HTMLFormElement>('[data-pose-form]');
const shotStatus = required<HTMLOutputElement>('[data-shot-status]');
const shotGuidance = required<HTMLElement>('[data-shot-guidance]');
const shotRecovery = required<HTMLElement>('[data-shot-recovery]');
const cueWorkspace = document.querySelector<HTMLElement>('[data-cue-workspace]');
const cueTargetOverlay = document.querySelector<HTMLElement>('[data-cue-target-overlay]');
const cuePathOverlay = document.querySelector<HTMLElement>('[data-cue-path-overlay]');
type CueCanvasRole = 'cursor' | 'pulse' | 'reveal';
type CursorPathAuthoringCue = AuthoringCue & { semantic: Extract<CueSemantic, { kind: 'cursor-path' }> };
let cuePickRole: CueCanvasRole | null = null;
let cueEditingKind: CueSemantic['kind'] | null = null;
let cueCanvasGeneration = 0;
let cueCanvasFrame: number | null = null;
let cuePathGestureGeneration = 0;
let shotConfig: { startMs: number; landedMs: number; settledMs: number; targetElementIds: string[] } | null = null;
let shotSelection: string[] = [];
let shotPrimaryElementId: string | null = null;
let shotMomentMs = 700;
let shotMode: 'pose' | 'path' = 'path';
let shotProjection: PreviewOverlayProjection | null = null;
let shotGeometry: Array<{ elementId: string; timeMs: number; contentBounds: ProjectionRect; overlayBounds: ProjectionRect;
  deltasDevicePixels: { left: number; top: number; right: number; bottom: number; centerX: number; centerY: number } }> = [];
let shotGeometryGeneration = 0;
type ShotGeometryRequest = { requestId: number; workspaceGeneration: number; primaryElementId: string;
  geometryKey: string; waypoints: Array<{ keyframeId: string; timeMs: number }>;
  paths: Array<{ elementId: string; objectIndex: number; waypoints: Array<{ keyframeId: string; timeMs: number }> }>;
  requestedTimes: number[] };
let shotGeometryRequestId = 0;
let latestShotGeometryRequest: ShotGeometryRequest | null = null;
let pendingShotGeometryRequest: ShotGeometryRequest | null = null;
let shotGeometryPumpRunning = false;
let shotGeometryPumpCompletion = Promise.resolve();
let activeShotGeometrySamplers = 0;
let maximumActiveShotGeometrySamplers = 0;
let lastCommittedShotGeometryRequestId: number | null = null;
let committedShotGeometryKey: string | null = null;
let mountedPreviewGeneration = 0;
let activeWaypointDraft: {
  operation: AuthoringOperation;
  intent: OperationIntentPayload;
  commandBytes: string;
  compiledHtml: string;
  compiledCss: string;
  exportDigest: string;
} | null = null;
let waypointDraftApply = Promise.resolve();
let waypointDraftFrame: number | null = null;
let waypointDraftMoveCount = 0;
let waypointDraftAppliedCount = 0;
let waypointDraftFailure: string | null = null;
let waypointGestureGeneration = 0;
let waypointReleasePhase: 'idle' | 'flushing-latest' | 'committing' | 'publishing-geometry' = 'idle';
let playbackFeedbackFrame: number | null = null;
let lastPreviewCommitPromotion: { schemaVersion: 'motion.preview-css-commit-promotion.v1'; attempted: boolean;
  promoted: boolean; fallbackCode: string | null } = { schemaVersion: 'motion.preview-css-commit-promotion.v1', attempted: false,
    promoted: false, fallbackCode: null };
required<HTMLButtonElement>('[data-keep-draft]').addEventListener('click', () => resolveDraftConflict(true));
required<HTMLButtonElement>('[data-discard-draft]').addEventListener('click', () => resolveDraftConflict(false));
for (const button of shotWorkspace.querySelectorAll<HTMLButtonElement>('[data-shot-mode]')) button.addEventListener('click', () => {
  selectShotMode(shotMode === 'path' ? 'pose' : 'path');
});
required<HTMLInputElement>('[data-move-together]').addEventListener('change', (event) => {
  const editBoth = event.currentTarget as HTMLInputElement;
  shotSelection = editBoth.checked && shotConfig ? [...shotConfig.targetElementIds] : shotPrimaryElementId ? [shotPrimaryElementId] : [];
  renderShotWorkspace();
});
shotPoseForm.addEventListener('submit', (event) => { event.preventDefault(); void applyShotPose(); });
required<HTMLButtonElement>('[data-shot-apply-easing]').addEventListener('click', () => void applyShotEasing());
required<HTMLButtonElement>('[data-shot-remove-moment]').addEventListener('click', () => void removeShotMoment());
required<HTMLButtonElement>('[data-shot-hold]').addEventListener('click', () => void applyShotHold());
required<HTMLButtonElement>('[data-shot-retry]').addEventListener('click', () => initializeSeedWorkspace());
required<HTMLButtonElement>('[data-shot-inspect]').addEventListener('click', () => {
  const inspector = required<HTMLDetailsElement>('.inspect-panel'); inspector.open = true; inspector.scrollIntoView({ block: 'start', behavior: 'smooth' });
});
const shotMomentTime = required<HTMLInputElement>('[data-shot-moment-time]');
shotMomentTime.addEventListener('input', () => {
  required<HTMLOutputElement>('[data-shot-moment-time-output]').value = `${shotMomentTime.value} ms`;
  scrub(Number(shotMomentTime.value));
});
shotMomentTime.addEventListener('change', () => void applyShotMomentTime(Number(shotMomentTime.value)));
for (const input of document.querySelectorAll<HTMLInputElement>('[data-shot-settled]')) {
  input.addEventListener('input', () => {
    for (const timingInput of document.querySelectorAll<HTMLInputElement>('[data-shot-landing], [data-shot-settled]')) {
      timingInput.setCustomValidity(''); timingInput.removeAttribute('aria-invalid');
    }
    shotStatus.value = `Timing draft not applied · revision ${authoring.document.revision} unchanged.`;
  });
}
for (const control of document.querySelectorAll<HTMLInputElement>('[data-new-branch], [data-claim-id], [data-lease-version]')) {
  control.addEventListener('input', () => { control.dataset.draft = String(control.value !== control.defaultValue); });
}

branchSelect?.addEventListener('change', () => void switchBranch(branchSelect.value));
branchForm?.addEventListener('submit', (event) => { event.preventDefault(); void createBranch(
  required<HTMLInputElement>('[data-new-branch]').value); });
revokeForm?.addEventListener('submit', (event) => { event.preventDefault(); void revokeClaim(
  required<HTMLInputElement>('[data-claim-id]').value, Number(required<HTMLInputElement>('[data-lease-version]').value)); });
const previewSelectionLabel = required<HTMLElement>('[data-preview-selection-label]');
const appliedDuration = required<HTMLOutputElement>('[data-applied-duration]');
const appliedDelay = required<HTMLOutputElement>('[data-applied-delay]');
const appliedEasing = required<HTMLOutputElement>('[data-applied-easing]');
const insertHoldButton = required<HTMLButtonElement>('[data-insert-hold]');
const holdStatus = required<HTMLOutputElement>('[data-hold-status]');

if (payload.cueWorkspace) {
for (const form of document.querySelectorAll<HTMLFormElement>('[data-cue-form]')) form.addEventListener('submit', (event) => {
  event.preventDefault(); void submitCueForm(form);
});
for (const button of document.querySelectorAll<HTMLButtonElement>('[data-cue-cancel-edit]')) button.addEventListener('click', () => {
  cueEditingKind = null; renderCueCanvas();
});
for (const button of document.querySelectorAll<HTMLButtonElement>('[data-cue-pick]')) button.addEventListener('click', () => {
  const role = button.dataset.cuePick as CueCanvasRole;
  cuePickRole = role;
  scrub(cuePickRole === 'reveal' ? 1200 : 700);
  renderCueCanvas();
  announceCueStatus(`Click the ${cueRoleLabel(cuePickRole).toLowerCase()} directly on the canvas.`, false);
});
for (const select of document.querySelectorAll<HTMLSelectElement>('[data-cue-cursor], [data-cue-pulse], [data-cue-reveal]')) {
  select.addEventListener('change', () => { cuePickRole = null; renderCueCanvas(); });
}
}

for (const radio of document.querySelectorAll<HTMLInputElement>('input[name="creation-target"]')) {
  radio.addEventListener('change', () => {
    selectedCreationElementId = radio.value as StructuralAuthoringElementId;
    creationDraftDirty = true;
    updateStructuralControls(buildTimeline(authoring.document).rows);
    schedulePreviewSelection();
  });
}

required<HTMLButtonElement>('[data-play]').addEventListener('click', () => {
  if (!shotConfig) previewSelection.hidden = true;
  if (Number(scrubber.value) >= Number(scrubber.max)) scrub(0);
  controller.play();
  startPlaybackFeedback();
  republishShotGeometry();
});
required<HTMLButtonElement>('[data-pause]').addEventListener('click', () => {
  controller.pause();
  stopPlaybackFeedback(); syncPlaybackFeedback();
  republishShotGeometry();
  schedulePreviewSelection();
});
scrubber.addEventListener('input', () => scrub(Number(scrubber.value)));
required<HTMLFormElement>('[data-value-form]').addEventListener('submit', (event) => {
  event.preventDefault(); void dispatch(makeEdit('motion.keyframe-value.set', { value: Number(valueInput.value) }));
});
required<HTMLFormElement>('[data-time-form]').addEventListener('submit', (event) => {
  event.preventDefault(); void dispatch(makeEdit('motion.keyframe-time.set', { timeMs: Number(timeInput.value) }));
});
valueInput.addEventListener('invalid', () => announceInvalidInput(valueInput, 'Opacity value'));
timeInput.addEventListener('invalid', () => announceInvalidInput(timeInput, 'Master time'));
valueInput.addEventListener('input', () => clearValidationFeedback(valueInput));
timeInput.addEventListener('input', () => clearValidationFeedback(timeInput));
valueInput.addEventListener('input', () => { valueInput.dataset.draft = 'true'; });
timeInput.addEventListener('input', () => { timeInput.dataset.draft = 'true'; });
undoButton.addEventListener('click', () => {
  if (serviceClient ? !durableUndoAvailable() : authoring.undo.length === 0) return;
  void dispatch(makeHistory('motion.history.undo'), '[data-undo]', {
    viewportTop: undoButton.getBoundingClientRect().top, scrollY,
  });
});
redoButton.addEventListener('click', () => {
  if (serviceClient ? !durableRedoAvailable() : authoring.redo.length === 0) return;
  void dispatch(makeHistory('motion.history.redo'), '[data-redo]', {
    viewportTop: redoButton.getBoundingClientRect().top, scrollY,
  });
});
createTrackButton.addEventListener('click', () => {
  if (!selectedCreationElementId) return;
  const elementId = selectedCreationElementId;
  void dispatch({
  ...operationEnvelope(), kind: 'motion.track.create', elementId,
  payload: { property: 'opacity', durationMs: 1000, delayMs: 610, easing: 'linear', startValue: 0, endValue: 1 },
  } as AuthoringOperation, '[data-add-midpoint]');
});
addMidpointButton.addEventListener('click', () => void withCreatedTrack((track) => ({
  ...operationEnvelope(), kind: 'motion.keyframe.add', elementId: track.elementId as StructuralAuthoringElementId, trackId: track.trackId,
  payload: { timeMs: 1110, value: 0.5 },
}), '[data-value]'));
setDurationButton.addEventListener('click', () => {
  const durationMs = Number(durationInput.value);
  if (!Number.isSafeInteger(durationMs) || durationMs <= 0) return rejectAuthoringInput(durationInput,
    'AUTHORING_DURATION_INVALID');
  void withCreatedTrack((track) => ({ ...operationEnvelope(), kind: 'motion.slot-duration.set',
    elementId: track.elementId as StructuralAuthoringElementId, trackId: track.trackId, payload: { durationMs } }));
});
setDelayButton.addEventListener('click', () => {
  const delayMs = Number(delayInput.value);
  if (!Number.isSafeInteger(delayMs) || delayMs < 0) return rejectAuthoringInput(delayInput,
    'AUTHORING_DELAY_INVALID');
  void withCreatedTrack((track) => ({ ...operationEnvelope(), kind: 'motion.binding-delay.set',
    elementId: track.elementId as StructuralAuthoringElementId, trackId: track.trackId, payload: { delayMs } }));
});
setEasingButton.addEventListener('click', () => void withCreatedTrack((track) => ({
  ...operationEnvelope(), kind: 'motion.slot-easing.set', elementId: track.elementId as StructuralAuthoringElementId, trackId: track.trackId,
  payload: { easing: required<HTMLSelectElement>('[data-easing]').value as 'linear' | 'ease-in-out' },
})));
insertHoldButton.addEventListener('click', () => void dispatch({
  ...operationEnvelope(), kind: 'motion.hold.insert',
  payload: { cueId: 'cue_pair', durationMs: 600 },
}, '[data-undo]'));
removeMidpointButton.addEventListener('click', () => void withCreatedTrack((track) => ({
  ...operationEnvelope(), kind: 'motion.keyframe.remove', elementId: track.elementId as StructuralAuthoringElementId, trackId: track.trackId,
  keyframeId: track.keyframes.find((keyframe) => keyframe.offset === 0.5)?.id ?? '',
}), '[data-add-midpoint]'));
for (const [selector, label] of [['[data-duration]', 'Duration'], ['[data-delay]', 'Delay']] as const) {
  const input = required<HTMLInputElement>(selector);
  input.addEventListener('invalid', () => announceInvalidInput(input, label));
  input.addEventListener('input', () => clearValidationFeedback(input));
}
for (const control of [durationInput, delayInput, easingInput]) {
  control.addEventListener('input', () => updateTimingDraftState(control));
  control.addEventListener('change', () => updateTimingDraftState(control));
}
const reducedToggle = required<HTMLButtonElement>('[data-reduced-toggle]');
const reducedPanel = required<HTMLElement>('[data-reduced-motion-panel]');
reducedPanel.querySelector('pre')!.textContent = authoring.document.reducedMotion.css;
reducedToggle.addEventListener('click', () => {
  const expanded = reducedToggle.getAttribute('aria-expanded') === 'true';
  reducedToggle.setAttribute('aria-expanded', String(!expanded));
  reducedPanel.hidden = expanded;
});

renderProjection();
await mountPreview(compiled.html, compiled.css);
activateCueLayout();
initializeSeedWorkspace();
if (serviceClient) await refreshDurableContext();
schedulePreviewSelection();
setPublicationState('settled');
document.querySelector('main')!.setAttribute('data-editor-ready', 'true');
window.addEventListener('resize', () => { configurePreviewCanvas(); schedulePreviewSelection(); scheduleCueCanvas(); if (shotConfig) renderShotWorkspace(); });

const inspectShotWorkspace = () => ({ open: Boolean(shotConfig), mode: shotMode, momentMs: shotMomentMs,
  selectedElementIds: [...shotSelection], revision: authoring.document.revision,
  previewMatchesCompiler: controller.readCompilerCommitState().committedHtml === compiled.html,
  previewNavigationSourceMatchesCompiler: controller.readCompilerCommitState().lastNavigationSourceHtml === compiled.html,
  compilerCommit: controller.readCompilerCommitState(),
  lastPreviewCommitPromotion: { ...lastPreviewCommitPromotion },
  waypointReleasePhase,
  compilerDraft: controller.readCompilerDraftState(),
  projection: shotProjection && { ...shotProjection },
  geometryPump: { running: shotGeometryPumpRunning, activeSamplers: activeShotGeometrySamplers,
    maximumActiveSamplers: maximumActiveShotGeometrySamplers, latestRequestId: latestShotGeometryRequest?.requestId ?? null,
    pendingRequestId: pendingShotGeometryRequest?.requestId ?? null, lastCommittedRequestId: lastCommittedShotGeometryRequestId },
  geometry: shotGeometry.map((sample) => ({ ...sample, contentBounds: { ...sample.contentBounds }, overlayBounds: { ...sample.overlayBounds },
    deltasDevicePixels: { ...sample.deltasDevicePixels } })),
  activeDraft: activeWaypointDraft && { commandBytes: activeWaypointDraft.commandBytes,
    compiledHtml: activeWaypointDraft.compiledHtml, compiledCss: activeWaypointDraft.compiledCss, exportDigest: activeWaypointDraft.exportDigest,
    moveCount: waypointDraftMoveCount, appliedCount: waypointDraftAppliedCount,
    controllerDraft: controller.readCompilerDraftState(),
    operation: structuredClone(activeWaypointDraft.operation) },
});

window.__motionEditor = {
  get compiledHtml() { return compiled.html; },
  get trackIds() { return buildTimeline(authoring.document).rows.map((row) => row.trackId); },
  get cueIds() { return authoring.document.cues.map((cue) => cue.id); },
  get canonicalProjection() { return buildTimeline(authoring.document); },
  readState: () => controller.readState(),
  inspectAuthoring: () => ({
    documentId: authoring.document.documentId,
    revision: authoring.document.revision,
    contentDigest: sha256Hex(canonicalContentBytes(authoring.document)),
    exportDigest: compiled.exportDigest,
    compiledHtml: compiled.html,
    undoCount: serviceClient ? Number(durableWorkspace?.history.undoAvailable ?? false) : authoring.undo.length,
    redoCount: serviceClient ? Number(durableWorkspace?.history.redoAvailable ?? false) : authoring.redo.length,
    consumedOperationIds: [...authoring.consumedOperationIds],
    selectedTrackId: selectedTrackId as string,
    selectedKeyframeId: selectedKeyframeId as string,
    selectedCreationElementId,
    unavailableSelection,
    unavailableCreation,
    draftConflictRevision,
    draftStaleBaseRevision,
    draftDirty: captureDraft().dirty,
    draftValues: captureDraft().values,
    lastCommitSeq,
    pendingRevision,
    publicationPending: publicationState === 'pending',
    publicationState,
    publicationFailureCode,
    serviceBacked: Boolean(serviceClient),
    activeBranchId,
    immutableRefetchCount,
    lastCommit,
  }),
  inspectCollaboration: () => ({ workspace: durableWorkspace && structuredClone(durableWorkspace),
    branches: durableBranches && structuredClone(durableBranches), claims: durableClaims && structuredClone(durableClaims),
    activity: durableActivity && structuredClone(durableActivity), diagnostic: lastServiceDiagnostic && structuredClone(lastServiceDiagnostic) }),
  dispatch,
  openShotWorkspace,
  inspectShotWorkspace,
  inspectCueWorkspace: () => ({ active: Boolean(cueWorkspace), pickRole: cuePickRole,
    selectedRoles: { cursor: Boolean(cueRoleSelect('cursor').value), pulse: Boolean(cueRoleSelect('pulse').value),
      reveal: Boolean(cueRoleSelect('reveal').value) },
    targetCandidateCount: Number(cueTargetOverlay?.dataset.candidateCount ?? 0),
    pathHandleCount: cuePathOverlay?.querySelectorAll('[data-waypoint-index]').length ?? 0,
    authoredCues: authoring.document.cues.filter((cue): cue is AuthoringCue => cue.schemaVersion === 'motion.authoring-cue.v1')
      .map((cue) => ({ kind: cue.semantic.kind, semantic: structuredClone(cue.semantic), generatedTrackCount: cue.generatedTrackIds.length })),
  }),
  switchBranch,
  disconnectEvents: () => { eventSubscription?.close(); eventSubscriptionGeneration += 1; },
  reconnectEvents: connectEvents,
  delayNextPublication: () => {
    if (publicationTestGate) return;
    let release: () => void = () => undefined;
    const promise = new Promise<void>((resolve) => { release = resolve; });
    publicationTestGate = { promise, release };
  },
  releasePublication: () => { publicationTestGate?.release(); publicationTestGate = null; },
  failNextPublication: () => { failNextPublicationForTest = true; },
  retryPublication: async () => {
    if (!serviceClient || publicationState !== 'failed') return false;
    const immutable = await serviceClient.head(authoring.document.documentId, activeBranchId);
    await applyImmutable(immutable, true);
    return true;
  },
};

type EditorPersistentOperation = AuthoringOperation | PreparedOperationIntent;

function rejectUnavailablePublication(): 'PUBLICATION_PENDING' | 'PUBLICATION_FAILED' | null {
  if (publicationState === 'settled') return null;
  const code = publicationState === 'pending' ? 'PUBLICATION_PENDING' : 'PUBLICATION_FAILED';
  publishClientDiagnostic(code, 'storage', true);
  return code;
}

async function dispatch(
  operation: EditorPersistentOperation,
  focusSelector?: string,
  historyAnchor?: { viewportTop: number; scrollY: number },
  previewPromotion?: PreviewCssCommitPromotion,
): Promise<{ ok: boolean; code?: string }> {
  const publicationRejection = rejectUnavailablePublication();
  if (publicationRejection) return { ok: false, code: publicationRejection };
  const beforeCreated = findCreatedTrack(buildTimeline(authoring.document).rows);
  let authoritativePreviewAlreadyMounted = false;
  let result: ReturnType<typeof dispatchAuthoringOperation>;
  if (serviceClient) {
    const command = serviceCommandForOperation(operation);
    const commandTask = reconciliation.then(async () => {
      const queuedPublicationRejection = rejectUnavailablePublication();
      if (queuedPublicationRejection) return { response: null, applied: false,
        authoritativePreviewAlreadyMounted: false, publicationRejection: queuedPublicationRejection };
      let response;
      try { response = await serviceClient.dispatch(command); }
      catch {
        try { response = await serviceClient.dispatch(command); }
        catch {
          const operationDigest = sha256Hex(canonicalJson(command));
          try {
            const committed = await findCommittedOperation(operation.documentId, operationDigest);
            if (!committed) return { response: null, applied: false, authoritativePreviewAlreadyMounted: false };
            pendingRevision = committed.revision;
            const immutable = await serviceClient.revision(operation.documentId, committed.revision);
            resolveAcceptedOperationDraft(operation);
            await applyImmutable(immutable, false, previewPromotion);
            resolveAcceptedCreationDraft(); pendingRevision = null;
            return { response: null, applied: true, authoritativePreviewAlreadyMounted: true };
          } catch { pendingRevision = null;
            return { response: null, applied: false, authoritativePreviewAlreadyMounted: false }; }
        }
      }
      if (response.ok) {
        pendingRevision = response.resultingRevision;
        try {
          const immutable = await serviceClient.revision(response.documentId, response.resultingRevision);
          resolveAcceptedOperationDraft(operation);
          await applyImmutable(immutable, false, previewPromotion);
          resolveAcceptedCreationDraft();
        }
        finally { pendingRevision = null; }
        return { response, applied: true, authoritativePreviewAlreadyMounted: true };
      }
      pendingRevision = null;
      if (response.code === 'STALE_REVISION') {
        const immutable = await serviceClient.head(operation.documentId, activeBranchId);
        await applyImmutable(immutable, true);
      }
      return { response, applied: false, authoritativePreviewAlreadyMounted: false };
    });
    reconciliation = commandTask.then(() => undefined, () => undefined);
    const outcome = await commandTask; const response = outcome.response;
    if ('publicationRejection' in outcome && outcome.publicationRejection) {
      return { ok: false, code: outcome.publicationRejection };
    }
    if (!response && !outcome.applied) {
      publishClientDiagnostic('SERVICE_UNAVAILABLE', 'storage', true);
      return { ok: false, code: 'SERVICE_UNAVAILABLE' };
    }
    if (response && !response.ok && !outcome.applied) {
      publishServiceDiagnostic(response.diagnostic);
      return { ok: false, code: response.diagnostic.code };
    } else {
      result = { ok: true, state: authoring };
      authoritativePreviewAlreadyMounted = outcome.authoritativePreviewAlreadyMounted;
    }
  } else {
    publishClientDiagnostic('SERVICE_REQUIRED', 'protocol', false);
    return { ok: false, code: 'SERVICE_REQUIRED' };
  }
  authoring = result.state;
  if (!authoritativePreviewAlreadyMounted) {
    compiled = compileMotionDocument(authoring.document);
    let promoted = false;
    if (previewPromotion) {
      try {
        await controller.promoteCompilerCssCommit({ ...previewPromotion,
          newCommittedHtml: compiled.html, newCompilerCss: compiled.css });
        promoted = true; lastPreviewCommitPromotion = { schemaVersion: 'motion.preview-css-commit-promotion.v1', attempted: true,
          promoted: true, fallbackCode: null };
      } catch (error) {
        lastPreviewCommitPromotion = { schemaVersion: 'motion.preview-css-commit-promotion.v1', attempted: true,
          promoted: false, fallbackCode: error instanceof Error ? error.message : 'PREVIEW_CSS_COMMIT_PROMOTION_INVALID' };
      }
    }
    if (!promoted) await mountPreview(compiled.html, compiled.css);
  }
  const rows = buildTimeline(authoring.document).rows;
  const created = findCreatedTrack(rows);
  const createdKeyframeCount = created?.keyframes.length ?? 0;
  if (created) {
    selectedTrackId = created.trackId;
    if (operation.kind === 'motion.keyframe.add') {
      selectedKeyframeId = created.keyframes.find((keyframe) => keyframe.offset === 0.5)!.id;
      hasExplicitKeyframeSelection = true;
    } else if (operation.kind === 'motion.keyframe.remove') {
      selectedKeyframeId = created.keyframes.at(-1)!.id;
    } else if (operation.kind === 'motion.track.create'
      || !created.keyframes.some((keyframe) => keyframe.id === selectedKeyframeId)) {
      selectedKeyframeId = created.keyframes[0]!.id;
    }
  } else {
    const selectedStillExists = selectedTrackId && selectedKeyframeId
      && rows.find((row) => row.trackId === selectedTrackId)
        ?.keyframes.some((keyframe) => keyframe.id === selectedKeyframeId);
    if (!selectedStillExists) {
      selectedTrackId = null;
      selectedKeyframeId = null;
    }
  }
  if (operation.kind === 'motion.history.undo'
    && (!created || createdKeyframeCount === 2)) {
    clearKeyframeSelection();
  } else if (operation.kind === 'motion.history.redo' && !beforeCreated && created) {
    selectedTrackId = created.trackId;
    selectedKeyframeId = created.keyframes[0]!.id;
    hasExplicitKeyframeSelection = true;
  } else if (operation.kind === 'motion.history.redo' && createdKeyframeCount === 3 && created) {
    selectedTrackId = created.trackId;
    selectedKeyframeId = created.keyframes.find((keyframe) => keyframe.offset === 0.5)!.id;
    hasExplicitKeyframeSelection = true;
  }
  renderProjection();
  if (shotConfig) renderShotWorkspace();
  if (operation.kind === 'motion.track.create') resolveAcceptedCreationDraft();
  status.value = `${successMessage(operation.kind)} Revision ${authoring.document.revision}.`;
  status.dataset.kind = 'success';
  if (cueWorkspace && (operation.kind === 'motion.history.undo' || operation.kind === 'motion.history.redo')) {
    const restored = operation.kind === 'motion.history.undo' ? 'Undid the last change' : 'Redid the last change';
    announceCueStatus(`${restored}. Revision ${authoring.document.revision}.`, false);
  }
  if (focusSelector) {
    const focusTarget = required<HTMLElement>(focusSelector);
    if (focusTarget instanceof HTMLButtonElement && focusTarget.disabled) {
      focusTarget.disabled = false;
      focusTarget.setAttribute('aria-disabled', 'true');
    }
    focusTarget.focus({ preventScroll: true });
    if (historyAnchor) {
      scrollBy(0, focusTarget.getBoundingClientRect().top - historyAnchor.viewportTop);
      Object.assign(focusTarget.dataset, {
        historyViewportTopBefore: String(historyAnchor.viewportTop),
        historyViewportTopAfter: String(focusTarget.getBoundingClientRect().top),
        historyScrollBefore: String(historyAnchor.scrollY),
        historyScrollAfter: String(scrollY),
        historyMaxScrollAfter: String(document.documentElement.scrollHeight - innerHeight),
      });
    }
  }
  return { ok: true };
}

function serviceCommandForOperation(operation: EditorPersistentOperation): MotionCommand {
  if (operation.schemaVersion === 'motion.operation-intent.v1') return makeOperationIntentCommand(operation, activeBranchId);
  return commandSchema.parse({ protocolVersion: 'motion.protocol.v1', operationId: operation.operationId,
    documentId: operation.documentId, branchId: activeBranchId, expectedRevision: operation.expectedRevision,
    command: operation });
}

async function prepareAndDispatchIntent(
  intent: OperationIntentPayload,
  focusSelector?: string,
  historyAnchor?: { viewportTop: number; scrollY: number },
  previewPromotion?: PreviewCssCommitPromotion,
): Promise<{ ok: boolean; code?: string }> {
  const publicationRejection = rejectUnavailablePublication();
  if (publicationRejection) return { ok: false, code: publicationRejection };
  if (!serviceClient) {
    publishClientDiagnostic('SERVICE_REQUIRED', 'protocol', false);
    return { ok: false, code: 'SERVICE_REQUIRED' };
  }
  const expectedRevision = authoring.document.revision;
  try {
    const preparation = await serviceClient.prepareOperation({ schemaVersion: 'motion.operation-preparation-request.v1',
      documentId: authoring.document.documentId, branchId: activeBranchId, expectedRevision, kind: intent.kind, intent });
    if (!preparation.eligibility || !preparation.normalizedIntent || !preparation.derivationDigest) {
      const code = preparation.reasonCode ?? 'DERIVATION_INVALID';
      publishClientDiagnostic(code, code === 'DERIVATION_STALE' ? 'revision' : 'domain', false);
      return { ok: false, code };
    }
    const prepared: PreparedOperationIntent = { schemaVersion: 'motion.operation-intent.v1', operationId: nextOperationId(),
      documentId: preparation.documentId, expectedRevision: preparation.revision, kind: preparation.kind,
      derivationDigest: preparation.derivationDigest, intent: preparation.normalizedIntent };
    return dispatch(prepared, focusSelector, historyAnchor, previewPromotion);
  } catch (error) {
    if (error instanceof MotionPreparationError) {
      publishServiceDiagnostic(error.response.diagnostic);
      return { ok: false, code: error.response.diagnostic.code };
    }
    publishClientDiagnostic('SERVICE_PREPARATION_FAILED', 'storage', true);
    return { ok: false, code: 'SERVICE_PREPARATION_FAILED' };
  }
}

function durableUndoAvailable(): boolean { return durableWorkspace?.history.undoAvailable === true; }
function durableRedoAvailable(): boolean { return durableWorkspace?.history.redoAvailable === true; }

async function findCommittedOperation(documentId: string, operationDigest: string): Promise<CommitMetadata | null> {
  if (!serviceClient) return null;
  let cursor = lastCommitSeq; const visited = new Set<number>();
  while (!visited.has(cursor)) {
    visited.add(cursor); const page = await serviceClient.activity(documentId, cursor, 100);
    const match = page.events.find((event) => event.operationDigest === operationDigest); if (match) return match;
    if (page.nextAfterCommitSeq === null) return null; cursor = page.nextAfterCommitSeq;
  }
  return null;
}

async function fetchDurableContext(documentId: string, branchId = activeBranchId): Promise<DurableContextSnapshot> {
  if (!serviceClient) throw new Error('SERVICE_REQUIRED');
  const [workspace, branches, claims, activity] = await Promise.all([
    serviceClient.workspace(documentId, branchId), serviceClient.branches(documentId),
    serviceClient.activeClaims(documentId), serviceClient.activity(documentId, 0, 25),
  ]);
  return { workspace, branches, claims, activity };
}

function publishDurableContext(snapshot: DurableContextSnapshot): void {
  const { workspace, branches, claims, activity } = snapshot;
  durableWorkspace = workspace; durableBranches = branches; durableClaims = claims; durableActivity = activity;
  required('[data-collaboration-branch]').textContent = activeBranchId;
  required('[data-collaboration-revision]').textContent = String(workspace.revision);
  const latest = activity.events.at(-1);
  required('[data-collaboration-actor]').textContent = latest?.actor
    ? `${latest.actor.kind} · ${latest.actor.actorId ?? 'legacy'}` : 'Awaiting activity';
  const activeClaim = claims.claims[0];
  required('[data-collaboration-claim]').textContent = activeClaim
    ? `${activeClaim.scope} · ${activeClaim.holder.actorId ?? 'legacy'}` : 'None';
  if (branchSelect) {
    const selected = activeBranchId; branchSelect.replaceChildren(...branches.branches.map((branch) => new Option(
      `${branch.branchId} · r${branch.headRevision}`, branch.branchId, false, branch.branchId === selected)));
  }
  const activityList = required<HTMLOListElement>('[data-collaboration-activity]'); activityList.replaceChildren();
  for (const event of activity.events.slice(-8).reverse()) {
    const item = document.createElement('li');
    item.textContent = `r${event.revision} · ${event.kind} · ${event.actor?.kind ?? 'legacy'} · ${event.actor?.actorId ?? 'legacy'}`;
    activityList.append(item);
  }
  const eligibilityList = required<HTMLUListElement>('[data-collaboration-eligibility]'); eligibilityList.replaceChildren();
  for (const entry of workspace.eligibility) {
    const item = document.createElement('li'); item.dataset.eligible = String(entry.eligible);
    item.textContent = `${entry.kind}: ${entry.eligible ? 'available' : entry.reasonCode}`; eligibilityList.append(item);
  }
  undoButton.disabled = !workspace.history.undoAvailable;
  redoButton.disabled = !workspace.history.redoAvailable;
  if (cueWorkspace) required<HTMLElement>('[data-cue-history-slot]').hidden = undoButton.disabled && redoButton.disabled;
}

async function refreshDurableContext(): Promise<void> {
  if (!serviceClient) return;
  publishDurableContext(await fetchDurableContext(authoring.document.documentId));
}

function setPublicationState(state: PublicationState, failureCode: string | null = null): void {
  publicationState = state;
  publicationFailureCode = failureCode;
  const main = document.querySelector('main')!;
  main.dataset.publicationPending = String(state === 'pending');
  main.dataset.publicationState = state;
}

function publishServiceDiagnostic(diagnostic: MotionDiagnostic): void {
  lastServiceDiagnostic = diagnostic;
  const output = document.querySelector<HTMLOutputElement>('[data-service-diagnostic]');
  if (output) { output.hidden = false;
    output.value = `${diagnostic.code} · ${diagnostic.category} · ${diagnostic.retryable ? 'retryable' : 'not retryable'}`; }
  status.value = diagnostic.code === 'STALE_REVISION'
    ? `${diagnostic.code}: local change not applied; refreshed to revision ${authoring.document.revision}.`
    : `${diagnostic.code}: revision ${authoring.document.revision} unchanged.`;
  status.dataset.kind = 'error';
}

function publishClientDiagnostic(code: string, category: MotionDiagnostic['category'], retryable: boolean): void {
  publishServiceDiagnostic({ schemaVersion: 'motion.diagnostic.v1', code, category, retryable });
}

if (serviceClient) connectEvents();

function connectEvents(): void {
  if (!serviceClient) return;
  eventSubscription?.close();
  const generation = ++eventSubscriptionGeneration;
  eventSubscription = serviceClient.events(authoring.document.documentId, lastCommitSeq, (event) => {
    reconciliation = reconciliation.then(() => reconcileCommit(event, generation)).catch((error) => {
      status.value = `Remote refresh failed (${error instanceof Error ? error.message : 'UNKNOWN'}).`;
      status.dataset.kind = 'error';
      if (generation !== eventSubscriptionGeneration) return;
      eventSubscription?.close(); eventSubscriptionGeneration += 1;
      const attempts = reconciliationFailures.get(event.commitSeq) ?? 0;
      reconciliationFailures.set(event.commitSeq, attempts + 1);
      if (attempts === 0) reconnectTimer = setTimeout(connectEvents, 0);
    });
  }, () => {
    if (generation !== eventSubscriptionGeneration) return;
    status.value = 'Live updates disconnected. Reconnecting from the durable cursor…'; status.dataset.kind = 'error';
    if (reconnectTimer) clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(connectEvents, 100);
  });
}

async function reconcileCommit(event: CommitMetadata, subscriptionGeneration: number): Promise<void> {
  if (!serviceClient || subscriptionGeneration !== eventSubscriptionGeneration || event.commitSeq <= lastCommitSeq) return;
  const acknowledge = () => { lastCommitSeq = event.commitSeq; lastCommit = event; reconciliationFailures.delete(event.commitSeq); };
  const gap = event.commitSeq !== lastCommitSeq + 1;
  if (event.branchId !== activeBranchId) { acknowledge(); await refreshDurableContext(); return; }
  if (event.kind === 'motion.track.create' && event.revision < authoring.document.revision) { acknowledge(); return; }
  const branchAtStart = branchGeneration;
  const immutable = gap ? await serviceClient.head(event.documentId, event.branchId)
    : await serviceClient.revision(event.documentId, event.revision);
  if (branchAtStart !== branchGeneration || event.branchId !== activeBranchId) return;
  if (!gap && immutable.canonicalDigest !== event.digest) throw new Error('REMOTE_DIGEST_MISMATCH');
  if (gap && immutable.document.revision === event.revision && immutable.canonicalDigest !== event.digest)
    throw new Error('REMOTE_GAP_DIGEST_MISMATCH');
  const applied = immutable.document.revision !== authoring.document.revision;
  if (applied) await applyImmutable(immutable, true);
  acknowledge();
  if (applied || gap) {
    status.value = gap ? `Event gap detected; immutable branch head refetched at revision ${authoring.document.revision}.`
      : `Revision ${authoring.document.revision} refreshed from committed service state.`;
    status.dataset.kind = 'success';
  }
  if (!applied) await refreshDurableContext();
}

async function switchBranch(branchId: string): Promise<void> {
  if (!serviceClient) return; const generation = ++branchGeneration;
  reconciliation = reconciliation.then(async () => {
    const immutable = await serviceClient.head(authoring.document.documentId, branchId);
    if (generation !== branchGeneration) return;
    activeBranchId = branchId; await applyImmutable(immutable, true);
    status.value = `Branch ${branchId} head revision ${authoring.document.revision} loaded.`;
  });
  await reconciliation;
}

async function createBranch(branchId: string): Promise<void> {
  if (!serviceClient) return;
  if (rejectUnavailablePublication()) return;
  try {
    const response = await serializeServiceCommand(() => serviceClient.dispatch(makeBranchCreateCommand({ operationId: nextOperationId(),
      documentId: authoring.document.documentId, sourceBranchId: activeBranchId,
      expectedRevision: authoring.document.revision, branchId })));
    if (!response) return;
    if (!response.ok) { publishServiceDiagnostic(response.diagnostic); return; }
    if (branchSelect && ![...branchSelect.options].some((option) => option.value === branchId)) branchSelect.add(new Option(branchId, branchId));
    if (branchSelect) branchSelect.value = branchId; await switchBranch(branchId); status.dataset.kind = 'success';
  } catch { publishClientDiagnostic('SERVICE_UNAVAILABLE', 'storage', true); }
}

async function revokeClaim(claimId: string, leaseVersion: number): Promise<void> {
  if (!serviceClient) return;
  if (rejectUnavailablePublication()) return;
  try {
    const documentRevision = await serviceClient.documentRevision(authoring.document.documentId);
    const response = await serializeServiceCommand(() => serviceClient.dispatch(makeClaimControlCommand({ kind: 'motion.claim.revoke', operationId: nextOperationId(),
      documentId: authoring.document.documentId, branchId: activeBranchId, expectedRevision: documentRevision.revision,
      claimId, leaseVersion })));
    if (!response) return;
    if (!response.ok) { publishServiceDiagnostic(response.diagnostic); return; }
    status.value = `Claim ${response.claimId} revoked at lease version ${response.leaseVersion}.`; status.dataset.kind = 'success';
    await refreshDurableContext();
  } catch { publishClientDiagnostic('SERVICE_UNAVAILABLE', 'storage', true); }
}

async function serializeServiceCommand<T>(command: () => Promise<T>): Promise<T | null> {
  const task = reconciliation.then(() => rejectUnavailablePublication() ? null : command());
  reconciliation = task.then(() => undefined, () => undefined); return task;
}

function clearKeyframeSelection(): void {
  selectedTrackId = null;
  selectedKeyframeId = null;
  hasExplicitKeyframeSelection = false;
}

type ImmutableHead = Awaited<ReturnType<MotionServiceClient['head']>>;
async function applyImmutable(immutable: ImmutableHead, remote: boolean, previewPromotion?: PreviewCssCommitPromotion): Promise<void> {
  const draft = captureDraft();
  const nextAuthoring = createAuthoringState(immutable.document); const nextCompiled = compileMotionDocument(nextAuthoring.document);
  const previousCompiled = compiled;
  setPublicationState('pending');
  let promoted = false;
  try {
    const nextDurableContext = serviceClient
      ? await fetchDurableContext(nextAuthoring.document.documentId, activeBranchId)
      : null;
    if (publicationTestGate) await publicationTestGate.promise;
    if (previewPromotion) {
      try {
        await controller.promoteCompilerCssCommit({ ...previewPromotion, newCommittedHtml: nextCompiled.html, newCompilerCss: nextCompiled.css });
        promoted = true; lastPreviewCommitPromotion = { schemaVersion: 'motion.preview-css-commit-promotion.v1', attempted: true,
          promoted: true, fallbackCode: null };
      } catch (error) {
        lastPreviewCommitPromotion = { schemaVersion: 'motion.preview-css-commit-promotion.v1', attempted: true, promoted: false,
          fallbackCode: error instanceof Error ? error.message : 'PREVIEW_CSS_COMMIT_PROMOTION_INVALID' };
      }
    } else {
      lastPreviewCommitPromotion = { schemaVersion: 'motion.preview-css-commit-promotion.v1', attempted: false,
        promoted: false, fallbackCode: null };
    }
    if (!promoted) await mountPreview(nextCompiled.html, nextCompiled.css);
    if (failNextPublicationForTest) {
      failNextPublicationForTest = false;
      throw new Error('PREVIEW_PUBLICATION_TEST_FAILURE');
    }
    authoring = nextAuthoring; compiled = nextCompiled; immutableRefetchCount += 1;
    if (nextDurableContext) publishDurableContext(nextDurableContext);
    renderProjection();
    if (shotConfig) renderShotWorkspace();
    if (draft.dirty) {
      restoreDraft(draft);
      if (remote) { draftConflictRevision = authoring.document.revision;
        draftConflict.hidden = false; draftConflict.dataset.revision = String(draftConflictRevision); }
    } else {
      draftStaleBaseRevision = null;
    }
    setPublicationState('settled');
  } catch (error) {
    if (controller.readCompilerCommitState().committedHtml !== previousCompiled.html) {
      try { await mountPreview(previousCompiled.html, previousCompiled.css); } catch { /* preserve explicit failed state */ }
    }
    setPublicationState('failed', error instanceof Error ? error.message : 'PUBLICATION_FAILED');
    throw error;
  }
}

type DraftSnapshot = { dirty: boolean; values: Record<string, string>; dirtyFields: Record<string, boolean>;
  creationElementId: StructuralAuthoringElementId | null; creationDirty: boolean; staleBaseRevision: number | null };
function captureDraft(): DraftSnapshot {
  const values: Record<string, string> = {}; const dirtyFields: Record<string, boolean> = {};
  for (const selector of ['[data-duration]', '[data-delay]', '[data-easing]', '[data-value]', '[data-time]',
    '[data-new-branch]', '[data-claim-id]', '[data-lease-version]']) {
    const control = document.querySelector<HTMLInputElement | HTMLSelectElement>(selector); if (!control) continue;
    values[selector] = control.value;
    dirtyFields[selector] = selector === '[data-duration]' || selector === '[data-delay]' || selector === '[data-easing]'
      ? control.closest<HTMLElement>('.timing-control')?.dataset.draft === 'true' : control.dataset.draft === 'true';
  }
  const dirty = Object.values(dirtyFields).some(Boolean) || creationDraftDirty;
  return { dirty, values, dirtyFields, creationElementId: selectedCreationElementId, creationDirty: creationDraftDirty,
    staleBaseRevision: dirtyStaleBase(dirty) };
}
function restoreDraft(draft: DraftSnapshot): void {
  for (const [selector, value] of Object.entries(draft.values)) {
    const control = document.querySelector<HTMLInputElement | HTMLSelectElement>(selector);
    if (control && draft.dirtyFields[selector]) control.value = value;
  }
  selectedCreationElementId = draft.creationElementId;
  creationDraftDirty = draft.creationDirty; draftStaleBaseRevision = draft.staleBaseRevision;
  for (const radio of document.querySelectorAll<HTMLInputElement>('input[name="creation-target"]'))
    radio.checked = radio.value === selectedCreationElementId;
  for (const [selector, dirty] of Object.entries(draft.dirtyFields)) {
    const control = document.querySelector<HTMLInputElement | HTMLSelectElement>(selector); if (!control) continue;
    if (selector === '[data-duration]' || selector === '[data-delay]' || selector === '[data-easing]') {
      control.closest<HTMLElement>('.timing-control')!.dataset.draft = String(dirty);
      required<HTMLElement>('em', control.closest('.timing-control')!).hidden = !dirty;
    } else control.dataset.draft = String(dirty);
  }
}
function resolveDraftConflict(keep: boolean): void {
  if (!keep) {
    selectedCreationElementId = null; creationDraftDirty = false; draftStaleBaseRevision = null;
    valueInput.value = ''; timeInput.value = ''; valueInput.dataset.draft = 'false'; timeInput.dataset.draft = 'false';
    for (const radio of document.querySelectorAll<HTMLInputElement>('input[name="creation-target"]')) radio.checked = false;
    for (const control of document.querySelectorAll<HTMLInputElement>('[data-new-branch], [data-claim-id], [data-lease-version]')) {
      control.value = control.defaultValue; control.dataset.draft = 'false';
    }
    renderProjection();
  }
  draftConflictRevision = null; draftConflict.hidden = true;
  status.value = keep ? `Local draft kept against revision ${authoring.document.revision}; apply it explicitly when ready.`
    : `Local draft discarded; revision ${authoring.document.revision} values restored.`;
  status.dataset.kind = 'success';
}

function dirtyStaleBase(dirty: boolean): number | null {
  return dirty ? draftStaleBaseRevision ?? authoring.document.revision : null;
}

function resolveAcceptedCreationDraft(): void {
  creationDraftDirty = false;
  if (captureDraft().dirty) return;
  draftStaleBaseRevision = null;
  draftConflictRevision = null;
  draftConflict.hidden = true;
  delete draftConflict.dataset.revision;
}

function resolveAcceptedOperationDraft(operation: Pick<EditorPersistentOperation, 'kind'>): void {
  if (operation.kind === 'motion.track.create') resolveAcceptedCreationDraft();
  const timingControl = operation.kind === 'motion.slot-duration.set' ? durationInput
    : operation.kind === 'motion.binding-delay.set' ? delayInput
      : operation.kind === 'motion.slot-easing.set' ? easingInput : null;
  if (timingControl) {
    const container = timingControl.closest<HTMLElement>('.timing-control')!;
    container.dataset.draft = 'false'; required<HTMLElement>('em', container).hidden = true;
    timingControl.setAttribute('aria-invalid', 'false');
  }
  if (operation.kind === 'motion.keyframe-value.set') valueInput.dataset.draft = 'false';
  if (operation.kind === 'motion.keyframe-time.set') timeInput.dataset.draft = 'false';
  if (operation.kind === 'motion.history.undo' || operation.kind === 'motion.history.redo') {
    for (const control of [durationInput, delayInput, easingInput]) {
      const container = control.closest<HTMLElement>('.timing-control')!;
      container.dataset.draft = 'false'; required<HTMLElement>('em', container).hidden = true;
      control.setAttribute('aria-invalid', 'false');
    }
    valueInput.dataset.draft = 'false'; timeInput.dataset.draft = 'false';
    valueInput.setAttribute('aria-invalid', 'false'); timeInput.setAttribute('aria-invalid', 'false');
  }
}

function operationEnvelope() {
  return { schemaVersion: 'motion.operation.v1' as const, operationId: nextOperationId(),
    documentId: authoring.document.documentId, expectedRevision: authoring.document.revision };
}

async function withCreatedTrack(
  create: (track: TimelineRow) => AuthoringOperation,
  focusSelector?: string | (() => string),
): Promise<{ ok: boolean; code?: string }> {
  const track = findCreatedTrack(buildTimeline(authoring.document).rows);
  if (!track) {
    status.value = `AUTHORING_TRACK_NOT_FOUND: operation rejected; revision ${authoring.document.revision} unchanged.`;
    status.dataset.kind = 'error'; return { ok: false, code: 'AUTHORING_TRACK_NOT_FOUND' };
  }
  return dispatch(create(track), typeof focusSelector === 'function' ? focusSelector() : focusSelector);
}

function makeEdit(
  kind: 'motion.keyframe-value.set' | 'motion.keyframe-time.set',
  payload: { value: number } | { timeMs: number },
): AuthoringOperation {
  const target = currentTarget();
  return {
    schemaVersion: 'motion.operation.v1', operationId: nextOperationId(),
    documentId: authoring.document.documentId, expectedRevision: authoring.document.revision,
    kind, elementId: target.elementId, trackId: target.trackId, keyframeId: selectedKeyframeId,
    payload,
  } as AuthoringOperation;
}

function makeHistory(kind: 'motion.history.undo' | 'motion.history.redo'): AuthoringOperation {
  return {
    schemaVersion: 'motion.operation.v1', operationId: nextOperationId(),
    documentId: authoring.document.documentId, expectedRevision: authoring.document.revision, kind,
  };
}

function nextOperationId(): string {
  operationSequence += 1;
  return `editor:${operationClientId}:${operationSequence}`;
}

function renderProjection(): void {
  const timeline = buildTimeline(authoring.document);
  const timelineElement = required<HTMLElement>('[data-timeline]');
  timelineElement.dataset.durationMs = String(timeline.durationMs);
  scrubber.max = String(shotConfig ? shotConfig.settledMs + 1 : timeline.durationMs);
  timelineElement.replaceChildren(...timeline.rows.map(renderTrack));
  required('[data-track-count]').textContent = `${timeline.rows.length} tracks`;
  const cues = required('[data-cues]');
  cues.replaceChildren();
  for (const cue of timeline.cues) {
    const button = document.createElement('button');
    button.type = 'button';
    Object.assign(button.dataset, { cueId: cue.id, schemaVersion: cue.schemaVersion, label: cue.label, timeMs: String(cue.timeMs) });
    button.innerHTML = `<span>${cue.label}<code>${cue.id} · ${cue.schemaVersion}</code></span><time>${cue.timeMs} ms</time>`;
    button.addEventListener('click', () => scrub(cue.timeMs));
    cues.append(button);
  }
  required('[data-cue-count]').textContent = String(timeline.cues.length);
  if (payload.cueWorkspace) renderAuthoredCues();
  const hold = timeline.holds?.[0];
  insertHoldButton.disabled = Boolean(hold);
  holdStatus.value = hold
    ? `600 ms hold inserted · Pair crosses at ${hold.sourceTimeMs + hold.durationMs} ms · duration ${timeline.durationMs} ms`
    : 'No hold inserted · Pair crosses at 2870 ms';
  required<HTMLElement>('[data-hold-control]').dataset.active = String(Boolean(hold));
  for (const [button, unavailable] of [[undoButton, serviceClient ? !durableUndoAvailable() : authoring.undo.length === 0],
    [redoButton, serviceClient ? !durableRedoAvailable() : authoring.redo.length === 0]] as const) {
    button.removeAttribute('aria-disabled');
    button.disabled = unavailable;
  }
  if (cueWorkspace) required<HTMLElement>('[data-cue-history-slot]').hidden = undoButton.disabled && redoButton.disabled;
  updateStructuralControls(timeline.rows);
  updateSelection();
  scheduleCueCanvas();
}

async function submitCueForm(form: HTMLFormElement): Promise<void> {
  const kind = form.dataset.cueForm as CueSemantic['kind'];
  const number = (name: string): number => Number(new FormData(form).get(name));
  const cursorTargetId = required<HTMLSelectElement>('[data-cue-cursor]').value;
  const pulseTargetId = required<HTMLSelectElement>('[data-cue-pulse]').value;
  const revealTargetId = required<HTMLSelectElement>('[data-cue-reveal]').value;
  const existing = authoring.document.cues.find((cue): cue is AuthoringCue => cue.schemaVersion === 'motion.authoring-cue.v1'
    && cue.semantic.kind === kind);
  let semantic: CueSemantic;
  if (kind === 'cursor-path') {
    const startMs = number('start'); const arriveMs = number('arrive');
    semantic = { kind, cursorTargetId, startMs, arriveMs, easing: { kind: 'keyword', value: 'ease-out' }, waypoints: [
      { timeMs: startMs, xPpm: Math.round(number('startX') * 10_000), yPpm: Math.round(number('startY') * 10_000) },
      { timeMs: arriveMs, xPpm: Math.round(number('endX') * 10_000), yPpm: Math.round(number('endY') * 10_000) },
    ] };
  } else if (kind === 'reveal') {
    semantic = { kind, targetIds: [revealTargetId], startMs: number('start'), completeMs: number('complete') };
  } else {
    const reveal = authoring.document.cues.find((cue): cue is AuthoringCue => cue.schemaVersion === 'motion.authoring-cue.v1'
      && cue.semantic.kind === 'reveal');
    semantic = { kind, cursorTargetId, pulseTargetId, arriveMs: number('arrive'), pressMs: number('press'),
      releaseMs: number('release'), pulseEndMs: number('pulseEnd'), pressScalePpm: Math.round(number('scale') * 10_000),
      pulseRadiusPpm: Math.round(number('radius') * 1_000_000), pulseOpacityPpm: 700_000,
      ...(reveal ? { revealCueId: reveal.id } : {}) };
  }
  const intent: OperationIntentPayload = existing
    ? { kind: 'motion.cue.update', cueId: existing.id, semantic }
    : { kind: 'motion.cue.create', creationKey: `editor-${kind}`, semantic };
  const result = await prepareAndDispatchIntent(intent);
  if (result.ok) { cueEditingKind = null; renderCueCanvas(); }
  announceCueStatus(result.ok ? `${kind === 'cursor-path' ? 'Cursor path' : kind === 'click' ? 'Click' : 'Reveal'} ${existing ? 'updated' : 'created'} at revision ${authoring.document.revision}.`
    : cueDiagnosticMessage(result.code ?? 'UNKNOWN', kind), !result.ok, result.ok ? undefined : result.code);
}

function renderAuthoredCues(): void {
  reconcileCueEditingProjection();
  const container = required<HTMLElement>('[data-authored-cues]'); container.replaceChildren();
  const createLabels: Record<CueSemantic['kind'], string> = {
    'cursor-path': 'Create cursor path', reveal: 'Create reveal', click: 'Create click',
  };
  for (const form of document.querySelectorAll<HTMLFormElement>('[data-cue-form]')) {
    form.querySelector('button[type="submit"]')!.textContent = createLabels[form.dataset.cueForm as CueSemantic['kind']];
  }
  for (const cue of authoring.document.cues.filter((candidate): candidate is AuthoringCue => candidate.schemaVersion === 'motion.authoring-cue.v1')) {
    const card = document.createElement('article'); card.dataset.authoredCue = cue.semantic.kind; card.dataset.cueId = cue.id;
    card.innerHTML = `<div><strong>${cue.label}</strong><span>${cue.generatedTrackIds.length} generated track${cue.generatedTrackIds.length === 1 ? '' : 's'}</span></div>
      <div><button type="button" data-cue-edit>Edit</button><button type="button" data-cue-detach>Detach</button><button type="button" data-cue-delete>Delete</button></div>`;
    card.querySelector<HTMLButtonElement>('[data-cue-edit]')!.addEventListener('click', () => {
      cueEditingKind = cue.semantic.kind; renderCueCanvas();
      document.querySelector<HTMLFormElement>(`[data-cue-form="${cue.semantic.kind}"]`)?.focus();
    });
    card.querySelector<HTMLButtonElement>('[data-cue-detach]')!.addEventListener('click', () => void terminateCue(cue, 'motion.cue.detach'));
    card.querySelector<HTMLButtonElement>('[data-cue-delete]')!.addEventListener('click', () => void terminateCue(cue, 'motion.cue.delete'));
    container.append(card);
    const form = document.querySelector<HTMLFormElement>(`[data-cue-form="${cue.semantic.kind}"]`);
    if (form) {
      form.querySelector('button[type="submit"]')!.textContent = `Update ${cue.label.toLowerCase()}`;
      hydrateCueForm(form, cue.semantic);
    }
  }
}

function reconcileCueEditingProjection(): void {
  if (!cueEditingKind || authoring.document.cues.some((cue) => cue.schemaVersion === 'motion.authoring-cue.v1'
    && cue.semantic.kind === cueEditingKind)) return;
  const form = document.querySelector<HTMLFormElement>(`[data-cue-form="${cueEditingKind}"]`);
  form?.reset();
  for (const control of form?.querySelectorAll<HTMLInputElement>('[aria-invalid]') ?? []) control.removeAttribute('aria-invalid');
  const output = required<HTMLOutputElement>('[data-cue-status]');
  output.value = '';
  output.dataset.kind = 'ready';
  delete output.dataset.diagnosticCode;
  cueEditingKind = null;
}

function hydrateCueForm(form: HTMLFormElement, semantic: CueSemantic): void {
  const set = (name: string, value: number) => {
    const input = form.elements.namedItem(name) as HTMLInputElement | null;
    if (input) input.value = String(value);
  };
  if (semantic.kind === 'cursor-path') {
    required<HTMLSelectElement>('[data-cue-cursor]').value = semantic.cursorTargetId;
    set('start', semantic.startMs); set('arrive', semantic.arriveMs);
    set('startX', semantic.waypoints[0]!.xPpm / 10_000); set('startY', semantic.waypoints[0]!.yPpm / 10_000);
    set('endX', semantic.waypoints.at(-1)!.xPpm / 10_000); set('endY', semantic.waypoints.at(-1)!.yPpm / 10_000);
  } else if (semantic.kind === 'reveal') {
    required<HTMLSelectElement>('[data-cue-reveal]').value = semantic.targetIds[0]!;
    set('start', semantic.startMs); set('complete', semantic.completeMs);
  } else {
    required<HTMLSelectElement>('[data-cue-cursor]').value = semantic.cursorTargetId;
    required<HTMLSelectElement>('[data-cue-pulse]').value = semantic.pulseTargetId;
    set('arrive', semantic.arriveMs); set('press', semantic.pressMs); set('release', semantic.releaseMs);
    set('pulseEnd', semantic.pulseEndMs); set('scale', semantic.pressScalePpm / 10_000);
    set('radius', semantic.pulseRadiusPpm / 1_000_000);
  }
}

async function terminateCue(cue: AuthoringCue, kind: 'motion.cue.delete' | 'motion.cue.detach'): Promise<void> {
  const intent: OperationIntentPayload = { kind, cueId: cue.id };
  const result = await prepareAndDispatchIntent(intent);
  if (result.ok && kind === 'motion.cue.detach') detachedCueKinds.add(cue.semantic.kind);
  announceCueStatus(result.ok ? `${cue.label} ${kind.endsWith('detach')
    ? 'detached to ordinary tracks. The compiled result is unchanged; use Undo to restore guided editing' : 'deleted'}.`
    : cueDiagnosticMessage(result.code ?? 'UNKNOWN', cue.semantic.kind), !result.ok, result.ok ? undefined : result.code);
}

function cueDiagnosticMessage(code: string, kind: CueSemantic['kind']): string {
  if (code === 'CUE_REPLACEMENT_INVALID') return `${kind === 'click' ? 'Click' : kind === 'reveal' ? 'Reveal' : 'Cursor path'} tracks are ordinary tracks now. Use Undo to restore guided editing before changing this beat.`;
  if (kind === 'click' && (code === 'CUE_UPDATE_INVALID' || code === 'CUE_MOMENT_INVALID' || code === 'CUE_TIMING_INVALID' || code.includes('CHRONOLOGY'))) {
    return 'Timing must stay in order: Arrive < Press < Release < Pulse end. Adjust the highlighted values and try again.';
  }
  return `That change could not be applied. Revision ${authoring.document.revision} is unchanged.`;
}

function announceCueStatus(message: string, error: boolean, diagnosticCode?: string): void {
  const output = required<HTMLOutputElement>('[data-cue-status]'); output.value = message; output.dataset.kind = error ? 'error' : 'success';
  if (diagnosticCode) output.dataset.diagnosticCode = diagnosticCode; else delete output.dataset.diagnosticCode;
}

function cueRoleLabel(role: CueCanvasRole): string {
  return role === 'cursor' ? 'Cursor' : role === 'pulse' ? 'Click target' : 'Reveal target';
}

function cueRoleSelect(role: CueCanvasRole): HTMLSelectElement {
  return required<HTMLSelectElement>(role === 'cursor' ? '[data-cue-cursor]'
    : role === 'pulse' ? '[data-cue-pulse]' : '[data-cue-reveal]');
}

function activateCueLayout(): void {
  if (!cueWorkspace) return;
  const layout = required<HTMLElement>('.primary-layout');
  layout.insertBefore(cueWorkspace, required<HTMLElement>('.workflow'));
  required<HTMLElement>('[data-cue-history-slot]').append(required<HTMLElement>('.workflow-footer'));
  required<HTMLElement>('.editor-shell').classList.add('cue-active');
  required<HTMLElement>('.topbar h1').textContent = 'Build a guided interaction';
  required<HTMLElement>('.purpose').textContent = 'Choose the objects, shape the cursor path, and preview the result on one canvas.';
  required<HTMLElement>('#preview-heading').textContent = 'Canvas';
  renderCueCanvas();
}

function scheduleCueCanvas(): void {
  if (!cueWorkspace) return;
  if (cueCanvasFrame !== null) cancelAnimationFrame(cueCanvasFrame);
  cueCanvasFrame = requestAnimationFrame(() => { cueCanvasFrame = null; renderCueCanvas(); });
}

function renderCueCanvas(): void {
  if (!cueWorkspace || !cueTargetOverlay || !cuePathOverlay) return;
  const selections = new Map<CueCanvasRole, string>([['cursor', cueRoleSelect('cursor').value],
    ['pulse', cueRoleSelect('pulse').value], ['reveal', cueRoleSelect('reveal').value]]);
  const authoredKinds = new Set(authoring.document.cues.filter((cue): cue is AuthoringCue => cue.schemaVersion === 'motion.authoring-cue.v1')
    .map((cue) => cue.semantic.kind));
  reconcileCueEditingProjection();
  if (!missingCueTarget(selections) && !authoredKinds.has('cursor-path') && !cuePathDefaultsInitialized) initializeCuePathDefaults(selections);
  const detachedKind = (['cursor-path', 'reveal', 'click'] as const).find((kind) => detachedCueKinds.has(kind) && !authoredKinds.has(kind));
  const missingRole = (['cursor', 'pulse', 'reveal'] as const).find((role) => !selections.get(role));
  if (!cuePickRole && missingRole) cuePickRole = missingRole;
  const workflowStep = cueEditingKind ?? missingRole ? (cueEditingKind ? `edit-${cueEditingKind}` : `pick-${missingRole}`)
    : detachedKind ? `detached-${detachedKind}`
    : !authoredKinds.has('cursor-path') ? 'cursor-path'
      : !authoredKinds.has('reveal') ? 'reveal' : !authoredKinds.has('click') ? 'click' : 'complete';
  cueWorkspace.dataset.step = workflowStep;
  const guidance: Record<string, string> = {
    'pick-cursor': 'The canvas is active. Click the object that should move as the cursor.', 'pick-pulse': 'Now click the object the cursor should press.',
    'pick-reveal': 'Now click the content that should appear.', 'cursor-path': 'Create the movement, then drag Start and Arrive directly on the canvas.',
    reveal: 'Add the reveal using the suggested timing.', click: 'Add the click response to finish the interaction.',
    complete: 'The interaction is ready. Drag the path handles or press Play to review it.',
    'detached-cursor-path': 'The cursor path is now ordinary motion and still compiles exactly as before. Use Undo to restore guided editing.',
    'detached-reveal': 'The reveal is now ordinary motion and still compiles exactly as before. Use Undo to restore guided editing.',
    'detached-click': 'The click response is now ordinary motion and still compiles exactly as before. Use Undo to restore guided editing.',
    'edit-cursor-path': 'Adjust the cursor movement, then save your changes.', 'edit-reveal': 'Adjust the reveal timing, then save your changes.',
    'edit-click': 'Adjust the click response, then save your changes.',
  };
  required<HTMLElement>('[data-cue-guidance]').textContent = guidance[workflowStep] ?? guidance.complete!;
  required<HTMLElement>('#cue-workspace-heading').textContent = workflowStep === 'pick-cursor' ? 'Choose the moving cursor object'
    : workflowStep === 'pick-pulse' ? 'Click the destination object' : workflowStep === 'pick-reveal' ? 'Click the content to reveal'
      : workflowStep === 'cursor-path' ? 'Shape the cursor movement' : workflowStep === 'reveal' ? 'Add the reveal'
        : workflowStep === 'click' ? 'Add the click response' : workflowStep === 'complete' ? 'Interaction ready'
          : workflowStep.startsWith('detached-') ? 'Guided editing detached' : 'Edit the interaction';
  required<HTMLElement>('[data-cue-progress-count]').textContent = workflowStep === 'complete' ? 'Ready'
    : workflowStep.startsWith('edit-') ? 'Editing' : missingRole ? 'Choose objects' : 'Build motion';
  required<HTMLElement>('.preview-title p').textContent = workflowStep.startsWith('pick-')
    ? guidance[workflowStep]! : workflowStep === 'complete' ? 'Drag Start or Arrive, or press Play.' : guidance[workflowStep] ?? guidance.complete!;
  for (const role of ['cursor', 'pulse', 'reveal'] as const) {
    const selected = Boolean(selections.get(role));
    const card = required<HTMLElement>(`[data-cue-role-card="${role}"]`);
    card.dataset.selected = String(selected);
    card.dataset.current = String(workflowStep === `pick-${role}`);
    required<HTMLOutputElement>(`[data-cue-role-status="${role}"]`).value = selected ? 'Selected' : workflowStep === `pick-${role}` ? 'Choose on canvas' : 'Waiting';
    const button = required<HTMLButtonElement>(`[data-cue-pick="${role}"]`);
    button.setAttribute('aria-pressed', String(cuePickRole === role));
    button.hidden = !selected;
    button.textContent = 'Change';
  }
  for (const form of document.querySelectorAll<HTMLFormElement>('[data-cue-form]')) {
    const kind = form.dataset.cueForm as CueSemantic['kind'];
    form.hidden = workflowStep !== kind && workflowStep !== `edit-${kind}`;
    const cancel = form.querySelector<HTMLButtonElement>('[data-cue-cancel-edit]');
    if (cancel) cancel.hidden = workflowStep !== `edit-${kind}`;
  }
  required<HTMLElement>('[data-cue-complete]').hidden = workflowStep !== 'complete';
  const advanced = required<HTMLDetailsElement>('.cue-advanced');
  advanced.hidden = authoredKinds.size === 0;
  const cursorSelected = Boolean(selections.get('cursor'));
  const pulseSelected = Boolean(selections.get('pulse'));
  const revealSelected = Boolean(selections.get('reveal'));
  required<HTMLButtonElement>('[data-cue-form="cursor-path"] button[type="submit"]').disabled = !cursorSelected || detachedKind === 'cursor-path';
  required<HTMLButtonElement>('[data-cue-form="reveal"] button[type="submit"]').disabled = !revealSelected || detachedKind === 'reveal';
  required<HTMLButtonElement>('[data-cue-form="click"] button[type="submit"]').disabled = !(cursorSelected && pulseSelected) || detachedKind === 'click';
  renderCueTargetOverlay(selections);
  void renderCuePathOverlay(++cueCanvasGeneration);
}

function missingCueTarget(selections: Map<CueCanvasRole, string>): boolean {
  return (['cursor', 'pulse', 'reveal'] as const).some((role) => !selections.get(role));
}

function initializeCuePathDefaults(selections: Map<CueCanvasRole, string>): void {
  const cursorId = selections.get('cursor'); const pulseId = selections.get('pulse');
  if (!cursorId || !pulseId) return;
  const form = required<HTMLFormElement>('[data-cue-form="cursor-path"]');
  const time = (name: string) => Number((form.elements.namedItem(name) as HTMLInputElement).value);
  const restoreTime = controller.readState().playheadMs; controller.scrub(time('start'));
  const cursor = cueVisualBounds(cursorId); controller.scrub(time('arrive')); const pulse = cueVisualBounds(pulseId);
  controller.scrub(restoreTime);
  if (!cursor || !pulse) return;
  const source = controller.sourceSize();
  const pulseCenter = { x: (pulse.left + pulse.right) / 2, y: (pulse.top + pulse.bottom) / 2 };
  const set = (name: string, value: number) => {
    const input = form.elements.namedItem(name) as HTMLInputElement;
    input.value = String(Math.round(value * 10_000) / 10_000);
  };
  set('startX', cursor.left / source.widthCssPixels * 100);
  set('startY', cursor.top / source.heightCssPixels * 100);
  set('endX', (pulseCenter.x - cursor.width / 2) / source.widthCssPixels * 100);
  set('endY', (pulseCenter.y - cursor.height / 2) / source.heightCssPixels * 100);
  cuePathDefaultsInitialized = true;
}

function renderCueTargetOverlay(selections: Map<CueCanvasRole, string>): void {
  if (!cueTargetOverlay) return;
  cueTargetOverlay.replaceChildren();
  const entries = authoring.document.elements.map((element) => ({ elementId: element.id, bounds: cueVisualBounds(element.id) }))
    .filter((entry): entry is { elementId: string; bounds: ProjectionRect } => Boolean(entry.bounds))
    .sort((left, right) => left.elementId.localeCompare(right.elementId));
  cueTargetOverlay.dataset.candidateCount = String(entries.length);
  cueTargetOverlay.onclick = null;
  if (cuePickRole) {
    const commit = (elementId: string) => {
      const role = cuePickRole; if (!role) return;
      cueRoleSelect(role).value = elementId; cuePickRole = null; renderCueCanvas();
      announceCueStatus(`${cueRoleLabel(role)} selected.`, false);
    };
    for (const [index, entry] of entries.entries()) {
      const marker = document.createElement('span'); marker.className = 'cue-target-candidate';
      marker.dataset.cueTargetCandidate = ''; marker.dataset.elementId = entry.elementId;
      marker.dataset.objectLabel = `Object ${index + 1}`;
      Object.assign(marker.style, { left: `${entry.bounds.left}px`, top: `${entry.bounds.top}px`,
        width: `${entry.bounds.width}px`, height: `${entry.bounds.height}px` });
      cueTargetOverlay.append(marker);
    }
    cueTargetOverlay.onclick = (event) => {
      if (event.target !== cueTargetOverlay) return;
      const overlayRect = cueTargetOverlay.getBoundingClientRect();
      const source = controller.sourceSize();
      const x = (event.clientX - overlayRect.left) * source.widthCssPixels / overlayRect.width;
      const y = (event.clientY - overlayRect.top) * source.heightCssPixels / overlayRect.height;
      const hits = entries.filter(({ bounds }) => x >= bounds.left && x <= bounds.right && y >= bounds.top && y <= bounds.bottom);
      if (hits.length === 1) { commit(hits[0]!.elementId); return; }
      if (hits.length === 0) { announceCueStatus('No selectable object is under that point. Try another visible object.', true); return; }
      for (const marker of cueTargetOverlay.querySelectorAll<HTMLElement>('[data-cue-target-candidate]')) {
        marker.dataset.ambiguous = String(hits.some((hit) => hit.elementId === marker.dataset.elementId));
      }
      const chooser = document.createElement('div'); chooser.className = 'cue-target-disambiguation';
      chooser.dataset.cueTargetDisambiguation = ''; chooser.setAttribute('role', 'group'); chooser.setAttribute('aria-label', 'Choose the intended overlapping object');
      Object.assign(chooser.style, { left: `${x}px`, top: `${y}px` });
      const heading = document.createElement('strong'); heading.textContent = 'Objects overlap here'; chooser.append(heading);
      for (const hit of hits) {
        const button = document.createElement('button'); button.type = 'button'; button.dataset.cueTargetChoice = '';
        button.dataset.elementId = hit.elementId;
        button.textContent = cueTargetOverlay.querySelector<HTMLElement>(`[data-cue-target-candidate][data-element-id="${hit.elementId}"]`)?.dataset.objectLabel ?? 'Object';
        button.addEventListener('click', (choiceEvent) => { choiceEvent.stopPropagation(); commit(hit.elementId); });
        chooser.append(button);
      }
      cueTargetOverlay.querySelector('[data-cue-target-disambiguation]')?.remove();
      cueTargetOverlay.append(chooser); chooser.querySelector<HTMLButtonElement>('button')?.focus();
      announceCueStatus('Several objects overlap there. Choose the intended object from the neutral list.', false);
    };
  } else {
    const rolesByElement = new Map<string, CueCanvasRole[]>();
    for (const [role, elementId] of selections) if (elementId) rolesByElement.set(elementId,
      [...(rolesByElement.get(elementId) ?? []), role]);
    for (const [elementId, roles] of rolesByElement) {
      const entry = entries.find((candidate) => candidate.elementId === elementId); if (!entry) continue;
      const marker = document.createElement('span'); marker.className = 'cue-target-assignment';
      marker.dataset.roles = roles.join(' '); marker.dataset.elementId = elementId;
      marker.dataset.label = roles.map(cueRoleLabel).join(' · ');
      Object.assign(marker.style, { left: `${entry.bounds.left}px`, top: `${entry.bounds.top}px`,
        width: `${entry.bounds.width}px`, height: `${entry.bounds.height}px` });
      cueTargetOverlay.append(marker);
    }
  }
  cueTargetOverlay.hidden = cueTargetOverlay.childElementCount === 0;
  cueTargetOverlay.dataset.picking = String(Boolean(cuePickRole));
}

async function renderCuePathOverlay(generation: number): Promise<void> {
  if (!cuePathOverlay) return;
  if (controller.readState().playStates.some((playState) => playState === 'running')) return;
  const cue = authoring.document.cues.find((candidate): candidate is CursorPathAuthoringCue => candidate.schemaVersion === 'motion.authoring-cue.v1'
    && candidate.semantic.kind === 'cursor-path');
  cuePathOverlay.replaceChildren();
  if (!cue || cuePickRole) {
    required<HTMLElement>('[data-cue-path-guidance]').textContent = cuePickRole
      ? 'Finish choosing the canvas target to edit the path.'
      : 'Pick the cursor, create its path, then drag Start and Arrive on the canvas.';
    return;
  }
  const restoreTime = controller.readState().playheadMs;
  const samples = cue.semantic.waypoints.map((waypoint) => {
    controller.scrub(waypoint.timeMs); return { timeMs: waypoint.timeMs, bounds: cueVisualBounds(cue.semantic.cursorTargetId) };
  });
  controller.scrub(restoreTime);
  if (generation !== cueCanvasGeneration) return;
  const handles: HTMLButtonElement[] = [];
  for (const [index, waypoint] of cue.semantic.waypoints.entries()) {
    const sample = samples.find((candidate) => candidate.timeMs === waypoint.timeMs);
    if (!sample?.bounds) continue;
    const handle = document.createElement('button'); handle.type = 'button'; handle.className = 'cue-path-waypoint';
    const label = index === 0 ? 'Start' : index === cue.semantic.waypoints.length - 1 ? 'Arrive' : `${waypoint.timeMs} ms`;
    Object.assign(handle.dataset, { waypointIndex: String(index), timeMs: String(waypoint.timeMs), label });
    handle.setAttribute('aria-label', `${label} cursor position; drag to adjust the path`);
    Object.assign(handle.style, { left: `${sample.bounds.left}px`, top: `${sample.bounds.top}px`,
      width: `${sample.bounds.width}px`, height: `${sample.bounds.height}px` });
    handle.addEventListener('click', () => scrub(waypoint.timeMs));
    handle.addEventListener('pointerdown', (event) => beginCuePathDrag(event, cue, index));
    cuePathOverlay.append(handle); handles.push(handle);
  }
  for (let index = 0; index < handles.length - 1; index += 1) cuePathOverlay.prepend(cuePathSegment(handles[index]!, handles[index + 1]!));
  required<HTMLElement>('[data-cue-path-guidance]').textContent = 'Drag Start or Arrive directly on the canvas. Timing stays in the fields below.';
}

function cueVisualBounds(elementId: string): ProjectionRect | null {
  const target = iframe.contentDocument?.querySelector<HTMLElement>(`[data-motion-id="${elementId}"]`); if (!target) return null;
  const candidates = [target, ...target.querySelectorAll<HTMLElement>('*')];
  const rects = candidates.map((candidate) => candidate.getBoundingClientRect())
    .filter((rect) => Number.isFinite(rect.left) && rect.width > 0 && rect.height > 0);
  if (rects.length === 0) {
    let parent = target.parentElement;
    while (parent && parent !== iframe.contentDocument?.body) {
      const rect = parent.getBoundingClientRect(); if (rect.width > 0 && rect.height > 0) { rects.push(rect); break; }
      parent = parent.parentElement;
    }
  }
  if (rects.length === 0) return null;
  const left = Math.min(...rects.map((rect) => rect.left)); const top = Math.min(...rects.map((rect) => rect.top));
  const right = Math.max(...rects.map((rect) => rect.right)); const bottom = Math.max(...rects.map((rect) => rect.bottom));
  return { left, top, right, bottom, width: right - left, height: bottom - top };
}

function cuePathSegment(from: HTMLElement, to: HTMLElement): HTMLSpanElement {
  const segment = document.createElement('span'); segment.className = 'cue-path-segment'; segment.setAttribute('aria-hidden', 'true');
  segment.dataset.from = from.dataset.waypointIndex ?? ''; segment.dataset.to = to.dataset.waypointIndex ?? '';
  positionCuePathSegment(segment, from, to); return segment;
}

function positionCuePathSegment(segment: HTMLElement, from: HTMLElement, to: HTMLElement): void {
  const center = (item: HTMLElement) => { const [dx = '0', dy = '0'] = item.style.translate.split(/\s+/);
    return { x: Number.parseFloat(item.style.left) + Number.parseFloat(item.style.width) / 2 + (Number.parseFloat(dx) || 0),
      y: Number.parseFloat(item.style.top) + Number.parseFloat(item.style.height) / 2 + (Number.parseFloat(dy) || 0) }; };
  const start = center(from); const end = center(to); const dx = end.x - start.x; const dy = end.y - start.y;
  Object.assign(segment.style, { left: `${start.x}px`, top: `${start.y}px`, width: `${Math.hypot(dx, dy)}px`,
    transform: `translateY(-1px) rotate(${Math.atan2(dy, dx)}rad)` });
}

function refreshCuePathSegments(): void {
  if (!cuePathOverlay) return;
  for (const segment of cuePathOverlay.querySelectorAll<HTMLElement>('[data-from]')) {
    const from = cuePathOverlay.querySelector<HTMLElement>(`[data-waypoint-index="${segment.dataset.from}"]`);
    const to = cuePathOverlay.querySelector<HTMLElement>(`[data-waypoint-index="${segment.dataset.to}"]`);
    if (from && to) positionCuePathSegment(segment, from, to);
  }
}

function beginCuePathDrag(event: PointerEvent, cue: CursorPathAuthoringCue, waypointIndex: number): void {
  if (event.button !== 0) return;
  const projection = readShotProjection(); if (!projection) return;
  const surface = event.currentTarget as HTMLButtonElement; const start = { clientX: event.clientX, clientY: event.clientY };
  const base = cue.semantic.waypoints[waypointIndex]; if (!base) return;
  const envelope = operationEnvelope(); const gesture = ++cuePathGestureGeneration;
  const committed = { html: compiled.html, css: compiled.css }; let latest: { operation: CueAuthoringOperation;
    intent: OperationIntentPayload; html: string; css: string } | null = null;
  let draftTask = Promise.resolve(); let moved = false; event.preventDefault(); surface.setPointerCapture(event.pointerId);
  const move = (next: PointerEvent) => {
    let delta; try { delta = previewPointerDeltaToPpm(projection, start, { clientX: next.clientX, clientY: next.clientY }); }
    catch { return; }
    moved ||= Math.abs(next.clientX - start.clientX) + Math.abs(next.clientY - start.clientY) > 1; if (!moved) return;
    const semantic = structuredClone(cue.semantic); semantic.waypoints[waypointIndex] = { ...base,
      xPpm: base.xPpm + delta.deltaXPpm, yPpm: base.yPpm + delta.deltaYPpm };
    const operation: CueAuthoringOperation = { ...envelope, kind: 'motion.cue.update', payload: { cueId: cue.id,
      expectedExpansionDigest: cue.expansionDigest, semantic, targetSnapshots: cueTargetSnapshots(authoring.document, semantic) } };
    const reduced = dispatchAuthoringOperation(authoring, operation); if (!reduced.ok) return;
    let draftCompiled; try { draftCompiled = compileMotionDocument(reduced.state.document); } catch { return; }
    latest = { operation, intent: { kind: 'motion.cue.update', cueId: cue.id, semantic },
      html: draftCompiled.html, css: draftCompiled.css };
    const localDeltaX = delta.deltaXPpm * projection.sourceWidthCssPixels / 1_000_000;
    const localDeltaY = delta.deltaYPpm * projection.sourceHeightCssPixels / 1_000_000;
    surface.style.translate = `${localDeltaX}px ${localDeltaY}px`; refreshCuePathSegments();
    const draft = latest; draftTask = draftTask.then(async () => {
      if (gesture !== cuePathGestureGeneration || latest !== draft) return; await controller.applyCompilerCssDraft(draft.css);
    }).catch(() => undefined);
    announceCueStatus('Cursor path draft · release to apply or press Escape to cancel.', false);
  };
  const cleanup = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', finish);
    window.removeEventListener('pointercancel', cancel); window.removeEventListener('keydown', escape);
    if (surface.hasPointerCapture(event.pointerId)) surface.releasePointerCapture(event.pointerId); };
  const restore = () => { cuePathGestureGeneration += 1; latest = null; surface.style.translate = ''; refreshCuePathSegments();
    void draftTask.then(() => controller.restoreCommittedCompilerCss()).then(() => { scheduleCueCanvas();
      announceCueStatus(`Cursor path unchanged at revision ${authoring.document.revision}.`, false); }); };
  const finish = () => { cleanup(); const accepted = latest; if (!moved || !accepted) { restore(); return; }
    void draftTask.then(async () => {
      if (gesture !== cuePathGestureGeneration) return;
      const result = await prepareAndDispatchIntent(accepted.intent, undefined, undefined, { schemaVersion: 'motion.preview-css-commit-promotion.v1',
        oldCommittedHtml: committed.html, oldCompilerCss: committed.css, newCommittedHtml: accepted.html, newCompilerCss: accepted.css });
      if (!result.ok) surface.style.translate = '';
      scheduleCueCanvas();
      announceCueStatus(result.ok ? `Cursor path updated at revision ${authoring.document.revision}.` : `Change rejected: ${result.code}.`, !result.ok);
    }); };
  const cancel = () => { cleanup(); restore(); };
  const escape = (keyboard: KeyboardEvent) => { if (keyboard.key !== 'Escape') return; keyboard.preventDefault(); cancel(); };
  window.addEventListener('pointermove', move); window.addEventListener('pointerup', finish, { once: true });
  window.addEventListener('pointercancel', cancel, { once: true }); window.addEventListener('keydown', escape);
}

function updateStructuralControls(rows: TimelineRow[]): void {
  const locked = (authoring.document.holds ?? []).length > 0;
  const track = findCreatedTrack(rows);
  const hasTrack = Boolean(track);
  const hasMidpoint = Boolean(track?.keyframes.some((keyframe) => keyframe.offset === 0.5));
  for (const choice of creationChoices) {
    const eligibility = projectTrackCreationEligibility(authoring.document, choice.elementId, 'opacity');
    const radio = required<HTMLInputElement>(`input[name="creation-target"][value="${choice.elementId}"]`);
    radio.disabled = locked || !eligibility.available;
    required(`[data-choice-reason="${choice.elementId}"]`).textContent = eligibility.available
      ? 'Available' : eligibilityReason(eligibility.reason);
  }
  const selectedEligibility = selectedCreationElementId
    ? projectTrackCreationEligibility(authoring.document, selectedCreationElementId, 'opacity') : null;
  unavailableCreation = Boolean(selectedCreationElementId && !selectedEligibility?.available);
  createTrackButton.disabled = locked || !selectedEligibility?.available;
  createTrackButton.textContent = selectedCreationElementId
    ? `Create ${creationChoices.find((choice) => choice.elementId === selectedCreationElementId)!.label} opacity track`
    : 'Select an element';
  addMidpointButton.disabled = locked || !hasTrack || hasMidpoint;
  removeMidpointButton.disabled = locked || !hasMidpoint;
  for (const control of [durationInput, delayInput, easingInput, setDurationButton, setDelayButton, setEasingButton]) {
    control.disabled = locked || !hasTrack;
  }
  hydrateTimingControls(track);
  required('[data-structural-status]').textContent = locked
    ? 'Hold inserted. Undo the hold before making another edit.' : !selectedCreationElementId
    ? 'Select an available element to begin.'
    : !hasTrack && selectedEligibility?.available
      ? `${creationChoices.find((choice) => choice.elementId === selectedCreationElementId)!.label} is ready to animate.`
      : !hasTrack ? eligibilityReason(selectedEligibility?.reason ?? null)
    : hasMidpoint ? 'Midpoint ready. Adjust timing or remove it.' : 'Track ready. Add a midpoint or adjust timing.';
}

function hydrateTimingControls(track: TimelineRow | undefined): void {
  if (!track) {
    durationInput.value = '1000'; delayInput.value = '610'; easingInput.value = 'linear';
    appliedDuration.value = 'Applied — create a track first';
    appliedDelay.value = 'Applied — create a track first';
    appliedEasing.value = 'Applied — create a track first';
  } else {
    const durationMs = track.keyframes.at(-1)!.timeMs - track.keyframes[0]!.timeMs;
    const easing = track.timing.kind === 'keyword' ? track.timing.value : JSON.stringify(track.timing);
    durationInput.value = String(durationMs); delayInput.value = String(track.delayMs); easingInput.value = easing;
    appliedDuration.value = `Applied · ${durationMs} ms`;
    appliedDelay.value = `Applied · ${track.delayMs} ms`;
    appliedEasing.value = `Applied · ${easing}`;
  }
  for (const control of [durationInput, delayInput, easingInput]) {
    control.closest('.timing-control')?.setAttribute('data-draft', 'false');
    required<HTMLElement>('em', control.closest('.timing-control')!).hidden = true;
  }
  durationInput.setAttribute('aria-invalid', 'false');
  delayInput.setAttribute('aria-invalid', 'false');
}

function updateTimingDraftState(control: HTMLInputElement | HTMLSelectElement): void {
  const track = findCreatedTrack(buildTimeline(authoring.document).rows);
  let appliedValue: string | undefined;
  if (track) {
    if (control === durationInput) {
      appliedValue = String(track.keyframes.at(-1)!.timeMs - track.keyframes[0]!.timeMs);
    } else if (control === delayInput) {
      appliedValue = String(track.delayMs);
    } else {
      appliedValue = track.timing.kind === 'keyword' ? track.timing.value : JSON.stringify(track.timing);
    }
  }
  const differs = appliedValue !== undefined && control.value !== appliedValue;
  const container = control.closest<HTMLElement>('.timing-control')!;
  container.dataset.draft = String(differs);
  required<HTMLElement>('em', container).hidden = !differs;
}

function eligibilityReason(reason: ReturnType<typeof projectTrackCreationEligibility>['reason']): string {
  const reasons = {
    TRACK_ALREADY_EXISTS: 'Already has an opacity track.',
    TRACK_LIMIT_REACHED: 'One created track is allowed in this document.',
    SHARED_PROPERTY_UNSUPPORTED: 'Shared opacity cannot be changed here.',
    PROPERTY_CONFLICT: 'Another opacity binding conflicts with creation.',
    ID_COLLISION: 'Stable track identity is unavailable.',
    DOCUMENT_INVALID: 'The document must be valid before creating a track.',
    ELEMENT_NOT_FOUND: 'The target is no longer in the document.',
    TARGET_PROPERTY_UNSUPPORTED: 'This target and property are not supported.',
  } as const;
  return reason ? reasons[reason] : 'Available';
}

function findCreatedTrack(rows: TimelineRow[]): TimelineRow | undefined {
  return rows.find((row) => creationChoices.some((choice) => choice.elementId === row.elementId)
    && row.property === 'opacity');
}

function diagnosticMessage(code: string): string {
  const messages: Record<string, string> = {
    AUTHORING_DURATION_INVALID: 'Enter a whole-number duration greater than 0.',
    AUTHORING_DELAY_INVALID: 'Enter a whole-number delay of 0 or greater.',
    AUTHORING_TRACK_NOT_FOUND: 'Create the cursor opacity track first.',
    AUTHORING_HOLD_LOCKED: 'Undo the hold before making another edit.',
  };
  return messages[code] ?? 'That change could not be applied.';
}

function rejectAuthoringInput(input: HTMLInputElement, code: 'AUTHORING_DURATION_INVALID' | 'AUTHORING_DELAY_INVALID'): void {
  input.setAttribute('aria-invalid', 'true'); input.focus({ preventScroll: true });
  status.value = `${diagnosticMessage(code)} (${code}) Revision ${authoring.document.revision} unchanged.`;
  status.dataset.kind = 'error'; status.dataset.source = 'validation';
}

function successMessage(kind: AuthoringOperation['kind']): string {
  const messages: Partial<Record<AuthoringOperation['kind'], string>> = {
    'motion.track.create': 'Opacity track created.',
    'motion.keyframe.add': 'Midpoint added.',
    'motion.slot-duration.set': 'Duration updated.',
    'motion.binding-delay.set': 'Delay updated.',
    'motion.slot-easing.set': 'Easing updated.',
    'motion.keyframe.remove': 'Midpoint removed.',
    'motion.hold.insert': '600 ms hold inserted before Pair crosses.',
    'motion.history.undo': 'Undid the last change.',
    'motion.history.redo': 'Redid the change.',
  };
  return messages[kind] ?? 'Change applied.';
}

function updateSelection(): void {
  const row = selectedTrackId
    ? buildTimeline(authoring.document).rows.find((candidate) => candidate.trackId === selectedTrackId) : undefined;
  const keyframe = row?.keyframes.find((candidate) => candidate.id === selectedKeyframeId);
  unavailableSelection = Boolean(hasExplicitKeyframeSelection && (!row || !keyframe));
  const locked = (authoring.document.holds ?? []).length > 0;
  valueInput.disabled = locked || !hasExplicitKeyframeSelection;
  timeInput.disabled = locked || !hasExplicitKeyframeSelection;
  valueButton.disabled = locked || !hasExplicitKeyframeSelection;
  timeButton.disabled = locked || !hasExplicitKeyframeSelection;
  if (unavailableSelection) {
    disableUnavailableMutationControls();
    required('[data-selection]').innerHTML = `<div class="selection-summary unavailable"><strong>Selected canonical target unavailable</strong><span>Track ${selectedTrackId} · keyframe ${selectedKeyframeId}</span></div>`;
    previewSelectionLabel.textContent = 'Selection unavailable'; previewSelection.hidden = true; return;
  }
  if (!hasExplicitKeyframeSelection) {
    required('[data-selection]').innerHTML = `<div class="selection-summary"><strong>No keyframe selected</strong><span>Open Inspect all tracks and choose a keyframe for exact editing.</span></div>`;
    previewSelectionLabel.textContent = selectedCreationElementId ? 'Element chosen' : '';
    schedulePreviewSelection();
    return;
  }
  selectedKeyframeId = keyframe!.id;
  required('[data-selection]').innerHTML = `
    <div class="selection-summary"><strong>Selected ${row!.property} keyframe</strong><span>Revision ${authoring.document.revision}</span></div>
    <div class="selection-chips"><span class="preview-link">Linked to preview</span></div>
    <details class="canonical-ids"><summary>Canonical IDs</summary><code>Element · ${row!.elementId}</code><code>Track · ${row!.trackId}</code><code>Keyframe · ${keyframe!.id}</code></details>`;
  previewSelectionLabel.textContent = `Selected element · ${row!.property}`;
  valueInput.value = keyframe!.value;
  timeInput.value = String(keyframe!.timeMs);
  valueInput.dataset.draft = 'false'; timeInput.dataset.draft = 'false';
  valueInput.setAttribute('aria-invalid', 'false');
  timeInput.setAttribute('aria-invalid', 'false');
  schedulePreviewSelection();
}

function disableUnavailableMutationControls(): void {
  for (const control of [createTrackButton, addMidpointButton, removeMidpointButton, durationInput, delayInput, easingInput,
    setDurationButton, setDelayButton, setEasingButton, valueInput, timeInput, valueButton, timeButton, insertHoldButton])
    control.disabled = true;
}

function findEditableTrack(): TimelineRow | null {
  const timeline = buildTimeline(authoring.document);
  const created = findCreatedTrack(timeline.rows);
  if (created) return created;
  const editable = timeline.rows.filter((row) => row.property === 'opacity'
    && timeline.rows.filter((candidate) => candidate.ruleId === row.ruleId && candidate.property === row.property).length === 1);
  return editable.length === 1 ? editable[0]! : null;
}

function currentTarget(): TimelineRow {
  const selected = selectedTrackId
    ? buildTimeline(authoring.document).rows.find((row) => row.trackId === selectedTrackId) : undefined;
  if (!selected || !selectedKeyframeId || !selected.keyframes.some((keyframe) => keyframe.id === selectedKeyframeId)) {
    throw new Error('EDITOR_KEYFRAME_SELECTION_MISSING');
  }
  return selected;
}

function scrub(timeMs: number): void {
  stopPlaybackFeedback();
  controller.scrub(timeMs); scrubber.value = String(timeMs); playhead.value = `${timeMs} ms`;
  updatePreviewPlaybackState();
  republishShotGeometry();
  schedulePreviewSelection();
  scheduleCueCanvas();
}

function stopPlaybackFeedback(): void {
  if (playbackFeedbackFrame !== null) cancelAnimationFrame(playbackFeedbackFrame);
  playbackFeedbackFrame = null;
}

function syncPlaybackFeedback(): void {
  const state = controller.readState();
  const nativeTime = state.currentTimes.find((time): time is number => typeof time === 'number');
  if (nativeTime === undefined) return;
  const shotEndMs = shotConfig?.settledMs;
  if (shotEndMs !== undefined && nativeTime >= shotEndMs) {
    controller.pause();
    controller.scrub(shotEndMs);
    scrubber.value = String(shotEndMs); playhead.value = `${shotEndMs} ms`;
    updatePreviewPlaybackState(shotEndMs, true);
    schedulePreviewSelection();
    return;
  }
  const visibleTime = Math.max(0, Math.min(Number(scrubber.max), Math.round(nativeTime)));
  scrubber.value = String(visibleTime); playhead.value = `${visibleTime} ms`;
  updatePreviewPlaybackState(nativeTime, state.playStates.every((playState) => playState !== 'running'));
  schedulePreviewSelection();
}

function startPlaybackFeedback(): void {
  stopPlaybackFeedback();
  const tick = () => {
    syncPlaybackFeedback();
    if (controller.readState().playStates.some((playState) => playState === 'running')) playbackFeedbackFrame = requestAnimationFrame(tick);
    else playbackFeedbackFrame = null;
  };
  playbackFeedbackFrame = requestAnimationFrame(tick);
}

function alignShotPreviewToMoment(timeMs: number): boolean {
  if (!Number.isSafeInteger(timeMs) || timeMs < 0 || timeMs > authoring.document.durationMs) {
    shotStatus.value = `PREVIEW_TIME_INVALID · revision ${authoring.document.revision} unchanged.`; return false;
  }
  stopPlaybackFeedback(); controller.scrub(timeMs);
  const state = controller.readState();
  if (state.playheadMs !== timeMs || state.currentTimes.length === 0 || state.currentTimes.some((currentTime) => currentTime !== timeMs)
    || state.playStates.some((playState) => playState !== 'paused')) {
    shotStatus.value = `PREVIEW_MOMENT_ALIGNMENT_INVALID · revision ${authoring.document.revision} unchanged.`; return false;
  }
  scrubber.value = String(timeMs); playhead.value = `${timeMs} ms`; updatePreviewPlaybackState(); schedulePreviewSelection(); return true;
}

function renderTrack(row: TimelineRow): HTMLElement {
  const article = document.createElement('article');
  article.className = 'track-row';
  Object.assign(article.dataset, {
    trackId: row.trackId, elementId: row.elementId, property: row.property,
    ruleId: row.ruleId, applicationId: row.applicationId, activeSlotId: row.activeSlotId,
    delayMs: String(row.delayMs), slotCount: String(row.orderedSlotIds.length),
    interpolation: row.interpolation, timing: JSON.stringify(row.timing), timingKind: row.timing.kind,
    keyframeCount: String(row.keyframes.length),
    selected: String(row.trackId === selectedTrackId),
    cueOwned: String(Boolean(authoring.document.tracks.find((track) => track.id === row.trackId)?.cueOwnership)),
  });
  const timing = row.timing.kind === 'steps' ? `steps(${row.timing.count}, ${row.timing.position})`
    : row.timing.kind === 'keyword' ? row.timing.value : 'cubic-bezier';
  const cueOwned = Boolean(authoring.document.tracks.find((track) => track.id === row.trackId)?.cueOwnership);
  article.innerHTML = `<div class="track-identity"><strong>${row.property}</strong><span>${row.interpolation} motion${cueOwned ? ' · cue-owned · locked' : ''}</span><details class="canonical-ids"><summary>Canonical IDs</summary><code>Element · ${row.elementId}</code><code>Track · ${row.trackId}</code><code>Rule · ${row.ruleId}</code></details></div><div class="track-meta"><span>delay ${row.delayMs} ms</span><span>${timing}</span><span>${row.orderedSlotIds.length} ordered slot${row.orderedSlotIds.length === 1 ? '' : 's'}</span><div class="slots"></div></div><div class="keyframes"></div>`;
  const slotList = article.querySelector('.slots')!;
  for (const slotId of row.orderedSlotIds) {
    const slot = document.createElement('code');
    Object.assign(slot.dataset, { slotId, active: String(slotId === row.activeSlotId) });
    slot.textContent = `${slotId}${slotId === row.activeSlotId ? ' · active' : ''}`; slotList.append(slot);
  }
  const editable = row.trackId === findEditableTrack()?.trackId;
  const keyframeList = article.querySelector('.keyframes')!;
  for (const keyframe of row.keyframes) {
    const marker = document.createElement('button');
    marker.type = 'button'; marker.className = 'keyframe'; marker.disabled = !editable;
    marker.setAttribute('aria-pressed', String(editable && selectedKeyframeId === keyframe.id));
    Object.assign(marker.dataset, { keyframeId: keyframe.id, offset: String(keyframe.offset), value: keyframe.value, easing: JSON.stringify(keyframe.easing), timeMs: String(keyframe.timeMs) });
    marker.innerHTML = `<strong>${formatTimelineNumber(keyframe.timeMs, 3)} ms</strong><code>${keyframe.id}</code><span>${formatTimelineNumber(keyframe.offset * 100, 4)}% · ${keyframe.value} · easing ${keyframe.easing ? JSON.stringify(keyframe.easing) : 'inherited'}</span>`;
    marker.addEventListener('click', () => { selectedTrackId = row.trackId; selectedKeyframeId = keyframe.id; hasExplicitKeyframeSelection = true; renderProjection(); valueInput.focus({ preventScroll: true }); });
    keyframeList.append(marker);
  }
  return article;
}

function formatTimelineNumber(value: number, maximumFractionDigits: number): string {
  const rounded = Number(value.toFixed(maximumFractionDigits));
  return Object.is(rounded, -0) || rounded === 0 ? '0' : String(rounded);
}

function announceInvalidInput(input: HTMLInputElement, label: string): void {
  input.setAttribute('aria-invalid', 'true');
  status.value = `${label}: ${input.validationMessage} Revision ${authoring.document.revision} unchanged.`;
  status.dataset.kind = 'error';
  status.dataset.source = 'validation';
}

function clearValidationFeedback(input: HTMLInputElement): void {
  input.setAttribute('aria-invalid', String(!input.validity.valid));
  if (input.validity.valid && status.dataset.source === 'validation') {
    status.value = `Revision ${authoring.document.revision} ready.`;
    status.dataset.kind = 'ready';
    delete status.dataset.source;
  }
}

function schedulePreviewSelection(): void {
  requestAnimationFrame(updatePreviewSelection);
}

async function mountPreview(compiledHtml: string, compilerCss: string): Promise<void> {
  if (shotGeometryPumpRunning) await shotGeometryPumpCompletion;
  await controller.mount(compiledHtml, compilerCss);
  mountedPreviewGeneration += 1;
  const requestedPlayheadMs = Number(scrubber.value);
  const mountedState = controller.readState();
  if (Number.isFinite(requestedPlayheadMs) && requestedPlayheadMs >= 0
    && (mountedState.playheadMs !== requestedPlayheadMs || mountedState.currentTimes.some((time) => time !== requestedPlayheadMs))) {
    controller.scrub(requestedPlayheadMs); playhead.value = `${requestedPlayheadMs} ms`;
  }
  configurePreviewCanvas();
  await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  if (shotConfig) renderShotWorkspace();
  scheduleCueCanvas();
}

function configurePreviewCanvas(): void {
  const source = controller.sourceSize(); const availableWidth = previewStage.clientWidth;
  if (!Number.isSafeInteger(source.widthCssPixels) || source.widthCssPixels <= 0
    || !Number.isSafeInteger(source.heightCssPixels) || source.heightCssPixels <= 0) throw new Error('PREVIEW_SOURCE_SIZE_INVALID');
  if (!Number.isFinite(availableWidth) || availableWidth <= 0) throw new Error('PREVIEW_PROJECTION_INVALID');
  const runway = shotConfig ? 72 : 0;
  const previewPanel = required<HTMLElement>('.preview-panel');
  const panelTop = previewPanel.getBoundingClientRect().top;
  const chromeHeight = required<HTMLElement>('.preview-title').offsetHeight + required<HTMLElement>('.transport').offsetHeight;
  const visiblePanelTop = getComputedStyle(previewPanel).position === 'static' || panelTop >= window.innerHeight ? 0 : Math.max(0, panelTop);
  const availableHeight = Math.max(240, window.innerHeight - visiblePanelTop - chromeHeight - 48);
  const scale = Math.min((availableWidth - runway * 2) / source.widthCssPixels,
    (availableHeight - runway * 2) / source.heightCssPixels);
  if (!Number.isFinite(scale) || scale <= 0) throw new Error('PREVIEW_PROJECTION_INVALID');
  previewCanvas.style.width = `${source.widthCssPixels}px`; previewCanvas.style.height = `${source.heightCssPixels}px`;
  previewCanvas.style.left = `${runway}px`; previewCanvas.style.top = `${runway}px`;
  previewCanvas.style.transform = `scale(${scale})`; previewStage.style.height = `${source.heightCssPixels * scale + runway * 2}px`;
  previewStage.dataset.runwayCssPixels = String(runway);
  iframe.style.width = `${source.widthCssPixels}px`; iframe.style.height = `${source.heightCssPixels}px`;
}

function readShotProjection(): PreviewOverlayProjection | null {
  const source = controller.sourceSize();
  const result = createPreviewOverlayProjection({ sourceWidthCssPixels: source.widthCssPixels,
    sourceHeightCssPixels: source.heightCssPixels, iframeRect: rectValue(iframe.getBoundingClientRect()),
    overlayRect: rectValue(shotOverlay.getBoundingClientRect()), devicePixelRatio: window.devicePixelRatio });
  if (!result.ok) { shotStatus.value = `${result.code} · revision ${authoring.document.revision} unchanged.`; return null; }
  return result.projection;
}

function rectValue(rect: DOMRect): ProjectionRect {
  return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height };
}

function updatePreviewSelection(): void {
  syncPreviewObjectTargets();
  const selectedRow = selectedTrackId
    ? buildTimeline(authoring.document).rows.find((row) => row.trackId === selectedTrackId) : undefined;
  const targetElementId = shotConfig && shotPrimaryElementId ? shotPrimaryElementId : selectedCreationElementId ?? selectedRow?.elementId;
  if (!targetElementId) {
    previewSelection.hidden = true;
    return;
  }
  const target = iframe.contentDocument?.querySelector<HTMLElement>(`[data-motion-id="${targetElementId}"]`);
  if (!target) {
    previewSelection.hidden = true;
    return;
  }
  const targetRect = target.getBoundingClientRect();
  previewSelection.style.left = `${targetRect.left}px`;
  previewSelection.style.top = `${targetRect.top}px`;
  previewSelection.style.width = `${targetRect.width}px`;
  previewSelection.style.height = `${targetRect.height}px`;
  if (shotConfig && shotPrimaryElementId) {
    previewSelection.querySelector('span')!.textContent = `Object ${shotConfig.targetElementIds.indexOf(shotPrimaryElementId) + 1}`;
  }
  previewSelection.hidden = false;
}

function syncPreviewObjectTargets(): void {
  if (!shotConfig) {
    previewObjectOverlay.replaceChildren();
    previewObjectOverlay.hidden = true;
    return;
  }
  previewObjectOverlay.hidden = false;
  const existing = new Map([...previewObjectOverlay.querySelectorAll<HTMLButtonElement>('[data-preview-control-key]')]
    .map((button) => [button.dataset.previewControlKey!, button]));
  const desired = new Set<string>();
  const source = controller.sourceSize();
  const displayScale = iframe.getBoundingClientRect().width / source.widthCssPixels;
  const targetSize = Number.isFinite(displayScale) && displayScale > 0 ? 44 / displayScale : 44;
  for (const [index, elementId] of shotConfig.targetElementIds.entries()) {
    const target = iframe.contentDocument?.querySelector<HTMLElement>(`[data-motion-id="${elementId}"]`);
    const bodyKey = `${elementId}:body`; desired.add(bodyKey);
    let button = existing.get(bodyKey);
    if (!button) {
      button = document.createElement('button');
      button.type = 'button';
      button.className = 'preview-object-target';
      button.dataset.previewControlKey = bodyKey;
      button.dataset.previewObjectId = elementId;
      button.addEventListener('click', () => {
        if (button!.dataset.dragged === 'true') return;
        selectShotPrimary(elementId);
      });
      button.addEventListener('pointerdown', (event) => {
        if (event.button !== 0) return;
        if (shotPrimaryElementId !== elementId) selectShotPrimary(elementId);
        beginDirectPoseGesture(event, 'move');
      });
      button.addEventListener('keydown', (event) => void handleDirectPoseKeyboard(event, 'body'));
      previewObjectOverlay.append(button);
    }
    button.setAttribute('aria-label', `Object ${index + 1}; drag to move`);
    button.setAttribute('aria-pressed', String(elementId === shotPrimaryElementId));
    button.dataset.objectLabel = `Object ${index + 1}`;
    button.hidden = !target;
    if (target) {
      const rect = target.getBoundingClientRect();
      const bodyWidth = Math.max(rect.width, targetSize); const bodyHeight = Math.max(rect.height, targetSize);
      button.style.left = `${rect.left + rect.width / 2 - bodyWidth / 2}px`;
      button.style.top = `${rect.top + rect.height / 2 - bodyHeight / 2}px`;
      button.style.width = `${bodyWidth}px`; button.style.height = `${bodyHeight}px`;
      const transformControls = [
        { kind: 'scale' as const, corner: 'top-left', x: rect.left - targetSize / 2, y: rect.top - targetSize / 2 },
        { kind: 'scale' as const, corner: 'top-right', x: rect.right + targetSize / 2, y: rect.top - targetSize / 2 },
        { kind: 'scale' as const, corner: 'bottom-right', x: rect.right + targetSize / 2, y: rect.bottom + targetSize / 2 },
        { kind: 'scale' as const, corner: 'bottom-left', x: rect.left - targetSize / 2, y: rect.bottom + targetSize / 2 },
        { kind: 'rotate' as const, corner: null, x: rect.left + rect.width / 2, y: rect.top - targetSize * .82 },
      ];
      for (const control of transformControls) {
        const { kind, corner } = control;
        const key = `${elementId}:${kind}:${corner ?? 'top-center'}`; desired.add(key); let handle = existing.get(key);
        if (!handle) {
          handle = document.createElement('button'); handle.type = 'button';
          handle.className = `preview-transform-handle ${kind}-handle`; handle.dataset.previewControlKey = key;
          handle.dataset.transformElementId = elementId; handle.dataset.transformHandle = kind;
          handle.setAttribute('role', 'slider'); handle.addEventListener('pointerdown', (event) => {
            if (event.button !== 0) return; if (shotPrimaryElementId !== elementId) selectShotPrimary(elementId);
            beginDirectPoseGesture(event, kind);
          });
          handle.addEventListener('keydown', (event) => void handleDirectPoseKeyboard(event, kind));
          previewObjectOverlay.append(handle);
        }
        handle.dataset.transformRole = kind === 'scale' ? 'uniform-scale-corner' : 'rotation';
        if (corner) handle.dataset.transformCorner = corner;
        else delete handle.dataset.transformCorner;
        const selected = elementId === shotPrimaryElementId; handle.hidden = !selected;
        handle.style.width = `${targetSize}px`; handle.style.height = `${targetSize}px`;
        handle.style.left = `${control.x - targetSize / 2}px`;
        handle.style.top = `${control.y - targetSize / 2}px`;
        const trajectory = projectTransformTrajectory(authoring.document, elementId);
        const pose = trajectory.eligible ? trajectory.waypoints.find((point) => point.timeMs === shotMomentMs)?.pose : undefined;
        const value = kind === 'scale' ? (pose?.scalePpm ?? 1_000_000) / 1_000_000 : (pose?.rotateMicrodegrees ?? 0) / 1_000_000;
        const controlName = kind === 'scale'
          ? `${corner!.replace('-', ' ')} uniform scale handle for Object ${index + 1}`
          : `Rotation handle for Object ${index + 1}`;
        handle.setAttribute('aria-label', controlName);
        handle.title = kind === 'scale' ? `Drag the ${corner!.replace('-', ' ')} corner to scale Object ${index + 1}`
          : `Drag to rotate Object ${index + 1}`;
        handle.setAttribute('aria-valuemin', kind === 'scale' ? '0.25' : '-180'); handle.setAttribute('aria-valuemax', kind === 'scale' ? '3' : '180');
        handle.setAttribute('aria-valuenow', String(value)); handle.setAttribute('aria-valuetext', kind === 'scale' ? `${value} uniform scale` : `${value} degrees`);
      }
    }
  }
  for (const [key, button] of existing) if (!desired.has(key)) button.remove();
}

function openShotWorkspace(config: { startMs: number; landedMs: number; settledMs: number; targetElementIds: string[] }): { ok: boolean; code?: string } {
  const projection = projectShotWorkspace(authoring.document, config);
  if (!projection.eligible) { const code = projection.code ?? 'SHOT_WORKSPACE_UNAVAILABLE'; shotStatus.value = `${code} · revision ${authoring.document.revision} unchanged.`; return { ok: false, code }; }
  const source = controller.sourceSize();
  if (!Number.isSafeInteger(source.widthCssPixels) || source.widthCssPixels <= 0
    || !Number.isSafeInteger(source.heightCssPixels) || source.heightCssPixels <= 0 || !readShotProjection()) {
    const code = 'PREVIEW_SOURCE_SIZE_INVALID'; shotStatus.value = `${code} · revision ${authoring.document.revision} unchanged.`;
    return { ok: false, code };
  }
  shotConfig = { ...config, targetElementIds: [...config.targetElementIds].sort() };
  shotWorkspace.removeAttribute('aria-disabled'); shotWorkspace.dataset.editable = 'true'; shotRecovery.hidden = true; shotStatus.setAttribute('role', 'status');
  forEachShotControl((control) => { control.disabled = false; });
  shotPrimaryElementId = shotConfig.targetElementIds[0]!;
  shotSelection = [shotPrimaryElementId]; shotMomentMs = config.landedMs; shotWorkspace.hidden = false; shotMoments.hidden = false;
  activateShotLayout(); configurePreviewCanvas();
  scrubber.max = String(shotConfig.settledMs + 1);
  if (!alignShotPreviewToMoment(shotMomentMs)) return { ok: false, code: 'PREVIEW_MOMENT_ALIGNMENT_INVALID' };
  renderShotWorkspace(); configurePreviewCanvas(); renderShotWorkspace(); return { ok: true };
}

function activateShotLayout(): void {
  const shell = required<HTMLElement>('.editor-shell');
  required<HTMLElement>('[data-shot-history-slot]').append(required<HTMLElement>('.workflow-footer'));
  shell.classList.add('shot-active');
  required<HTMLElement>('.topbar h1').textContent = 'Shape motion directly on the canvas';
  required<HTMLElement>('.purpose').textContent = 'Choose an object and a moment. Add points when the path needs another beat.';
}

function forEachShotControl(callback: (control: HTMLInputElement | HTMLButtonElement | HTMLSelectElement) => void): void {
  for (const root of [shotWorkspace, shotMoments]) {
    root.querySelectorAll<HTMLInputElement | HTMLButtonElement | HTMLSelectElement>('input, button, select').forEach(callback);
  }
}

function initializeSeedWorkspace(): void {
  const metadata = payload.shotWorkspace;
  if (!metadata) return;
  const structuralElementIds = authoring.document.elements.map((element) => element.id).sort();
  const targets = [...metadata.targetElementIds];
  const bindingValid = metadata.schemaVersion === 'motion.editor-shot-workspace.v1'
    && metadata.documentId === authoring.document.documentId
    && metadata.startMs === 0 && metadata.landedMs === 700 && metadata.settledMs === 2100
    && targets.length === 2
    && targets.every((elementId, index) => elementId === structuralElementIds[index]);
  if (bindingValid) {
    const opened = openShotWorkspace({ startMs: metadata.startMs, landedMs: metadata.landedMs,
      settledMs: metadata.settledMs, targetElementIds: targets });
    if (opened.ok) return;
    showSeedWorkspaceFailure(opened.code ?? 'SHOT_WORKSPACE_UNAVAILABLE');
    return;
  }
  showSeedWorkspaceFailure('SHOT_WORKSPACE_METADATA_MISMATCH');
}

function showSeedWorkspaceFailure(code: string): void {
  shotConfig = null;
  shotSelection = [];
  shotPrimaryElementId = null;
  shotWorkspace.hidden = false; shotMoments.hidden = true;
  shotWorkspace.removeAttribute('aria-disabled'); shotWorkspace.dataset.editable = 'false';
  forEachShotControl((control) => { control.disabled = true; });
  shotRecovery.hidden = false;
  required<HTMLElement>('[data-shot-recovery-copy]').textContent = `${code}. The committed document was not changed. Restore a compatible Shot 1 revision or source, then retry; you can still inspect every track now.`;
  required<HTMLButtonElement>('[data-shot-retry]').disabled = false;
  required<HTMLButtonElement>('[data-shot-inspect]').disabled = false;
  shotStatus.setAttribute('role', 'alert');
  shotStatus.value = `${code} · revision ${authoring.document.revision} unchanged. Manual Shot editing is unavailable.`;
}

function canonicalShotInventory() {
  if (!shotConfig) return null;
  const inventories = shotConfig.targetElementIds.map((elementId) => {
    const trajectory = projectTransformTrajectory(authoring.document, elementId);
    if (!trajectory.eligible) return null;
    const waypoints = trajectory.waypoints.filter((waypoint) => waypoint.timeMs >= shotConfig!.startMs && waypoint.timeMs <= shotConfig!.settledMs)
      .sort((left, right) => left.timeMs - right.timeMs || left.keyframeId.localeCompare(right.keyframeId));
    if (waypoints.some((waypoint) => !Number.isSafeInteger(waypoint.timeMs) || !waypoint.keyframeId)
      || new Set(waypoints.map((waypoint) => waypoint.timeMs)).size !== waypoints.length) return null;
    return { elementId, waypoints };
  });
  const validInventories = inventories.filter((inventory): inventory is NonNullable<typeof inventory> => inventory !== null);
  if (validInventories.length !== shotConfig.targetElementIds.length) return null;
  return validInventories;
}

function isSharedShotMoment(inventories: NonNullable<ReturnType<typeof canonicalShotInventory>>, elementIds: string[], timeMs: number): boolean {
  return elementIds.every((elementId) => inventories.find((inventory) => inventory.elementId === elementId)
    ?.waypoints.some((waypoint) => waypoint.timeMs === timeMs) === true);
}

function selectShotPrimary(elementId: string): void {
  if (!shotConfig || !shotConfig.targetElementIds.includes(elementId)) return;
  shotPrimaryElementId = elementId;
  shotSelection = required<HTMLInputElement>('[data-move-together]').checked ? [...shotConfig.targetElementIds] : [elementId];
  renderShotWorkspace(); schedulePreviewSelection();
}

function selectShotMode(nextMode: 'pose' | 'path'): void {
  if (nextMode === 'path' && !alignShotPreviewToMoment(shotMomentMs)) return;
  shotMode = nextMode;
  shotWorkspace.querySelectorAll<HTMLButtonElement>('[data-shot-mode]').forEach((item) =>
    { item.setAttribute('aria-pressed', String(nextMode === 'path'));
      item.textContent = nextMode === 'path' ? 'Hide path' : 'Show path'; });
  renderShotWorkspace();
}

function selectShotMoment(timeMs: number): void {
  if (!alignShotPreviewToMoment(timeMs)) return;
  shotMomentMs = timeMs; renderShotWorkspace();
}

function focusShotMoment(timeMs: number): void {
  requestAnimationFrame(() => document.querySelector<HTMLInputElement>(
    `input[name="shot-moment"][value="${timeMs}"]`)?.focus());
}

function shotMomentLabel(timeMs: number): string {
  if (timeMs === shotConfig?.startMs) return 'Start';
  if (timeMs === shotConfig?.settledMs) return 'Settle';
  const trajectory = shotPrimaryElementId ? projectTransformTrajectory(authoring.document, shotPrimaryElementId) : null;
  const intermediate = trajectory?.eligible ? trajectory.waypoints
    .filter((point) => point.timeMs > (shotConfig?.startMs ?? 0) && point.timeMs < (shotConfig?.settledMs ?? 2100)) : [];
  const index = intermediate.findIndex((point) => point.timeMs === timeMs);
  return index >= 0 ? `Point ${index + 1}` : `${timeMs} ms`;
}

function updatePreviewPlaybackState(timeMs?: number, paused = false): void {
  const editing = shotMomentLabel(shotMomentMs);
  previewShotState.value = timeMs === undefined ? `Editing ${editing}`
    : `${paused ? 'Paused' : 'Previewing'} ${Math.round(timeMs)} ms · ${editing}`;
}

function syncPreviewShotToolbar(requestedTimes: number[]): void {
  previewShotToolbar.hidden = !shotConfig;
  if (!shotConfig || !shotPrimaryElementId) return;
  const primaryIndex = shotConfig.targetElementIds.indexOf(shotPrimaryElementId);
  previewShotObject.textContent = `Object ${primaryIndex + 1}`;
  if (playbackFeedbackFrame === null) updatePreviewPlaybackState();
  const descriptors = [
    { key: 'mode:path', label: 'Path', ariaLabel: 'Show path overlay', pressed: shotMode === 'path',
      action: () => selectShotMode(shotMode === 'path' ? 'pose' : 'path') },
    ...shotConfig.targetElementIds.map((elementId, index) => ({ key: `primary:${elementId}`, label: `Object ${index + 1}`,
      ariaLabel: `Edit Object ${index + 1} from preview`, pressed: elementId === shotPrimaryElementId,
      action: () => selectShotPrimary(elementId) })),
    ...requestedTimes.map((timeMs) => ({ key: `moment:${timeMs}`, label: shotMomentLabel(timeMs),
      ariaLabel: `Edit ${shotMomentLabel(timeMs)} waypoint from preview`, pressed: timeMs === shotMomentMs,
      action: () => selectShotMoment(timeMs) })),
    { key: 'group', label: 'Move together', ariaLabel: 'Move both objects together from preview',
      pressed: required<HTMLInputElement>('[data-move-together]').checked,
      action: () => required<HTMLInputElement>('[data-move-together]').click() },
  ];
  const existing = new Map([...previewShotActions.querySelectorAll<HTMLButtonElement>('button[data-preview-shot-key]')]
    .map((button) => [button.dataset.previewShotKey!, button]));
  const desired = new Set(descriptors.map((descriptor) => descriptor.key));
  for (const [index, descriptor] of descriptors.entries()) {
    let button = existing.get(descriptor.key);
    if (!button) { button = document.createElement('button'); button.type = 'button'; button.dataset.previewShotKey = descriptor.key;
      button.addEventListener('click', descriptor.action); }
    button.textContent = descriptor.label; button.setAttribute('aria-label', descriptor.ariaLabel);
    button.setAttribute('aria-pressed', String(descriptor.pressed));
    const current = previewShotActions.querySelectorAll<HTMLButtonElement>('button[data-preview-shot-key]').item(index);
    if (current !== button) previewShotActions.insertBefore(button, current);
  }
  for (const [key, button] of existing) if (!desired.has(key)) button.remove();
}

function renderShotWorkspace(): void {
  if (!shotConfig) return;
  const momentBeforeReconciliation = shotMomentMs;
  shotTargets.querySelectorAll('label').forEach((item) => item.remove());
  for (const [index, elementId] of shotConfig.targetElementIds.entries()) {
    const label = document.createElement('label'); label.className = 'shot-object';
    const primary = document.createElement('input'); primary.type = 'radio'; primary.name = 'shot-primary'; primary.value = elementId;
    primary.checked = elementId === shotPrimaryElementId; primary.setAttribute('aria-label', `Primary Object ${index + 1}`);
    primary.addEventListener('change', () => { if (primary.checked) selectShotPrimary(elementId); });
    const copy = document.createElement('span'); copy.innerHTML = `<strong>Object ${index + 1}</strong><small>Primary</small>`;
    label.append(primary, copy); shotTargets.append(label);
  }
  const primary = shotPrimaryElementId ?? shotSelection[0]!; const inventories = canonicalShotInventory();
  const primaryInventory = inventories?.find((inventory) => inventory.elementId === primary);
  if (!inventories || !primaryInventory) { shotGeometry = []; shotProjection = null; shotOverlay.replaceChildren();
    shotOverlay.setAttribute('aria-busy', 'false'); shotStatus.value = 'TRAJECTORY_INVENTORY_DIVERGED'; return; }
  const moveTogether = required<HTMLInputElement>('[data-move-together]');
  const primaryTimes = primaryInventory.waypoints.map((waypoint) => waypoint.timeMs);
  const sharedTimes = primaryTimes.filter((timeMs) => isSharedShotMoment(inventories, shotConfig!.targetElementIds, timeMs));
  if (moveTogether.checked && !sharedTimes.includes(shotMomentMs)) {
    if (sharedTimes.length > 0) shotMomentMs = [...sharedTimes]
      .sort((left, right) => Math.abs(left - shotMomentMs) - Math.abs(right - shotMomentMs) || left - right)[0]!;
    else { moveTogether.checked = false; shotSelection = [primary]; }
  }
  if (moveTogether.checked) shotSelection = [...shotConfig.targetElementIds];
  const requestedTimes = moveTogether.checked ? sharedTimes : primaryTimes;
  if (!requestedTimes.includes(shotMomentMs)) shotMomentMs = [...requestedTimes]
    .sort((left, right) => Math.abs(left - shotMomentMs) - Math.abs(right - shotMomentMs) || left - right)[0]!;
  if (shotMode === 'path' && shotMomentMs !== momentBeforeReconciliation && !alignShotPreviewToMoment(shotMomentMs)) return;
  moveTogether.disabled = !moveTogether.checked && !sharedTimes.includes(shotMomentMs);
  renderShotContextDock(inventories);
  const displayedWaypoints = primaryInventory.waypoints.filter((waypoint) => requestedTimes.includes(waypoint.timeMs));
  const displayedPaths = inventories.map((inventory, objectIndex) => ({ elementId: inventory.elementId, objectIndex,
    waypoints: inventory.waypoints.map(({ keyframeId, timeMs }) => ({ keyframeId, timeMs })) }));
  const geometryTimes = [...new Set(displayedPaths.flatMap((path) => path.waypoints.map((waypoint) => waypoint.timeMs)))].sort((a, b) => a - b);
  const momentSequence = required<HTMLElement>('[data-shot-moment-sequence]', shotMoments);
  momentSequence.replaceChildren();
  for (const [index, timeMs] of requestedTimes.entries()) {
    if (index > 0 && timeMs - requestedTimes[index - 1]! > 1) {
      const beforeMs = requestedTimes[index - 1]!; const add = document.createElement('button'); add.type = 'button';
      add.className = 'moment-add'; add.textContent = '+'; add.setAttribute('aria-label',
        `Add a point between ${shotMomentLabel(beforeMs)} and ${shotMomentLabel(timeMs)}`);
      add.addEventListener('click', () => void addShotMoment(beforeMs, timeMs)); momentSequence.append(add);
    }
    const label = document.createElement('label'); const input = document.createElement('input'); input.type = 'radio'; input.name = 'shot-moment';
    input.value = String(timeMs); input.checked = timeMs === shotMomentMs;
    input.addEventListener('change', () => { if (input.checked) selectShotMoment(timeMs); });
    const copy = document.createElement('span'); copy.innerHTML = `<strong>${shotMomentLabel(timeMs)}</strong><small>${timeMs} ms</small>`;
    label.append(input, copy); momentSequence.append(label);
  }
  const projection = readShotProjection();
  if (!projection) { shotGeometry = []; committedShotGeometryKey = null; shotOverlay.replaceChildren();
    shotOverlay.setAttribute('aria-busy', 'false'); return; }
  const geometryKey = sha256Hex(canonicalJson({ mountedPreviewGeneration, compilerDigest: compiled.exportDigest, primaryElementId: primary,
    waypoints: displayedWaypoints.map(({ keyframeId, timeMs }) => ({ keyframeId, timeMs })), paths: displayedPaths, requestedTimes: geometryTimes,
    projection: { sourceWidthCssPixels: projection.sourceWidthCssPixels, sourceHeightCssPixels: projection.sourceHeightCssPixels,
      displayLeft: projection.displayLeft, displayTop: projection.displayTop, displayWidth: projection.displayWidth,
      displayHeight: projection.displayHeight, scaleX: projection.scaleX, scaleY: projection.scaleY,
      devicePixelRatio: projection.devicePixelRatio } }));
  const latestKey = latestShotGeometryRequest?.geometryKey;
  if (geometryKey !== latestKey) {
    const geometryGeneration = ++shotGeometryGeneration;
    publishShotGeometry({ workspaceGeneration: geometryGeneration, primaryElementId: primary, geometryKey,
      waypoints: displayedWaypoints, paths: displayedPaths, requestedTimes: geometryTimes });
  } else if (committedShotGeometryKey !== geometryKey && !pendingShotGeometryRequest && !shotGeometryPumpRunning) {
    publishShotGeometry({ workspaceGeneration: shotGeometryGeneration, primaryElementId: primary, geometryKey,
      waypoints: displayedWaypoints, paths: displayedPaths, requestedTimes: geometryTimes });
  }
  const selected = primaryInventory.waypoints.find((point) => point.timeMs === shotMomentMs);
  const primaryLabel = `Object ${shotConfig.targetElementIds.indexOf(primary) + 1}`;
  const momentLabel = shotMomentLabel(shotMomentMs);
  shotWorkspace.dataset.mode = shotMode;
  syncPreviewShotToolbar(requestedTimes);
  previewSelectionLabel.textContent = `${primaryLabel} selected`;
  shotGuidance.textContent = `Editing ${primaryLabel} at ${momentLabel}. Drag the object to move it, any corner to scale uniformly, or the rotation handle above it to rotate.${moveTogether.checked ? ' Object movement translates both objects together.' : ''}${shotMode === 'path' ? ' Path waypoints are visible and draggable.' : ''}`;
  const controls = shotPoseForm.elements as unknown as Record<string, HTMLInputElement>;
  for (const control of shotPoseForm.querySelectorAll<HTMLInputElement>('input')) control.disabled = !selected;
  if (selected) { controls.x!.value = String(selected.pose.translateXMicrounits / 1_000_000); controls.y!.value = String(selected.pose.translateYMicrounits / 1_000_000);
    controls.scale!.value = String(selected.pose.scalePpm / 1_000_000); controls.rotate!.value = String(selected.pose.rotateMicrodegrees / 1_000_000); }
  shotOverlay.dataset.mode = shotMode;
  previewObjectOverlay.dataset.mode = shotMode;
  shotOverlay.toggleAttribute('inert', shotMode !== 'path');
  syncReferencePathSelection();
  for (const handle of shotOverlay.querySelectorAll<HTMLElement>('[data-keyframe-id][data-time-ms]')) {
    handle.setAttribute('aria-pressed', String(Number(handle.dataset.timeMs) === shotMomentMs));
  }
  const currentGeometry = committedShotGeometryKey === geometryKey;
  shotOverlay.setAttribute('aria-busy', String(!currentGeometry));
  shotStatus.value = currentGeometry ? `${primaryLabel} · ${momentLabel} ready.` : 'Updating canvas…';
  schedulePreviewSelection();
}

function renderShotContextDock(inventories: NonNullable<ReturnType<typeof canonicalShotInventory>>): void {
  if (!shotConfig) return;
  const editTogether = required<HTMLInputElement>('[data-move-together]').checked;
  const sharedTimes = inventories[0]!.waypoints.map((waypoint) => waypoint.timeMs)
    .filter((timeMs) => inventories.every((inventory) => inventory.waypoints.some((waypoint) => waypoint.timeMs === timeMs)))
    .sort((left, right) => left - right);
  const primaryTimes = inventories.find((inventory) => inventory.elementId === shotPrimaryElementId)?.waypoints
    .map((waypoint) => waypoint.timeMs).sort((left, right) => left - right) ?? [];
  const editableTimes = editTogether ? sharedTimes : primaryTimes;
  const selectedIndex = editableTimes.indexOf(shotMomentMs);
  const protectedMoment = shotMomentMs === shotConfig.startMs || shotMomentMs === shotConfig.settledMs;
  const noFollowingEditableSegment = selectedIndex < 0 || selectedIndex === editableTimes.length - 1;
  required<HTMLElement>('[data-shot-context-name]').textContent = shotMomentLabel(shotMomentMs);
  const timeInput = required<HTMLInputElement>('[data-shot-context-time]');
  const timeOutput = required<HTMLOutputElement>('[data-shot-moment-time-output]');
  timeInput.min = String((editableTimes[selectedIndex - 1] ?? shotMomentMs - 1) + 1);
  timeInput.max = String((editableTimes[selectedIndex + 1] ?? shotMomentMs + 1) - 1);
  timeInput.value = String(shotMomentMs); timeOutput.value = `${shotMomentMs} ms`;
  timeInput.disabled = protectedMoment || selectedIndex < 0;
  const remove = required<HTMLButtonElement>('[data-shot-context-remove]');
  remove.hidden = timeInput.disabled;
  remove.disabled = timeInput.disabled || editableTimes.length <= 3;
  const editingElementIds = editTogether ? shotConfig.targetElementIds : shotPrimaryElementId ? [shotPrimaryElementId] : [];
  const selected = projectTrajectorySelection(authoring.document, editingElementIds, shotMomentMs);
  const easing = required<HTMLSelectElement>('[data-shot-context-easing]');
  const applyEasing = required<HTMLButtonElement>('[data-shot-apply-easing]');
  easing.disabled = !selected.eligible || noFollowingEditableSegment;
  applyEasing.disabled = easing.disabled;
  if (!selected.eligible) return;
  const timings = effectiveShotTimings(selected.targets);
  if (timings && timings.every((timing) => canonicalJson(timing) === canonicalJson(timings[0]))) {
    const timing = timings[0]!;
    easing.value = timing.kind === 'keyword' ? timing.value : 'custom';
  }
}

function publishShotGeometry(request: Omit<ShotGeometryRequest, 'requestId'>): void {
  const published = { ...request, requestId: ++shotGeometryRequestId,
    waypoints: request.waypoints.map((waypoint) => ({ ...waypoint })),
    paths: request.paths.map((path) => ({ ...path, waypoints: path.waypoints.map((waypoint) => ({ ...waypoint })) })),
    requestedTimes: [...request.requestedTimes] };
  latestShotGeometryRequest = published; pendingShotGeometryRequest = published;
  shotOverlay.setAttribute('aria-busy', 'true');
  shotStatus.value = 'Updating canvas…';
  if (!shotGeometryPumpRunning) shotGeometryPumpCompletion = pumpShotGeometry();
}

function republishShotGeometry(): void {
  if (!shotConfig || !latestShotGeometryRequest) return;
  if (committedShotGeometryKey === latestShotGeometryRequest.geometryKey) return;
  publishShotGeometry({ workspaceGeneration: latestShotGeometryRequest.workspaceGeneration,
    primaryElementId: latestShotGeometryRequest.primaryElementId, geometryKey: latestShotGeometryRequest.geometryKey,
    waypoints: latestShotGeometryRequest.waypoints, paths: latestShotGeometryRequest.paths,
    requestedTimes: latestShotGeometryRequest.requestedTimes });
}

function isCurrentShotGeometryRequest(request: ShotGeometryRequest): boolean {
  return latestShotGeometryRequest?.requestId === request.requestId && request.workspaceGeneration === shotGeometryGeneration
    && Boolean(shotConfig) && request.primaryElementId === shotPrimaryElementId;
}

async function pumpShotGeometry(): Promise<void> {
  if (shotGeometryPumpRunning) return;
  shotGeometryPumpRunning = true;
  try {
    while (pendingShotGeometryRequest) {
      const request = pendingShotGeometryRequest; pendingShotGeometryRequest = null;
      await processShotGeometryRequest(request);
    }
  } finally {
    shotGeometryPumpRunning = false;
    if (pendingShotGeometryRequest) shotGeometryPumpCompletion = pumpShotGeometry();
  }
}

async function awaitShotGeometryCommit(): Promise<void> {
  while (shotGeometryPumpRunning || pendingShotGeometryRequest) {
    const completion = shotGeometryPumpCompletion;
    await completion;
    if (completion === shotGeometryPumpCompletion && !shotGeometryPumpRunning && !pendingShotGeometryRequest) return;
  }
}

function refreshTrajectorySegments(): void {
  const handles = [...shotOverlay.querySelectorAll<HTMLElement>('[data-keyframe-id]')]
    .sort((left, right) => Number(left.dataset.timeMs) - Number(right.dataset.timeMs));
  const existing = new Map([...shotOverlay.querySelectorAll<HTMLElement>('[data-trajectory-segment]')]
    .map((segment) => [segment.dataset.trajectorySegment!, segment]));
  const desired = new Set<string>();
  for (let index = 0; index < handles.length - 1; index += 1) {
    const from = handles[index]!; const to = handles[index + 1]!;
    const key = `${from.dataset.keyframeId!}:${to.dataset.keyframeId!}`; desired.add(key);
    let segment = existing.get(key);
    if (!segment) { segment = document.createElement('span'); segment.className = 'trajectory-segment';
      segment.dataset.trajectorySegment = key; segment.setAttribute('aria-hidden', 'true'); shotOverlay.prepend(segment); }
    const center = (handle: HTMLElement) => { const [translatedX = '0', translatedY = '0'] = handle.style.translate.split(/\s+/);
      return { x: Number.parseFloat(handle.style.left) + Number.parseFloat(handle.style.width) / 2 + (Number.parseFloat(translatedX) || 0),
        y: Number.parseFloat(handle.style.top) + Number.parseFloat(handle.style.height) / 2 + (Number.parseFloat(translatedY) || 0) }; };
    const start = center(from); const end = center(to);
    const dx = end.x - start.x; const dy = end.y - start.y;
    segment.dataset.segmentIndex = String(index + 1);
    segment.dataset.segmentLabel = `${shotMomentLabel(Number(from.dataset.timeMs))} to ${shotMomentLabel(Number(to.dataset.timeMs))}`;
    Object.assign(segment.style, { left: `${start.x}px`, top: `${start.y}px`, width: `${Math.hypot(dx, dy)}px`,
      transform: `translateY(-1px) rotate(${Math.atan2(dy, dx)}rad)` });
  }
  for (const [key, segment] of existing) if (!desired.has(key)) segment.remove();
}

function syncReferencePathSelection(): void {
  for (const item of shotOverlay.querySelectorAll<HTMLElement>('[data-reference-segment], [data-reference-waypoint]')) {
    item.dataset.selected = String(Boolean(item.dataset.elementId && shotSelection.includes(item.dataset.elementId)));
  }
}

function renderReferencePaths(request: ShotGeometryRequest,
  samples: Awaited<ReturnType<NativePreviewController['measureTargetBoundsAtTimes']>>): void {
  const existingPoints = new Map([...shotOverlay.querySelectorAll<HTMLElement>('[data-reference-waypoint]')]
    .map((point) => [point.dataset.referenceWaypoint!, point]));
  const existingSegments = new Map([...shotOverlay.querySelectorAll<HTMLElement>('[data-reference-segment]')]
    .map((segment) => [segment.dataset.referenceSegment!, segment]));
  const desiredPoints = new Set<string>(); const desiredSegments = new Set<string>();
  for (const path of request.paths) {
    const selected = shotSelection.includes(path.elementId);
    const points = path.waypoints.map((waypoint) => {
      const key = `${path.elementId}:${waypoint.keyframeId}`; desiredPoints.add(key);
      const sample = samples.find((candidate) => candidate.elementId === path.elementId && candidate.timeMs === waypoint.timeMs);
      if (!sample) throw new Error('PREVIEW_REFERENCE_GEOMETRY_TARGET_MISSING');
      let point = existingPoints.get(key);
      if (!point) { point = document.createElement('span'); point.className = 'trajectory-reference-waypoint';
        point.dataset.referenceWaypoint = key; point.setAttribute('aria-hidden', 'true'); shotOverlay.append(point); }
      point.dataset.elementId = path.elementId; point.dataset.timeMs = String(waypoint.timeMs);
      point.dataset.objectIndex = String(path.objectIndex); point.dataset.selected = String(selected);
      Object.assign(point.style, { left: `${sample.bounds.left}px`, top: `${sample.bounds.top}px`, width: `${sample.bounds.width}px`,
        height: `${sample.bounds.height}px` });
      return { point, key, bounds: sample.bounds };
    });
    for (let index = 0; index < points.length - 1; index += 1) {
      const from = points[index]!; const to = points[index + 1]!; const key = `${path.elementId}:${from.key}:${to.key}`;
      desiredSegments.add(key); let segment = existingSegments.get(key);
      if (!segment) { segment = document.createElement('span'); segment.className = 'trajectory-reference-segment';
        segment.dataset.referenceSegment = key; segment.setAttribute('aria-hidden', 'true'); shotOverlay.prepend(segment); }
      const start = { x: from.bounds.left + from.bounds.width / 2, y: from.bounds.top + from.bounds.height / 2 };
      const end = { x: to.bounds.left + to.bounds.width / 2, y: to.bounds.top + to.bounds.height / 2 };
      const dx = end.x - start.x; const dy = end.y - start.y;
      segment.dataset.elementId = path.elementId; segment.dataset.objectIndex = String(path.objectIndex);
      segment.dataset.selected = String(selected);
      Object.assign(segment.style, { left: `${start.x}px`, top: `${start.y}px`, width: `${Math.hypot(dx, dy)}px`,
        transform: `translateY(-1px) rotate(${Math.atan2(dy, dx)}rad)` });
    }
  }
  for (const [key, point] of existingPoints) if (!desiredPoints.has(key)) point.remove();
  for (const [key, segment] of existingSegments) if (!desiredSegments.has(key)) segment.remove();
}

async function processShotGeometryRequest(request: ShotGeometryRequest): Promise<void> {
  if (!isCurrentShotGeometryRequest(request)) return;
  let samples: Awaited<ReturnType<NativePreviewController['measureTargetBoundsAtTimes']>>;
  try {
    activeShotGeometrySamplers += 1; maximumActiveShotGeometrySamplers = Math.max(maximumActiveShotGeometrySamplers, activeShotGeometrySamplers);
    samples = await controller.measureTargetBoundsAtTimes(shotConfig!.targetElementIds, request.requestedTimes);
  } catch (error) {
    if (error instanceof Error && error.message === 'PREVIEW_GEOMETRY_SUPERSEDED') return;
    if (!isCurrentShotGeometryRequest(request)) return;
    shotProjection = null; shotGeometry = []; shotOverlay.replaceChildren(); shotOverlay.setAttribute('aria-busy', 'false');
    const code = error instanceof Error ? error.message : 'PREVIEW_GEOMETRY_INVALID';
    shotStatus.value = `${code} · revision ${authoring.document.revision} unchanged.`;
    return;
  } finally {
    activeShotGeometrySamplers -= 1;
  }
  if (!isCurrentShotGeometryRequest(request)) return;
  try {
    const projection = readShotProjection();
    if (!projection) { shotProjection = null; shotGeometry = []; shotOverlay.replaceChildren();
      shotOverlay.setAttribute('aria-busy', 'false'); return; }
    renderReferencePaths(request, samples);
    const existingHandles = [...shotOverlay.querySelectorAll<HTMLButtonElement>('[data-keyframe-id]')];
    const handlesByKeyframeId = new Map(existingHandles.map((handle) => [handle.dataset.keyframeId!, handle]));
    if (handlesByKeyframeId.size !== existingHandles.length) throw new Error('PREVIEW_GEOMETRY_HANDLE_IDENTITY_INVALID');
    const orderedHandles: HTMLButtonElement[] = [];
    for (const waypoint of request.waypoints) {
      const sample = samples.find((candidate) => candidate.elementId === request.primaryElementId && candidate.timeMs === waypoint.timeMs);
      if (!sample) throw new Error('PREVIEW_GEOMETRY_TARGET_MISSING');
      let handle = handlesByKeyframeId.get(waypoint.keyframeId);
      if (!handle) {
        handle = document.createElement('button'); handle.type = 'button'; handle.className = 'trajectory-waypoint';
        const label = document.createElement('span'); label.className = 'trajectory-waypoint-label';
        const name = document.createElement('strong'); name.className = 'trajectory-waypoint-name';
        const time = document.createElement('small'); time.className = 'trajectory-waypoint-time';
        label.append(name, time); handle.append(label);
        handle.addEventListener('click', () => { if (handle!.dataset.dragged === 'true') return;
          const timeMs = Number(handle!.dataset.timeMs);
          if (alignShotPreviewToMoment(timeMs)) { shotMomentMs = timeMs; renderShotWorkspace(); } });
        handle.addEventListener('pointerdown', (event) => beginWaypointDrag(event, Number(handle!.dataset.timeMs)));
      }
      handle.dataset.keyframeId = waypoint.keyframeId; handle.dataset.timeMs = String(waypoint.timeMs);
      handle.dataset.elementId = request.primaryElementId;
      handle.dataset.label = shotMomentLabel(waypoint.timeMs);
      handle.querySelector<HTMLElement>('.trajectory-waypoint-name')!.textContent = handle.dataset.label;
      handle.querySelector<HTMLElement>('.trajectory-waypoint-time')!.textContent = `${waypoint.timeMs} ms`;
      handle.setAttribute('aria-label', `${handle.dataset.label}, ${waypoint.timeMs} ms, compiler-native target bounds`);
      handle.setAttribute('aria-pressed', String(waypoint.timeMs === shotMomentMs));
      Object.assign(handle.style, { left: `${sample.bounds.left}px`, top: `${sample.bounds.top}px`, width: `${sample.bounds.width}px`,
        height: `${sample.bounds.height}px`, translate: '' });
      orderedHandles.push(handle);
    }
    if (!isCurrentShotGeometryRequest(request)) return;
    const desiredIds = new Set(request.waypoints.map((waypoint) => waypoint.keyframeId));
    for (const handle of existingHandles) if (!desiredIds.has(handle.dataset.keyframeId!)) handle.remove();
    for (const [index, handle] of orderedHandles.entries()) {
      const current = shotOverlay.querySelectorAll<HTMLButtonElement>('[data-keyframe-id]').item(index);
      if (current !== handle) shotOverlay.insertBefore(handle, current);
    }
    const placedLabels: Array<{ left: number; right: number; top: number; bottom: number }> = [];
    for (const handle of orderedHandles) {
      const label = handle.querySelector<HTMLElement>('.trajectory-waypoint-label')!;
      label.style.translate = '';
      const left = handle.offsetLeft - 1;
      const width = label.offsetWidth;
      const height = label.offsetHeight;
      const baseTop = handle.offsetTop + handle.offsetHeight + 4;
      let shift = 0;
      while (placedLabels.some((placed) => left < placed.right && left + width > placed.left
        && baseTop + shift < placed.bottom && baseTop + shift + height > placed.top)) shift += height + 4;
      label.style.translate = shift ? `0 ${shift}px` : '';
      placedLabels.push({ left, right: left + width, top: baseTop + shift, bottom: baseTop + shift + height });
    }
    refreshTrajectorySegments();
    const nextGeometry: typeof shotGeometry = [];
    for (const sample of samples) {
      const handle = sample.elementId === request.primaryElementId
        ? shotOverlay.querySelector<HTMLElement>(`[data-keyframe-id][data-element-id="${request.primaryElementId}"][data-time-ms="${sample.timeMs}"]`) : null;
      if (!handle) continue;
      const overlayBounds = rectValue(handle.getBoundingClientRect()); const expected = projectContentBounds(projection, sample.bounds);
      const center = (rect: ProjectionRect) => ({ x: (rect.left + rect.right) / 2, y: (rect.top + rect.bottom) / 2 });
      const actualCenter = center(overlayBounds); const expectedCenter = center(expected); const dpr = projection.devicePixelRatio;
      const deltasDevicePixels = { left: Math.abs(overlayBounds.left - expected.left) * dpr,
        top: Math.abs(overlayBounds.top - expected.top) * dpr, right: Math.abs(overlayBounds.right - expected.right) * dpr,
        bottom: Math.abs(overlayBounds.bottom - expected.bottom) * dpr, centerX: Math.abs(actualCenter.x - expectedCenter.x) * dpr,
        centerY: Math.abs(actualCenter.y - expectedCenter.y) * dpr };
      if (Object.values(deltasDevicePixels).some((delta) => delta > 1)) throw new Error('PREVIEW_GEOMETRY_PARITY_EXCEEDED');
      nextGeometry.push({ elementId: sample.elementId, timeMs: sample.timeMs, contentBounds: { ...sample.bounds }, overlayBounds, deltasDevicePixels });
    }
    if (!isCurrentShotGeometryRequest(request)) return;
    shotProjection = projection; shotGeometry = nextGeometry; lastCommittedShotGeometryRequestId = request.requestId;
    committedShotGeometryKey = request.geometryKey;
    shotOverlay.setAttribute('aria-busy', 'false');
    const objectLabel = `Object ${shotConfig!.targetElementIds.indexOf(request.primaryElementId) + 1}`;
    shotStatus.value = `${objectLabel} · ${shotMomentLabel(shotMomentMs)} ready.`;
  } catch (error) {
    if (!isCurrentShotGeometryRequest(request)) return;
    shotProjection = null; shotGeometry = []; shotOverlay.replaceChildren(); shotOverlay.setAttribute('aria-busy', 'false');
    const code = error instanceof Error ? error.message : 'PREVIEW_GEOMETRY_INVALID';
    shotStatus.value = `${code} · revision ${authoring.document.revision} unchanged.`;
  }
}

function shotStageProjection() {
  const { widthCssPixels, heightCssPixels } = controller.sourceSize();
  if (!Number.isSafeInteger(widthCssPixels) || widthCssPixels <= 0
    || !Number.isSafeInteger(heightCssPixels) || heightCssPixels <= 0) return null;
  const widthMicrounits = widthCssPixels * 1_000_000; const heightMicrounits = heightCssPixels * 1_000_000;
  if (!Number.isSafeInteger(widthMicrounits) || !Number.isSafeInteger(heightMicrounits)) return null;
  return { stageDigest: sha256Hex(`${compiled.exportDigest}\0${widthMicrounits}\0${heightMicrounits}`), widthMicrounits, heightMicrounits };
}

function shotViewportIntent(): { widthCssPixels: number; heightCssPixels: number } | null {
  const { widthCssPixels, heightCssPixels } = controller.sourceSize();
  if (!Number.isSafeInteger(widthCssPixels) || widthCssPixels <= 0
    || !Number.isSafeInteger(heightCssPixels) || heightCssPixels <= 0) return null;
  return { widthCssPixels, heightCssPixels };
}

function directPoseIntent(nextPose: ShotPose, kind: DirectPoseKind): OperationIntentPayload | null {
  if (!shotPrimaryElementId) return null;
  if (kind === 'move' && required<HTMLInputElement>('[data-move-together]').checked && shotSelection.length > 1) {
    const primary = projectTransformTrajectory(authoring.document, shotPrimaryElementId);
    const current = primary.eligible ? primary.waypoints.find((point) => point.timeMs === shotMomentMs) : null;
    const viewport = shotViewportIntent();
    if (!current || !viewport) return null;
    return { kind: 'motion.transform-waypoints.translate', elementIds: [...shotSelection], momentMs: shotMomentMs,
      deltaXPpm: Math.round((nextPose.translateXMicrounits - current.pose.translateXMicrounits) / viewport.widthCssPixels),
      deltaYPpm: Math.round((nextPose.translateYMicrounits - current.pose.translateYMicrounits) / viewport.heightCssPixels), viewport };
  }
  const viewport = shotViewportIntent(); if (!viewport) return null;
  return { kind: 'motion.transform-pose.set', elementId: shotPrimaryElementId, momentMs: shotMomentMs,
    pose: nextPose, viewport };
}

type DirectPoseKind = 'move' | 'scale' | 'rotate';
type ShotPose = { translateXMicrounits: number; translateYMicrounits: number; scalePpm: number; rotateMicrodegrees: number };

function selectedShotPose(): { pose: ShotPose; target: { elementId: string; trackId: string; keyframeId: string; expectedTransform: string } } | null {
  if (!shotPrimaryElementId) return null;
  const selected = projectTrajectorySelection(authoring.document, [shotPrimaryElementId], shotMomentMs);
  const trajectory = projectTransformTrajectory(authoring.document, shotPrimaryElementId);
  if (!selected.eligible || !trajectory.eligible) return null;
  const waypoint = trajectory.waypoints.find((point) => point.timeMs === shotMomentMs);
  return waypoint ? { pose: { ...waypoint.pose }, target: selected.targets[0]! } : null;
}

function normalizeRotation(degrees: number): number {
  if (degrees === 180 || degrees === -180) return degrees;
  return ((degrees + 180) % 360 + 360) % 360 - 180;
}

function directPoseOperation(nextPose: ShotPose, kind: DirectPoseKind): AuthoringOperation | null {
  const selected = selectedShotPose(); const stage = shotStageProjection();
  if (!selected || !stage) return null;
  if (kind === 'move' && required<HTMLInputElement>('[data-move-together]').checked && shotSelection.length > 1) {
    return buildWaypointTranslateOperation(shotMomentMs, nextPose.translateXMicrounits, nextPose.translateYMicrounits);
  }
  return { ...operationEnvelope(), kind: 'motion.transform-pose.set', ...selected.target, payload: { pose: nextPose, stage } };
}

function beginDirectPoseGesture(event: PointerEvent, kind: DirectPoseKind): void {
  if (event.button !== 0 || !shotPrimaryElementId || !alignShotPreviewToMoment(shotMomentMs)) return;
  const selected = selectedShotPose(); const projection = readShotProjection();
  if (!selected || !projection) return;
  event.preventDefault(); const surface = event.currentTarget as HTMLButtonElement;
  surface.setPointerCapture(event.pointerId);
  const start = { clientX: event.clientX, clientY: event.clientY }; const startPose = selected.pose;
  const target = iframe.contentDocument?.querySelector<HTMLElement>(`[data-motion-id="${shotPrimaryElementId}"]`);
  const targetRect = target?.getBoundingClientRect(); const iframeRect = iframe.getBoundingClientRect();
  const center = targetRect ? { x: iframeRect.left + (targetRect.left + targetRect.width / 2) * projection.scaleX,
    y: iframeRect.top + (targetRect.top + targetRect.height / 2) * projection.scaleY } : { x: start.clientX, y: start.clientY };
  const startAngle = Math.atan2(event.clientY - center.y, event.clientX - center.x);
  const startRadius = Math.max(1, Math.hypot(event.clientX - center.x, event.clientY - center.y));
  const committedAtGestureStart = { html: compiled.html, css: compiled.css }; let latest: { operation: AuthoringOperation;
    intent: OperationIntentPayload; html: string; css: string } | null = null; let moved = false; let frame: number | null = null; let cancelled = false;
  const preview = () => { frame = null; const draft = latest; if (!draft || cancelled) return;
    void controller.applyCompilerCssDraft(draft.css).then(() => schedulePreviewSelection()).catch(() => undefined); };
  const move = (next: PointerEvent) => {
    const dx = (next.clientX - start.clientX) / projection.scaleX; const dy = (next.clientY - start.clientY) / projection.scaleY;
    moved ||= Math.abs(next.clientX - start.clientX) + Math.abs(next.clientY - start.clientY) > 1;
    if (!moved) return;
    let pose: ShotPose = { ...startPose };
    if (kind === 'move') pose = { ...pose, translateXMicrounits: startPose.translateXMicrounits + Math.round(dx * 1_000_000),
      translateYMicrounits: startPose.translateYMicrounits + Math.round(dy * 1_000_000) };
    if (kind === 'scale') pose = { ...pose, scalePpm: Math.round(Math.max(.25, Math.min(3, startPose.scalePpm / 1_000_000
      * Math.hypot(next.clientX - center.x, next.clientY - center.y) / startRadius)) * 1_000_000) };
    if (kind === 'rotate') pose = { ...pose, rotateMicrodegrees: Math.round(normalizeRotation(startPose.rotateMicrodegrees / 1_000_000
      + (Math.atan2(next.clientY - center.y, next.clientX - center.x) - startAngle) * 180 / Math.PI) * 1_000_000) };
    const operation = directPoseOperation(pose, kind); const intent = directPoseIntent(pose, kind); if (!operation || !intent) return;
    const reduced = dispatchAuthoringOperation(authoring, operation); if (!reduced.ok) return;
    const draft = compileMotionDocument(reduced.state.document); latest = { operation, intent, html: draft.html, css: draft.css };
    if (frame === null) frame = requestAnimationFrame(preview);
    shotStatus.value = `${kind} draft · release to commit or press Escape to cancel.`;
  };
  const cleanup = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', finish);
    window.removeEventListener('pointercancel', cancel); window.removeEventListener('keydown', escape);
    if (surface.hasPointerCapture(event.pointerId)) surface.releasePointerCapture(event.pointerId); if (frame !== null) cancelAnimationFrame(frame); };
  const cancel = () => { cancelled = true; cleanup(); latest = null; void controller.restoreCommittedCompilerCss().then(() => {
    shotStatus.value = `Draft cancelled · revision ${authoring.document.revision} unchanged.`; schedulePreviewSelection(); }); };
  const escape = (keyboard: KeyboardEvent) => { if (keyboard.key !== 'Escape') return; keyboard.preventDefault(); cancel(); };
  const finish = () => { cleanup(); const draft = latest; if (!moved || !draft) { latest = null; return; }
    void controller.applyCompilerCssDraft(draft.css).then(() => prepareAndDispatchIntent(draft.intent, undefined, undefined, {
      schemaVersion: 'motion.preview-css-commit-promotion.v1', oldCommittedHtml: committedAtGestureStart.html,
      oldCompilerCss: committedAtGestureStart.css, newCommittedHtml: draft.html, newCompilerCss: draft.css,
    })).then((result) => { shotStatus.value = result.ok ? `${kind} applied at revision ${authoring.document.revision}.` : `${result.code} · unchanged.`;
      renderShotWorkspace(); }).catch(async () => { await controller.restoreCommittedCompilerCss(); }); };
  window.addEventListener('pointermove', move); window.addEventListener('pointerup', finish, { once: true });
  window.addEventListener('pointercancel', cancel, { once: true }); window.addEventListener('keydown', escape);
}

async function handleDirectPoseKeyboard(event: KeyboardEvent, kind: 'body' | 'scale' | 'rotate'): Promise<void> {
  const selected = selectedShotPose(); if (!selected) return;
  if ((event.key === 'Enter' || event.key === ' ') && kind !== 'body') {
    event.preventDefault(); const value = kind === 'scale' ? `${selected.pose.scalePpm / 1_000_000} uniform scale`
      : `${selected.pose.rotateMicrodegrees / 1_000_000} degrees rotation`; shotStatus.value = value; return;
  }
  const arrows = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'];
  if (!arrows.includes(event.key) && !(kind === 'rotate' && ['Home', 'End'].includes(event.key))) return;
  event.preventDefault(); const pose = { ...selected.pose }; let operationKind: DirectPoseKind = kind === 'body' ? 'move' : kind;
  if (kind === 'body' && event.altKey) operationKind = event.key === 'ArrowUp' || event.key === 'ArrowDown' ? 'scale' : 'rotate';
  if (operationKind === 'move') { const step = (event.shiftKey ? 10 : 1) * 1_000_000;
    if (event.key === 'ArrowLeft') pose.translateXMicrounits -= step; if (event.key === 'ArrowRight') pose.translateXMicrounits += step;
    if (event.key === 'ArrowUp') pose.translateYMicrounits -= step; if (event.key === 'ArrowDown') pose.translateYMicrounits += step; }
  if (operationKind === 'scale') { const step = (event.shiftKey ? .25 : .05) * 1_000_000;
    const increase = event.key === 'ArrowUp' || event.key === 'ArrowRight'; pose.scalePpm = Math.round(Math.max(250_000, Math.min(3_000_000, pose.scalePpm + (increase ? step : -step)))); }
  if (operationKind === 'rotate') { const step = event.shiftKey ? 15 : 1; const current = pose.rotateMicrodegrees / 1_000_000;
    const next = event.key === 'Home' ? -180 : event.key === 'End' ? 180 : normalizeRotation(current + (event.key === 'ArrowRight' || event.key === 'ArrowUp' ? step : -step));
    pose.rotateMicrodegrees = Math.round(next * 1_000_000); }
  const intent = directPoseIntent(pose, operationKind); if (!intent) return;
  const result = await prepareAndDispatchIntent(intent); shotStatus.value = result.ok ? `${operationKind} applied at revision ${authoring.document.revision}.` : `${result.code} · unchanged.`;
  renderShotWorkspace(); (event.currentTarget as HTMLElement).focus({ preventScroll: true });
}

async function applyShotPose(): Promise<void> {
  if (!shotConfig || !shotPrimaryElementId) return; const primary = shotPrimaryElementId;
  const selected = projectTrajectorySelection(authoring.document, [primary], shotMomentMs);
  if (!selected.eligible) { shotStatus.value = selected.code ?? 'TRAJECTORY_SELECTION_INVALID'; return; }
  const controls = shotPoseForm.elements as unknown as Record<string, HTMLInputElement>;
  const nextPose = { translateXMicrounits: Math.round(Number(controls.x!.value) * 1_000_000),
    translateYMicrounits: Math.round(Number(controls.y!.value) * 1_000_000),
    scalePpm: Math.round(Number(controls.scale!.value) * 1_000_000),
    rotateMicrodegrees: Math.round(Number(controls.rotate!.value) * 1_000_000) };
  const intent = directPoseIntent(nextPose, 'move'); if (!intent) { shotStatus.value = 'TRAJECTORY_SELECTION_INVALID · unchanged.'; return; }
  const result = await prepareAndDispatchIntent(intent); shotStatus.value = result.ok ? `Pose applied at revision ${authoring.document.revision}.` : `${result.code} · unchanged.`; renderShotWorkspace();
}

function buildWaypointTranslateOperation(momentMs: number, nextXMicrounits: number, nextYMicrounits: number): AuthoringOperation | null {
  const selected = projectTrajectorySelection(authoring.document, shotSelection, momentMs);
  if (!selected.eligible) { shotStatus.value = selected.code ?? 'TRAJECTORY_SELECTION_INVALID'; return null; }
  const primary = projectTransformTrajectory(authoring.document, shotPrimaryElementId!);
  if (!primary.eligible) { shotStatus.value = primary.code; return null; }
  const current = primary.waypoints.find((point) => point.timeMs === momentMs);
  if (!current) { shotStatus.value = 'TRAJECTORY_MOMENT_MISSING'; return null; }
  const stage = shotStageProjection(); if (!stage) { shotStatus.value = 'TRAJECTORY_STAGE_INVALID'; return null; }
  const deltaXPpm = Math.round((nextXMicrounits - current.pose.translateXMicrounits) * 1_000_000 / stage.widthMicrounits);
  const deltaYPpm = Math.round((nextYMicrounits - current.pose.translateYMicrounits) * 1_000_000 / stage.heightMicrounits);
  if (!Number.isSafeInteger(stage.widthMicrounits * deltaXPpm / 1_000_000)
    || !Number.isSafeInteger(stage.heightMicrounits * deltaYPpm / 1_000_000)) {
    shotStatus.value = 'AUTHORING_TRAJECTORY_PRECISION_INVALID'; return null;
  }
  return { ...operationEnvelope(), kind: 'motion.transform-waypoints.translate', payload: { targets: selected.targets,
    deltaXPpm, deltaYPpm, stage } };
}

function beginWaypointDrag(event: PointerEvent, momentMs: number): void {
  if (event.button !== 0 || shotMode !== 'path' || !alignShotPreviewToMoment(momentMs)) return;
  shotMomentMs = momentMs; renderShotWorkspace();
  const primaryElementId = shotPrimaryElementId!;
  const primary = projectTransformTrajectory(authoring.document, primaryElementId); if (!primary.eligible) return;
  const current = primary.waypoints.find((point) => point.timeMs === momentMs); if (!current) return;
  const editTogether = required<HTMLInputElement>('[data-move-together]').checked && shotSelection.length > 1;
  const selected = projectTrajectorySelection(authoring.document, editTogether ? [...shotSelection] : [primaryElementId], momentMs);
  if (!selected.eligible) return;
  const stage = shotStageProjection(); if (!stage) return;
  const projection = readShotProjection(); if (!projection) return;
  const committedAtGestureStart = { html: compiled.html, css: compiled.css };
  const gestureGeneration = ++waypointGestureGeneration;
  waypointReleasePhase = 'idle';
  activeWaypointDraft = null; waypointDraftMoveCount = 0; waypointDraftAppliedCount = 0; waypointDraftFailure = null;
  if (waypointDraftFrame !== null) { cancelAnimationFrame(waypointDraftFrame); waypointDraftFrame = null; }
  const envelope = operationEnvelope();
  event.preventDefault(); const surface = event.currentTarget as HTMLButtonElement; surface.setPointerCapture(event.pointerId);
  const feedbackHandle = surface.matches('[data-keyframe-id]') ? surface
    : shotOverlay.querySelector<HTMLElement>(`[data-element-id="${primaryElementId}"][data-time-ms="${momentMs}"]`);
  const start = { clientX: event.clientX, clientY: event.clientY }; let moved = false;
  const move = (next: PointerEvent) => {
    let deltaXPpm: number; let deltaYPpm: number;
    try { ({ deltaXPpm, deltaYPpm } = previewPointerDeltaToPpm(projection, start, { clientX: next.clientX, clientY: next.clientY })); }
    catch { shotStatus.value = `PREVIEW_POINTER_INVERSE_INVALID · revision ${authoring.document.revision} unchanged.`; return; }
    const candidate: AuthoringOperation = { ...envelope, kind: 'motion.transform-waypoints.translate', payload: {
      targets: selected.targets, deltaXPpm, deltaYPpm, stage } };
    moved ||= Math.abs(next.clientX - start.clientX) + Math.abs(next.clientY - start.clientY) > 1;
    if (moved) { surface.dataset.dragged = 'true'; if (feedbackHandle) feedbackHandle.style.translate = `${next.clientX - start.clientX}px ${next.clientY - start.clientY}px`;
      refreshTrajectorySegments(); }
    if (!moved || !Number.isSafeInteger(stage.widthMicrounits * deltaXPpm / 1_000_000)
      || !Number.isSafeInteger(stage.heightMicrounits * deltaYPpm / 1_000_000)) return;
    const reduced = dispatchAuthoringOperation(authoring, candidate); if (!reduced.ok) return;
    let draftCompiled;
    try { draftCompiled = compileMotionDocument(reduced.state.document); } catch { return; }
    const intent: OperationIntentPayload = { kind: 'motion.transform-waypoints.translate',
      elementIds: (editTogether ? [...shotSelection] : [primaryElementId]), momentMs, deltaXPpm, deltaYPpm,
      viewport: { widthCssPixels: projection.sourceWidthCssPixels, heightCssPixels: projection.sourceHeightCssPixels } };
    const nextDraft = { operation: candidate, intent, commandBytes: canonicalJson(makeTrajectoryCommand(candidate as Parameters<typeof makeTrajectoryCommand>[0], activeBranchId)),
      compiledHtml: draftCompiled.html, compiledCss: draftCompiled.css, exportDigest: draftCompiled.exportDigest };
    activeWaypointDraft = nextDraft; waypointDraftMoveCount += 1;
    if (waypointDraftFrame === null) waypointDraftFrame = requestAnimationFrame(() => {
      waypointDraftFrame = null; const frameDraft = activeWaypointDraft;
      waypointDraftApply = waypointDraftApply.then(async () => {
        if (!frameDraft || gestureGeneration !== waypointGestureGeneration || activeWaypointDraft !== frameDraft) return;
        await controller.applyCompilerCssDraft(frameDraft.compiledCss); waypointDraftAppliedCount += 1;
      }).catch(async (error: unknown) => {
        waypointDraftFailure = error instanceof Error ? error.message : 'PREVIEW_DRAFT_INVALID'; activeWaypointDraft = null;
        await controller.restoreCommittedCompilerCss();
        shotStatus.value = `${waypointDraftFailure} · revision ${authoring.document.revision} unchanged.`;
      });
    });
    shotStatus.value = `Trajectory draft · ${primaryElementId}/${current.keyframeId} · release to commit or press Escape to cancel.`;
  };
  const cancelDraftFrame = () => { if (waypointDraftFrame !== null) { cancelAnimationFrame(waypointDraftFrame); waypointDraftFrame = null; } };
  const clearTerminalFeedback = () => { if (feedbackHandle) feedbackHandle.style.translate = ''; refreshTrajectorySegments();
    queueMicrotask(() => { delete surface.dataset.dragged; }); };
  const detachGesture = (retainTerminalFeedback: boolean) => {
    window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', finish);
    window.removeEventListener('pointercancel', cancelPointer); window.removeEventListener('keydown', cancelKeyboard);
    if (surface.hasPointerCapture(event.pointerId)) surface.releasePointerCapture(event.pointerId);
    if (!retainTerminalFeedback) clearTerminalFeedback();
  };
  const restoreCommitted = () => { const cancelGeneration = ++waypointGestureGeneration; cancelDraftFrame(); activeWaypointDraft = null;
    void waypointDraftApply.then(async () => { if (cancelGeneration !== waypointGestureGeneration) return;
      await controller.restoreCommittedCompilerCss(); schedulePreviewSelection();
      waypointReleasePhase = 'idle'; shotStatus.value = `Draft cancelled · revision ${authoring.document.revision} unchanged.`; }); };
  const finish = () => { const releasedDraft = activeWaypointDraft; detachGesture(Boolean(moved && releasedDraft));
    const releaseGeneration = ++waypointGestureGeneration; cancelDraftFrame();
    if (moved && releasedDraft) {
      waypointReleasePhase = 'flushing-latest';
      waypointDraftApply = waypointDraftApply.then(async () => {
        if (releaseGeneration !== waypointGestureGeneration) return;
        await controller.applyCompilerCssDraft(releasedDraft.compiledCss); waypointDraftAppliedCount += 1;
      });
      void waypointDraftApply.then(async () => {
        if (releaseGeneration !== waypointGestureGeneration || waypointDraftFailure) return;
        waypointReleasePhase = 'committing';
        const result = await prepareAndDispatchIntent(releasedDraft.intent, undefined, undefined, {
          schemaVersion: 'motion.preview-css-commit-promotion.v1', oldCommittedHtml: committedAtGestureStart.html,
          oldCompilerCss: committedAtGestureStart.css, newCommittedHtml: releasedDraft.compiledHtml,
          newCompilerCss: releasedDraft.compiledCss,
        });
        if (!result.ok) await controller.restoreCommittedCompilerCss();
        else { waypointReleasePhase = 'publishing-geometry'; await awaitShotGeometryCommit(); }
      }).catch(async (error: unknown) => {
        waypointDraftFailure = error instanceof Error ? error.message : 'PREVIEW_DRAFT_INVALID';
        await controller.restoreCommittedCompilerCss();
        shotStatus.value = `${waypointDraftFailure} · revision ${authoring.document.revision} unchanged.`;
      }).finally(() => { if (releaseGeneration === waypointGestureGeneration) activeWaypointDraft = null;
        waypointReleasePhase = 'idle'; clearTerminalFeedback(); });
    } else if (moved) { restoreCommitted(); }
    else { waypointReleasePhase = 'idle'; activeWaypointDraft = null; }
  };
  const cancelPointer = () => { detachGesture(false); restoreCommitted(); };
  const cancelKeyboard = (keyboard: KeyboardEvent) => { if (keyboard.key !== 'Escape') return; keyboard.preventDefault(); detachGesture(false); restoreCommitted(); };
  window.addEventListener('pointermove', move); window.addEventListener('pointerup', finish, { once: true }); window.addEventListener('pointercancel', cancelPointer, { once: true }); window.addEventListener('keydown', cancelKeyboard);
}

async function addShotMoment(beforeMs: number, afterMs: number): Promise<void> {
  if (!shotConfig || !shotPrimaryElementId) return;
  const timeMs = Math.floor((beforeMs + afterMs) / 2);
  if (!(beforeMs < timeMs && timeMs < afterMs)) return;
  const editTogether = required<HTMLInputElement>('[data-move-together]').checked;
  const intent: OperationIntentPayload = { kind: 'motion.transform-waypoint.add',
    elementIds: editTogether ? [...shotConfig.targetElementIds] : [shotPrimaryElementId], timeMs };
  const result = await prepareAndDispatchIntent(intent);
  if (result.ok) { shotMomentMs = timeMs; alignShotPreviewToMoment(timeMs); }
  shotStatus.value = result.ok ? `Point added at ${timeMs} ms · revision ${authoring.document.revision}.`
    : `${result.code} · no point added.`;
  renderShotWorkspace();
  if (result.ok) focusShotMoment(timeMs);
}

async function removeShotMoment(): Promise<void> {
  if (!shotConfig || !shotPrimaryElementId || shotMomentMs === shotConfig.startMs || shotMomentMs === shotConfig.settledMs) return;
  const inventory = canonicalShotInventory()?.find((candidate) => candidate.elementId === shotPrimaryElementId);
  const previous = inventory?.waypoints.filter((point) => point.timeMs < shotMomentMs).at(-1)?.timeMs ?? shotConfig.startMs;
  const removing = shotMomentMs;
  const editTogether = required<HTMLInputElement>('[data-move-together]').checked;
  const intent: OperationIntentPayload = { kind: 'motion.transform-waypoint.remove',
    elementIds: editTogether ? [...shotConfig.targetElementIds] : [shotPrimaryElementId], timeMs: removing };
  const result = await prepareAndDispatchIntent(intent);
  if (result.ok) { shotMomentMs = previous; alignShotPreviewToMoment(previous); }
  shotStatus.value = result.ok ? `Point removed · revision ${authoring.document.revision}.` : `${result.code} · unchanged.`;
  renderShotWorkspace();
  if (result.ok) focusShotMoment(previous);
}

async function applyShotMomentTime(targetTimeMs: number): Promise<void> {
  const config = shotConfig;
  if (!config || shotMomentMs === config.startMs || shotMomentMs === config.settledMs
    || !Number.isSafeInteger(targetTimeMs) || targetTimeMs === shotMomentMs) return;
  const sourceTimeMs = shotMomentMs;
  const inventory = canonicalShotInventory()?.find((candidate) => candidate.elementId === shotPrimaryElementId);
  const intermediate = inventory?.waypoints.map((point) => point.timeMs)
    .filter((timeMs) => timeMs > config.startMs && timeMs < config.settledMs) ?? [];
  const landingTimeMs = Math.min(targetTimeMs, ...intermediate.filter((timeMs) => timeMs !== sourceTimeMs));
  const editTogether = required<HTMLInputElement>('[data-move-together]').checked;
  const intent: OperationIntentPayload = { kind: 'motion.keyframe-group-time.set',
    elementIds: editTogether ? [...config.targetElementIds] : shotPrimaryElementId ? [shotPrimaryElementId] : [],
    sourceTimeMs, targetTimeMs, landingTimeMs, settledTimeMs: config.settledMs };
  const result = await prepareAndDispatchIntent(intent);
  if (result.ok) { shotMomentMs = targetTimeMs; alignShotPreviewToMoment(targetTimeMs); }
  shotStatus.value = result.ok ? `Point moved to ${targetTimeMs} ms · revision ${authoring.document.revision}.`
    : `${result.code} · timing unchanged.`;
  renderShotWorkspace();
}

function effectiveShotTimings(targets: Array<{ trackId: string; elementId: string; keyframeId: string; expectedTransform: string }>): Array<TimingFunction> | null {
  const effectiveTimings = targets.map((target): TimingFunction | null => {
    const track = authoring.document.tracks.find((item) => item.id === target.trackId && item.elementId === target.elementId && item.property === 'transform');
    const rule = track && authoring.document.rules.find((item) => item.id === track.ruleId);
    const ruleTrack = rule?.tracks.find((item) => item.property === 'transform');
    const keyframe = ruleTrack?.keyframes.find((item) => item.id === target.keyframeId && item.value === target.expectedTransform);
    const application = track && authoring.document.applications.find((item) => item.slots.some((slot) => slot.id === track.slotId));
    const slotIndex = application?.slots.findIndex((slot) => slot.id === track?.slotId) ?? -1;
    const slot = application?.slots[slotIndex];
    const binding = application?.bindings.find((item) => item.elementId === target.elementId);
    if (!track || !ruleTrack || !keyframe || !application || !slot || binding?.delayOverridesMs[slotIndex] === undefined) return null;
    return keyframe.easing ?? slot.timingFunction;
  });
  return effectiveTimings.some((timing) => timing === null) ? null : effectiveTimings as Array<TimingFunction>;
}

async function applyShotEasing(): Promise<void> {
  if (!shotConfig || shotMomentMs === shotConfig.settledMs) return;
  const editTogether = required<HTMLInputElement>('[data-move-together]').checked;
  const elementIds = editTogether ? shotConfig.targetElementIds : shotPrimaryElementId ? [shotPrimaryElementId] : [];
  const selected = projectTrajectorySelection(authoring.document, elementIds, shotMomentMs);
  if (!selected.eligible) { shotStatus.value = selected.code ?? 'TRAJECTORY_SELECTION_INVALID'; return; }
  const effectiveTimings = effectiveShotTimings(selected.targets);
  if (!effectiveTimings) { shotStatus.value = 'AUTHORING_TRAJECTORY_EASING_MISSING · unchanged.'; return; }
  const expectedEasing = effectiveTimings[0]!;
  if (effectiveTimings.some((timing) => canonicalJson(timing) !== canonicalJson(expectedEasing))) {
    shotStatus.value = 'AUTHORING_TRAJECTORY_EASING_NON_UNIFORM · unchanged.'; return;
  }
  const draft = required<HTMLSelectElement>('[data-shot-easing]').value;
  if (draft === 'custom') { shotStatus.value = 'Choose an easing preset to replace the source curve.'; return; }
  const value = draft as 'linear' | 'ease' | 'ease-in' | 'ease-out' | 'ease-in-out';
  const intent: OperationIntentPayload = { kind: 'motion.keyframe-group-easing.set', elementIds: [...elementIds],
    momentMs: shotMomentMs, expectedEasing, easing: { kind: 'keyword', value } };
  const result = await prepareAndDispatchIntent(intent);
  shotStatus.value = result.ok ? `Movement after ${shotMomentLabel(shotMomentMs)} updated · revision ${authoring.document.revision}.`
    : `${result.code} · unchanged.`; renderShotWorkspace();
}

async function applyShotHold(): Promise<void> {
  const config = shotConfig;
  if (!config) return;
  const settledInput = required<HTMLInputElement>('[data-shot-settled]');
  const settled = Number(settledInput.value);
  if (!Number.isSafeInteger(settled) || settled <= 1 || settled >= config.settledMs) {
    settledInput.setAttribute('aria-invalid', 'true'); settledInput.focus();
    shotStatus.value = `Hold must begin between 2 and ${config.settledMs - 1} ms · unchanged.`; return;
  }
  const inventory = canonicalShotInventory()?.[0];
  const landing = inventory?.waypoints.map((point) => point.timeMs)
    .filter((timeMs) => timeMs > config.startMs && timeMs < settled).at(-1) ?? config.landedMs;
  const selected = projectTrajectorySelection(authoring.document, config.targetElementIds, 2100); if (!selected.eligible) { shotStatus.value = selected.code ?? 'TRAJECTORY_SELECTION_INVALID'; return; }
  const intent: OperationIntentPayload = { kind: 'motion.settled-hold.set', elementIds: [...config.targetElementIds],
    sourceTimeMs: 2100, settledTimeMs: settled, landingTimeMs: landing, boundaryTimeMs: 2100 };
  const result = await prepareAndDispatchIntent(intent);
  shotStatus.value = result.ok ? `Settled hold applied at revision ${authoring.document.revision}.` : `${result.code} · unchanged.`; renderShotWorkspace();
}

function required<T extends Element = HTMLElement>(selector: string, root: ParentNode = document): T {
  const element = root.querySelector<T>(selector);
  if (!element) throw new Error('EDITOR_ELEMENT_MISSING');
  return element;
}
