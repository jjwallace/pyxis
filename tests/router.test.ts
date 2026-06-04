import { describe, it, expect, beforeEach } from 'vitest'
import { Pyxis, createMockEmbedFn } from '../src/index.js'

describe('Pyxis', () => {
  let router: Pyxis

  beforeEach(async () => {
    router = new Pyxis(createMockEmbedFn(), { dbPath: '/tmp/pyxis-test.json' })
    await router.init()
  })

  it('adds and queries routes', async () => {
    await router.add({ type: 'doc', name: 'auth', description: 'Authentication and session tokens', path: '/docs/auth.md' })
    await router.add({ type: 'doc', name: 'assets', description: 'Asset loading and CDN uploads', path: '/docs/assets.md' })
    await router.add({ type: 'rule', name: 'review', description: 'Code review workflow', path: '/ai/review.md' })

    const results = await router.query('auth tokens')
    expect(results.length).toBeGreaterThan(0)
    expect(results[0].route.name).toBe('auth')
  })

  it('filters by type', async () => {
    await router.addMany([
      { type: 'doc', name: 'auth', description: 'Authentication', path: '/docs/auth.md' },
      { type: 'rule', name: 'review', description: 'Authentication review rule', path: '/ai/review.md' },
    ])

    const docs = await router.queryDocs('authentication')
    expect(docs.every(r => r.route.type === 'doc')).toBe(true)

    const rules = await router.queryRules('authentication')
    expect(rules.every(r => r.route.type === 'rule')).toBe(true)
  })

  it('returns scores between 0 and 1', async () => {
    await router.add({ type: 'doc', name: 'test', description: 'Test document', path: '/docs/test.md' })
    const results = await router.query('test', { mode: 'vector' })
    for (const r of results) {
      expect(r.score).toBeGreaterThanOrEqual(0)
      expect(r.score).toBeLessThanOrEqual(1)
    }
  })

  it('removeByPath drops routes', async () => {
    await router.add({ type: 'doc', name: 'auth', description: 'Auth doc', path: '/docs/auth.md' })
    expect(router.size).toBe(1)
    router.removeByPath('/docs/auth.md')
    expect(router.size).toBe(0)
  })

  it('supports fulltext-only mode', async () => {
    await router.add({ type: 'doc', name: 'sprites', description: 'Sprite loading and atlas packing', path: '/docs/sprites.md' })
    const results = await router.query('atlas', { mode: 'fulltext' })
    expect(results.length).toBeGreaterThan(0)
  })
})
