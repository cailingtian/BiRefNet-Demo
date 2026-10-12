# BiRefNet-Demo

A local Next.js demo for removing image backgrounds with the BiRefNet ONNX model.

## Run locally

```bash
pnpm install
pnpm run setup-model
pnpm dev
```

Open <http://localhost:3000> after the dev server starts.

The model is downloaded into `models/` by `pnpm run setup-model`. It is excluded from Git because GitHub rejects files larger than 100 MB.
