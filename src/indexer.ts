import { readdir, readFile } from 'node:fs/promises'
import { join, extname, basename } from 'node:path'
import type { Route, IndexFilesOptions } from './types.js'

const DEFAULT_EXTENSIONS = ['.md', '.mdc', '.txt']

function extractFrontmatter(content: string): { description?: string; metadata?: Record<string, unknown> } {
  const match = content.match(/^---\s*\n([\s\S]*?)\n---/)
  if (!match) return {}
  const result: Record<string, unknown> = {}
  for (const line of match[1].split('\n')) {
    const idx = line.indexOf(':')
    if (idx === -1) continue
    result[line.slice(0, idx).trim()] = line.slice(idx + 1).trim()
  }
  return {
    description: typeof result.description === 'string' ? result.description : undefined,
    metadata: result,
  }
}

function extractHeading(content: string): string {
  const stripped = content.replace(/^---\s*\n[\s\S]*?\n---\s*\n?/, '')
  for (const line of stripped.split('\n')) {
    const h = line.match(/^#+\s+(.+)/)
    if (h) return h[1].trim()
    if (line.trim()) return line.trim()
  }
  return ''
}

async function scanDir(dir: string, extensions: string[]): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true })
  const files: string[] = []
  for (const entry of entries) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) files.push(...await scanDir(full, extensions))
    else if (extensions.includes(extname(entry.name))) files.push(full)
  }
  return files
}

export async function indexFiles(dir: string, options: IndexFilesOptions): Promise<Route[]> {
  const extensions = options.extensions ?? DEFAULT_EXTENSIONS
  const parseFm = options.parseFrontmatter !== false
  const files = await scanDir(dir, extensions)
  const routes: Route[] = []

  for (const filePath of files) {
    const content = await readFile(filePath, 'utf-8')
    const name = basename(filePath, extname(filePath))
    if (name === 'index') continue

    let description: string
    let metadata: Record<string, unknown> | undefined

    if (parseFm) {
      const fm = extractFrontmatter(content)
      description = fm.description ?? extractHeading(content)
      metadata = fm.metadata
    } else {
      description = extractHeading(content)
    }

    routes.push({ type: options.type, name, description, path: filePath, metadata })
  }

  return routes
}
