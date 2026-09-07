/**
 * Fires a one-shot sound. A fresh element each time, so two that land close
 * together layer rather than the second cutting the first off.
 *
 * The files are served verbatim from `src/renderer/public/`, so the paths are
 * relative to the page like the audio worklet's.
 */
export function playSound(src: string, volume = 0.8): void {
  const audio = new Audio(src)
  audio.volume = volume
  // Autoplay can still be refused; a celebration is not worth an unhandled
  // rejection over.
  void audio.play().catch(() => undefined)
}

/**
 * How loud the Recorder Panel's own effect sounds are played — half the
 * default a one-shot takes. These land over a game that is running, where the
 * finale's crackers land over a window that is being looked at.
 */
export const SOUND_EFFECT_VOLUME = 0.4

/**
 * Where the Recorder Panel's effect sounds are served from — the folder the
 * main process reads the numbers off (`sound-effects.ts`). The names are in
 * Japanese, so the file is encoded rather than pasted into the URL.
 */
export function soundEffectUrl(file: string): string {
  return `./recorderpanel_SE/${encodeURIComponent(file)}`
}
