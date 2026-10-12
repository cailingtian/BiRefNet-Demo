import { NextResponse } from 'next/server'
import * as ort from 'onnxruntime-node'
import sharp from 'sharp'
import os from 'node:os'
import path from 'node:path'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

const MODEL_SIZE = 1024
const modelPath = path.join(process.cwd(), 'models', 'BiRefNet-general-bb_swin_v1_tiny-epoch_232.onnx')
let sessionPromise: Promise<any> | undefined

function getSession() {
  // Keep CPU arena/threading bounded so the 1024px decoder does not over-allocate on laptops.
  sessionPromise ??= ort.InferenceSession.create(modelPath, {
    executionMode: 'parallel',
    graphOptimizationLevel: 'all',
    intraOpNumThreads: 1,
    interOpNumThreads: 1,
    enableCpuMemArena: false,
  }).catch((error: unknown) => {
    sessionPromise = undefined
    throw error
  })
  return sessionPromise
}

function sigmoid(value: number) {
  return 1 / (1 + Math.exp(-Math.max(-30, Math.min(30, value))))
}

export async function POST(request: Request) {
  const wallStarted = process.hrtime.bigint()
  const cpuStarted = process.cpuUsage()
  const rssBefore = process.memoryUsage().rss
  try {
    const form = await request.formData()
    const uploaded = form.get('image')
    if (!(uploaded instanceof File)) return NextResponse.json({ error: '请先选择图片。' }, { status: 400 })
    if (!uploaded.type.startsWith('image/')) return NextResponse.json({ error: '只支持图片文件。' }, { status: 415 })
    if (uploaded.size > 4 * 1024 * 1024) return NextResponse.json({ error: '图片不能超过 4MB。' }, { status: 413 })

    const input = Buffer.from(await uploaded.arrayBuffer())
    const decoded = await sharp(input).rotate().ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    const width = decoded.info.width
    const height = decoded.info.height
    if (!width || !height) return NextResponse.json({ error: '无法读取图片尺寸。' }, { status: 422 })

    const resized = await sharp(input).rotate().resize(MODEL_SIZE, MODEL_SIZE, { fit: 'fill' }).removeAlpha().raw().toBuffer()
    const tensorData = new Float32Array(1 * 3 * MODEL_SIZE * MODEL_SIZE)
    const mean = [0.485, 0.456, 0.406]
    const std = [0.229, 0.224, 0.225]
    for (let y = 0; y < MODEL_SIZE; y += 1) {
      for (let x = 0; x < MODEL_SIZE; x += 1) {
        const pixel = (y * MODEL_SIZE + x) * 3
        const index = y * MODEL_SIZE + x
        tensorData[index] = (resized[pixel] / 255 - mean[0]) / std[0]
        tensorData[MODEL_SIZE * MODEL_SIZE + index] = (resized[pixel + 1] / 255 - mean[1]) / std[1]
        tensorData[2 * MODEL_SIZE * MODEL_SIZE + index] = (resized[pixel + 2] / 255 - mean[2]) / std[2]
      }
    }

    const session = await getSession()
    const inferenceStarted = process.hrtime.bigint()
    const output = await session.run({ [session.inputNames[0]]: new ort.Tensor('float32', tensorData, [1, 3, MODEL_SIZE, MODEL_SIZE]) })
    const inferenceMs = Number(process.hrtime.bigint() - inferenceStarted) / 1_000_000
    const logits = output[session.outputNames[0]].data as Float32Array
    const mask = Buffer.alloc(MODEL_SIZE * MODEL_SIZE)
    // BiRefNet's official rembg post-processing normalizes the sigmoid map per image.
    // Without this step, low-contrast person masks can become fully opaque.
    const probabilities = new Float32Array(logits.length)
    let predictionMin = 1
    let predictionMax = 0
    for (let i = 0; i < probabilities.length; i += 1) {
      const probability = sigmoid(logits[i])
      probabilities[i] = probability
      predictionMin = Math.min(predictionMin, probability)
      predictionMax = Math.max(predictionMax, probability)
    }
    const predictionRange = Math.max(predictionMax - predictionMin, 1e-6)
    for (let i = 0; i < mask.length; i += 1) {
      mask[i] = Math.round(((probabilities[i] - predictionMin) / predictionRange) * 255)
    }

    const feather = Math.max(0, Math.min(6, Number(form.get('feather')) || 0))
    const threshold = Math.max(-40, Math.min(50, Number(form.get('threshold')) || 0))
    const processedMask = await sharp(mask, { raw: { width: MODEL_SIZE, height: MODEL_SIZE, channels: 1 } })
      .blur(feather / 2)
      .resize(width, height, { fit: 'fill' })
      .greyscale()
      .raw()
      .toBuffer()
    for (let i = 0; i < processedMask.length; i += 1) processedMask[i] = Math.max(0, Math.min(255, ((processedMask[i] - threshold) * 255) / (255 - threshold)))
    let maskMin = 255
    let maskMax = 0
    let maskSum = 0
    for (const value of processedMask) {
      maskMin = Math.min(maskMin, value)
      maskMax = Math.max(maskMax, value)
      maskSum += value
    }
    const maskMean = maskSum / processedMask.length

    const rgba = Buffer.alloc(width * height * 4)
    for (let i = 0; i < width * height; i += 1) {
      const source = i * 4
      const target = source
      rgba[target] = decoded.data[source]
      rgba[target + 1] = decoded.data[source + 1]
      rgba[target + 2] = decoded.data[source + 2]
      rgba[target + 3] = processedMask[i]
    }
    const result = await sharp(rgba, { raw: { width, height, channels: 4 } }).png().toBuffer()
    const elapsedMs = Number(process.hrtime.bigint() - wallStarted) / 1_000_000
    const cpu = process.cpuUsage(cpuStarted)
    const cpuMs = (cpu.user + cpu.system) / 1_000
    const cpuPercent = elapsedMs > 0 ? (cpuMs / elapsedMs / Math.max(1, os.cpus().length)) * 100 : 0
    const rssAfter = process.memoryUsage().rss
    const metrics = {
      elapsedMs: Math.round(elapsedMs),
      inferenceMs: Math.round(inferenceMs),
      cpuMs: Math.round(cpuMs),
      cpuPercent: Number(cpuPercent.toFixed(1)),
      rssBeforeMb: Number((rssBefore / 1024 / 1024).toFixed(1)),
      rssAfterMb: Number((rssAfter / 1024 / 1024).toFixed(1)),
      cpuCores: os.cpus().length,
    }
    console.info('[remove-background:metrics]', JSON.stringify(metrics))
    return new NextResponse(new Uint8Array(result), {
      headers: {
        'Content-Type': 'image/png',
        'Cache-Control': 'no-store',
        'X-Image-Width': String(width),
        'X-Image-Height': String(height),
        'X-Processing-Ms': String(metrics.elapsedMs),
        'X-Inference-Ms': String(metrics.inferenceMs),
        'X-Cpu-Ms': String(metrics.cpuMs),
        'X-Cpu-Percent': String(metrics.cpuPercent),
        'X-Rss-Before-Mb': String(metrics.rssBeforeMb),
        'X-Rss-After-Mb': String(metrics.rssAfterMb),
        'X-Cpu-Cores': String(metrics.cpuCores),
        'X-Mask-Min': String(maskMin),
        'X-Mask-Max': String(maskMax),
        'X-Mask-Mean': maskMean.toFixed(2),
      },
    })
  } catch (error) {
    console.error('[remove-background]', error)
    const message = error instanceof Error && error.message.includes('ENOENT') ? '模型文件不存在，请先运行 npm run setup-model。' : '推理失败，请检查模型文件和图片后重试。'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
