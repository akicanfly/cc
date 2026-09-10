import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { processRulesPair } from './claudemd.js'

let root: string

function rule(dir: string, rel: string, body: string): void {
  const path = join(dir, rel)
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, `${body}\n`)
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'ccc-rules-test-'))
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('processRulesPair', () => {
  test('.agents twin wins over the .claude twin', async () => {
    const agentsDir = join(root, '.agents', 'rules')
    const claudeDir = join(root, '.claude', 'rules')
    rule(agentsDir, 'shared.md', '# agents shared')
    rule(claudeDir, 'shared.md', '# claude shared')
    rule(claudeDir, 'extra.md', '# claude extra')
    const files = await processRulesPair({
      agentsDir,
      claudeDir,
      type: 'Project',
      processedPaths: new Set<string>(),
      includeExternal: false,
      conditionalRule: false,
    })
    const byPath = new Map(files.map(f => [f.path, f.content]))
    expect(files).toHaveLength(2)
    const shared = [...byPath.entries()].find(([p]) => p.endsWith('shared.md'))
    expect(shared?.[0]).toContain('.agents')
    expect([...byPath.keys()].some(p => p.endsWith('extra.md'))).toBe(true)
  })

  test('missing .agents dir falls back to .claude only', async () => {
    const claudeDir = join(root, '.claude', 'rules')
    rule(claudeDir, 'only.md', '# only')
    const files = await processRulesPair({
      agentsDir: join(root, '.agents', 'rules'),
      claudeDir,
      type: 'Project',
      processedPaths: new Set<string>(),
      includeExternal: false,
      conditionalRule: false,
    })
    expect(files).toHaveLength(1)
    expect(files[0]?.path).toContain('.claude')
  })
})
