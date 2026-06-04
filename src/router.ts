import MiniSearch from 'minisearch'
import { readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import type { Route, SearchResult, PyxisConfig, QueryOptions, EmbedFn } from './types.js'

const DEFAULT_LIMIT = 5
const DEFAULT_VECTOR_WEIGHT = 0.7
const DEFAULT_FULLTEXT_WEIGHT = 0.3

interface StoredRoute extends Route {
  id: string
  embedding: number[]
}

interface PersistedIndex {
  version: number
  routes: StoredRoute[]
}

function cosine(a: number[], b: number[]): number {
  let dot = 0, magA = 0, magB = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    magA += a[i] * a[i]
    magB += b[i] * b[i]
  }
  const denom = Math.sqrt(magA) * Math.sqrt(magB)
  return denom === 0 ? 0 : dot / denom
}

export class Pyxis {
  private embedFn: EmbedFn
  private config: Required<PyxisConfig>
  private routes: StoredRoute[] = []
  private fts: MiniSearch<StoredRoute>
  private nextId = 0

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

  /** Load persisted index from disk, or start fresh. */
  async init(): Promise<void> {
    if (!existsSync(this.config.dbPath)) return
    try {
      const raw = await readFile(this.config.dbPath, 'utf-8')
      const data: PersistedIndex = JSON.parse(raw)
      this.routes = data.routes ?? []
      this.nextId = this.routes.length
      if (this.routes.length > 0) {
        this.fts.addAll(this.routes)
      }
    } catch {
      // corrupt or missing — start fresh
    }
  }

  /** Persist the current index to disk. */
  async save(): Promise<void> {
    const data: PersistedIndex = { version: 1, routes: this.routes }
    await writeFile(this.config.dbPath, JSON.stringify(data), 'utf-8')
  }

  async add(route: Route): Promise<void> {
    const embedding = await this.embedFn(`${route.name} ${route.description}`)
    const id = String(this.nextId++)
    const stored: StoredRoute = { ...route, id, embedding }
    this.routes.push(stored)
    this.fts.add(stored)
  }

  async addMany(routes: Route[]): Promise<void> {
    // Embed in parallel — Transformers.js v3 handles batching internally
    await Promise.all(routes.map(r => this.add(r)))
  }

  async query(text: string, options: QueryOptions = {}): Promise<SearchResult[]> {
    const limit = options.limit ?? this.config.defaultLimit
    const mode = options.mode ?? 'hybrid'

    const candidates = options.type
      ? this.routes.filter(r => r.type === options.type)
      : this.routes

    if (candidates.length === 0) return []

    // Vector scores
    const vectorScores = new Map<string, number>()
    if (mode !== 'fulltext') {
      const queryEmbedding = await this.embedFn(text)
      for (const r of candidates) {
        vectorScores.set(r.id, cosine(queryEmbedding, r.embedding))
      }
    }

    // Fulltext scores (BM25 via MiniSearch)
    const ftScores = new Map<string, number>()
    if (mode !== 'vector') {
      const ftResults = this.fts.search(text)
      const maxScore = ftResults[0]?.score ?? 1
      for (const r of ftResults) {
        ftScores.set(String(r.id), r.score / maxScore)
      }
    }

    // Merge scores
    const allIds = new Set(candidates.map(r => r.id))
    const scored: { id: string; score: number }[] = []

    for (const id of allIds) {
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

  /** Remove all routes of a given file path (for incremental updates). */
  removeByPath(filePath: string): void {
    const toRemove = this.routes.filter(r => r.path === filePath)
    for (const r of toRemove) this.fts.remove(r)
    this.routes = this.routes.filter(r => r.path !== filePath)
  }

  get size(): number { return this.routes.length }
}
