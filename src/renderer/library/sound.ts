import { playSound } from '../playSound'

/*
 * The Setting board's 音声 tab, read where a sound is fired rather than passed
 * down as a prop.
 *
 * Both of these are played from inside an effect's own closure — the
 * confetti's crackers come up on cues read off the clip's clock, a balloon's
 * pop on a click handler held in state — where a prop would be the one the
 * effect was set up with. The shell writes the rows onto the document the way
 * it writes `data-animations`, and this reads them back; see `motion.ts`,
 * which is the same arrangement for the same reason.
 */
export type SoundKind = 'cracker' | 'balloon'

const ATTRIBUTE: Record<SoundKind, string> = {
  cracker: 'crackerSound',
  balloon: 'balloonSound'
}

/** On unless the row says otherwise, so a sound is not lost to the frame
    before the settings have been read. */
export function soundOn(kind: SoundKind): boolean {
  return document.documentElement.dataset[ATTRIBUTE[kind]] !== 'off'
}

export function playIfOn(kind: SoundKind, src: string, volume?: number): void {
  if (soundOn(kind)) playSound(src, volume)
}
