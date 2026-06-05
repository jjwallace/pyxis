import { readFile, readdir } from 'node:fs/promises'
import { join, extname, relative } from 'node:path'
import ts from 'typescript'
import type { Route, IndexCodeOptions } from './types.js'

type Language = 'typescript' | 'javascript' | 'rust'

const EXT_MAP: Record<string, Language> = {
  '.ts': 'typescript',
  '.tsx': 'typescript',
  '.js': 'javascript',
  '.jsx': 'javascript',
  '.rs': 'rust',
}

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'target', '.turbo', 'build', 'out', '.next'])

interface Symbol {
  type: string
  name: string
  signature: string
  comment: string
  line: number
}

function lineOf(src: string, pos: number): number {
  return src.slice(0, pos).split('\n').length
}

// ─── TypeScript / JavaScript (TypeScript Compiler API) ───────────────────────

async function extractTS(filePath: string): Promise<Symbol[]> {
  const src = await readFile(filePath, 'utf-8')
  const sf = ts.createSourceFile(filePath, src, ts.ScriptTarget.Latest, true)
  const symbols: Symbol[] = []

  function getJSDoc(node: ts.Node): string {
    const ranges = ts.getLeadingCommentRanges(src, node.getFullStart())
    if (!ranges?.length) return ''
    const last = ranges[ranges.length - 1]
    const comment = src.slice(last.pos, last.end)
    return comment
      .replace(/^\/\*\*?|\*\/$/g, '')
      .replace(/^\s*\*\s?/gm, '')
      .replace(/\s+/g, ' ')
      .trim()
  }

  function getSignature(node: ts.FunctionLike): string {
    const params = node.parameters.map(p => p.getText(sf)).join(', ')
    const ret = node.type ? `: ${node.type.getText(sf)}` : ''
    return `(${params})${ret}`
  }

  function visit(node: ts.Node) {
    if (ts.isFunctionDeclaration(node) && node.name) {
      symbols.push({
        type: 'function',
        name: node.name.text,
        signature: getSignature(node),
        comment: getJSDoc(node),
        line: lineOf(src, node.getStart(sf)),
      })
    }

    if (ts.isClassDeclaration(node) && node.name) {
      symbols.push({
        type: 'class',
        name: node.name.text,
        signature: '',
        comment: getJSDoc(node),
        line: lineOf(src, node.getStart(sf)),
      })
    }

    if (ts.isInterfaceDeclaration(node)) {
      symbols.push({
        type: 'interface',
        name: node.name.text,
        signature: '',
        comment: getJSDoc(node),
        line: lineOf(src, node.getStart(sf)),
      })
    }

    if (ts.isTypeAliasDeclaration(node)) {
      symbols.push({
        type: 'type',
        name: node.name.text,
        signature: '',
        comment: getJSDoc(node),
        line: lineOf(src, node.getStart(sf)),
      })
    }

    if (ts.isVariableStatement(node)) {
      for (const decl of node.declarationList.declarations) {
        if (!ts.isIdentifier(decl.name)) continue
        const init = decl.initializer
        if (init && (ts.isArrowFunction(init) || ts.isFunctionExpression(init))) {
          symbols.push({
            type: 'function',
            name: decl.name.text,
            signature: getSignature(init),
            comment: getJSDoc(node),
            line: lineOf(src, node.getStart(sf)),
          })
        }
      }
    }

    if (ts.isMethodDeclaration(node) && ts.isIdentifier(node.name)) {
      const name = node.name.text
      if (!['constructor', 'get', 'set'].includes(name)) {
        symbols.push({
          type: 'method',
          name,
          signature: getSignature(node),
          comment: getJSDoc(node),
          line: lineOf(src, node.getStart(sf)),
        })
      }
    }

    ts.forEachChild(node, visit)
  }

  ts.forEachChild(sf, visit)
  return symbols
}

// ─── Rust (regex-based — no native deps) ─────────────────────────────────────

async function extractRust(filePath: string): Promise<Symbol[]> {
  const src = await readFile(filePath, 'utf-8')
  const symbols: Symbol[] = []
  const lines = src.split('\n')

  const patterns: Array<{ re: RegExp; type: string }> = [
    { re: /^pub(?:\([^)]*\))?\s+(?:async\s+)?fn\s+(\w+)\s*(<[^>]*>)?\s*(\([^)]*\))/, type: 'function' },
    { re: /^(?:async\s+)?fn\s+(\w+)\s*(<[^>]*>)?\s*(\([^)]*\))/, type: 'function' },
    { re: /^pub(?:\([^)]*\))?\s+struct\s+(\w+)/, type: 'struct' },
    { re: /^pub(?:\([^)]*\))?\s+enum\s+(\w+)/, type: 'enum' },
    { re: /^pub(?:\([^)]*\))?\s+trait\s+(\w+)/, type: 'trait' },
    { re: /^impl(?:<[^>]*>)?\s+(\w+)/, type: 'impl' },
  ]

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim()

    // Grab doc comment above
    let comment = ''
    let j = i - 1
    const docLines: string[] = []
    while (j >= 0 && lines[j].trim().startsWith('///')) {
      docLines.unshift(lines[j].trim().replace(/^\/\/\/\s?/, ''))
      j--
    }
    comment = docLines.join(' ').trim()

    for (const { re, type } of patterns) {
      const m = line.match(re)
      if (m) {
        const name = m[1]
        const sig = m[3] ?? ''
        symbols.push({ type, name, signature: sig, comment, line: i + 1 })
        break
      }
    }
  }

  return symbols
}

// ─── Scanner ──────────────────────────────────────────────────────────────────

async function scanDir(dir: string, exts: string[]): Promise<string[]> {
  const files: string[] = []
  try {
    const entries = await readdir(dir, { withFileTypes: true })
    for (const e of entries) {
      const full = join(dir, e.name)
      if (e.isDirectory() && !SKIP_DIRS.has(e.name)) {
        files.push(...await scanDir(full, exts))
      } else if (e.isFile() && exts.includes(extname(e.name))) {
        files.push(full)
      }
    }
  } catch {}
  return files
}

/**
 * Index source code files using the TypeScript Compiler API (TS/JS)
 * and regex extraction (Rust). Extracts functions, classes, interfaces,
 * types, structs, enums, and traits as individual routes with line numbers.
 *
 * Route paths include line numbers: "src/auth.ts:45"
 */
export async function indexCode(dir: string, options: IndexCodeOptions = {}): Promise<Route[]> {
  const langs = options.languages ?? ['typescript', 'javascript', 'rust']
  const exts = Object.entries(EXT_MAP)
    .filter(([, lang]) => langs.includes(lang))
    .map(([ext]) => ext)

  const files = await scanDir(dir, exts)
  const routes: Route[] = []

  await Promise.all(files.map(async filePath => {
    const lang = EXT_MAP[extname(filePath)]
    if (!lang) return
    try {
      const symbols = lang === 'rust'
        ? await extractRust(filePath)
        : await extractTS(filePath)

      const relPath = options.rootDir ? relative(options.rootDir, filePath) : filePath

      for (const sym of symbols) {
        if (!sym.name || sym.name.startsWith('_')) continue
        const description = sym.comment ||
          [sym.type, sym.name, sym.signature].filter(Boolean).join(' ')

        routes.push({
          type: sym.type,
          name: sym.name,
          description,
          path: `${relPath}:${sym.line}`,
          metadata: {
            signature: sym.signature || undefined,
            language: lang,
            file: relPath,
            line: sym.line,
            ...options.metadata,
          },
        })
      }
    } catch {
      // skip unparseable files silently
    }
  }))

  return routes
}
