/** Compiler-owned code only. Authored shot content is serialized exclusively into scriptless frames. */
export const SEQUENCE_RUNTIME = String.raw`(() => {
  'use strict';
  const config = JSON.parse(document.getElementById('sequence-config').textContent);
  const frames = Array.from(document.querySelectorAll('iframe[data-sequence-clip]'));
  const media = matchMedia('(prefers-reduced-motion: reduce)');
  let animations = [], currentTimeMs = 0, activeClipIndex = 0, localTimeMs = 0;
  let sampledReducedMotion = media.matches;
  let ready = false, playing = false, frameRequest = null, anchorTime = 0, anchorClock = 0;
  function inventory() {
    sampledReducedMotion = media.matches;
    animations = frames.map(frame => {
      const found = frame.contentDocument.getAnimations();
      for (const animation of found) {
        if (!(animation instanceof frame.contentWindow.CSSAnimation)
          || animation.timeline !== frame.contentDocument.timeline
          || !Number.isFinite(animation.effect.getComputedTiming().endTime)) {
          throw new Error('SEQUENCE_NATIVE_ANIMATION_UNSUPPORTED');
        }
        animation.pause();
      }
      return found;
    });
  }
  function apply(time) {
    // A preference can change before its event is delivered. Never revive canceled CSS animations.
    if (sampledReducedMotion !== media.matches) inventory();
    currentTimeMs = Math.max(0, Math.min(config.durationMs, time));
    activeClipIndex = config.clips.findIndex(clip => currentTimeMs < clip.endMs);
    if (activeClipIndex < 0) activeClipIndex = config.clips.length - 1;
    config.clips.forEach((clip, index) => {
      const local = Math.max(0, Math.min(clip.durationMs, currentTimeMs - clip.startMs));
      animations[index].forEach(animation => { animation.pause(); animation.currentTime = local; });
      const active = index === activeClipIndex;
      frames[index].style.visibility = active ? 'visible' : 'hidden';
      frames[index].setAttribute('aria-hidden', String(!active));
      frames[index].inert = !active;
      if (active) localTimeMs = local;
    });
  }
  function requireReady() { if (!ready) throw new Error('SEQUENCE_NOT_READY'); }
  function stop() {
    playing = false;
    if (frameRequest !== null) cancelAnimationFrame(frameRequest);
    frameRequest = null;
  }
  function pause() {
    requireReady();
    if (playing) apply(anchorTime + performance.now() - anchorClock);
    stop();
  }
  function seek(ms) {
    requireReady();
    if (typeof ms !== 'number' || !Number.isFinite(ms)) throw new Error('SEQUENCE_TIME_INVALID');
    stop(); apply(ms);
  }
  function tick() {
    if (!playing) return;
    apply(anchorTime + performance.now() - anchorClock);
    if (currentTimeMs >= config.durationMs) stop();
    else frameRequest = requestAnimationFrame(tick);
  }
  function play() {
    requireReady();
    if (playing) return;
    if (currentTimeMs >= config.durationMs) apply(0);
    anchorTime = currentTimeMs; anchorClock = performance.now(); playing = true;
    frameRequest = requestAnimationFrame(tick);
  }
  function readState() {
    return { ready, currentTimeMs, durationMs: config.durationMs, activeClipIndex,
      activeClipId: config.clips[activeClipIndex].clipId, localTimeMs, playing,
      reducedMotion: media.matches };
  }
  function deadline(promise) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('SEQUENCE_ASSET_TIMEOUT')), 15000);
      promise.then(value => { clearTimeout(timer); resolve(value); }, error => { clearTimeout(timer); reject(error); });
    });
  }
  async function loadFrame(frame, index) {
    if (frame.contentDocument?.URL !== 'about:srcdoc' || frame.contentDocument.readyState !== 'complete') {
      await new Promise((resolve, reject) => {
        frame.addEventListener('load', resolve, { once: true });
        frame.addEventListener('error', () => reject(new Error('SEQUENCE_FRAME_FAILED')), { once: true });
      });
    }
    const doc = frame.contentDocument;
    // Force initial style/layout so fonts and CSS-created animation objects are discovered.
    doc.documentElement.getBoundingClientRect();
    doc.getAnimations().forEach(animation => { animation.pause(); animation.currentTime = 0; });
    await doc.fonts.ready;
    await Promise.all(Array.from(doc.images).filter(image => image.getAttribute('src') || image.getAttribute('srcset')).map(image => image.decode()));
    await Promise.all(config.clips[index].imageAssets.map(url => {
      const image = new frame.contentWindow.Image(); image.src = url; return image.decode();
    }));
    if (Array.from(doc.fonts).some(font => font.status === 'error')) throw new Error('SEQUENCE_FONT_FAILED');
  }
  const readiness = deadline(Promise.all(frames.map(loadFrame))).then(() => {
    inventory(); ready = true; apply(0);
    media.addEventListener('change', () => {
      const resume = playing; pause();
      try {
        frames.forEach(frame => frame.contentDocument.documentElement.getBoundingClientRect());
        inventory(); apply(currentTimeMs); if (resume) play();
      } catch (error) { stop(); ready = false; document.getElementById('sequence-error').textContent = 'SEQUENCE_NATIVE_ANIMATION_UNSUPPORTED'; }
    });
    play();
  });
  window.__motionSequence = Object.freeze({ ready: readiness, seek, play, pause, readState });
  readiness.catch(() => {
    stop(); document.getElementById('sequence-error').textContent = 'Sequence preview unavailable: an embedded source could not be prepared.';
  });
})();`;
