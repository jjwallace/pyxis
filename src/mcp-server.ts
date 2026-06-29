import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { resolve } from 'node:path'
import { Pyxis, createEmbedFn } from './index.js'

const DB_PATH = process.env.PYXIS_DB ?? resolve(process.cwd(), '.lattice/pyxis.json')

const server = new Server(
  { name: 'pyxis', version: '0.1.0' },
  { capabilities: { tools: {} } }
)

let router: Pyxis | null = null

async function getRouter(): Promise<Pyxis> {
  if (router) return router
  const embed = await createEmbedFn()
  router = new Pyxis(embed, { dbPath: DB_PATH })
  await router.init()
  return router
}

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'pyxis_search',
      description:
        'Search the Lattice codebase index by meaning. Returns matching symbols, docs, rules, and commands with file paths and line numbers. Use this before reading files to find where relevant code lives across repos.',
      inputSchema: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Natural language search query',
          },
          type: {
            type: 'string',
            enum: ['doc', 'rule', 'command', 'function', 'class', 'interface', 'type'],
            description: 'Filter by route type',
          },
          project: {
            type: 'string',
            description:
              'Filter to a specific project (e.g. game-components, game-kit, nest-native, template-amino, component-workshop, pyxis)',
          },
          limit: {
            type: 'number',
            description: 'Number of results to return (default 8)',
          },
          mode: {
            type: 'string',
            enum: ['hybrid', 'vector', 'fulltext'],
            description: 'Search mode — hybrid (default), vector-only, or BM25 fulltext-only',
          },
        },
        required: ['query'],
      },
    },
  ],
}))

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  if (req.params.name !== 'pyxis_search') {
    throw new Error(`Unknown tool: ${req.params.name}`)
  }

  const { query, type, project, limit = 8, mode = 'hybrid' } = req.params.arguments as {
    query: string
    type?: string
    project?: string
    limit?: number
    mode?: 'hybrid' | 'vector' | 'fulltext'
  }

  const r = await getRouter()

  if (r.size === 0) {
    return {
      content: [{
        type: 'text',
        text: 'Index is empty. Run `bun run index` in the Lattice root first.',
      }],
    }
  }

  const results = await r.query(query, { type, limit, mode })
  const filtered = project
    ? results.filter(res => res.route.metadata?.project === project)
    : results

  if (filtered.length === 0) {
    const filters = [type && `type:${type}`, project && `project:${project}`].filter(Boolean).join(' ')
    return {
      content: [{
        type: 'text',
        text: `No results for "${query}"${filters ? ` (${filters})` : ''}. Try broadening the query or removing filters.`,
      }],
    }
  }

  const lines = filtered.map((res, i) => {
    const proj = (res.route.metadata?.project as string) ?? '?'
    const desc = res.route.description ? `\n   ${res.route.description}` : ''
    return `${i + 1}. [${res.score.toFixed(2)}] ${res.route.type} · ${proj} — **${res.route.name}**\n   ${res.route.path}${desc}`
  })

  return {
    content: [{
      type: 'text',
      text: `Pyxis: "${query}" → ${filtered.length} hits (${r.size} indexed)\n\n${lines.join('\n\n')}`,
    }],
  }
})

const transport = new StdioServerTransport()
await server.connect(transport)
