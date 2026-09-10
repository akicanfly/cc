import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  CONFIG_ROOT_NAMES,
  getProjectDirsUpToHome,
  loadMarkdownFilesForSubdir,
} from './markdownConfigLoader.js'

const originalEnv = { ...process.env }
let root: string
let configDir: string

function write(rel: string, content: string): void {
  const path = join(root, rel)
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, content)
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'ccc-roots-test-'))
  configDir = mkdtempSync(join(tmpdir(), 'ccc-roots-cfg-'))
  process.env.CLAUDE_CONFIG_DIR = configDir
  process.env.CLAUDE_CODE_USE_NATIVE_FILE_SEARCH = '1'
  loadMarkdownFilesForSubdir.cache?.clear?.()
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
  rmSync(configDir, { recursive: true, force: true })
  // Restore by key, never by replacing process.env: libraries like
  // env-paths capture the object identity at import time.
  for (const key of ['CLAUDE_CONFIG_DIR', 'CLAUDE_CODE_USE_NATIVE_FILE_SEARCH'] as const) {
    if (originalEnv[key] === undefined) delete process.env[key]
    else process.env[key] = originalEnv[key]
  }
  loadMarkdownFilesForSubdir.cache?.clear?.()
})

describe('config root names', () => {
  test('.agents sorts before .claude', () => {
    expect(CONFIG_ROOT_NAMES).toEqual(['.agents', '.claude'])
  })
})

describe('getProjectDirsUpToHome', () => {
  test('returns .agents dir before .claude dir per level', () => {
    write('.agents/commands/x.md', '# x\n')
    write('.claude/commands/x.md', '# x\n')
    const dirs = getProjectDirsUpToHome('commands', root)
    expect(dirs[0]).toBe(join(root, '.agents', 'commands'))
    expect(dirs[1]).toBe(join(root, '.claude', 'commands'))
  })

  test('skips roots that do not exist', () => {
    write('.claude/commands/x.md', '# x\n')
    const dirs = getProjectDirsUpToHome('commands', root)
    expect(dirs).toEqual([join(root, '.claude', 'commands')])
  })
})

describe('loadMarkdownFilesForSubdir', () => {
  test('loads commands from both roots', async () => {
    write('.agents/commands/deploy.md', '---\ndescription: a\n---\nDeploy\n')
    write('.claude/commands/test.md', '---\ndescription: c\n---\nTest\n')
    const files = await loadMarkdownFilesForSubdir('commands', root)
    const names = files.map(f => f.filePath).sort()
    expect(names).toEqual(
      [join(root, '.agents', 'commands', 'deploy.md'), join(root, '.claude', 'commands', 'test.md')].sort(),
    )
  })

  test('.agents wins a same-name collision', async () => {
    write('.agents/commands/deploy.md', '---\ndescription: agents\n---\nAgents deploy\n')
    write('.claude/commands/deploy.md', '---\ndescription: claude\n---\nClaude deploy\n')
    const files = await loadMarkdownFilesForSubdir('commands', root)
    expect(files).toHaveLength(1)
    expect(files[0]?.filePath).toBe(join(root, '.agents', 'commands', 'deploy.md'))
  })

  test('loads agents from .agents/agents', async () => {
    write('.agents/agents/reviewer.md', '---\ndescription: r\n---\nReview\n')
    const files = await loadMarkdownFilesForSubdir('agents', root)
    expect(files.map(f => f.filePath)).toEqual([join(root, '.agents', 'agents', 'reviewer.md')])
  })

  test('loads user-level skills from ~/.agents/skills', async () => {
    const agentsSkill = join(configDir, '.agents', 'skills', 'helper', 'SKILL.md')
    mkdirSync(join(agentsSkill, '..'), { recursive: true })
    writeFileSync(agentsSkill, '---\ndescription: h\n---\nHelp\n')
    const files = await loadMarkdownFilesForSubdir('skills', root)
    expect(files.map(f => f.filePath)).toEqual([agentsSkill])
  })
})
