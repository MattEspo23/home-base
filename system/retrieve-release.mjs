#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  discoverChannel,
  extractVerifiedArchive,
  fetchJson,
  releaseRetrievalInternals,
  retrievalLimits,
  validateReleaseMetadata,
  verifyGitHubTag,
} from './lib/release-retrieval-contract.mjs'

const systemRoot = path.dirname(fileURLToPath(import.meta.url))
const homeBaseRoot = path.resolve(systemRoot, '..')
const args = process.argv.slice(2)
const command = args[0]

function valueAfter(flag) {
  const index = args.indexOf(flag)
  return index >= 0 ? args[index + 1] : undefined
}

function usage() {
  console.log(`Home Base verified release retrieval

Inspect immutable public metadata without changing Home Base:
  node system/retrieve-release.mjs inspect --metadata <https-github-release-metadata-url>

Discover the current public stable or preview pointer without downloading:
  node system/retrieve-release.mjs discover --channel stable

Download, hash, preflight, and extract to a new directory outside Home Base:
  node system/retrieve-release.mjs download --metadata <https-github-release-metadata-url> --output </new/absolute/directory>

The downloaded candidate is still only an update input. Use system/update.mjs
preview and prepare before any reviewed apply.`)
}

async function metadataFromUrl(url) {
  const metadata = validateReleaseMetadata(await fetchJson(url))
  await verifyGitHubTag(metadata)
  return metadata
}

if (!command || ['help', '--help'].includes(command)) {
  usage()
  process.exit(0)
}

const metadataUrl = valueAfter('--metadata')
const channel = valueAfter('--channel')

if (command === 'discover') {
  if (!channel) throw new Error('discover requires --channel stable|preview')
  const discovered = await discoverChannel(channel)
  console.log(JSON.stringify({
    result: 'verified_discovery',
    pointerUrl: discovered.pointerUrl,
    metadataUrl: discovered.metadataUrl,
    version: discovered.metadata.version,
    tag: discovered.metadata.tag,
    commit: discovered.metadata.commit,
    artifact: discovered.metadata.artifact,
    mutatesInstalledTree: false,
  }, null, 2))
  process.exit(0)
}

if (!metadataUrl && !channel) throw new Error(`${command} requires --metadata or --channel`)
const metadata = channel ? (await discoverChannel(channel)).metadata : await metadataFromUrl(metadataUrl)

if (command === 'inspect') {
  console.log(JSON.stringify({
    result: 'verified_metadata',
    channel: metadata.channel,
    version: metadata.version,
    tag: metadata.tag,
    commit: metadata.commit,
    artifact: metadata.artifact,
    skillVault: metadata.skillVault,
    signing: metadata.signing,
    mutatesInstalledTree: false,
  }, null, 2))
  process.exit(0)
}

if (command === 'download') {
  const output = valueAfter('--output')
  if (!output || !path.isAbsolute(output)) throw new Error('download requires an absolute --output directory')
  const destination = path.resolve(output)
  const relativeToHomeBase = path.relative(homeBaseRoot, destination)
  if (!relativeToHomeBase || (!relativeToHomeBase.startsWith('..') && !path.isAbsolute(relativeToHomeBase))) {
    throw new Error('Download output must be outside the installed Home Base tree')
  }
  const buffer = await releaseRetrievalInternals.requestBuffer(metadata.artifact.url, {
    maxBytes: Math.min(metadata.artifact.bytes, retrievalLimits.compressedBytes),
    deadline: Date.now() + retrievalLimits.totalMs,
  })
  if (buffer.length !== metadata.artifact.bytes) throw new Error('Downloaded artifact byte size does not match release metadata')
  if (releaseRetrievalInternals.sha256(buffer) !== metadata.artifact.sha256) throw new Error('Downloaded artifact SHA-256 does not match release metadata')
  const temporaryArchive = path.join(path.dirname(destination), `.home-base-download-${process.pid}-${Date.now()}.tgz`)
  if (fs.existsSync(temporaryArchive)) throw new Error('Temporary download path already exists')
  try {
    fs.writeFileSync(temporaryArchive, buffer, { flag: 'wx', mode: 0o600 })
    const extracted = await extractVerifiedArchive({
      archivePath: temporaryArchive,
      expectedSha256: metadata.artifact.sha256,
      destinationRoot: destination,
    })
    console.log(JSON.stringify({
      result: 'verified_candidate',
      version: metadata.version,
      tag: metadata.tag,
      commit: metadata.commit,
      homeBaseRoot: extracted.homeBaseRoot,
      entryCount: extracted.entryCount,
      uncompressedBytes: extracted.uncompressedBytes,
      mutatesInstalledTree: false,
      next: `node system/update.mjs preview --candidate ${extracted.homeBaseRoot}`,
    }, null, 2))
  } finally {
    if (fs.existsSync(temporaryArchive)) fs.rmSync(temporaryArchive)
  }
  process.exit(0)
}

throw new Error(`Unknown retrieval command: ${command}`)
