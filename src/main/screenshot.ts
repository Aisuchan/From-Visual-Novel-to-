import { desktopCapturer, screen } from 'electron'
import fs from 'node:fs'
import path from 'node:path'

export async function captureScreenshot(
  gameTitle: string,
  gameId: number,
  userDataDir: string
): Promise<string> {
  const display = screen.getPrimaryDisplay()
  const sources = await desktopCapturer.getSources({
    types: ['window', 'screen'],
    thumbnailSize: display.size
  })

  const normalizedTitle = gameTitle.toLowerCase()
  const windowMatch = sources.find(
    (source) => source.name && normalizedTitle.includes(source.name.toLowerCase())
  )
  const screenFallback = sources.find((source) => source.id.startsWith('screen:'))
  const target = windowMatch ?? screenFallback

  if (!target) {
    throw new Error('キャプチャ可能な画面/ウィンドウが見つかりませんでした')
  }

  const png = target.thumbnail.toPNG()
  const dir = path.join(userDataDir, 'screenshots', String(gameId))
  fs.mkdirSync(dir, { recursive: true })
  const filePath = path.join(dir, `${Date.now()}.png`)
  fs.writeFileSync(filePath, png)
  return filePath
}
