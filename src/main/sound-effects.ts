import path from 'node:path'
import fs from 'node:fs'
import { is } from './env'
import type { SoundEffect } from '../shared/db-types'

/**
 * The Recorder Panel's effect sounds. They are served verbatim out of
 * `src/renderer/public/` the way the audio worklet is, so in dev they are read
 * from the source tree and packaged from where the renderer was built — the
 * same split `loadRenderer` makes, for the same reason.
 */
export const SOUND_EFFECT_DIR = 'recorderpanel_SE'

function soundEffectDir(): string {
  return is.dev
    ? path.join(process.cwd(), 'src', 'renderer', 'public', SOUND_EFFECT_DIR)
    : path.join(__dirname, '..', 'renderer', SOUND_EFFECT_DIR)
}

/**
 * Every file in that folder is named `<number>_<whatever>.mp3`, and **the
 * number is the whole of what the Setting board offers and stores**: a row
 * naming 「4_カメラのシャッター3.mp3」 would be a row as wide as the board,
 * and the 試聴 button beside it is how a number is found out. Read off the
 * folder rather than written down, so dropping a file in adds an option.
 *
 * Ordered by that number, and anything not named for one is not offered.
 */
export function listSoundEffects(): SoundEffect[] {
  let names: string[]
  try {
    names = fs.readdirSync(soundEffectDir())
  } catch {
    return []
  }
  const effects: SoundEffect[] = []
  for (const file of names) {
    const match = /^(\d+)_/.exec(file)
    if (match) effects.push({ key: match[1], file })
  }
  return effects.sort((a, b) => Number(a.key) - Number(b.key))
}

/** The file a stored number names — null for `off`, and null for a number no
    file answers to any more, so a folder that has changed under a setting
    plays nothing rather than the wrong sound. */
export function soundEffectFile(key: string): string | null {
  if (key === 'off') return null
  return listSoundEffects().find((effect) => effect.key === key)?.file ?? null
}
