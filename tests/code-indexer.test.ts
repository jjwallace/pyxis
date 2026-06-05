import { describe, it, expect } from 'vitest'
import { writeFile, mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { indexCode } from '../src/index.js'

const TMP = '/tmp/pyxis-code-test'

const SAMPLE_TS = `
/** Validates a JWT token and returns the decoded payload. Throws if expired. */
export async function authenticate(token: string): Promise<User> {
  return verifyJwt(token)
}

/** Manages user session state */
export class SessionManager {
  start(userId: string): void {}
  end(sessionId: string): void {}
}

export interface User {
  id: string
  email: string
}

export type AuthResult = { user: User; token: string }
`

describe('indexCode', () => {
  it('extracts functions, classes, interfaces, types from TypeScript', async () => {
    await mkdir(TMP, { recursive: true })
    await writeFile(join(TMP, 'auth.ts'), SAMPLE_TS)

    const routes = await indexCode(TMP, { languages: ['typescript'], rootDir: TMP })

    const names = routes.map(r => r.name)
    expect(names).toContain('authenticate')
    expect(names).toContain('SessionManager')
    expect(names).toContain('User')
    expect(names).toContain('AuthResult')

    await rm(TMP, { recursive: true, force: true })
  })

  it('includes line numbers in path', async () => {
    await mkdir(TMP, { recursive: true })
    await writeFile(join(TMP, 'auth.ts'), SAMPLE_TS)

    const routes = await indexCode(TMP, { languages: ['typescript'], rootDir: TMP })
    const fn = routes.find(r => r.name === 'authenticate')

    expect(fn?.path).toMatch(/auth\.ts:\d+/)
    expect(fn?.metadata?.language).toBe('typescript')

    await rm(TMP, { recursive: true, force: true })
  })

  it('uses JSDoc as description when present', async () => {
    await mkdir(TMP, { recursive: true })
    await writeFile(join(TMP, 'auth.ts'), SAMPLE_TS)

    const routes = await indexCode(TMP, { languages: ['typescript'], rootDir: TMP })
    const fn = routes.find(r => r.name === 'authenticate')

    expect(fn?.description).toContain('Validates a JWT token')

    await rm(TMP, { recursive: true, force: true })
  })
})
