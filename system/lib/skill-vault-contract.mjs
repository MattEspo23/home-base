import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex')
}

function safeRelative(relativePath) {
  const normalized = relativePath.split(path.sep).join('/').replace(/^\.\/+/, '')
  if (!normalized || normalized === '..' || normalized.startsWith('../') || path.isAbsolute(normalized)) {
    throw new Error(`Unsafe Skill path: ${relativePath}`)
  }
  return normalized
}

function walkFiles(root, relative = '') {
  const absolute = path.join(root, relative)
  if (!fs.existsSync(absolute)) return []
  const stat = fs.lstatSync(absolute)
  const shown = relative ? safeRelative(relative) : path.basename(root)
  if (stat.isSymbolicLink()) throw new Error(`Skill projection may not contain a symbolic link: ${shown}`)
  if (stat.isFile()) {
    if (stat.nlink !== 1) throw new Error(`Skill projection may not contain a hard-linked file: ${shown}`)
    return [safeRelative(relative)]
  }
  if (!stat.isDirectory()) throw new Error(`Skill projection contains an unsupported file type: ${shown}`)
  return fs.readdirSync(absolute, { withFileTypes: true })
    .sort((left, right) => left.name.localeCompare(right.name))
    .flatMap((entry) => walkFiles(root, path.join(relative, entry.name)))
}

function metadata(skillRoot) {
  const text = fs.readFileSync(path.join(skillRoot, 'SKILL.md'), 'utf8')
  const frontmatter = text.match(/^---\n([\s\S]*?)^---\n/m)?.[1]
  const name = frontmatter?.match(/^name:\s*([^\n]+)$/m)?.[1]?.trim().replace(/^['"]|['"]$/g, '')
  const description = frontmatter?.match(/^description:\s*([^\n]+)$/m)?.[1]?.trim().replace(/^['"]|['"]$/g, '')
  if (!name || !description) throw new Error(`Skill metadata is incomplete: ${skillRoot}`)
  return { name, description }
}

export function validateSkillVaultProjection(homeBaseRoot) {
  const distributionRoot = path.join(homeBaseRoot, 'system', 'distribution')
  const lock = JSON.parse(fs.readFileSync(path.join(distributionRoot, 'skill-vault.lock.json'), 'utf8'))
  if (lock.schemaVersion !== 2 || lock.packageCount !== 27 || lock.packages?.length !== 27) {
    throw new Error('Skill Vault lock must contain exactly 27 schema-v2 packages')
  }
  if (
    lock.source?.version !== '0.1.3' ||
    lock.source?.state !== 'released' ||
    lock.source?.tag !== 'v0.1.3' ||
    lock.source?.commit !== 'cf0df42008cdffa79556a35ef79b803d3b2f19d7' ||
    lock.source?.tree !== '13d65f76bc07afd05b14e1318b2610bf47d13926'
  ) {
    throw new Error('Skill Vault lock is not pinned to the immutable v0.1.3 release')
  }
  if (JSON.stringify(lock.adapters) !== JSON.stringify(['.agents/skills', '.claude/skills'])) {
    throw new Error('Skill Vault adapters must target the Codex and Claude repository Skill roots')
  }

  const packageNames = new Set()
  const foldedNames = new Map()
  for (const item of lock.packages) {
    const folded = item.name.normalize('NFKC').toLocaleLowerCase('en-US')
    if (foldedNames.has(folded)) throw new Error(`Duplicate or case-colliding Skill names: ${item.name}`)
    foldedNames.set(folded, item.name)
    packageNames.add(item.name)
    for (const adapter of lock.adapters) {
      const packageRoot = path.join(homeBaseRoot, adapter, item.name)
      const observedFiles = walkFiles(packageRoot).sort()
      const expectedFiles = Object.keys(item.files).sort()
      if (JSON.stringify(observedFiles) !== JSON.stringify(expectedFiles)) {
        throw new Error(`Skill adapter file list drifted: ${adapter}/${item.name}`)
      }
      const observedMetadata = metadata(packageRoot)
      if (observedMetadata.name !== item.name || observedMetadata.description !== item.description) {
        throw new Error(`Skill adapter metadata drifted: ${adapter}/${item.name}`)
      }
      for (const relative of expectedFiles) {
        const observedHash = sha256(fs.readFileSync(path.join(packageRoot, relative)))
        if (observedHash !== item.files[relative]) {
          throw new Error(`Skill adapter hash drifted: ${adapter}/${item.name}/${relative}`)
        }
      }
    }
  }

  for (const receipt of lock.projectedReceipts) {
    const observed = sha256(fs.readFileSync(path.join(distributionRoot, 'skill-vault', receipt.file)))
    if (observed !== receipt.sha256) throw new Error(`Skill Vault notice drifted: ${receipt.file}`)
  }

  const canonicalProjection = {
    releaseVersion: lock.source.version,
    packages: lock.packages,
    projectedReceipts: lock.projectedReceipts,
  }
  if (sha256(JSON.stringify(canonicalProjection)) !== lock.projectionDigest) {
    throw new Error('Skill Vault projection digest does not match the lock')
  }

  const adapterNames = lock.adapters.map((adapter) => fs.readdirSync(path.join(homeBaseRoot, adapter), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort())
  if (adapterNames[0].length !== 42 || JSON.stringify(adapterNames[0]) !== JSON.stringify(adapterNames[1])) {
    throw new Error('Home Base must expose the same 42 Skills to Codex and Claude')
  }
  for (const name of adapterNames[0]) {
    const observed = metadata(path.join(homeBaseRoot, '.agents', 'skills', name))
    if (observed.name !== name) throw new Error(`Home Base Skill folder/frontmatter mismatch: ${name}`)
    const folded = name.normalize('NFKC').toLocaleLowerCase('en-US')
    if (!packageNames.has(name) && foldedNames.has(folded)) throw new Error(`Home Base core/Vault collision: ${name}`)
    if (!foldedNames.has(folded)) foldedNames.set(folded, name)
    else if (foldedNames.get(folded) !== name) throw new Error(`Home Base case-folded collision: ${name}`)
  }

  const catalog = fs.readFileSync(path.join(distributionRoot, 'SKILL-CATALOG.md'), 'utf8')
  for (const name of adapterNames[0]) {
    if (!catalog.includes(`\`$${name}\``)) throw new Error(`Skill catalog lacks explicit invocation: ${name}`)
  }
  for (const route of ['start-home-base', 'ask-espo', 'youtube-action-plan', 'review-home-base-update']) {
    if (!catalog.includes(`\`${route}\``)) throw new Error(`Skill catalog lacks representative route: ${route}`)
  }

  return {
    totalSkills: adapterNames[0].length,
    homeBaseCoreSkills: adapterNames[0].length - lock.packageCount,
    skillVaultPackages: lock.packageCount,
    projectionDigest: lock.projectionDigest,
    source: lock.source,
  }
}
