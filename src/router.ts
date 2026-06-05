import MiniSearch from 'minisearch'
import { readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import type { Route, SearchResult, PyxisConfig, QueryOptions, EmbedFn } from './types.js'

const DEFAULT_LIMIT = 5
const DEFAULT_VECTOR_WEIGHT = 0.7
const DEFAULT_FULLTEXT_WEIGHT = 0.3

interface StoredRoute extends Route {
  id: number
  embedding: number[]
}

interface PersistedIndex {
  version: number
  routes: StoredRoute[]
}

export class Pyxis {
  private embedFn: EmbedFn
  private config: Required<PyxisConfig>
  private routes: StoredRoute[] = []
  private fts: MiniSearch<StoredRoute>
  private hnsw: any = null
  private nextId = 0
  private dimensions = 768

  constructor(embedFn: EmbedFn, config: PyxisConfig = {}) {
    this.embedFn = embedFn
    this.config = {
      dbPath: config.dbPath ?? './pyxis.json',
      defaultLimit: config.defaultLimit ?? DEFAULT_LIMIT,
      vectorWeight: config.vectorWeight ?? DEFAULT_VECTOR_WEIGHT,
      fulltextWeight: config.fulltextWeight ?? DEFAULT_FULLTEXT_WEIGHT,
    }
    this.fts = new MiniSearch({
      fields: ['name', 'description'],
      storeFields: ['id'],
      searchOptions: { prefix: true, fuzzy: 0.2 },
    })
  }

  private async buildHnsw(): Promise<void> {
    const { Index, MetricKind, ScalarKind } = await import('usearch')
    this.hnsw = new Index(this.dimensions, MetricKind.Cos, ScalarKind.F32, 16)
    for (const r of this.routes) {
      this.hnsw.add(BigInt(r.id), new Float32Array(r.embedding))
    }
  }

  async init(): Promise<void> {
    if (!existsSync(this.config.dbPath)) return
    try {
      const raw = await readFile(this.config.dbPath, 'utf-8')
      const data: PersistedIndex = JSON.parse(raw)
      this.routes = data.routes ?? []
      this.nextId = this.routes.length > 0
        ? Math.max(...this.routes.map(r => r.id)) + 1
        : 0
      if (this.routes.length > 0) {
        if (this.routes[0].embedding) {
          this.dimensions = this.routes[0].embedding.length
        }
        this.fts.addAll(this.routes.map(r => ({ ...r, id: String(r.id) })) as any)
        await this.buildHnsw()
      }
    } catch {
      // corrupt or missing — start fresh
    }
  }

  async save(): Promise<void> {
    const data: PersistedIndex = { version: 2, routes: this.routes }
    await writeFile(this.config.dbPath, JSON.stringify(data), 'utf-8')
  }

  async add(route: Route): Promise<void> {
    const embedding = await this.embedFn(`${route.name} ${route.description}`)
    this.dimensions = embedding.length
    const id = this.nextId++
    const stored: StoredRoute = { ...route, id, embedding }
    this.routes.push(stored)
    this.fts.add({ ...stored, id: String(id) } as any)

    // Rebuild HNSW — usearch doesn't support incremental add after construction
    // For small batches this is fast; addMany rebuilds once after all adds
    this._hnswDirty = true
  }

  private _hnswDirty = false

  async addMany(routes: Route[]): Promise<void> {
    await Promise.all(routes.map(r => this.add(r)))
    if (this._hnswDirty) {
      await this.buildHnsw()
      this._hnswDirty = false
    }
  }

  async query(text: string, options: QueryOptions = {}): Promise<SearchResult[]> {
    const limit = options.limit ?? this.config.defaultLimit
    const mode = options.mode ?? 'hybrid'

    const candidates = options.type
      ? this.routes.filter(r => r.type === options.type)
      : this.routes

    if (candidates.length === 0) return []

    const candidateIds = new Set(candidates.map(r => r.id))

    // Vector scores via HNSW (O(log n)) or brute force fallback
    const vectorScores = new Map<number, number>()
    if (mode !== 'fulltext') {
      const queryEmbedding = await this.embedFn(text)

      if (this.hnsw && candidates.length === this.routes.length) {
        // Fast HNSW path — search top-k candidates
        const k = Math.min(limit * 4, this.routes.length)
        const results = this.hnsw.search(new Float32Array(queryEmbedding), k)
        for (let i = 0; i < results.keys.length; i++) {
          const id = Number(results.keys[i])
          // usearch cos metric returns distance (0=identical), convert to similarity
          vectorScores.set(id, 1 - results.distances[i])
        }
      } else {
        // Filtered subset — brute force only over candidates (still O(n_candidates))
        const qv = new Float32Array(queryEmbedding)
        for (const r of candidates) {
          const rv = new Float32Array(r.embedding)
          let dot = 0, magA = 0, magB = 0
          for (let i = 0; i < qv.length; i++) {
            dot += qv[i] * rv[i]; magA += qv[i] * qv[i]; magB += rv[i] * rv[i]
          }
          const denom = Math.sqrt(magA) * Math.sqrt(magB)
          vectorScores.set(r.id, denom === 0 ? 0 : dot / denom)
        }
      }
    }

    // BM25 via MiniSearch
    const ftScores = new Map<number, number>()
    if (mode !== 'vector') {
      const ftResults = this.fts.search(text)
      const maxScore = ftResults[0]?.score ?? 1
      for (const r of ftResults) {
        const id = Number(r.id)
        if (candidateIds.has(id)) ftScores.set(id, r.score / maxScore)
      }
    }

    // Merge
    const scored: { id: number; score: number }[] = []
    for (const id of candidateIds) {
      const v = vectorScores.get(id) ?? 0
      const f = ftScores.get(id) ?? 0
      const score =
        mode === 'vector'   ? v :
        mode === 'fulltext' ? f :
        v * this.config.vectorWeight + f * this.config.fulltextWeight
      scored.push({ id, score })
    }

    scored.sort((a, b) => b.score - a.score)

    const routeById = new Map(this.routes.map(r => [r.id, r]))
    return scored.slice(0, limit).map(({ id, score }) => {
      const r = routeById.get(id)!
      const { embedding: _e, id: _id, ...route } = r
      return { route, score }
    })
  }

  async queryRules(text: string, limit?: number) { return this.query(text, { type: 'rule', limit }) }
  async queryDocs(text: string, limit?: number) { return this.query(text, { type: 'doc', limit }) }
  async queryCommands(text: string, limit?: number) { return this.query(text, { type: 'command', limit }) }

  removeByPath(filePath: string): void {
    const toRemove = this.routes.filter(r => r.path === filePath || r.path.startsWith(filePath + ':'))
    for (const r of toRemove) this.fts.remove({ ...r, id: String(r.id) } as any)
    this.routes = this.routes.filter(r => !r.path.startsWith(filePath))
    this._hnswDirty = true
  }

  get size(): number { return this.routes.length }
}
