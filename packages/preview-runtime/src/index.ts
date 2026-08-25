import { classifyAnimatedProperty, normalizeCssTimingFunction, projectTransformTrajectory, type MotionCue, type MotionDocument, type MotionHold, type TimingFunction } from '../../domain/src/index.js';

export const previewOverlayProjectionSchemaVersion = 'motion.preview-overlay-projection.v1' as const;

export type ProjectionRect = { left: number; top: number; right: number; bottom: number; width: number; height: number };

export type PreviewOverlayProjection = {
  schemaVersion: typeof previewOverlayProjectionSchemaVersion;
  sourceWidthCssPixels: number;
  sourceHeightCssPixels: number;
  displayLeft: number;
  displayTop: number;
  displayWidth: number;
  displayHeight: number;
  scaleX: number;
  scaleY: number;
  devicePixelRatio: number;
};

export type PreviewOverlayProjectionResult =
  | { ok: true; projection: PreviewOverlayProjection }
  | { ok: false; code: 'PREVIEW_SOURCE_SIZE_INVALID' | 'PREVIEW_PROJECTION_INVALID' | 'PREVIEW_PROJECTION_NON_UNIFORM' | 'PREVIEW_OVERLAY_EDGE_MISMATCH' };

export function createPreviewOverlayProjection(input: {
  sourceWidthCssPixels: number;
  sourceHeightCssPixels: number;
  iframeRect: ProjectionRect;
  overlayRect: ProjectionRect;
  devicePixelRatio: number;
}): PreviewOverlayProjectionResult {
  const { sourceWidthCssPixels, sourceHeightCssPixels, iframeRect, overlayRect, devicePixelRatio } = input;
  if (!Number.isSafeInteger(sourceWidthCssPixels) || sourceWidthCssPixels <= 0
    || !Number.isSafeInteger(sourceHeightCssPixels) || sourceHeightCssPixels <= 0) {
    return { ok: false, code: 'PREVIEW_SOURCE_SIZE_INVALID' };
  }
  const values = [iframeRect.left, iframeRect.top, iframeRect.right, iframeRect.bottom, iframeRect.width, iframeRect.height,
    overlayRect.left, overlayRect.top, overlayRect.right, overlayRect.bottom, overlayRect.width, overlayRect.height, devicePixelRatio];
  if (!values.every(Number.isFinite) || iframeRect.width <= 0 || iframeRect.height <= 0 || devicePixelRatio <= 0) {
    return { ok: false, code: 'PREVIEW_PROJECTION_INVALID' };
  }
  const edgeDeltaDevicePixels = Math.max(Math.abs(iframeRect.left - overlayRect.left), Math.abs(iframeRect.top - overlayRect.top),
    Math.abs(iframeRect.right - overlayRect.right), Math.abs(iframeRect.bottom - overlayRect.bottom)) * devicePixelRatio;
  if (edgeDeltaDevicePixels > 1) return { ok: false, code: 'PREVIEW_OVERLAY_EDGE_MISMATCH' };
  const scaleX = iframeRect.width / sourceWidthCssPixels;
  const scaleY = iframeRect.height / sourceHeightCssPixels;
  if (!Number.isFinite(scaleX) || !Number.isFinite(scaleY) || scaleX <= 0 || scaleY <= 0) {
    return { ok: false, code: 'PREVIEW_PROJECTION_INVALID' };
  }
  const nonUniformDevicePixels = Math.max(sourceWidthCssPixels, sourceHeightCssPixels) * Math.abs(scaleX - scaleY) * devicePixelRatio;
  if (nonUniformDevicePixels > 1) return { ok: false, code: 'PREVIEW_PROJECTION_NON_UNIFORM' };
  return { ok: true, projection: { schemaVersion: previewOverlayProjectionSchemaVersion, sourceWidthCssPixels,
    sourceHeightCssPixels, displayLeft: iframeRect.left, displayTop: iframeRect.top, displayWidth: iframeRect.width,
    displayHeight: iframeRect.height, scaleX, scaleY, devicePixelRatio } };
}

export function projectContentBounds(projection: PreviewOverlayProjection, bounds: ProjectionRect): ProjectionRect {
  const left = projection.displayLeft + bounds.left * projection.scaleX;
  const top = projection.displayTop + bounds.top * projection.scaleY;
  const right = projection.displayLeft + bounds.right * projection.scaleX;
  const bottom = projection.displayTop + bounds.bottom * projection.scaleY;
  return { left, top, right, bottom, width: right - left, height: bottom - top };
}

export function invertPreviewClientPoint(projection: PreviewOverlayProjection, point: { clientX: number; clientY: number }) {
  const x = (point.clientX - projection.displayLeft) / projection.scaleX;
  const y = (point.clientY - projection.displayTop) / projection.scaleY;
  if (![x, y].every(Number.isFinite)) throw new Error('PREVIEW_POINTER_INVERSE_INVALID');
  return { x, y };
}

export function previewPointerDeltaToPpm(projection: PreviewOverlayProjection, start: { clientX: number; clientY: number }, end: { clientX: number; clientY: number }) {
  const sourceStart = invertPreviewClientPoint(projection, start);
  const sourceEnd = invertPreviewClientPoint(projection, end);
  const deltaXPpm = Math.round((sourceEnd.x - sourceStart.x) * 1_000_000 / projection.sourceWidthCssPixels);
  const deltaYPpm = Math.round((sourceEnd.y - sourceStart.y) * 1_000_000 / projection.sourceHeightCssPixels);
  if (!Number.isSafeInteger(deltaXPpm) || !Number.isSafeInteger(deltaYPpm)) throw new Error('PREVIEW_POINTER_INVERSE_INVALID');
  return { deltaXPpm, deltaYPpm };
}

export function projectTrajectoryOverlay(document: MotionDocument, elementId: string, stage: { widthMicrounits: number; heightMicrounits: number }) {
  const trajectory = projectTransformTrajectory(document, elementId);
  if (!trajectory.eligible) return trajectory;
  if (!Number.isSafeInteger(stage.widthMicrounits) || stage.widthMicrounits <= 0 || !Number.isSafeInteger(stage.heightMicrounits) || stage.heightMicrounits <= 0) return { eligible: false as const, elementId, code: 'TRAJECTORY_STAGE_INVALID' };
  return { ...trajectory, waypoints: trajectory.waypoints.map((point) => ({ ...point,
    xPpm: Math.round(point.pose.translateXMicrounits * 1_000_000 / stage.widthMicrounits),
    yPpm: Math.round(point.pose.translateYMicrounits * 1_000_000 / stage.heightMicrounits) })) };
}

export type TimelineCue = MotionCue;

export type TimelineRow = {
  trackId: string;
  elementId: string;
  property: string;
  ruleId: string;
  applicationId: string;
  activeSlotId: string;
  delayMs: number;
  interpolation: 'continuous' | 'discrete' | 'step';
  timing: TimingFunction;
  orderedSlotIds: string[];
  keyframes: Array<{
    id: string;
    offset: number;
    value: string;
    easing: TimingFunction | null;
    timeMs: number;
  }>;
};

export type TimelineModel = {
  schemaVersion: 'motion.timeline-projection.v1';
  durationMs: number;
  rows: TimelineRow[];
  cues: TimelineCue[];
  holds?: MotionHold[];
  reducedMotion: MotionDocument['reducedMotion'];
};

export type PreviewState = {
  playheadMs: number;
  currentTimes: Array<number | null>;
  playStates: AnimationPlayState[];
};

export type PreviewCssCommitPromotion = {
  schemaVersion: 'motion.preview-css-commit-promotion.v1';
  oldCommittedHtml: string;
  oldCompilerCss: string;
  newCommittedHtml: string;
  newCompilerCss: string;
};

export class NativePreviewController {
  readonly iframe: HTMLIFrameElement;
  #animations: Animation[] = [];
  #playheadMs = 0;
  #sourceSize: { widthCssPixels: number; heightCssPixels: number } | null = null;
  #nativeStateGeneration = 0;
  #compilerStyle: HTMLStyleElement | null = null;
  #committedDocument: Document | null = null;
  #committedHtml: string | null = null;
  #lastNavigationSourceHtml: string | null = null;
  #committedCompilerCss: string | null = null;
  #activeCompilerCss: string | null = null;
  #draftApplicationCount = 0;
  #nativeStateHandoffBusy = false;
  #nativeStateHandoffWaiters: Array<() => void> = [];
  #nativeStateOwner: 'idle' | 'geometry' | 'replacement' | 'promotion' = 'idle';

  constructor(iframe: HTMLIFrameElement) {
    this.iframe = iframe;
  }

  async mount(compiledHtml: string, compilerCss: string): Promise<void> {
    this.#nativeStateGeneration += 1;
    this.iframe.setAttribute('sandbox', 'allow-same-origin');
    await new Promise<void>((resolve) => {
      this.iframe.addEventListener('load', () => resolve(), { once: true });
      this.#lastNavigationSourceHtml = compiledHtml;
      this.iframe.srcdoc = compiledHtml;
    });
    const frameDocument = this.iframe.contentDocument;
    if (!frameDocument) throw new Error('PREVIEW_DOCUMENT_UNAVAILABLE');
    await frameDocument.fonts.ready;
    const compilerStyleText = `\n${compilerCss}`;
    const compilerStyles = [...frameDocument.querySelectorAll<HTMLStyleElement>('style')]
      .filter((style) => style.textContent === compilerStyleText);
    if (compilerStyles.length !== 1) throw new Error('PREVIEW_COMPILER_STYLESHEET_BINDING_INVALID');
    this.#compilerStyle = compilerStyles[0]!; this.#committedDocument = frameDocument; this.#committedHtml = compiledHtml;
    this.#committedCompilerCss = compilerCss; this.#activeCompilerCss = compilerCss;
    this.#draftApplicationCount = 0;
    const widthCssPixels = Math.max(frameDocument.documentElement.scrollWidth, frameDocument.body?.scrollWidth ?? 0);
    const heightCssPixels = Math.max(frameDocument.documentElement.scrollHeight, frameDocument.body?.scrollHeight ?? 0);
    if (!Number.isSafeInteger(widthCssPixels) || widthCssPixels <= 0
      || !Number.isSafeInteger(heightCssPixels) || heightCssPixels <= 0) throw new Error('PREVIEW_SOURCE_SIZE_INVALID');
    this.#sourceSize = { widthCssPixels, heightCssPixels };
    this.iframe.width = String(widthCssPixels); this.iframe.height = String(heightCssPixels);
    this.iframe.style.width = `${widthCssPixels}px`; this.iframe.style.height = `${heightCssPixels}px`;
    this.#animations = frameDocument.getAnimations();
    if (this.#animations.some((animation) => animation.constructor.name !== 'CSSAnimation'
      || animation.effect?.constructor.name !== 'KeyframeEffect'
      || animation.timeline?.constructor.name !== 'DocumentTimeline')) {
      this.#animations = [];
      throw new Error('PREVIEW_ANIMATION_UNSUPPORTED');
    }
    this.scrub(0);
  }

  async applyCompilerCssDraft(compilerCss: string): Promise<void> {
    if (!this.#compilerStyle || this.#committedCompilerCss === null || this.#activeCompilerCss === null) {
      throw new Error('PREVIEW_COMPILER_STYLESHEET_UNAVAILABLE');
    }
    await this.#replaceCompilerCss(compilerCss);
    this.#draftApplicationCount += 1;
  }

  async restoreCommittedCompilerCss(): Promise<void> {
    if (this.#committedCompilerCss === null) throw new Error('PREVIEW_COMPILER_STYLESHEET_UNAVAILABLE');
    if (this.#activeCompilerCss !== this.#committedCompilerCss) await this.#replaceCompilerCss(this.#committedCompilerCss);
  }

  async promoteCompilerCssCommit(input: PreviewCssCommitPromotion): Promise<{ schemaVersion: 'motion.preview-css-commit-promotion.v1'; promoted: true }> {
    return this.#withNativeStateHandoff('promotion', () => this.#promoteCompilerCssCommit(input));
  }

  async #promoteCompilerCssCommit(input: PreviewCssCommitPromotion): Promise<{ schemaVersion: 'motion.preview-css-commit-promotion.v1'; promoted: true }> {
    if (input.schemaVersion !== 'motion.preview-css-commit-promotion.v1') throw new Error('PREVIEW_CSS_COMMIT_PROMOTION_INVALID');
    const frameDocument = this.iframe.contentDocument; const style = this.#compilerStyle;
    if (!frameDocument || !style || !style.isConnected || frameDocument !== this.#committedDocument) {
      throw new Error('PREVIEW_CSS_COMMIT_PROMOTION_DOCUMENT_CHANGED');
    }
    if (this.#committedHtml === null || this.#committedCompilerCss === null || this.#activeCompilerCss === null
      || input.oldCommittedHtml !== this.#committedHtml || input.oldCompilerCss !== this.#committedCompilerCss
      || input.newCompilerCss !== this.#activeCompilerCss || input.newCompilerCss === input.oldCompilerCss) {
      throw new Error('PREVIEW_CSS_COMMIT_PROMOTION_STALE');
    }
    const oldSegment = `\n${input.oldCompilerCss}`; const newSegment = `\n${input.newCompilerCss}`;
    const oldIndex = input.oldCommittedHtml.indexOf(oldSegment);
    if (oldIndex < 0 || input.oldCommittedHtml.indexOf(oldSegment, oldIndex + oldSegment.length) >= 0) {
      throw new Error('PREVIEW_CSS_COMMIT_PROMOTION_AMBIGUOUS');
    }
    const promotedHtml = `${input.oldCommittedHtml.slice(0, oldIndex)}${newSegment}${input.oldCommittedHtml.slice(oldIndex + oldSegment.length)}`;
    const newIndex = input.newCommittedHtml.indexOf(newSegment);
    if (promotedHtml !== input.newCommittedHtml || newIndex < 0
      || input.newCommittedHtml.indexOf(newSegment, newIndex + newSegment.length) >= 0) {
      throw new Error('PREVIEW_CSS_COMMIT_PROMOTION_STRUCTURAL');
    }
    const exactLiveStyles = [...frameDocument.querySelectorAll<HTMLStyleElement>('style')]
      .filter((candidate) => candidate.textContent === newSegment);
    if (exactLiveStyles.length !== 1 || exactLiveStyles[0] !== style) throw new Error('PREVIEW_CSS_COMMIT_PROMOTION_LIVE_MISMATCH');
    if (this.#animations.length === 0 || this.#animations.some((animation) => animation.constructor.name !== 'CSSAnimation'
      || animation.effect?.constructor.name !== 'KeyframeEffect' || animation.timeline?.constructor.name !== 'DocumentTimeline')) {
      throw new Error('PREVIEW_ANIMATION_UNSUPPORTED');
    }
    const prior = this.#animations.map((animation) => ({ currentTime: animation.currentTime, playState: animation.playState }));
    await Promise.all(this.#animations.map((animation) => animation.ready));
    if (this.iframe.contentDocument !== frameDocument || this.#compilerStyle !== style
      || this.#animations.some((animation, index) => animation.playState !== prior[index]!.playState
        || (prior[index]!.playState !== 'running' && animation.currentTime !== prior[index]!.currentTime))) {
      throw new Error('PREVIEW_NATIVE_STATE_RESTORE_INEXACT');
    }
    this.#committedHtml = input.newCommittedHtml; this.#committedCompilerCss = input.newCompilerCss;
    return { schemaVersion: 'motion.preview-css-commit-promotion.v1', promoted: true };
  }

  readCompilerDraftState(): { active: boolean; applicationCount: number } {
    return { active: this.#committedCompilerCss !== null && this.#activeCompilerCss !== this.#committedCompilerCss,
      applicationCount: this.#draftApplicationCount };
  }

  readCompilerCommitState(): { committedHtml: string | null; lastNavigationSourceHtml: string | null;
    committedCompilerCss: string | null; activeCompilerCss: string | null; navigationSourceMatchesCommitted: boolean } {
    return { committedHtml: this.#committedHtml, lastNavigationSourceHtml: this.#lastNavigationSourceHtml,
      committedCompilerCss: this.#committedCompilerCss, activeCompilerCss: this.#activeCompilerCss,
      navigationSourceMatchesCommitted: this.#committedHtml !== null && this.#lastNavigationSourceHtml === this.#committedHtml };
  }

  readNativeStateHandoff(): { schemaVersion: 'motion.preview-native-state-handoff.v1'; owner: 'idle' | 'geometry' | 'replacement' | 'promotion' } {
    return { schemaVersion: 'motion.preview-native-state-handoff.v1', owner: this.#nativeStateOwner };
  }

  async #replaceCompilerCss(compilerCss: string): Promise<void> {
    return this.#withNativeStateHandoff('replacement', () => this.#replaceCompilerCssOwned(compilerCss));
  }

  async #replaceCompilerCssOwned(compilerCss: string): Promise<void> {
    const frameDocument = this.iframe.contentDocument; const frameWindow = this.iframe.contentWindow;
    const style = this.#compilerStyle; const activeCss = this.#activeCompilerCss;
    if (!frameDocument || !frameWindow || !style || activeCss === null || !style.isConnected) throw new Error('PREVIEW_DOCUMENT_UNAVAILABLE');
    const exactMatches = [...frameDocument.querySelectorAll<HTMLStyleElement>('style')]
      .filter((candidate) => candidate.textContent === `\n${activeCss}`);
    if (exactMatches.length !== 1 || exactMatches[0] !== style) throw new Error('PREVIEW_COMPILER_STYLESHEET_BINDING_INVALID');
    if (this.#animations.length === 0 || this.#animations.some((animation) => animation.constructor.name !== 'CSSAnimation'
      || animation.effect?.constructor.name !== 'KeyframeEffect' || animation.timeline?.constructor.name !== 'DocumentTimeline')) {
      throw new Error('PREVIEW_ANIMATION_UNSUPPORTED');
    }
    const prior = this.#animations.map((animation) => ({
      currentTime: animation.playState === 'paused' ? this.#playheadMs : animation.currentTime,
      playState: animation.playState,
    }));
    const frameIdentity = frameDocument; this.#nativeStateGeneration += 1; style.textContent = `\n${compilerCss}`;
    frameWindow.getComputedStyle(frameDocument.documentElement).display;
    frameDocument.documentElement.getBoundingClientRect();
    if (this.iframe.contentDocument !== frameIdentity || this.#compilerStyle !== style) throw new Error('PREVIEW_DRAFT_DOCUMENT_CHANGED');
    const nextAnimations = frameDocument.getAnimations();
    if (nextAnimations.length !== prior.length || nextAnimations.some((animation) => animation.constructor.name !== 'CSSAnimation'
      || animation.effect?.constructor.name !== 'KeyframeEffect' || animation.timeline?.constructor.name !== 'DocumentTimeline')) {
      throw new Error('PREVIEW_ANIMATION_UNSUPPORTED');
    }
    this.#animations = nextAnimations;
    for (const animation of this.#animations) animation.pause();
    const restoreNativeState = () => {
      for (const [index, animation] of this.#animations.entries()) {
        const state = prior[index]!;
        animation.pause(); animation.currentTime = state.currentTime;
        if (state.playState === 'running') animation.play();
        else if (state.playState === 'finished') animation.finish();
        else if (state.playState === 'idle') animation.cancel();
      }
    };
    restoreNativeState();
    frameWindow.getComputedStyle(frameDocument.documentElement).display;
    frameDocument.documentElement.getBoundingClientRect();
    await Promise.all(this.#animations.map((animation) => animation.ready));
    restoreNativeState();
    if (this.#animations.some((animation, index) => animation.playState !== prior[index]!.playState
      || (prior[index]!.playState !== 'running' && animation.currentTime !== prior[index]!.currentTime))) {
      throw new Error('PREVIEW_NATIVE_STATE_RESTORE_INEXACT');
    }
    this.#activeCompilerCss = compilerCss;
  }

  sourceSize(): { widthCssPixels: number; heightCssPixels: number } {
    if (!this.#sourceSize) throw new Error('PREVIEW_SOURCE_SIZE_UNAVAILABLE');
    return { ...this.#sourceSize };
  }

  async measureTargetBoundsAtTimes(elementIds: string[], timesMs: number[]): Promise<Array<{
    elementId: string; timeMs: number; bounds: ProjectionRect;
  }>> {
    return this.#withNativeStateHandoff('geometry', () => this.#measureTargetBoundsAtTimesOwned(elementIds, timesMs));
  }

  async #measureTargetBoundsAtTimesOwned(elementIds: string[], timesMs: number[]): Promise<Array<{
    elementId: string; timeMs: number; bounds: ProjectionRect;
  }>> {
    const frameDocument = this.iframe.contentDocument; const frameWindow = this.iframe.contentWindow;
    if (!frameDocument || !frameWindow || !this.#sourceSize) throw new Error('PREVIEW_DOCUMENT_UNAVAILABLE');
    if (frameDocument.fonts.status !== 'loaded') throw new Error('PREVIEW_FONTS_NOT_READY');
    if (elementIds.length === 0 || timesMs.length === 0 || !timesMs.every((timeMs) => Number.isFinite(timeMs) && timeMs >= 0)) {
      throw new Error('PREVIEW_GEOMETRY_REQUEST_INVALID');
    }
    const targets = elementIds.map((elementId) => [...frameDocument.querySelectorAll<HTMLElement>('[data-motion-id]')]
      .find((candidate) => candidate.dataset.motionId === elementId));
    if (targets.some((target) => !target || !target.isConnected)) throw new Error('PREVIEW_GEOMETRY_TARGET_MISSING');
    if (this.#animations.length === 0 || this.#animations.some((animation) => animation.constructor.name !== 'CSSAnimation'
      || animation.effect?.constructor.name !== 'KeyframeEffect' || animation.timeline?.constructor.name !== 'DocumentTimeline')) {
      throw new Error('PREVIEW_ANIMATION_UNSUPPORTED');
    }
    const priorPlayheadMs = this.#playheadMs;
    const measurementGeneration = this.#nativeStateGeneration;
    const measuredAnimations = [...this.#animations];
    const measurementCurrent = () => measurementGeneration === this.#nativeStateGeneration
      && this.iframe.contentDocument === frameDocument
      && measuredAnimations.length === this.#animations.length
      && measuredAnimations.every((animation, index) => animation === this.#animations[index]);
    const requireMeasurementCurrent = () => { if (!measurementCurrent()) throw new Error('PREVIEW_GEOMETRY_SUPERSEDED'); };
    const prior = this.#animations.map((animation) => ({
      currentTime: animation.playState === 'paused' ? this.#playheadMs : animation.currentTime,
      playState: animation.playState,
    }));
    const samples: Array<{ elementId: string; timeMs: number; bounds: ProjectionRect }> = [];
    try {
      for (const timeMs of timesMs) {
        requireMeasurementCurrent();
        for (const animation of this.#animations) { animation.pause(); animation.currentTime = timeMs; }
        requireMeasurementCurrent();
        if (this.#animations.some((animation) => animation.currentTime !== timeMs)) throw new Error('PREVIEW_TIME_INEXACT');
        frameWindow.getComputedStyle(frameDocument.documentElement).display;
        frameDocument.documentElement.getBoundingClientRect();
        requireMeasurementCurrent();
        for (const [index, target] of targets.entries()) {
          if (!target!.isConnected || this.iframe.contentDocument !== frameDocument) throw new Error('PREVIEW_GEOMETRY_TARGET_CHANGED');
          const rect = target!.getBoundingClientRect(); const values = [rect.left, rect.top, rect.right, rect.bottom, rect.width, rect.height];
          requireMeasurementCurrent();
          if (!values.every(Number.isFinite) || rect.width <= 0 || rect.height <= 0) throw new Error('PREVIEW_GEOMETRY_INVALID');
          samples.push({ elementId: elementIds[index]!, timeMs,
            bounds: { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height } });
        }
      }
    } finally {
      if (measurementCurrent()) {
        for (const [index, animation] of this.#animations.entries()) {
          animation.pause(); animation.currentTime = prior[index]!.currentTime;
          if (prior[index]!.playState === 'running') animation.play();
          else if (prior[index]!.playState === 'finished') animation.finish();
          else if (prior[index]!.playState === 'idle') animation.cancel();
        }
        this.#playheadMs = priorPlayheadMs;
        frameWindow.getComputedStyle(frameDocument.documentElement).display;
        frameDocument.documentElement.getBoundingClientRect();
      }
    }
    requireMeasurementCurrent();
    if (this.#animations.some((animation, index) => prior[index]!.playState !== 'running'
      && animation.currentTime !== prior[index]!.currentTime)) throw new Error('PREVIEW_PLAYHEAD_RESTORE_INEXACT');
    return samples;
  }

  async #withNativeStateHandoff<T>(owner: 'geometry' | 'replacement' | 'promotion', task: () => Promise<T>): Promise<T> {
    if (this.#nativeStateHandoffBusy) await new Promise<void>((resolve) => { this.#nativeStateHandoffWaiters.push(resolve); });
    else this.#nativeStateHandoffBusy = true;
    this.#nativeStateOwner = owner;
    try { return await task(); }
    finally {
      this.#nativeStateOwner = 'idle';
      const next = this.#nativeStateHandoffWaiters.shift();
      if (next) next(); else this.#nativeStateHandoffBusy = false;
    }
  }

  play(): void {
    this.#nativeStateGeneration += 1;
    for (const animation of this.#animations) animation.play();
  }

  pause(): void {
    this.#nativeStateGeneration += 1;
    for (const animation of this.#animations) animation.pause();
  }

  scrub(timeMs: number): void {
    if (!Number.isFinite(timeMs) || timeMs < 0) throw new Error('PREVIEW_TIME_INVALID');
    this.#nativeStateGeneration += 1;
    this.#playheadMs = timeMs;
    for (const animation of this.#animations) {
      animation.pause();
      animation.currentTime = timeMs;
    }
  }

  readState(): PreviewState {
    return {
      playheadMs: this.#playheadMs,
      currentTimes: this.#animations.map((animation) =>
        typeof animation.currentTime === 'number' ? animation.currentTime : null),
      playStates: this.#animations.map((animation) => animation.playState),
    };
  }
}

export function buildTimeline(document: MotionDocument): TimelineModel {
  const sourceToStory = (timeMs: number): number => (document.holds ?? []).reduce(
    (storyTime, hold) => storyTime + (timeMs >= hold.sourceTimeMs ? hold.durationMs : 0), timeMs,
  );
  const rows = document.tracks.map((track): TimelineRow => {
    const application = document.applications.find((candidate) =>
      candidate.slots.some((slot) => slot.id === track.slotId)
      && candidate.bindings.some((binding) => binding.elementId === track.elementId));
    const slotIndex = application?.slots.findIndex((slot) => slot.id === track.slotId) ?? -1;
    const slot = slotIndex >= 0 ? application!.slots[slotIndex] : undefined;
    const binding = application?.bindings.find((candidate) => candidate.elementId === track.elementId);
    const rule = document.rules.find((candidate) => candidate.id === track.ruleId);
    const ruleTrack = rule?.tracks.find((candidate) => candidate.property === track.property);
    if (!application || !slot || !binding || !ruleTrack) {
      throw new Error('PREVIEW_TIMELINE_RELATIONSHIP_INVALID');
    }
    const propertyClassification = classifyAnimatedProperty(track.property);
    if (!propertyClassification || (propertyClassification !== track.interpolation && track.interpolation !== 'step')) throw new Error('PREVIEW_MOTION_PROPERTY_UNSUPPORTED');
    const timing = normalizeCssTimingFunction(slot.timingFunction);
    const sourceDelayMs = binding.delayOverridesMs[slotIndex];
    if (sourceDelayMs === undefined) throw new Error('PREVIEW_TIMELINE_DELAY_MISSING');
    const delayMs = sourceToStory(sourceDelayMs);
    return {
      trackId: track.id,
      elementId: track.elementId,
      property: track.property,
      ruleId: track.ruleId,
      applicationId: application.id,
      activeSlotId: slot.id,
      delayMs,
      interpolation: track.interpolation,
      timing,
      orderedSlotIds: application.slots.map((candidate) => candidate.id),
      keyframes: ruleTrack.keyframes.map((keyframe) => ({
        id: keyframe.id,
        offset: keyframe.offset,
        value: keyframe.value,
        easing: keyframe.easing ?? null,
        timeMs: sourceToStory(sourceDelayMs + keyframe.offset * slot.durationMs),
      })),
    };
  });
  return {
    schemaVersion: 'motion.timeline-projection.v1',
    durationMs: document.durationMs,
    rows,
    cues: document.cues.map((cue) => ({ ...cue })),
    ...(document.holds ? { holds: document.holds.map((hold) => ({ ...hold })) } : {}),
    reducedMotion: { ...document.reducedMotion },
  };
}
