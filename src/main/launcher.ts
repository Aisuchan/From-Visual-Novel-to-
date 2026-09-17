import { spawn, execFile } from 'node:child_process'
import path from 'node:path'
import { t } from '../shared/i18n'

const POLL_INTERVAL_MS = 3000
/* How a hand-off is waited out. A launched exe can be a bootstrapper that starts
   the game through another process of the same name and exits at once — a Steam
   game re-launched through Steam is the common one — so its own exit is not the
   game's. After it exits the process list is watched for that name to be (or come
   back) up; these bound how long a re-launch is given to appear before the game
   is taken to have really ended. */
const CONFIRM_INTERVAL_MS = 1000
const CONFIRM_GRACE_POLLS = 6

function psQuote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`
}

function isRunning(stdout: string | null | undefined, exeName: string): boolean {
  return !!stdout && stdout.toLowerCase().includes(exeName.toLowerCase())
}

function pollUntilExited(exeName: string, onExit: () => void): void {
  let seenRunning = false
  const timer = setInterval(() => {
    execFile('tasklist', ['/FI', `IMAGENAME eq ${exeName}`, '/NH'], (_err, stdout) => {
      if (isRunning(stdout, exeName)) {
        seenRunning = true
        return
      }
      if (seenRunning) {
        clearInterval(timer)
        onExit()
      }
    })
  }, POLL_INTERVAL_MS)
}

/* Called when the launched exe has exited, to decide whether the game exited
   with it. If a process of the same name is (or comes) up within the grace, the
   exe was a bootstrapper and the game is still running — it is watched until it
   truly goes; if the name stays gone, the game really ended. This is what keeps
   the Recorder Panel up for a Steam game, whose exe hands off to Steam and exits
   before the panel has settled. */
function confirmExitThenWatch(exeName: string, onExit: () => void): void {
  let checks = 0
  const timer = setInterval(() => {
    execFile('tasklist', ['/FI', `IMAGENAME eq ${exeName}`, '/NH'], (_err, stdout) => {
      if (isRunning(stdout, exeName)) {
        clearInterval(timer)
        pollUntilExited(exeName, onExit)
        return
      }
      if (++checks >= CONFIRM_GRACE_POLLS) {
        clearInterval(timer)
        onExit()
      }
    })
  }, CONFIRM_INTERVAL_MS)
}

/* What a spawn's own failure is worth saying. `spawn` reports these on the
   'error' event rather than by throwing, so they arrive after the call has
   already come back — which is why the caller is told through `onFail` rather
   than by an exception. */
function failureMessage(err: NodeJS.ErrnoException, exePath: string): string {
  if (err.code === 'ENOENT') return t('実行ファイルが見つかりません。\n{0}', exePath)
  if (err.code === 'EACCES') return t('実行ファイルを開く権限がありません。\n{0}', exePath)
  return t('ゲームを起動できませんでした。\n{0}\n{1}', exePath, err.message)
}

/**
 * Starts the game and reports the process id, so a capture can find its window
 * later. An elevated launch goes through PowerShell and detaches, so there is
 * no id to report and `null` comes back instead.
 *
 * A launch that could not be made calls `onFail` with what to say about it
 * rather than `onExit`: nothing ran, so there is no session to have ended in
 * the ordinary way, and the player is owed the reason.
 */
export function launchGame(
  exePath: string,
  runAsAdmin: boolean,
  onExit: () => void,
  onFail: (message: string) => void
): number | null {
  const exeName = path.basename(exePath)
  const workDir = path.dirname(exePath)

  if (runAsAdmin) {
    const psCommand = `Start-Process -FilePath ${psQuote(exePath)} -WorkingDirectory ${psQuote(
      workDir
    )} -Verb RunAs`

    const child = spawn(
      'powershell',
      ['-NoProfile', '-NonInteractive', '-Command', psCommand],
      { windowsHide: true }
    )

    let launchFailed = false
    child.once('error', (err: NodeJS.ErrnoException) => {
      launchFailed = true
      onFail(failureMessage(err, exePath))
    })
    child.once('exit', (code) => {
      if (launchFailed) return
      if (code !== 0) {
        /* PowerShell answers for the whole elevated launch, so a non-zero exit
           is the UAC prompt refused as readily as it is a bad file. Both are
           the game not having started, which is what is said. */
        onFail(t('管理者としての起動ができませんでした。\n{0}', exePath))
        return
      }
      pollUntilExited(exeName, onExit)
    })
    return null
  }

  const child = spawn(exePath, [], { cwd: workDir, detached: false })
  let failed = false
  child.once('error', (err: NodeJS.ErrnoException) => {
    failed = true
    onFail(failureMessage(err, exePath))
  })
  child.once('exit', () => {
    if (failed) return
    /* Not taken as the game having exited on its own: the exe may be a
       bootstrapper (a Steam game re-launched through Steam) that hands off and
       exits at once, which is why the panel never appeared. The process list
       decides — see `confirmExitThenWatch`. */
    confirmExitThenWatch(exeName, onExit)
  })
  return child.pid ?? null
}
