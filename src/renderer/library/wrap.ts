/**
 * **Where a run of a title may come apart.**
 *
 * Chromium's rule for Japanese is that a line may end between very nearly any
 * two characters, so a title left to the browser broke in the middle of a word
 * — 蒼穹のカレイド|スコープ — and read as a mistake rather than as a long name.
 * What is here is the places a *reader* would break one, and how good each of
 * them is, so a caller can pick between them.
 *
 * It is shared: the PlayTime Graph sets a game's name in the middle of its ring
 * over two lines, and the Home board's cards carry the same names in the same
 * two lines under a thumbnail. Written once, a title cannot come apart in one
 * place on one screen and another place on the next.
 */

/* The four sets the rules below are written in terms of: a break may be taken
   at a space, around a bracket, after a mark that is already a separator, and
   at a change of script — which in Japanese is where one word tends to end and
   the next begin. */
const NAME_OPENERS = '「『（〔［【《〈｛(['
const NAME_CLOSERS = '」』）〕］】》〉｝)]'
const NAME_MARKS = '・/／｜|：:；;，,、。．.！!？?〜~＆&＋+－—―–-'
/* Kinsoku: a closing bracket, a mark, a small kana or a 長音符 belongs to the
   line the character before it is on and can never start one of its own. */
const NAME_NO_START = NAME_CLOSERS + NAME_MARKS + 'ーぁぃぅぇぉっゃゅょゎァィゥェォッャュョヮヵヶ々'

/* **A pair of these is a bracket, not two marks.** 「時計仕掛けのレイライン
   -黄昏時の境界線-」 and 「Subarashiki Hibi ~Furenzoku Sonzai~」 both set their
   subtitle off between a pair, and a subtitle goes to the next line *with* the
   mark that opens it — left behind, that mark hangs at the end of the line
   above and reads as a word cut in half.

   Two kinds, because a title uses one or the other: dashes and tildes. They are
   paired **within their own kind**, so a dash never closes a tilde. 長音符 is
   deliberately in neither: ー is part of the run it stands in rather than a
   bracket.

   Which one opens and which closes is their order — the first of a pair opens,
   the second closes — so a title carrying a single mark (「G-senjou no Maou」)
   has no pair at all and is left to the ordinary rules. */
const NAME_PAIRED = ['-－—―–−', '~〜～']

function pairOpeners(text: string): Set<number> {
  const openers = new Set<number>()
  for (const kind of NAME_PAIRED) {
    const at: number[] = []
    for (let index = 0; index < text.length; index += 1) {
      if (kind.includes(text[index])) at.push(index)
    }
    for (let pair = 0; pair + 1 < at.length; pair += 2) openers.add(at[pair])
  }
  return openers
}

type NameScript = 'latin' | 'digit' | 'hira' | 'kata' | 'han' | 'other'

function nameScript(ch: string): NameScript {
  const code = ch.codePointAt(0) ?? 0
  if (code >= 0x3041 && code <= 0x309f) return 'hira'
  if ((code >= 0x30a1 && code <= 0x30fa) || code === 0x30fd || code === 0x30fe) return 'kata'
  if ((code >= 0x4e00 && code <= 0x9fff) || (code >= 0x3400 && code <= 0x4dbf) || code === 0x3005)
    return 'han'
  if ((code >= 0x30 && code <= 0x39) || (code >= 0xff10 && code <= 0xff19)) return 'digit'
  if (
    (code >= 0x41 && code <= 0x5a) ||
    (code >= 0x61 && code <= 0x7a) ||
    (code >= 0xc0 && code <= 0x24f) ||
    (code >= 0xff21 && code <= 0xff3a) ||
    (code >= 0xff41 && code <= 0xff5a)
  )
    return 'latin'
  return 'other'
}

/** Every place the name may be broken, with how good a place it is: **-1 for
    the mark that opens a subtitle**, which is a bracket rather than a separator
    and so the strongest place a title has; 0 for a mark that is already a
    separator, 1 for a kana ending a word, 2 for any other change of script. */
export function nameBreaks(text: string): { at: number; tier: number }[] {
  /* A 長音符 is part of the run it stands in rather than a script of its own,
     so it takes the class of what is before it — ドール is one word. */
  const scripts: NameScript[] = []
  for (let index = 0; index < text.length; index += 1) {
    const ch = text[index]
    scripts.push(ch === 'ー' || ch === 'ｰ' ? scripts[index - 1] ?? 'other' : nameScript(ch))
  }

  const openers = pairOpeners(text)

  const breaks: { at: number; tier: number }[] = []
  for (let at = 1; at < text.length; at += 1) {
    const prev = text[at - 1]
    const cur = text[at]
    if (cur === ' ' || cur === '　') continue
    /* The mark that opens a subtitle is the one that *may* start a line, and
       the place just after it is the one place that may not: breaking there is
       exactly what leaves the mark hanging at the end of the line above. */
    if (openers.has(at)) {
      breaks.push({ at, tier: -1 })
      continue
    }
    if (openers.has(at - 1)) continue
    if (NAME_NO_START.includes(cur)) continue
    if (NAME_OPENERS.includes(prev)) continue
    let tier = -1
    if (prev === ' ' || prev === '　') tier = 0
    else if (NAME_CLOSERS.includes(prev) || NAME_MARKS.includes(prev)) tier = 0
    else if (NAME_OPENERS.includes(cur)) tier = 0
    else if (scripts[at - 1] !== scripts[at]) {
      /* Hiragana after a word is its okurigana or the particle holding it to
         the next one, so it is never left to start a line by itself. */
      if (scripts[at] === 'hira') continue
      tier = scripts[at - 1] === 'hira' ? 1 : 2
    }
    if (tier >= 0) breaks.push({ at, tier })
  }
  return breaks
}
