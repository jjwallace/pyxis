import type { EmbedFn } from './types.js'

let _pipeline: any = null

/**
 * Real semantic embeddings via Transformers.js v3 + Nomic Embed v2.
 * Downloads the ONNX model once and caches locally — no server, no API key.
 * MTEB score ~62 vs all-MiniLM-L6-v2's ~56.
 */
export async function createEmbedFn(
  model = 'nomic-ai/nomic-embed-text-v1'
): Promise<EmbedFn> {
  if (!_pipeline) {
    const { pipeline } = await import('@huggingface/transformers')
    _pipeline = await pipeline('feature-extraction', model, { dtype: 'fp32' })
  }

  return async (text: string): Promise<number[]> => {
    const output = await _pipeline(text, { pooling: 'mean', normalize: true })
    return Array.from(output.data as Float32Array)
  }
}

/**
 * Hash-based mock for tests — deterministic, instant, no model download.
 * Not suitable for production: produces no real semantic signal.
 */
export function createMockEmbedFn(dimensions = 768): EmbedFn {
  return async (text: string): Promise<number[]> => {
    const vec = new Array(dimensions).fill(0)
    const norm = text.toLowerCase().trim()
    for (let i = 0; i < norm.length; i++) {
      vec[(norm.charCodeAt(i) * (i + 1)) % dimensions] += 1
    }
    const mag = Math.sqrt(vec.reduce((s, v) => s + v * v, 0))
    return mag > 0 ? vec.map(v => v / mag) : vec
  }
}
