import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  serverExternalPackages: ['onnxruntime-node', 'sharp'],
  outputFileTracingIncludes: {
    '/api/remove-background': ['./models/*.onnx'],
  },
}

export default nextConfig
