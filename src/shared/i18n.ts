import { EN } from './i18n-en'
import type { Language } from './db-types'

/*
 * **The Japanese run *is* the key.**
 *
 * The interface is written in Japanese in the place it is used, and much of
 * what is on the screen is English already — the design's own words (Home,
 * SORT, ADD TAG +, PLAY TIME, OK, CANCEL) are English in Penpot and are meant
 * to stay English in both languages. Those are simply never passed through
 * here, so nothing can translate them by accident: **what `t()` wraps is
 * exactly what has another language.**
 *
 * Three things follow from keying on the Japanese rather than on a name:
 *
 *   - A translation that has not been written yet falls back to the Japanese.
 *     A half-finished dictionary is a working app, not a page of `missing.key`.
 *   - The dictionary reads as a table of Japanese against English, so it can be
 *     filled in without reading any code.
 *   - Japanese needs no dictionary at all: `t` hands the key straight back.
 *
 * `{0}`, `{1}`… are what a run puts around a figure — `t('今日の予定 {0}件', n)`
 * — so the number can move to wherever the other language wants it.
 */
let current: Language = 'ja'

/*
 * **Where a page is concerned the answer is written on the document, not held
 * in this module.**
 *
 * A module's own variable is the obvious place for it and it is wrong here for
 * the same reason `motion.ts` and `sound.ts` read an attribute: the value is
 * read at the moment a run is drawn, from code that may have been re-evaluated
 * since it was set. Under the dev server that happens every time this file or
 * the dictionary is touched — the module is replaced, its variable goes back to
 * its initial `ja`, and everything on the screen falls back to Japanese until
 * something re-renders the shell. Written on the document it survives that, and
 * `<html lang>` is where a page is supposed to say what language it is in
 * anyway. The main process has no document and keeps the variable.
 */
export function setLanguage(language: Language): void {
  current = language
  if (typeof document !== 'undefined') document.documentElement.lang = language
}

export function getLanguage(): Language {
  if (typeof document !== 'undefined') {
    const written = document.documentElement.lang
    if (written === 'ja' || written === 'en') return written
  }
  return current
}

export function t(text: string, ...args: (string | number)[]): string {
  const written = getLanguage() === 'ja' ? text : EN[text] || text
  if (args.length === 0) return written
  return written.replace(/\{(\d+)\}/g, (whole, index: string) => {
    const value = args[Number(index)]
    return value === undefined ? whole : String(value)
  })
}
