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
