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

export function launchGame(exePath: string, runAsAdmin: boolean, onExit: () => void): void {
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
    return
  }

  const child = spawn(exePath, [], { cwd: workDir, detached: false })
  child.once('exit', () => onExit())
  child.once('error', () => onExit())
}
