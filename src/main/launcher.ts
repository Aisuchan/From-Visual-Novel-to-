import { spawn, execFile } from 'node:child_process'
import path from 'node:path'

const POLL_INTERVAL_MS = 3000

function psQuote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`
}

function pollUntilExited(exeName: string, onExit: () => void): void {
  let seenRunning = false
  const timer = setInterval(() => {
    execFile('tasklist', ['/FI', `IMAGENAME eq ${exeName}`, '/NH'], (_err, stdout) => {
      const running = !!stdout && stdout.toLowerCase().includes(exeName.toLowerCase())
      if (running) {
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

/**
 * Starts the game and reports the process id, so a capture can find its window
 * later. An elevated launch goes through PowerShell and detaches, so there is
 * no id to report and `null` comes back instead.
 */
export function launchGame(
  exePath: string,
  runAsAdmin: boolean,
  onExit: () => void
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
    child.once('error', () => {
      launchFailed = true
      onExit()
    })
    child.once('exit', (code) => {
      if (launchFailed) return
      if (code !== 0) {
        onExit()
        return
      }
      pollUntilExited(exeName, onExit)
    })
    return null
  }

  const child = spawn(exePath, [], { cwd: workDir, detached: false })
  child.once('exit', () => onExit())
  child.once('error', () => onExit())
  return child.pid ?? null
}
