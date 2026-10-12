declare module 'onnxruntime-node' {
  export const InferenceSession: any
  export class Tensor<T = unknown> {
    constructor(type: string, data: T, dims: number[])
    data: T
    dims: number[]
  }
}
