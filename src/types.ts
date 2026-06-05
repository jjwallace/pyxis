export interface Route {
  type: string
  name: string
  description: string
  path: string
  metadata?: Record<string, unknown>
}

export interface SearchResult {
  route: Route
  score: number
}

export interface PyxisConfig {
  /** Path to persist the index (default: './pyxis.json') */
  dbPath?: string
  /** Number of results to return per query (default: 5) */
  defaultLimit?: number
  /** Weights for hybrid scoring: vector vs fulltext (default: 0.7 / 0.3) */
  vectorWeight?: number
  fulltextWeight?: number
}

export interface QueryOptions {
  limit?: number
  type?: string
  mode?: 'hybrid' | 'vector' | 'fulltext'
}

export interface IndexFilesOptions {
  type: string
  extensions?: string[]
  parseFrontmatter?: boolean
}

export interface IndexCodeOptions {
  /** Languages to parse (default: all supported) */
  languages?: Array<'typescript' | 'javascript' | 'rust'>
  /** Root dir for computing relative paths in route.path */
  rootDir?: string
  /** Extra metadata to attach to every extracted symbol */
  metadata?: Record<string, unknown>
}

export type EmbedFn = (text: string) => Promise<number[]>
