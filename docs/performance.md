# Performance

---

## Index build time

The dominant cost is embedding — running each route's `name + description` through the ONNX model. The HNSW and BM25 index builds are fast by comparison.

| Phase | Time (approx) |
|---|---|
| Model load (cold, first run ever) | 5-15s + download time |
| Model load (warm, model cached) | 3-8s |
| Embedding 2,700 routes | 60-180s (parallel) |
| HNSW rebuild | <1s |
| BM25 rebuild | <1s |
| JSON write (45MB) | <1s |

"Warm" means the ONNX model is already in `~/.cache/huggingface/`. "Cold" includes the ~560MB download.

Embedding time scales linearly with route count. Parallelism helps (routes are embedded concurrently via `Promise.all`), but the ONNX runtime processes one request at a time internally.

---

## Query latency

| Operation | Latency (approx) |
|---|---|
| Embed query text (model warm) | 20-80ms |
| HNSW k-NN search (2,700 nodes) | <1ms |
| BM25 search (MiniSearch) | <1ms |
| Score merge + sort | <1ms |
| **Total (warm session)** | **25-90ms** |
| **First call (model cold)** | **5-15s + query time** |

After the first call in a session, the model stays resident. Subsequent queries are fast.

---

## Memory usage

| Component | Memory (approx) |
|---|---|
| Nomic Embed v2 model (ONNX) | ~1.5GB |
| 2,700 routes (embeddings in RAM) | ~15MB |
| HNSW index | ~5MB |
| MiniSearch fulltext index | ~2MB |
| **Total per session** | **~1.5GB** |

The model dominates. This is fixed cost regardless of index size.

If memory is constrained, consider:
- Using a smaller model (`BAAI/bge-small-en-v1.5` → 384 dims, lighter)
- Running pyxis in a dedicated process rather than colocated with other services

---

## Scaling with route count

| Routes | Index file | Build time | Query time |
|---|---|---|---|
| 500 | ~8MB | ~20s | ~25ms |
| 2,700 | ~45MB | ~90s | ~30ms |
| 10,000 | ~165MB | ~5 min | ~40ms |
| 50,000 | ~820MB | ~25 min | ~80ms |

Query time scales as O(log N) for the HNSW component. At 50,000 routes the query is still fast; the bottleneck is embedding the query text, which is constant.

Build time scales linearly with route count (embedding is the bottleneck). At 50,000 routes, incremental updates become valuable — only touching changed files avoids the full cost.

---

## Filtered query performance

When a `type` or `project` filter reduces the candidate pool below the full route set, HNSW is bypassed:

```
Full set → HNSW k-NN (O log N)
Filtered subset → brute-force cosine (O N_subset)
```

For small subsets (<500 routes), brute-force is fast enough. For large subsets, the filter provides little performance benefit over querying without it. If you frequently filter to a large subset, consider maintaining separate index files per project.

---

## Watch mode performance

Watch mode keeps the model warm between saves. The per-change cost is:

1. Detect changed file (chokidar event)
2. 300ms debounce
3. For code files: re-run AST parser on the directory (~500ms for large dirs)
4. Embed new/changed routes (parallel)
5. HNSW rebuild if routes changed
6. JSON save

For a single `.md` change: embed 1 route (~30ms) + save (<1s). Effectively instant.

For a large `.ts` file with many symbols: re-embed all symbols in that dir (could be hundreds). Watch mode is less efficient than incremental for large code changes.

---

## Reducing build time

**Only index what you actively query.** If you rarely search `component-workshop`, remove it from `CODE_DIRS`. Fewer routes = faster builds and smaller index.

**Use watch mode during active development.** Avoids full rebuilds by only re-embedding changed files.

**Pre-download the model.** Run `bun run index --full` once before you need it, so the model is cached. The ONNX download is a one-time cost.

**Cache in CI.** See [ci-integration.md](ci-integration.md) for caching strategies that skip full rebuilds when source hasn't changed.

---

## Benchmarking

```typescript
import { Pyxis, createEmbedFn } from 'pyxis'

const embed = await createEmbedFn()
const router = new Pyxis(embed, { dbPath: '.lattice/pyxis.json' })
await router.init()

const N = 20
const start = performance.now()
for (let i = 0; i < N; i++) {
  await router.query('JWT authentication middleware', { limit: 8 })
}
const elapsed = performance.now() - start
console.log(`${N} queries in ${elapsed.toFixed(0)}ms → ${(elapsed / N).toFixed(1)}ms/query`)
```
