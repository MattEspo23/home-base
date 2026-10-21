#!/usr/bin/env node

import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const EXPECTED = Object.freeze({
  state: 'released',
  version: '0.1.3',
  repository: 'https://github.com/MattEspo23/skills',
  tag: 'v0.1.3',
  commit: 'cf0df42008cdffa79556a35ef79b803d3b2f19d7',
  tree: '13d65f76bc07afd05b14e1318b2610bf47d13926',
})

const PROJECTED_RECEIPTS = Object.freeze([
  'LICENSE',
  'NOTICE.md',
  'THIRD_PARTY_LICENSES/matt-pocock-MIT.txt',
  'THIRD_PARTY_NOTICES.md',
  'PROVENANCE.json',
  'SUPPORT.md',
  'SECURITY.md',
])

const systemDir = path.dirname(fileURLToPath(import.meta.url))
const homeBaseRoot = path.resolve(systemDir, '..', '..')
const args = process.argv.slice(2)
const sourceIndex = args.indexOf('--source')
const sourceRoot = sourceIndex >= 0 ? path.resolve(args[sourceIndex + 1] ?? '') : null
const write = args.includes('--write')

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex')
}

function portable(relativePath) {
  const value = relativePath.split(path.sep).join('/').replace(/^\.\/+/, '')
  if (!value || value === '..' || value.startsWith('../') || path.isAbsolute(value)) {
    throw new Error(`Unsafe Skill Vault path: ${relativePath}`)
  }
  return value
}

function filesUnder(root, relative = '') {
  const absolute = path.join(root, relative)
  const stat = fs.lstatSync(absolute)
  if (stat.isSymbolicLink() || (!stat.isDirectory() && !stat.isFile())) {
    throw new Error(`Skill Vault source contains an unsupported file type: ${portable(relative)}`)
  }
  if (stat.isFile()) return [portable(relative)]
  return fs.readdirSync(absolute, { withFileTypes: true })
    .sort((left, right) => left.name.localeCompare(right.name))
    .flatMap((entry) => filesUnder(root, path.join(relative, entry.name)))
}

function copyTree(source, destination) {
  for (const relative of filesUnder(source)) {
    const target = path.join(destination, relative)
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.copyFileSync(path.join(source, relative), target)
  }
}

function parseMetadata(skillPath) {
  const text = fs.readFileSync(path.join(skillPath, 'SKILL.md'), 'utf8')
  const frontmatter = text.match(/^---\n([\s\S]*?)^---\n/m)?.[1]
  const name = frontmatter?.match(/^name:\s*([^\n]+)$/m)?.[1]?.trim().replace(/^['"]|['"]$/g, '')
  const description = frontmatter?.match(/^description:\s*([^\n]+)$/m)?.[1]?.trim().replace(/^['"]|['"]$/g, '')
  if (!name || !description) throw new Error(`Missing YAML frontmatter name or description: ${skillPath}`)
  return { name, description }
}

function git(source, gitArgs) {
  return execFileSync('git', ['-C', source, ...gitArgs], { encoding: 'utf8' }).trim()
}

function packageInventory(root) {
  const packages = []
  for (const category of ['engineering', 'productivity']) {
    const categoryRoot = path.join(root, 'skills', category)
    for (const entry of fs.readdirSync(categoryRoot, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (!entry.isDirectory()) continue
      const packageRoot = path.join(categoryRoot, entry.name)
      const { name, description } = parseMetadata(packageRoot)
      if (name !== entry.name) {
        throw new Error(`Skill folder/frontmatter mismatch: ${entry.name} != ${name}`)
      }
      const files = Object.fromEntries(filesUnder(packageRoot).map((relative) => [
        relative,
        sha256(fs.readFileSync(path.join(packageRoot, relative))),
      ]))
      packages.push({
        name,
        category,
        description,
        sourcePath: `skills/${category}/${name}`,
        files,
      })
    }
  }
  return packages.sort((left, right) => left.name.localeCompare(right.name))
}

function assertNoCollisions(packages) {
  const sourceNames = new Map()
  for (const item of packages) {
    const folded = item.name.normalize('NFKC').toLocaleLowerCase('en-US')
    if (sourceNames.has(folded)) {
      throw new Error(`Duplicate or case-colliding Skill Vault names: ${sourceNames.get(folded)} and ${item.name}`)
    }
    sourceNames.set(folded, item.name)
  }

  const generatedNames = new Set(packages.map((item) => item.name))
  for (const adapterRoot of ['.agents/skills', '.claude/skills']) {
    const absoluteRoot = path.join(homeBaseRoot, adapterRoot)
    const coreNames = fs.readdirSync(absoluteRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !generatedNames.has(entry.name))
      .map((entry) => entry.name)
    for (const coreName of coreNames) {
      const folded = coreName.normalize('NFKC').toLocaleLowerCase('en-US')
      if (sourceNames.has(folded)) {
        throw new Error(`Skill Vault name collides with a Home Base core Skill: ${coreName}`)
      }
    }
  }
}

if (!sourceRoot || !fs.existsSync(path.join(sourceRoot, '.git'))) {
  throw new Error('Usage: node system/distribution/sync-skill-vault.mjs --source /path/to/MattEspo23/skills [--write]')
}

const observed = {
  commit: git(sourceRoot, ['rev-parse', 'HEAD']),
  tree: git(sourceRoot, ['rev-parse', 'HEAD^{tree}']),
  tagCommit: EXPECTED.tag ? git(sourceRoot, ['rev-list', '-n', '1', EXPECTED.tag]) : null,
}
if (observed.commit !== EXPECTED.commit || observed.tree !== EXPECTED.tree || (EXPECTED.tag && observed.tagCommit !== EXPECTED.commit)) {
  throw new Error(`Skill Vault source is not the pinned ${EXPECTED.tag} release: ${JSON.stringify(observed)}`)
}

const packages = packageInventory(sourceRoot)
if (packages.length !== 27) throw new Error(`Expected 27 Skill Vault packages, found ${packages.length}`)
assertNoCollisions(packages)

const projectedReceipts = PROJECTED_RECEIPTS.map((file) => ({
  file,
  sha256: sha256(fs.readFileSync(path.join(sourceRoot, file))),
}))
const projectionDigest = sha256(JSON.stringify({ releaseVersion: EXPECTED.version, packages, projectedReceipts }))
const lock = {
  schemaVersion: 2,
  source: EXPECTED,
  adapters: ['.agents/skills', '.claude/skills'],
  packageCount: packages.length,
  packages,
  projectedReceipts,
  projectionDigest,
}

function catalogMarkdown() {
  const vaultNames = new Set(packages.map((item) => item.name))
  const rows = fs.readdirSync(path.join(homeBaseRoot, '.agents', 'skills'), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const metadata = parseMetadata(path.join(homeBaseRoot, '.agents', 'skills', entry.name))
      return {
        ...metadata,
        layer: vaultNames.has(entry.name) ? 'Skill Vault' : 'Home Base core',
      }
    })
    .sort((left, right) => left.name.localeCompare(right.name))
  const escape = (value) => value.replaceAll('|', '\\|')
  return `# Included Skills\n\nHome Base includes ${rows.length} editable repository Skills: ${rows.length - packages.length} Home Base core workflows and ${packages.length} pinned Skill Vault packages. Codex may omit some names from its first context summary when the Skill list is large; that is a display-budget limit, not a missing package. Invoke any package explicitly as \`$skill-name\`.\n\n| Skill | Layer | What it does | Explicit invocation |\n|---|---|---|---|\n${rows.map((item) => `| \`${item.name}\` | ${item.layer} | ${escape(item.description)} | \`$${item.name}\` |`).join('\n')}\n\n## Representative natural-language routes\n\n- “Help me get started with Home Base” routes to \`start-home-base\`.\n- “Which Skill should I use for this idea?” routes to \`ask-espo\`.\n- “Turn this YouTube video into a small experiment” routes to \`youtube-action-plan\`.\n- “Review my Home Base update without overwriting my changes” routes to \`review-home-base-update\`.\n\nIf natural-language routing is ambiguous, use the explicit invocation shown in the table. External apps, connectors, sign-in, and account permissions are capabilities, not bundled Skills; run the Capability Doctor before relying on them.\n`
}

if (write) {
  for (const item of packages) {
    for (const adapterRoot of lock.adapters) {
      const destination = path.join(homeBaseRoot, adapterRoot, item.name)
      if (fs.existsSync(destination)) fs.rmSync(destination, { recursive: true })
      copyTree(path.join(sourceRoot, item.sourcePath), destination)
    }
  }

  const noticesRoot = path.join(systemDir, 'skill-vault')
  fs.mkdirSync(noticesRoot, { recursive: true })
  for (const { file } of projectedReceipts) {
    const destination = path.join(noticesRoot, file)
    fs.mkdirSync(path.dirname(destination), { recursive: true })
    fs.copyFileSync(path.join(sourceRoot, file), destination)
  }
  fs.writeFileSync(path.join(systemDir, 'skill-vault.lock.json'), `${JSON.stringify(lock, null, 2)}\n`)
  fs.writeFileSync(path.join(systemDir, 'SKILL-CATALOG.md'), catalogMarkdown())
  console.log(`Wrote ${packages.length} pinned Skill Vault packages to both agent adapters.`)
} else {
  const lockPath = path.join(systemDir, 'skill-vault.lock.json')
  if (!fs.existsSync(lockPath)) throw new Error('Skill Vault lock is missing; rerun with --write')
  const current = JSON.parse(fs.readFileSync(lockPath, 'utf8'))
  if (JSON.stringify(current) !== JSON.stringify(lock)) throw new Error('Skill Vault lock is stale')
  if (fs.readFileSync(path.join(systemDir, 'SKILL-CATALOG.md'), 'utf8') !== catalogMarkdown()) {
    throw new Error('Skill catalog is stale')
  }
  console.log(`Skill Vault projection is current at ${EXPECTED.version} ${EXPECTED.state} (${projectionDigest}).`)
}
