import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { clearSkillCaches, getSkillDirCommands } from './loadSkillsDir.js'

const originalConfigDir = process.env.CLAUDE_CONFIG_DIR
let root: string
let configDir: string

function skill(rootDir: string, name: string, description: string): void {
  const dir = join(rootDir, name)
  mkdirSync(dir, { recursive: true })
  writeFileSync(
    join(dir, 'SKILL.md'),
    `---\ndescription: ${description}\n---\n# ${name}\nDoes ${description}.\n`,
  )
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'ccc-skills-test-'))
  configDir = mkdtempSync(join(tmpdir(), 'ccc-skills-cfg-'))
  process.env.CLAUDE_CONFIG_DIR = configDir
  clearSkillCaches()
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
  rmSync(configDir, { recursive: true, force: true })
  // Restore by key, never by replacing process.env: libraries like
  // env-paths capture the object identity at import time.
  if (originalConfigDir === undefined) delete process.env.CLAUDE_CONFIG_DIR
  else process.env.CLAUDE_CONFIG_DIR = originalConfigDir
  clearSkillCaches()
})

describe('getSkillDirCommands with .agents roots', () => {
  test('loads skills from both project roots', async () => {
    mkdirSync(join(root, '.agents', 'skills'), { recursive: true })
    mkdirSync(join(root, '.claude', 'skills'), { recursive: true })
    skill(join(root, '.agents', 'skills'), 'deployer', 'agents deployer')
    skill(join(root, '.claude', 'skills'), 'tester', 'claude tester')
    const skills = await getSkillDirCommands(root)
    const names = skills.map(s => s.name).sort()
    expect(names).toEqual(['deployer', 'tester'])
  })

  test('.agents wins a same-name collision', async () => {
    mkdirSync(join(root, '.agents', 'skills'), { recursive: true })
    mkdirSync(join(root, '.claude', 'skills'), { recursive: true })
    skill(join(root, '.agents', 'skills'), 'deploy', 'agents version')
    skill(join(root, '.claude', 'skills'), 'deploy', 'claude version')
    const skills = await getSkillDirCommands(root)
    expect(skills).toHaveLength(1)
    expect(skills[0]?.description).toContain('agents version')
  })

  test('loads user-level skills from the agents home', async () => {
    // CLAUDE_CONFIG_DIR basename is not .claude here, so the agents home
    // nests inside it and stays isolated from the real home directory.
    skill(join(configDir, '.agents', 'skills'), 'helper', 'global helper')
    const skills = await getSkillDirCommands(root)
    expect(skills.map(s => s.name)).toEqual(['helper'])
  })
})
