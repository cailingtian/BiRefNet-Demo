'use client'

import { ChangeEvent, DragEvent, useMemo, useState } from 'react'
import { Download, ImagePlus, LoaderCircle, Sparkles, Upload, WandSparkles } from 'lucide-react'

type Result = { url: string; width: number; height: number; elapsedMs: number; inferenceMs: number; cpuMs: number; cpuPercent: number; rssBeforeMb: number; rssAfterMb: number; cpuCores: number }

export default function Home() {
  const [file, setFile] = useState<File | null>(null)
  const [sourceUrl, setSourceUrl] = useState('')
  const [result, setResult] = useState<Result | null>(null)
  const [threshold, setThreshold] = useState(0)
  const [feather, setFeather] = useState(2)
  const [parametersDirty, setParametersDirty] = useState(false)
  const [busy, setBusy] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [error, setError] = useState('')

  const previewStyle = useMemo(() => ({ '--checker-size': '16px' }) as React.CSSProperties, [])

  function choose(nextFile?: File) {
    if (!nextFile || !nextFile.type.startsWith('image/')) {
      setError('请选择 PNG、JPEG 或 WebP 图片。')
      return
    }
    if (nextFile.size > 10 * 1024 * 1024) {
      setError('图片不能超过 10MB。')
      return
    }
    setError('')
    setResult(null)
    setParametersDirty(false)
    setFile(nextFile)
    setSourceUrl(URL.createObjectURL(nextFile))
  }

  function onFileChange(event: ChangeEvent<HTMLInputElement>) {
    choose(event.target.files?.[0])
    event.currentTarget.value = ''
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault()
    setDragging(false)
    choose(event.dataTransfer.files?.[0])
  }

  async function process() {
    if (!file) return
    setBusy(true)
    setError('')
    const started = performance.now()
    try {
      const body = new FormData()
      body.append('image', file)
      body.append('threshold', String(threshold))
      body.append('feather', String(feather))
      const response = await fetch('/api/remove-background', { method: 'POST', body })
      if (!response.ok) throw new Error((await response.json().catch(() => null))?.error || '处理失败')
      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      setResult({
        url,
        width: Number(response.headers.get('x-image-width')) || 0,
        height: Number(response.headers.get('x-image-height')) || 0,
        elapsedMs: Number(response.headers.get('x-processing-ms')) || Math.round(performance.now() - started),
        inferenceMs: Number(response.headers.get('x-inference-ms')) || 0,
        cpuMs: Number(response.headers.get('x-cpu-ms')) || 0,
        cpuPercent: Number(response.headers.get('x-cpu-percent')) || 0,
        rssBeforeMb: Number(response.headers.get('x-rss-before-mb')) || 0,
        rssAfterMb: Number(response.headers.get('x-rss-after-mb')) || 0,
        cpuCores: Number(response.headers.get('x-cpu-cores')) || 0,
      })
      setParametersDirty(false)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '处理失败，请重试。')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="page-shell">
      <header className="topbar">
        <div className="brand"><span className="brand-mark"><WandSparkles size={16} /></span><span>Fine Cutout Lab</span><span className="beta">LOCAL DEMO</span></div>
        <div className="model-note"><span className="status-dot" /> BiRefNet General Lite <span className="muted">· 1024px mask</span></div>
      </header>

      <section className="intro">
        <div>
          <p className="eyebrow">边缘质量实验台</p>
          <h1>把发丝、薄纱和透明边缘<br /><em>抠得更干净。</em></h1>
          <p className="lede">完全在本机运行的 BiRefNet demo。上传一张图片，直接对比原图与透明 PNG 的边缘细节。</p>
        </div>
        <div className="signal"><Sparkles size={15} /><span>模型只返回前景 alpha，不会上传图片</span></div>
      </section>

      <section className="workspace">
        <div className="control-column">
          <div className="panel-heading"><span className="step">01</span><div><h2>放入图片</h2><p>建议使用有发丝、透明物体或复杂轮廓的原图</p></div></div>
          <div className={`dropzone ${dragging ? 'is-dragging' : ''} ${file ? 'has-file' : ''}`} onDragOver={(event) => { event.preventDefault(); setDragging(true) }} onDragLeave={() => setDragging(false)} onDrop={onDrop}>
            {file ? <><img src={sourceUrl} alt="待处理图片" /><div className="file-overlay"><span>{file.name}</span><button type="button" onClick={() => { setFile(null); setSourceUrl(''); setResult(null) }}>移除</button></div></> : <><div className="upload-icon"><ImagePlus size={23} /></div><strong>拖放图片到这里</strong><span>或点击选择本地文件</span><label className="upload-button"><Upload size={16} /> 选择图片<input type="file" accept="image/png,image/jpeg,image/webp" onChange={onFileChange} /></label></>}
          </div>

          <div className="panel-heading settings-title"><span className="step">02</span><div><h2>边缘微调</h2><p>先生成结果，再调整参数观察细节变化</p></div></div>
          <div className="settings">
            <div className="preset-row" aria-label="边缘处理预设">
              <button type="button" className={threshold === -12 && feather === 1 ? 'is-active' : ''} onClick={() => { setThreshold(-12); setFeather(1); setParametersDirty(true) }}>发丝优先</button>
              <button type="button" className={threshold === 24 && feather === 0 ? 'is-active' : ''} onClick={() => { setThreshold(24); setFeather(0); setParametersDirty(true) }}>干净边缘</button>
              <button type="button" className={threshold === -8 && feather === 2 ? 'is-active' : ''} onClick={() => { setThreshold(-8); setFeather(2); setParametersDirty(true) }}>透明物体</button>
            </div>
            <label><span><b>边缘阈值</b><small>提高可去掉灰边，过高会损失发丝</small></span><output>{threshold}</output></label>
            <input aria-label="边缘阈值" type="range" min="-40" max="50" value={threshold} onChange={(event) => { setThreshold(Number(event.target.value)); setParametersDirty(true) }} />
            <label><span><b>羽化半径</b><small>让透明边缘更自然</small></span><output>{feather}px</output></label>
            <input aria-label="羽化半径" type="range" min="0" max="6" step="0.5" value={feather} onChange={(event) => { setFeather(Number(event.target.value)); setParametersDirty(true) }} />
          </div>
          <button className="process-button" type="button" disabled={!file || busy} onClick={process}>{busy ? <><LoaderCircle className="spin" size={18} /> 正在推理边缘...</> : <><WandSparkles size={18} /> {parametersDirty || result ? '应用参数并重新处理' : '去除背景'}</>}</button>
          {error && <p className="error" role="alert">{error}</p>}
          <p className="privacy"><span className="status-dot" /> 本地 ONNX 推理 · 图片不会离开你的电脑</p>
        </div>

        <div className="result-column">
          <div className="result-header"><div><p className="eyebrow">03 / 结果预览</p><h2>检查边缘细节</h2></div>{result && <a className="download" href={result.url} download="cutout.png"><Download size={16} /> 下载透明 PNG</a>}</div>
          <div className="compare-grid">
            <Preview title="原图" empty={!sourceUrl} src={sourceUrl} alt="原图预览" />
            <Preview title="透明结果" empty={!result} src={result?.url} alt="透明背景结果预览" checker style={previewStyle} />
          </div>
          {result ? <div className="result-meta"><span><b>{result.width} × {result.height}</b> 输出尺寸</span><span><b>{(result.elapsedMs / 1000).toFixed(1)}s</b> 总耗时</span><span><b>{(result.inferenceMs / 1000).toFixed(1)}s</b> 模型推理</span><span><b>{result.cpuMs}ms</b> CPU 时间</span><span><b>{result.cpuPercent}%</b> CPU 占用 · {result.cpuCores} 核</span><span><b>{result.rssAfterMb}MB</b> RSS 内存</span></div> : <div className="empty-hint"><Sparkles size={17} /> 处理完成后，这里会显示透明边缘和资源指标。试试人物头发、玻璃杯或树叶。</div>}
        </div>
      </section>
      <footer>Fine Cutout Lab <span>·</span> for local model evaluation</footer>
    </main>
  )
}

function Preview({ title, src, alt, empty, checker, style }: { title: string; src?: string; alt: string; empty: boolean; checker?: boolean; style?: React.CSSProperties }) {
  return <div className="preview-card"><div className="preview-label"><span>{title}</span>{!empty && <span className="ready">READY</span>}</div><div className={`preview-canvas ${checker ? 'checker' : ''}`} style={style}>{empty ? <div className="preview-placeholder"><div className="placeholder-lines"><span /><span /><span /></div><small>等待图片</small></div> : <img src={src} alt={alt} />}</div></div>
}
