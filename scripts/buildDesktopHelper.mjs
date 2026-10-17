import { execFileSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

if (process.platform === 'darwin') {
  const output = join(process.cwd(), 'build', 'desktop')
  mkdirSync(output, { recursive: true })
  execFileSync('xcrun', ['swiftc', join(output, 'roster-desktop.swift'),
    '-target', `${process.arch === 'x64' ? 'x86_64' : 'arm64'}-apple-macosx10.15`,
    '-o', join(output, 'roster-desktop')], { stdio: 'inherit' })
}
