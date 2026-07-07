// Install the standalone `cc` binary to ~/.local/bin/cc (or $PREFIX/bin).
// Usage: bun scripts/install.ts
//
// Assumes `bun run build -- --compile` has already produced ./dist/bin/cc[.exe].

import { copyFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const isWindows = process.platform === 'win32'
const sourceName = isWindows ? 'cc.exe' : 'cc'
const source = join(import.meta.dir, '..', 'dist', 'bin', sourceName)
if (!existsSync(source)) {
  console.error(`Binary not found at ${source}. Run: bun run build -- --compile`)
  process.exit(1)
}

const candidates: string[] = []
if (process.env.CC_INSTALL_DIR) candidates.push(process.env.CC_INSTALL_DIR)
if (process.env.HOME) candidates.push(join(process.env.HOME, '.local', 'bin'))
if (process.env.PREFIX) candidates.push(join(process.env.PREFIX, 'bin'))

let target: string | null = null
for (const dir of candidates) {
  try {
    target = join(dir, sourceName)
    copyFileSync(source, target)
    break
  } catch {
    target = null
  }
}

if (!target) {
  console.error(`No install directory found or writable. Tried: ${candidates.join(', ')}`)
  process.exit(1)
}

console.log(`Installed ${source} -> ${target}`)
