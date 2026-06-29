# Embedding Models

Pyxis uses real embedding models — not hashes, not random vectors. The default is Nomic Embed v2, which runs locally via ONNX and requires no API key.

---

## Default: Nomic Embed v2

```typescript
import { createEmbedFn } from 'pyxis'
const embed = await createEmbedFn()  // nomic-ai/nomic-embed-text-v1
```

| Property | Value |
|---|---|
| Model | `nomic-ai/nomic-embed-text-v1` |
| Dimensions | 768 |
| MTEB score | ~62 |
| Pooling | Mean |
| Normalization | L2 |
| Runtime | ONNX (fp32) |
| Download size | ~560MB |
| Cache location | `~/.cache/huggingface/hub/` |

The model is downloaded once on first use, then cached locally. Subsequent loads read from disk — no network required.

---

## How `createEmbedFn` works

```typescript
// src/embeddings.ts
let _pipeline: any = null

export async function createEmbedFn(model = 'nomic-ai/nomic-embed-text-v1') {
  if (!_pipeline) {
    const { pipeline } = await import('@huggingface/transformers')
    _pipeline = await pipeline('feature-extraction', model, { dtype: 'fp32' })
  }
  return async (text: string): Promise<number[]> => {
    const output = await _pipeline(text, { pooling: 'mean', normalize: true })
    return Array.from(output.data)
  }
}
```

The pipeline is a module-level singleton. Calling `createEmbedFn()` multiple times returns the same instance — safe to call from multiple places, only initializes once.

---

## Using a different model

Pass any HuggingFace model ID that supports `feature-extraction`:

```typescript
// Higher quality, more dimensions, slower
const embed = await createEmbedFn('BAAI/bge-large-en-v1.5')

// Smaller and faster, slightly lower quality
const embed = await createEmbedFn('BAAI/bge-small-en-v1.5')

// Multilingual
const embed = await createEmbedFn('intfloat/multilingual-e5-base')
```

Changing models requires a full reindex — existing embeddings are incompatible with different model dimensions or normalization.

---

## ONNX runtime

Pyxis uses `@huggingface/transformers` which runs models via `onnxruntime-node` — a native N-API addon. Because it includes native binaries, it must be trusted before Bun will run it:

```bash
bun pm trust onnxruntime-node
bun install
```

Without this, Bun refuses to execute the addon's postinstall script and the model fails to load.

---

## Mock embeddings (testing only)

```typescript
import { createMockEmbedFn } from 'pyxis'
const embed = createMockEmbedFn(768)  // dimensions must match your index
```

Returns a deterministic hash-based embedding. Same input always produces the same vector, so `add` + `query` round-trips work. However, similar texts do NOT produce similar vectors — there is no semantic understanding.

Use only in unit tests where you want to verify indexing/retrieval mechanics without downloading a model.

```typescript
// ✓ Good test use
const embed = createMockEmbedFn()
const router = new Pyxis(embed, { dbPath: ':memory:' })
await router.add({ type: 'doc', name: 'auth', description: 'auth docs', path: 'docs/auth.md' })
const results = await router.query('auth')  // returns the route, score is arbitrary

// ✗ Bad test use — mock embeddings can't test semantic similarity
const results = await router.query('authentication session')  // may not match 'auth' route
```

---

## Model comparison

| Model | MTEB | Dims | Size | Speed | Notes |
|---|---|---|---|---|---|
| `nomic-ai/nomic-embed-text-v1` | ~62 | 768 | 560MB | Medium | Default. Good balance. |
| `BAAI/bge-large-en-v1.5` | ~64 | 1024 | 1.3GB | Slow | Highest quality English |
| `BAAI/bge-small-en-v1.5` | ~58 | 384 | 130MB | Fast | Good for low-resource environments |
| `intfloat/multilingual-e5-base` | ~58 | 768 | 1.1GB | Medium | Multilingual support |
| `sentence-transformers/all-MiniLM-L6-v2` | ~56 | 384 | 90MB | Fast | Widely used baseline |

MTEB scores are approximate and depend on the benchmark task. For code-search workloads, Nomic v2 and BGE-large perform best in practice.

---

## Changing models on an existing index

The index stores raw float32 embeddings — the model dimensionality is inferred from `routes[0].embedding.length`. If you change to a model with different dimensions, the HNSW index will be built with the wrong dimensionality and queries will fail silently.

**Always run a full reindex after changing models:**

```bash
# 1. Update your createEmbedFn call to use the new model
# 2. Delete the existing index
rm .lattice/pyxis.json
# 3. Rebuild from scratch
bun run index --full
```

---

## HuggingFace cache

Models are cached in `~/.cache/huggingface/hub/`. To use a different cache location:

```bash
HF_HOME=/custom/cache bun run index
```

To pre-download the model without running an index:

```typescript
import { createEmbedFn } from 'pyxis'
await createEmbedFn()  // just loading warms the cache
console.log('Model ready')
```
