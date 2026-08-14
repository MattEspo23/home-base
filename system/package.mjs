#!/usr/bin/env node

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { containsCredentialShape } from './lib/contracts.mjs'
import {
  createDeterministicArchive,
  extractVerifiedArchive,
  validateReleaseMetadata,
} from './lib/release-retrieval-contract.mjs'
import { validateSkillVaultProjection } from './lib/skill-vault-contract.mjs'
import { updateInternals } from './lib/safe-update-contract.mjs'
import {
  loadReleaseManifest,
  releaseFiles,
  releaseSourcePath,
} from './lib/update-contract.mjs'

const systemDir = path.dirname(fileURLToPath(import.meta.url))
const homeBaseRoot = path.resolve(systemDir, '..')
const args = process.argv.slice(2)
const outputIndex = args.indexOf('--output')
const output = outputIndex >= 0 ? args[outputIndex + 1] : undefined
const publicRelease = args.includes('--public-release')

if (!output || !path.isAbsolute(output)) {
  throw new Error(
    'Usage: node system/package.mjs [--public-release] --output /absolute/path/home-base-<version>.tgz',
  )
}

function runScript(targetRoot, script) {
  const result = spawnSync(process.execPath, [path.join(targetRoot, 'system', script)], {
    cwd: targetRoot,
    encoding: 'utf8',
  })
  if (result.status !== 0) {
    throw new Error(`${script} failed:\n${result.stdout ?? ''}${result.stderr ?? ''}`)
  }
}

for (const script of ['validate.mjs', 'prove.mjs', 'test-capability-doctor.mjs', 'test-safe-update.mjs', 'test-release-retrieval.mjs']) {
  runScript(homeBaseRoot, script)
}

validateSkillVaultProjection(homeBaseRoot)
updateInternals.scanWholeTree(homeBaseRoot)

function git(gitArgs, { allowMissing = false } = {}) {
  const result = spawnSync('git', ['-C', homeBaseRoot, ...gitArgs], { encoding: 'utf8' })
  if (result.status !== 0) {
    if (allowMissing) return ''
    throw new Error(`git ${gitArgs.join(' ')} failed: ${result.stderr ?? result.stdout}`)
  }
  return result.stdout.trim()
}

const repositoryRoot = git(['rev-parse', '--show-toplevel'])
const relativeHomeBase = path.relative(repositoryRoot, homeBaseRoot).split(path.sep).join('/') || '.'
if (git(['status', '--porcelain', '--', relativeHomeBase])) {
  throw new Error('Packaging requires a clean committed Home Base tree')
}
const sourceCommit = git(['rev-parse', 'HEAD'])
const branchRef = git(['symbolic-ref', '--short', 'HEAD'], { allowMissing: true })
const exactTag = git(['describe', '--tags', '--exact-match', 'HEAD'], { allowMissing: true })
const rawRepository = git(['config', '--get', 'remote.origin.url'], { allowMissing: true })
const normalizedRepository = rawRepository
  ? rawRepository.replace(/^git@github\.com:/, 'https://github.com/').replace(/\.git$/, '')
  : null
if (normalizedRepository && normalizedRepository !== 'https://github.com/MattEspo23/home-base') {
  throw new Error(`Packaging refuses an unexpected remote: ${normalizedRepository}`)
}
const manifest = loadReleaseManifest(homeBaseRoot)
const expectedTag = `v${manifest.version}`
if (publicRelease) {
  if (!normalizedRepository) throw new Error('Public packaging requires the canonical GitHub remote')
  if (exactTag !== expectedTag) throw new Error(`Public packaging requires HEAD at exact tag ${expectedTag}`)
  if (path.basename(output) !== `home-base-${manifest.version}.tgz`) {
    throw new Error(`Public package filename must be home-base-${manifest.version}.tgz`)
  }
}
const sourceRef = publicRelease ? exactTag : (branchRef || exactTag)
if (!sourceRef) throw new Error('Packaging requires a named branch or exact tag source ref')
const source = normalizedRepository
  ? {
      kind: 'github_remote',
      repository: normalizedRepository,
      repositoryUrl: normalizedRepository,
      ref: sourceRef,
      commit: sourceCommit,
    }
  : {
      kind: 'local_clean_root',
      repository: 'local_clean_root',
      repositoryUrl: null,
      ref: sourceRef,
      commit: sourceCommit,
    }

const stagingRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'home-base-package-'))
const stagedHomeBase = path.join(stagingRoot, 'home-base')
const proofParent = fs.mkdtempSync(path.join(os.tmpdir(), 'home-base-extracted-proof-'))
const extractedDestination = path.join(proofParent, 'verified')

try {
  for (const relativePath of releaseFiles(homeBaseRoot, manifest)) {
    const sourcePath = releaseSourcePath(homeBaseRoot, manifest, relativePath)
    if (!fs.existsSync(sourcePath) || !fs.statSync(sourcePath).isFile()) {
      throw new Error(
        `Release source is missing for ${relativePath}: ${path.relative(homeBaseRoot, sourcePath)}`,
      )
    }
    const contents = fs.readFileSync(sourcePath)
    if (containsCredentialShape(contents.toString('utf8'))) {
      throw new Error(`Credential-shaped content blocks packaging: ${relativePath}`)
    }
    const destination = path.join(stagedHomeBase, relativePath)
    fs.mkdirSync(path.dirname(destination), { recursive: true })
    fs.copyFileSync(sourcePath, destination)
    fs.chmodSync(destination, fs.statSync(sourcePath).mode & 0o111 ? 0o755 : 0o644)
  }

  const projection = validateSkillVaultProjection(stagedHomeBase)
  const releaseReceipt = {
    schemaVersion: 2,
    state: publicRelease ? 'public' : 'release_candidate',
    ctaEligible: publicRelease,
    releaseId: manifest.releaseId,
    version: manifest.version,
    trustRoot: 'github_repository',
    signing: 'not_claimed',
    source,
    skillVault: {
      state: projection.source.state,
      version: projection.source.version,
      tag: projection.source.tag,
      commit: projection.source.commit,
      projectionDigest: projection.projectionDigest,
    },
  }
  const releaseReceiptPath = path.join(stagedHomeBase, 'system', 'distribution', 'release.json')
  fs.writeFileSync(releaseReceiptPath, `${JSON.stringify(releaseReceipt, null, 2)}\n`)
  updateInternals.scanWholeTree(stagedHomeBase)
  for (const script of ['validate.mjs', 'prove.mjs', 'test-capability-doctor.mjs', 'test-safe-update.mjs', 'test-release-retrieval.mjs']) {
    runScript(stagedHomeBase, script)
  }

  const archivePath = path.resolve(output)
  fs.mkdirSync(path.dirname(archivePath), { recursive: true })
  if (fs.existsSync(archivePath) || fs.existsSync(`${archivePath}.sha256`) || fs.existsSync(`${archivePath}.json`)) {
    throw new Error('Package output or an adjacent receipt already exists')
  }
  const entries = releaseFiles(stagedHomeBase, manifest).map((relativePath) => {
    const absolute = path.join(stagedHomeBase, relativePath)
    return {
      path: `home-base/${relativePath}`,
      contents: fs.readFileSync(absolute),
      mode: fs.statSync(absolute).mode,
    }
  })
  const artifact = createDeterministicArchive(entries, archivePath)
  const extracted = await extractVerifiedArchive({
    archivePath,
    expectedSha256: artifact.sha256,
    destinationRoot: extractedDestination,
  })
  const extractedHomeBase = extracted.homeBaseRoot
  updateInternals.scanWholeTree(extractedHomeBase)
  validateSkillVaultProjection(extractedHomeBase)
  for (const filePath of updateInternals.scanWholeTree(extractedHomeBase).keys()) {
    const absolute = path.join(extractedHomeBase, filePath)
    if (fs.statSync(absolute).isFile() && containsCredentialShape(fs.readFileSync(absolute, 'utf8'))) {
      throw new Error(`Credential-shaped content blocks extracted archive: ${filePath}`)
    }
  }
  for (const script of ['validate.mjs', 'prove.mjs', 'test-capability-doctor.mjs', 'test-safe-update.mjs', 'test-release-retrieval.mjs']) {
    runScript(extractedHomeBase, script)
  }

  fs.writeFileSync(`${archivePath}.sha256`, `${artifact.sha256}  ${path.basename(archivePath)}\n`, { flag: 'wx' })
  const metadata = publicRelease
    ? validateReleaseMetadata({
        schemaVersion: 1,
        channel: 'stable',
        state: 'public',
        publicRelease: true,
        repository: normalizedRepository,
        version: manifest.version,
        tag: sourceRef,
        commit: sourceCommit,
        trustRoot: releaseReceipt.trustRoot,
        signing: releaseReceipt.signing,
        artifact: {
          file: path.basename(archivePath),
          url: `${normalizedRepository}/releases/download/${sourceRef}/${path.basename(archivePath)}`,
          sha256: artifact.sha256,
          bytes: artifact.bytes,
        },
        skillVault: releaseReceipt.skillVault,
      })
    : {
        schemaVersion: 2,
        state: 'release_candidate',
        ctaEligible: false,
        version: manifest.version,
        artifact: {
          file: path.basename(archivePath),
          sha256: artifact.sha256,
          bytes: artifact.bytes,
        },
        source,
        skillVault: releaseReceipt.skillVault,
        trustRoot: releaseReceipt.trustRoot,
        signing: releaseReceipt.signing,
        publicRelease: false,
      }
  fs.writeFileSync(`${archivePath}.json`, `${JSON.stringify(metadata, null, 2)}\n`, { flag: 'wx' })
  console.log(
    `Packaged Home Base ${manifest.version}: ${archivePath} (${entries.length} files, sha256 ${artifact.sha256})`,
  )
} finally {
  fs.rmSync(stagingRoot, { recursive: true })
  fs.rmSync(proofParent, { recursive: true })
}
