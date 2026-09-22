import { useEffect, useRef, useState } from 'react'
import type {
  AppSettings,
  AudioFormat,
  GpuMode,
  JpFont,
  Language,
  LaunchWindowMode,
  OverlayCorner,
  OverlaySize,
  ScreenDisplay,
  ScreenshotFormat,
  SoundEffect,
  Toggle,
  VideoFormat,
  VndbReleaseLanguage
} from '../../../shared/db-types'
import { playSound, soundEffectUrl, SOUND_EFFECT_VOLUME } from '../../playSound'
import { GEAR_PATH, GEAR_VIEW_BOX } from '../gear'
import { centreInk } from '../ink'
import OptionMenu from './OptionMenu'
import { t } from '../../../shared/i18n'
import './Setting.css'

/** Penpot: Setting — the board's own width, which the menu's scale comes off. */
const BOARD_WIDTH = 1585
/** Penpot: Select Box — 207 wide, which the menu under it takes too. */
const SELECT_WIDTH = 207
/* The air between the two boxes of the one row that has two — not the design's
   figure, there being no row in it with two — and so what a list dropped from
   the left of them has to cross to reach the right one's own right edge. */
const SELECT_GAP = 20
/* **The display list is the one that is not as wide as the box it drops from.**
   A monitor is named by its number, its resolution and whether it is the main
   one, which is a great deal longer than a language's name: in 207 the label
   column is 143, and `OptionMenu` stepped every row down to something barely
   readable. It runs out to the *right* box's right edge instead — the row's
   whole width — which is the only room there is beside it, and the rows then
   stand at very nearly their own size. */
const MONITOR_MENU_WIDTH = SELECT_WIDTH * 2 + SELECT_GAP
/* And the 描画方式 row's, for the same reason: what each of its choices hands to
   the CPU cannot be said in the four or five characters 207 leaves. That row has
   only one box and it stands at the row's right end, so the room is to its
   *left* — the list is held by its right edge (`align`) rather than its left,
   which is what ran it off the board and had it cut off there. */
const GPU_MENU_WIDTH = SELECT_WIDTH * 2 + SELECT_GAP
/** Penpot: "enable" — 41px in a 167 box with 25px of padding either side. */
const SELECT_FONT_SIZE = 41
const SELECT_LABEL_WIDTH = 167 - 25 * 2

interface Option {
  key: string
  label: string
  /** What the *field* writes once this option is the one on, where that is not
      the label the list carries. A monitor's row says its resolution so that
      two of them can be told apart while they stand side by side; the field has
      117px for a 41px run and nothing left to tell apart, so it says the number
      alone rather than stepping the whole of it down to nothing. */
  short?: string
  /** Draws a 試聴 button at this row's right end in the menu. */
  audition?: boolean
}

/** What a row's options are drawn from, beyond the settings themselves: the
    desktop's displays and the panel's own effect sounds are both read as the
    board opens, and a field takes whichever of them it is about. */
interface FieldContext {
  displays: ScreenDisplay[]
  sounds: SoundEffect[]
}

/** One Select Box. A row has one of these, except the Recorder Panel's
    placement, which is two — the display on the left and the corner on the
    right. */
interface SelectField {
  /** Unique across the board: it is what says whose menu is up. */
  id: string
  title: string
  options: (ctx: FieldContext) => Option[]
  current: (settings: AppSettings, ctx: FieldContext) => string
  patch: (key: string) => Partial<AppSettings>
  /** How wide the list it drops is, where that is not the box's own 207. */
  width?: number
  /** Which edge of the box a wider list is held to. A menu hangs off the box's
      left by default, which is where the room is on the モニター row — its own
      box is the left of two and the list runs out over the right one. A row with
      one box has that box at the row's right end, so a wider list has nowhere to
      go but left: held by its left edge it ran off the board and was cut off by
      it. */
  align?: 'left' | 'right'
}

/** A row whose description slot holds a path rather than a sentence: typed
    into, or picked with the 参照 button beside it. */
interface PathField {
  placeholder: string
  value: (settings: AppSettings) => string
  patch: (value: string) => Partial<AppSettings>
  browse?: () => Promise<string | null>
}

type TabId = 'general' | 'ui' | 'audio' | 'overlay'

interface RowBase {
  id: string
  tab: TabId
  name: string
  description?: string
  path?: PathField
}

interface SelectRow extends RowBase {
  kind: 'select'
  fields: SelectField[]
}

interface ToggleRow extends RowBase {
  kind: 'toggle'
  title: string
  current: (settings: AppSettings) => Toggle
  patch: (value: Toggle) => Partial<AppSettings>
}

interface ActionRow extends RowBase {
  kind: 'action'
  label: string
  title: string
  /* `apply` is the board's own `onChange`: a row that changes settings rather
     than the library reports what it did back through the same door every
     other row does, so the shell holds one copy of them. */
  run: (settings: AppSettings, apply: (patch: Partial<AppSettings>) => void) => void
  /** Asked again whenever the settings change; the button is dead until it
      answers true. A row with none is always live. */
  ready?: (settings: AppSettings) => Promise<boolean>
  /** Drawn on the app's own red plate: what it does cannot be undone. */
  danger?: boolean
}

type Row = SelectRow | ToggleRow | ActionRow

/* The board's four tabs, in the order they stand in at its top right. The
   design draws none — it draws two rows and leaves the Top's right half empty
   — but a board that scrolls is a board where a setting is looked for rather
   than seen, and these are the four things there are to look for. */
/* i18n-keys: the runs below are keys, read through `t` where drawn. */
const TABS: { id: TabId; label: string }[] = [
  { id: 'general', label: '一般' },
  { id: 'ui', label: 'UI' },
  { id: 'audio', label: '音声' },
  { id: 'overlay', label: 'レコーダーパネル' }
]

/* The four corners, in the order the row offers them: down the right side and
   then down the left. A left-hand corner also turns the panel around — the
   Move Button is the corner the strip folds under, so in a left corner it is
   the leftmost thing and the boards run from it. */
/* i18n-keys: the runs below are keys, read through `t` where drawn. */
const CORNER_LABELS: Record<OverlayCorner, string> = {
  'top-right': '右上',
  'bottom-right': '右下',
  'top-left': '左上',
  'bottom-left': '左下'
}
const CORNER_ORDER: OverlayCorner[] = ['top-right', 'bottom-right', 'top-left', 'bottom-left']

/* The primary display is stored as `primary` rather than by its own id, so the
   panel follows whichever display that is rather than the one that happened to
   be primary when the row was set. Every other display is stored by its id,
   and one that is no longer on the desktop comes back to the primary. */
function monitorOptions({ displays }: FieldContext): Option[] {
  if (displays.length === 0) {
    return [{ key: 'primary', label: t('モニター1'), short: t('モニター1') }]
  }
  return displays.map((display) => ({
    key: display.primary ? 'primary' : display.id,
    label: display.label,
    short: display.short
  }))
}

function monitorKey(stored: string, displays: ScreenDisplay[]): string {
  if (stored === 'primary') return 'primary'
  const named = displays.find((display) => display.id === stored)
  if (!named) return 'primary'
  return named.primary ? 'primary' : named.id
}

/* A sound is offered by the number its file is named for, which is the whole
   of what is stored — the 試聴 button on each row of the menu is how a number
   is found out. なし stands at the head of the list: every other sound on the
   board is a row that can be turned off, and the panel making no sound at all
   is where it starts. */
function soundOptions({ sounds }: FieldContext): Option[] {
  return [
    { key: 'off', label: t('なし') },
    ...sounds.map((sound) => ({
      key: sound.key,
      label: sound.key,
      audition: true
    }))
  ]
}

/** A stored number no file answers to any more reads as なし, which is also
    what it plays. */
function soundKey(stored: string, sounds: SoundEffect[]): string {
  return sounds.some((sound) => sound.key === stored) ? stored : 'off'
}

/* Every row there is, grouped by the tab it stands under and in the order that
   tab draws them. A setting is either one of a fixed list or a switch, so the
   board draws two controls and the rows are this one array rather than a block
   of markup each.

   **The runs in here are written in Japanese and are not passed through `t`.**
   This array is built once, as the module is imported, which is before the
   shell has read the 言語/language row — a translation made here would be
   frozen in whatever the language was at load. They are the *keys*: every one
   of them goes through `t` at the moment it is drawn instead. Same for `TABS`
   and `CORNER_LABELS` above, and for the same reason. */
/* i18n-keys: the runs below are keys, read through `t` where drawn. */
const ROWS: Row[] = [
  {
    kind: 'select',
    id: 'language',
    tab: 'general',
    name: '言語/language',
    fields: [
      {
        id: 'language',
        title: '言語を選ぶ',
        options: () => [
          /* A language is called what it is called in its own language, so
             neither of these is ever translated. */
          { key: 'ja', label: '日本語' },
          { key: 'en', label: 'ENG' }
        ],
        current: (settings) => settings.language,
        patch: (key) => ({ language: key as Language })
      }
    ]
  },
  {
    kind: 'select',
    id: 'jpFont',
    tab: 'ui',
    name: '日本語フォントを変更',
    fields: [
      {
        id: 'jpFont',
        title: '日本語フォントを選ぶ',
        /* A font's name is a name, so — like 日本語 / ENG — it is shown as it is
           in both languages rather than translated. */
        options: () => [
          { key: 'hangyaku', label: '反逆明朝' },
          { key: 'kinkakuji', label: '金畫字' },
          { key: 'kurohana', label: '黒華明朝' }
        ],
        current: (settings) => settings.jpFont,
        patch: (key) => ({ jpFont: key as JpFont })
      }
    ]
  },
  {
    /* Not a thing the app remembers about itself: what this row writes is the
       system's own Run key, so turning it on here is what actually puts the
       app in Windows' startup list. */
    kind: 'toggle',
    id: 'launchAtLogin',
    tab: 'general',
    name: 'PCの起動時にこのアプリを立ち上げる',
    title: '自動起動の入り切り',
    current: (settings) => settings.launchAtLogin,
    patch: (value) => ({ launchAtLogin: value })
  },
  {
    kind: 'toggle',
    id: 'addGameMore',
    tab: 'ui',
    name: 'Add Gameに高度な設定を追加',
    description: 'ブランド名・発売日・購入日・購入額を入力できるようにする',
    title: 'Add Gameの高度な設定の入り切り',
    current: (settings) => settings.addGameMore,
    patch: (value) => ({ addGameMore: value })
  },
  {
    kind: 'select',
    id: 'launchWindowMode',
    tab: 'general',
    name: 'このアプリの起動時のウインドウサイズ',
    fields: [
      {
        id: 'launchWindowMode',
        title: 'このアプリの起動時のウインドウサイズを選ぶ',
        options: () => [
          { key: 'window', label: t('ウインドウ') },
          { key: 'fullscreen', label: t('フルスクリーン') }
        ],
        current: (settings) => settings.launchWindowMode,
        patch: (key) => ({ launchWindowMode: key as LaunchWindowMode })
      }
    ]
  },
  {
    kind: 'select',
    id: 'gpuMode',
    tab: 'general',
    name: '描画方式',
    /* The one row on this board whose effect waits for the next launch: the
       switches it writes can only be set before the app is ready. */
    description: '表示がぼやける・崩れる場合に変更（次回の起動から）',
    fields: [
      {
        id: 'gpuMode',
        title: '描画方式を選ぶ',
        /* Each rung hands one more stage of the drawing to the CPU, so the list
           reads down from "leave it alone" to "do none of it on the GPU" and
           what is picked is the first one that answers. The field says the short
           form: the box is 117 for a 41px run, and 「DirectComposition を使わ
           ない」 there would be stepped down to nothing. */
        options: () => [
          { key: 'auto', label: t('自動') },
          {
            key: 'no-direct-composition',
            label: t('DirectComposition を使わない'),
            short: t('DC なし')
          },
          {
            key: 'no-gpu-compositing',
            label: t('GPU 合成を使わない'),
            short: t('合成なし')
          },
          { key: 'off', label: t('GPU を使わない'), short: t('GPU なし') }
        ],
        current: (settings) => settings.gpuMode,
        patch: (key) => ({ gpuMode: key as GpuMode }),
        width: GPU_MENU_WIDTH,
        // One box, and it is at the row's right end: the room is to its left.
        align: 'right'
      }
    ]
  },
  {
    /* **A game is released once per market, so which release is *the* release
       is a question about the player.** VNDB lists them a language at a time
       and the Add Game dialog's Reference row reads the first complete one out
       of the block this names — the original for a library kept in Japanese,
       the translated one for a library of what can actually be played. It is
       not the 言語/language row above: the interface can be English while the
       dates come off the Japanese releases.

       **A language with no release falls back to the Japanese one.** Plenty of
       games are never translated, and a library where those games alone carry
       no date at all is worse than one where the date is the original's — so
       what is picked here is the block that is *preferred*, and 日本語版 is
       what answers when it is not there. Which one a date actually came from
       is written on the game and said on the Game Info board, so the two are
       never confused. */
    kind: 'select',
    id: 'vndbReleaseLanguage',
    tab: 'general',
    name: 'VN DataBaseから取得する発売日',
    fields: [
      {
        id: 'vndbReleaseLanguage',
        title: '取得する発売日を選ぶ',
        /* The field writes the language alone. 「英語版」 is three characters and
           fits the box; its English half, "English release", is a sentence in
           117px and was stepped down to nothing. The list keeps the whole name —
           and takes the room the 描画方式 row's list takes, out to the left, so
           "Japanese release" stands at its own size there too. */
        options: () => [
          { key: 'en', label: t('英語版'), short: t('英語') },
          { key: 'zh', label: t('中国語版'), short: t('中国語') },
          { key: 'ja', label: t('日本語版'), short: t('日本語') }
        ],
        current: (settings) => settings.vndbReleaseLanguage,
        patch: (key) => ({ vndbReleaseLanguage: key as VndbReleaseLanguage }),
        width: GPU_MENU_WIDTH,
        align: 'right'
      }
    ]
  },
  {
    kind: 'toggle',
    id: 'backupOnLaunch',
    tab: 'general',
    name: '起動時にバックアップを作成',
    title: '起動時のバックアップの入り切り',
    /* The row's description slot is where the copy goes rather than a sentence
       about it: one file a day, named for the day, in the folder named here. */
    path: {
      placeholder: 'バックアップの保存先',
      value: (settings) => settings.backupDirectory,
      patch: (value) => ({ backupDirectory: value }),
      browse: () => window.library.pickBackupDirectory()
    },
    current: (settings) => settings.backupOnLaunch,
    patch: (value) => ({ backupOnLaunch: value })
  },
  {
    kind: 'action',
    id: 'backupRestore',
    tab: 'general',
    name: 'バックアップを読み込み',
    label: '読み込み',
    title: 'このバックアップでライブラリを置き換える',
    /* What this replaces cannot be put back, so the main process asks before
       anything is touched and restarts the app afterwards — and the button is
       dead until the path names a file that is actually a database, which is
       the one check that can be made before any of that. What is pointed at is
       the `library.sqlite3` *inside* a dated backup folder; the pictures beside
       it come back with it, and a bare database file — every backup made before
       the folders existed — still reads back on its own. */
    path: {
      placeholder: 'バックアップの library.sqlite3 のパス',
      value: (settings) => settings.backupRestorePath,
      patch: (value) => ({ backupRestorePath: value }),
      browse: () => window.library.pickBackupFile()
    },
    ready: (settings) => window.library.checkBackup(settings.backupRestorePath),
    run: (settings) => {
      void window.library.restoreBackup(settings.backupRestorePath)
    }
  },
  {
    kind: 'action',
    id: 'settingsReset',
    tab: 'general',
    name: '設定をリセット',
    description: 'すべての設定を初期状態に戻す（ライブラリはそのまま）',
    label: 'リセット',
    title: 'すべての設定を初期状態に戻す',
    /* Drawn on the app's own red plate: it is the one control on the board
       whose act cannot be taken back. */
    danger: true,
    /* Asked about in the main process, the way the restore above is: every row
       goes back at once and there is no undoing it. What comes back is the
       whole of the settings as they now stand, which is handed to the shell as
       a patch — every key at once — so nothing here has to know how the shell
       holds them. Cancelled, nothing comes back and nothing is written. */
    run: (_settings, apply) => {
      void window.library.resetSettings().then((fresh) => {
        if (fresh) apply(fresh)
      })
    }
  },
  {
    kind: 'action',
    id: 'libraryErase',
    tab: 'general',
    name: '初期化',
    description: 'バックアップを除くすべてのデータを消去する',
    label: '消去',
    title: 'バックアップを除くすべてのデータを消去する',
    danger: true,
    /* The whole library goes with this one, so the main process asks twice
       before anything is touched and restarts the app on an empty library
       afterwards; nothing comes back to the board, there being no board left
       to come back to. */
    run: () => {
      void window.library.eraseLibrary()
    }
  },
  {
    kind: 'toggle',
    id: 'animations',
    tab: 'ui',
    name: 'アニメーション',
    description: '表示速度に影響するアニメーションの切り替え',
    title: 'アニメーションの入り切り',
    current: (settings) => settings.animations,
    patch: (value) => ({ animations: value })
  },
  {
    kind: 'toggle',
    id: 'groupFrame',
    tab: 'ui',
    name: 'ゲームリストのアイコンにグループ色の枠を付ける',
    title: 'ゲームリストのアイコンのグループ色枠の入り切り',
    current: (settings) => settings.groupFrame,
    patch: (value) => ({ groupFrame: value })
  },
  {
    kind: 'toggle',
    id: 'crackerSound',
    tab: 'audio',
    name: 'クラッカー音',
    title: 'クラッカー音の入り切り',
    current: (settings) => settings.crackerSound,
    patch: (value) => ({ crackerSound: value })
  },
  {
    kind: 'toggle',
    id: 'balloonSound',
    tab: 'audio',
    name: '風船の破裂音',
    title: '風船の破裂音の入り切り',
    current: (settings) => settings.balloonSound,
    patch: (value) => ({ balloonSound: value })
  },
  {
    kind: 'select',
    id: 'overlayPlacement',
    tab: 'overlay',
    name: 'レコーダーパネルの初期位置',
    description: '表示するモニターも変更できます。',
    /* Two boxes rather than one list of every corner of every display: the
       display and the corner are two questions, and asked together they made
       a list four times as long as it had to be. The display is on the left
       and the corner on the right, which is the order they are read in. */
    fields: [
      {
        id: 'overlayDisplay',
        title: 'レコーダーパネルを出すモニターを選ぶ',
        options: monitorOptions,
        current: (settings, { displays }) => monitorKey(settings.overlayDisplay, displays),
        patch: (key) => ({ overlayDisplay: key }),
        /* Out to the corner box's own right edge: a monitor's name is far
           longer than a box of 207 can write. */
        width: MONITOR_MENU_WIDTH
      },
      {
        id: 'overlayCorner',
        title: 'レコーダーパネルが開く角を選ぶ',
        options: () =>
          CORNER_ORDER.map((corner) => ({
            key: corner,
            label: t(CORNER_LABELS[corner])
          })),
        current: (settings) => settings.overlayCorner,
        patch: (key) => ({ overlayCorner: key as OverlayCorner })
      }
    ]
  },
  {
    kind: 'select',
    id: 'overlaySize',
    tab: 'overlay',
    name: 'レコーダーパネルのサイズ',
    /* The design writes a description under every name; this row needs none —
       中 is the design's own size and the other two are a quarter either side
       of it, which the three words already say. */
    fields: [
      {
        id: 'overlaySize',
        title: 'レコーダーパネルのサイズを選ぶ',
        options: () => [
          { key: 'large', label: t('大') },
          { key: 'medium', label: t('中') },
          { key: 'small', label: t('小') }
        ],
        current: (settings) => settings.overlaySize,
        patch: (key) => ({ overlaySize: key as OverlaySize })
      }
    ]
  },
  {
    kind: 'toggle',
    id: 'rememberPanelPosition',
    tab: 'overlay',
    name: 'パネルの位置を記憶',
    description: 'ゲームごとに前回の位置へパネルを復元する',
    title: 'パネルの位置の記憶の入り切り',
    current: (settings) => settings.rememberPanelPosition,
    patch: (value) => ({ rememberPanelPosition: value })
  },
  {
    kind: 'select',
    id: 'screenshotFormat',
    tab: 'overlay',
    name: 'スクリーンショットの形式',
    fields: [
      {
        id: 'screenshotFormat',
        title: 'スクリーンショットの形式を選ぶ',
        options: () => [
          { key: 'png', label: 'png' },
          { key: 'jpg', label: 'jpg' }
        ],
        current: (settings) => settings.screenshotFormat,
        patch: (key) => ({ screenshotFormat: key as ScreenshotFormat })
      }
    ]
  },
  {
    kind: 'select',
    id: 'videoFormat',
    tab: 'overlay',
    name: '画面録画ファイルの形式',
    fields: [
      {
        id: 'videoFormat',
        title: '画面録画ファイルの形式を選ぶ',
        options: () => [
          /* Capitals for the two that carry a figure: this face sets lowercase as
             small caps, so "mp4" stood as two short letters against a full-height
             4 and read as a mismatch. "MP" is the figure's own height. */
          { key: 'mp4', label: 'MP4' },
          { key: 'mov', label: 'mov' }
        ],
        current: (settings) => settings.videoFormat,
        patch: (key) => ({ videoFormat: key as VideoFormat })
      }
    ]
  },
  {
    kind: 'select',
    id: 'audioFormat',
    tab: 'overlay',
    name: '録音ファイルの形式',
    fields: [
      {
        id: 'audioFormat',
        title: '録音ファイルの形式を選ぶ',
        options: () => [
          { key: 'mp3', label: 'MP3' },
          { key: 'wav', label: 'wav' }
        ],
        current: (settings) => settings.audioFormat,
        patch: (key) => ({ audioFormat: key as AudioFormat })
      }
    ]
  },
  {
    kind: 'toggle',
    id: 'screenshotToGallery',
    tab: 'overlay',
    name: 'スクリーンショットの自動保存',
    description: 'レコーダーパネルから取ったスクリーンショットをサムネイルに追加する',
    title: 'スクリーンショットをサムネイルに追加するかどうか',
    current: (settings) => settings.screenshotToGallery,
    patch: (value) => ({ screenshotToGallery: value })
  },
  {
    kind: 'toggle',
    id: 'videoToGallery',
    tab: 'overlay',
    name: '画面録画の自動保存',
    description: 'レコーダーパネルからの録画をサムネイルに追加する',
    title: '画面録画をサムネイルに追加するかどうか',
    current: (settings) => settings.videoToGallery,
    patch: (value) => ({ videoToGallery: value })
  },
  {
    kind: 'toggle',
    id: 'audioToVoice',
    tab: 'overlay',
    name: '録音の自動保存',
    description: 'レコーダーパネルからの録音をボイスマネージャーに追加する',
    title: '録音をボイスマネージャーに追加するかどうか',
    current: (settings) => settings.audioToVoice,
    patch: (value) => ({ audioToVoice: value })
  },
  {
    kind: 'select',
    id: 'screenshotSound',
    tab: 'overlay',
    name: 'スクリーンショットの効果音',
    fields: [
      {
        id: 'screenshotSound',
        title: 'スクリーンショットの効果音を選ぶ',
        options: soundOptions,
        current: (settings, { sounds }) => soundKey(settings.screenshotSound, sounds),
        patch: (key) => ({ screenshotSound: key })
      }
    ]
  },
  /* One row each. They began as a single 録画・録音 row; a screen recording
     stopping and an audio take stopping are different events, and the file that
     suits one need not suit the other. Both are played as the recording
     *stops*, never as one starts: a recording is the system's own loopback, so
     a sound made while one is running is a sound in the file. */
  {
    kind: 'select',
    id: 'videoSound',
    tab: 'overlay',
    name: '画面録画の効果音',
    description: '画面録画を終了したときに鳴ります。',
    fields: [
      {
        id: 'videoSound',
        title: '画面録画の効果音を選ぶ',
        options: soundOptions,
        current: (settings, { sounds }) => soundKey(settings.videoSound, sounds),
        patch: (key) => ({ videoSound: key })
      }
    ]
  },
  {
    kind: 'select',
    id: 'audioSound',
    tab: 'overlay',
    name: '録音の効果音',
    description: '録音を終了したときに鳴ります。',
    fields: [
      {
        id: 'audioSound',
        title: '録音の効果音を選ぶ',
        options: soundOptions,
        current: (settings, { sounds }) => soundKey(settings.audioSound, sounds),
        patch: (key) => ({ audioSound: key })
      }
    ]
  }
]

const FIELDS: SelectField[] = ROWS.flatMap((row) => (row.kind === 'select' ? row.fields : []))
const ACTIONS: ActionRow[] = ROWS.filter((row): row is ActionRow => row.kind === 'action')

interface Props {
  settings: AppSettings
  onChange: (patch: Partial<AppSettings>) => void
}

export default function Setting({ settings, onChange }: Props): React.JSX.Element {
  const boardRef = useRef<HTMLDivElement | null>(null)
  /* Whichever field's Select Box the menu is hanging off. One ref rather than
     one per field: only one menu is ever up, and this is what tells
     `OptionMenu` to leave the button that opened it alone when it dismisses on
     a click. */
  const anchorRef = useRef<HTMLButtonElement | null>(null)
  /* Where the menu hangs, in the board's own design pixels. Measured when the
     field is opened rather than written down as a constant: the rows scroll
     once there are more of them than the container is tall. */
  const [menu, setMenu] = useState<{
    id: string
    top: number
    left: number
  } | null>(null)
  /* Which tab is up. It opens on the first every time rather than being kept:
     a tab is where a setting is looked for, not a setting. */
  const [tab, setTab] = useState<TabId>(TABS[0].id)
  /* The desktop's displays and the panel's own effect sounds. Both are read as
     the board opens rather than held by the shell: a display can be plugged in
     or unplugged while the app is running, and a sound is whatever is in the
     folder. */
  const [ctx, setCtx] = useState<FieldContext>({ displays: [], sounds: [] })
  /* Which action rows will act. Asked again on every settings change: what
     one of them is about is a path the row itself writes. */
  const [ready, setReady] = useState<Record<string, boolean>>({})

  useEffect(() => {
    let live = true
    void Promise.all(
      ACTIONS.map(async (row) => [row.id, row.ready ? await row.ready(settings) : true] as const)
    ).then((answers) => {
      if (live) setReady(Object.fromEntries(answers))
    })
    return () => {
      live = false
    }
  }, [settings])

  useEffect(() => {
    let live = true
    void Promise.all([window.library.listDisplays(), window.library.listSoundEffects()]).then(
      ([displays, sounds]) => {
        if (live) setCtx({ displays, sounds })
      }
    )
    return () => {
      live = false
    }
  }, [])

  function toggleMenu(id: string, button: HTMLButtonElement): void {
    const board = boardRef.current
    if (!board) return
    if (menu?.id === id) {
      setMenu(null)
      return
    }
    /* The one list on this board that can change while it is open: a monitor
       can be plugged in or unplugged at any moment, so it is read again as the
       list is dropped rather than only when the board arrived. */
    if (id === 'overlayDisplay') {
      void window.library.listDisplays().then((displays) => {
        setCtx((current) => ({ ...current, displays }))
      })
    }
    const boardRect = board.getBoundingClientRect()
    const rect = button.getBoundingClientRect()
    const scale = boardRect.width / BOARD_WIDTH
    anchorRef.current = button
    /* A list wider than the box it drops from hangs off one of its edges, and
       which one is the field's own: see `SelectField.align`. */
    const field = FIELDS.find((one) => one.id === id)
    const boxLeft = (rect.left - boardRect.left) / scale
    const width = field?.width ?? SELECT_WIDTH
    setMenu({
      id,
      top: (rect.bottom - boardRect.top) / scale,
      left: field?.align === 'right' ? boxLeft + rect.width / scale - width : boxLeft
    })
  }

  const openField = FIELDS.find((field) => field.id === menu?.id)
  /* The option the list stands on is marked with the app's accent and the list
     is brought to it, the way every other menu in the app opens. */
  const openCurrent = openField?.current(settings, ctx)
  const openOptions =
    openField?.options(ctx).map((option) => ({
      ...option,
      current: option.key === openCurrent
    })) ?? []

  return (
    <div className="setting-board" ref={boardRef}>
      {/* Penpot: Top — 1515x84 */}
      <div className="setting-top">
        <div className="setting-heading">
          <div className="setting-letter">
            {/* Penpot draws the mark as a "⚙" run; it is the app's own gear
                artwork instead, placed by geometry rather than by wherever a
                glyph's baseline rounds to. */}
            <span className="setting-mark">
              <svg viewBox={GEAR_VIEW_BOX} aria-hidden="true">
                <path d={GEAR_PATH} />
              </svg>
            </span>
            <h1 className="setting-word">Setting</h1>
          </div>

          {/* Penpot: Under Line — a 172px bar plus a 132x8 tapering triangle */}
          <div className="setting-underline">
            <span className="setting-underline-bar" />
            <svg className="setting-underline-tail" viewBox="0 0 132 8" preserveAspectRatio="none">
              <path d="M0,0 L132,0 L0,8 Z" fill="#e1e8ed" />
            </svg>
          </div>
        </div>

        {/* Not in the design, which leaves the Top's right half empty: seven
            rows come to more than the container is tall, and a board that
            scrolls is a board where a setting is looked for rather than seen.
            They stand on the heading's own Under Line. */}
        <div className="setting-tabs" role="tablist">
          {TABS.map((entry) => (
            <button
              className={`setting-tab${entry.id === tab ? ' is-current' : ''}`}
              key={entry.id}
              role="tab"
              aria-selected={entry.id === tab}
              onClick={() => {
                setTab(entry.id)
                setMenu(null)
              }}
            >
              <span className="setting-tab-word">{t(entry.label)}</span>
              <span className="setting-tab-mark" />
            </button>
          ))}
        </div>
      </div>

      {/* The rows are keyed on the tab so a switch remounts them, which is what
          runs their arrival — the board slot's own fade at the length a handful
          of rows needs. */}
      <div className="setting-container" key={tab}>
        {ROWS.filter((row) => row.tab === tab).map((row) => (
          <div className="setting-column" key={row.id}>
            <div className="setting-explain">
              <span className="setting-name">{t(row.name)}</span>
              {row.description && <span className="setting-description">{t(row.description)}</span>}
              {row.path && <PathRow field={row.path} settings={settings} onChange={onChange} />}
            </div>

            {row.kind === 'select' && (
              /* Penpot: Select Box — 207x59. The whole box is the button
                 rather than only the arrow, there being nothing to type. */
              <div className="setting-selects">
                {row.fields.map((field) => (
                  <SelectBox
                    key={field.id}
                    field={field}
                    settings={settings}
                    ctx={ctx}
                    open={menu?.id === field.id}
                    onToggle={(button) => toggleMenu(field.id, button)}
                  />
                ))}
              </div>
            )}

            {row.kind === 'toggle' && (
              /* Penpot: On / Off Button — 207x59, each half its own button. */
              <div className="setting-switch" role="group" aria-label={t(row.title)}>
                {(['on', 'off'] as Toggle[]).map((value) => (
                  <button
                    className={`setting-switch-half ${value}${
                      row.current(settings) === value ? ' chosen' : ''
                    }`}
                    key={value}
                    onClick={() => onChange(row.patch(value))}
                    title={t(row.title)}
                    aria-pressed={row.current(settings) === value}
                  >
                    <span className="setting-switch-label">{value}</span>
                  </button>
                ))}
              </div>
            )}

            {row.kind === 'action' && (
              /* Not in the design, which draws no button on a row: it takes
                 the Select Box's own 207x59 and its plate, so it stands
                 exactly where every other row's control does. */
              <button
                className={`setting-action${row.danger ? ' danger' : ''}`}
                onClick={() => row.run(settings, onChange)}
                disabled={ready[row.id] === false}
                title={
                  ready[row.id] === false
                    ? t('バックアップファイルのパスを指定してください')
                    : t(row.title)
                }
              >
                {t(row.label)}
              </button>
            )}
          </div>
        ))}
      </div>

      {menu && openField && (
        <OptionMenu
          options={openOptions}
          top={menu.top}
          left={menu.left}
          width={openField.width ?? SELECT_WIDTH}
          /* Ten is as many as the board has room for under a row that is
             already most of the way down it — the same figure the side
             panel's Sort menu stands at. Past that the menu scrolls. */
          maxRows={Math.min(openOptions.length, 10)}
          scrollToKey={openCurrent}
          onPick={(key) => {
            onChange(openField.patch(key))
            setMenu(null)
          }}
          onDismiss={() => setMenu(null)}
          anchorRef={anchorRef}
          /* A sound is offered by the number its file is named for, so every
             row of those two menus carries a 試聴: a number says nothing about
             a sound and hearing it is the only thing that does. */
          onAudition={(key) => {
            const sound = ctx.sounds.find((entry) => entry.key === key)
            if (sound) playSound(soundEffectUrl(sound.file), SOUND_EFFECT_VOLUME)
          }}
        />
      )}
    </div>
  )
}

/* The description slot as a field: what the row needs said is a place rather
   than a sentence. Settled the way the side panel's Group field is — what is in
   it and what is stored are two pieces of state, a half-typed path being no
   folder — so it commits on Enter or on the caret leaving, and Escape puts back
   what was there. The 参照 button commits as it answers, a folder chosen from a
   dialog being finished by definition. */
function PathRow({
  field,
  settings,
  onChange
}: {
  field: PathField
  settings: AppSettings
  onChange: (patch: Partial<AppSettings>) => void
}): React.JSX.Element {
  const stored = field.value(settings)
  const [draft, setDraft] = useState(stored)
  const settled = useRef(stored)

  useEffect(() => {
    if (settled.current !== stored) {
      settled.current = stored
      setDraft(stored)
    }
  }, [stored])

  function commit(value: string): void {
    const next = value.trim()
    settled.current = next
    setDraft(next)
    if (next !== stored) onChange(field.patch(next))
  }

  return (
    <div className="setting-path">
      <input
        className="setting-path-field"
        value={draft}
        placeholder={t(field.placeholder)}
        spellCheck={false}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={(event) => commit(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur()
          if (event.key === 'Escape') {
            setDraft(stored)
            event.currentTarget.blur()
          }
        }}
      />
      {field.browse && (
        <button
          className="setting-path-browse"
          onClick={() => {
            void field.browse?.().then((picked) => {
              if (picked) commit(picked)
            })
          }}
        >
          {t('参照')}
        </button>
      )}
    </div>
  )
}

/* Penpot: Select Box — 207x59, the value's 167 box and the 40px arrow beside it
   squared off into one pill. The whole box is the button rather than only the
   arrow: a setting of this kind is one of a fixed list, so there is nothing to
   type into the field and the menu is the only way to change it. */
function SelectBox({
  field,
  settings,
  ctx,
  open,
  onToggle
}: {
  field: SelectField
  settings: AppSettings
  ctx: FieldContext
  open: boolean
  onToggle: (button: HTMLButtonElement) => void
}): React.JSX.Element {
  const options = field.options(ctx)
  const current = field.current(settings, ctx)
  const value = options.find((option) => option.key === current) ?? options[0]

  return (
    <button
      className="setting-select"
      onClick={(event) => onToggle(event.currentTarget)}
      title={t(field.title)}
      aria-haspopup="menu"
      aria-expanded={open}
    >
      <span className="setting-select-value">
        <SelectLabel label={value?.short ?? value?.label ?? ''} />
      </span>
      <span className="setting-select-arrow">
        <span className="setting-select-caret">▼</span>
      </span>
    </button>
  )
}

/* Penpot sets the value at 41px, and "enable" comes to exactly the 117 the box
   leaves. A language's name is whatever it is called in its own language, so a
   run past that is stepped down to fit the way the clock's date is — and then
   its ink is put on the box's middle (`centreInk` in `ink.ts`, which is where
   the reasoning is), the box itself not doing that for it: measured at 41,
   「日本語」 stood 3.0px above the middle and "png" 3.5 below it. Both are
   done again once the faces are all in: a run measured in a fallback face is
   measured at the wrong size and the wrong height. */
function SelectLabel({ label }: { label: string }): React.JSX.Element {
  const ref = useRef<HTMLSpanElement | null>(null)
  const probeRef = useRef<HTMLSpanElement | null>(null)

  useEffect(() => {
    let dropped = false
    const fit = (): void => {
      const el = ref.current
      const probe = probeRef.current
      if (!el || !probe) return
      el.style.fontSize = `${SELECT_FONT_SIZE}px`
      el.style.transform = ''
      const width = el.scrollWidth
      const size =
        width > SELECT_LABEL_WIDTH
          ? Math.floor(SELECT_FONT_SIZE * (SELECT_LABEL_WIDTH / width))
          : SELECT_FONT_SIZE
      el.style.fontSize = `${size}px`
      /* The label's padding is the same above and below, so the middle of its
         box is the middle of the line box the flex has centred. */
      centreInk(el, probe, label, size)
    }
    fit()
    void document.fonts.ready.then(() => {
      if (!dropped) fit()
    })
    return () => {
      dropped = true
    }
  }, [label])

  return (
    <span className="setting-select-label" ref={ref}>
      {label}
      {/* Where the baseline is: an empty inline-block stands on it, so its
          bottom edge says where it stands. Nothing is drawn. */}
      <span className="setting-select-baseline" ref={probeRef} />
    </span>
  )
}
