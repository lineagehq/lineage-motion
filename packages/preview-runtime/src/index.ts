import type { MotionCue, MotionDocument, MotionHold, TimingFunction } from '../../domain/src/index.js';

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

export class NativePreviewController {
  readonly iframe: HTMLIFrameElement;
  #animations: Animation[] = [];
  #playheadMs = 0;

  constructor(iframe: HTMLIFrameElement) {
    this.iframe = iframe;
  }

  async mount(compiledHtml: string): Promise<void> {
    this.iframe.setAttribute('sandbox', 'allow-same-origin');
    await new Promise<void>((resolve) => {
      this.iframe.addEventListener('load', () => resolve(), { once: true });
      this.iframe.srcdoc = compiledHtml;
    });
    const frameDocument = this.iframe.contentDocument;
    if (!frameDocument) throw new Error('PREVIEW_DOCUMENT_UNAVAILABLE');
    await frameDocument.fonts.ready;
    this.#animations = frameDocument.getAnimations();
    this.scrub(0);
  }

  play(): void {
    for (const animation of this.#animations) animation.play();
  }

  pause(): void {
    for (const animation of this.#animations) animation.pause();
  }

  scrub(timeMs: number): void {
    if (!Number.isFinite(timeMs) || timeMs < 0) throw new Error('PREVIEW_TIME_INVALID');
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
      timing: slot.timingFunction,
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
