import { createWriteStream, existsSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { pipeline } from 'node:stream/promises'

const url = 'https://github.com/danielgatis/rembg/releases/download/v0.0.0/BiRefNet-general-bb_swin_v1_tiny-epoch_232.onnx'
const target = new URL('../models/BiRefNet-general-bb_swin_v1_tiny-epoch_232.onnx', import.meta.url)

await mkdir(new URL('../models/', import.meta.url), { recursive: true })
if (existsSync(target)) {
  console.log('Model already exists:', target.pathname)
} else {
  console.log('Downloading 224MB BiRefNet Lite model...')
  const response = await fetch(url)
  if (!response.ok || !response.body) throw new Error(`Download failed: ${response.status}`)
  await pipeline(response.body, createWriteStream(target))
  console.log('Model saved:', target.pathname)
}
