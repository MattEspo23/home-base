#!/usr/bin/env node

import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { gzipSync } from 'node:zlib'
import {
  createDeterministicArchive,
  discoverChannel,
  extractVerifiedArchive,
  inspectTar,
  retrievalRequestHeaders,
  validateRedirect,
  validateChannelPointer,
  validateReleaseMetadata,
  validateRetrievalUrl,
  verifyGitHubTag,
} from './lib/release-retrieval-contract.mjs'

function putString(header, value, offset, length) {
  Buffer.from(value).copy(header, offset, 0, length)
}

function putOctal(header, value, offset, length) {
  putString(header, `${value.toString(8).padStart(length - 1, '0')}\0`, offset, length)
}

function tar(entries, { end = true } = {}) {
  const blocks = []
  for (const entry of entries) {
    const contents = Buffer.from(entry.contents ?? '')
    const header = Buffer.alloc(512)
    putString(header, entry.path, 0, 100)
    putOctal(header, 0o644, 100, 8)
    putOctal(header, 0, 108, 8)
    putOctal(header, 0, 116, 8)
    putOctal(header, entry.declaredSize ?? contents.length, 124, 12)
    putOctal(header, 0, 136, 12)
    header.fill(0x20, 148, 156)
    header[156] = (entry.type ?? '0').charCodeAt(0)
    putString(header, 'ustar\0', 257, 6)
    putString(header, '00', 263, 2)
    const checksum = header.reduce((sum, byte) => sum + byte, 0)
    putString(header, `${checksum.toString(8).padStart(6, '0')}\0 `, 148, 8)
    blocks.push(header, contents)
    const padding = (512 - (contents.length % 512)) % 512
    if (padding) blocks.push(Buffer.alloc(padding))
  }
  if (end) blocks.push(Buffer.alloc(1024))
  return Buffer.concat(blocks)
}

function temporaryFile(contents) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'home-base-retrieval-test-'))
  const file = path.join(root, 'fixture.tar')
  fs.writeFileSync(file, contents)
  return { root, file }
}

function metadata() {
  return {
    schemaVersion: 1,
    channel: 'stable',
    state: 'public',
    publicRelease: true,
    repository: 'https://github.com/MattEspo23/home-base',
    version: '1.0.0',
    tag: 'v1.0.0',
    commit: 'a'.repeat(40),
    trustRoot: 'github_repository',
    signing: 'not_claimed',
    artifact: {
      file: 'home-base-1.0.0.tgz',
      url: 'https://github.com/MattEspo23/home-base/releases/download/v1.0.0/home-base-1.0.0.tgz',
      sha256: 'b'.repeat(64),
      bytes: 1024,
    },
    skillVault: {
      version: '0.1.3',
      tag: 'v0.1.3',
      commit: 'c'.repeat(40),
      projectionDigest: 'd'.repeat(64),
    },
  }
}

test('accepts exact public GitHub release metadata and tag target', async () => {
  const value = metadata()
  assert.equal(validateReleaseMetadata(value), value)
  const target = await verifyGitHubTag(value, async () => ({ object: { type: 'commit', sha: value.commit } }))
  assert.equal(target.sha, value.commit)
})

test('rejects mutable or mismatched release identity', () => {
  const value = metadata()
  value.tag = 'v1.0.1'
  assert.throws(() => validateReleaseMetadata(value), /tag must exactly match/)
})

test('rejects foreign hosts and excessive redirects', () => {
  assert.throws(() => validateRetrievalUrl('https://example.com/file.tgz'), /not allowlisted/)
  assert.throws(() => validateRedirect('https://github.com/MattEspo23/home-base/releases/download/v1.0.0/file.tgz', 'https://objects.githubusercontent.com/file', 4), /redirect limit/)
})

test('uses GitHub API media headers only for API requests', () => {
  assert.deepEqual(retrievalRequestHeaders('https://api.github.com/repos/MattEspo23/home-base/contents/channels/stable.json?ref=main'), {
    'user-agent': 'EspoAI-Home-Base/1.0',
    accept: 'application/vnd.github+json',
    'x-github-api-version': '2022-11-28',
  })
  assert.deepEqual(retrievalRequestHeaders('https://github.com/MattEspo23/home-base/releases/download/v1.0.0/file.tgz'), {
    'user-agent': 'EspoAI-Home-Base/1.0',
    accept: 'application/octet-stream',
  })
})

test('mutable channel discovery resolves only immutable matching metadata', async () => {
  const value = metadata()
  const metadataUrl = 'https://github.com/MattEspo23/home-base/releases/download/v1.0.0/release.json'
  const pointer = { schemaVersion: 1, channel: 'stable', state: 'available', metadataUrl }
  assert.equal(validateChannelPointer(pointer, 'stable'), metadataUrl)
  const discovered = await discoverChannel('stable', async (url) => {
    if (url.includes('/contents/channels/')) return { encoding: 'base64', content: Buffer.from(JSON.stringify(pointer)).toString('base64') }
    if (url === metadataUrl) return value
    if (url.includes('/git/ref/tags/')) return { object: { type: 'commit', sha: value.commit } }
    throw new Error(`Unexpected fixture URL: ${url}`)
  })
  assert.equal(discovered.metadata.commit, value.commit)
  assert.throws(() => validateChannelPointer({ ...pointer, state: 'unavailable' }, 'stable'), /not publicly available/)
})

for (const fixture of [
  { name: 'absolute path', entries: [{ path: '/home-base/file' }], pattern: /absolute path/ },
  { name: 'traversal', entries: [{ path: 'home-base/../file' }], pattern: /traversal/ },
  { name: 'symbolic link', entries: [{ path: 'home-base/link', type: '2' }], pattern: /not a regular file/ },
  { name: 'hard link', entries: [{ path: 'home-base/link', type: '1' }], pattern: /not a regular file/ },
  { name: 'special device', entries: [{ path: 'home-base/device', type: '3' }], pattern: /not a regular file/ },
  { name: 'case collision', entries: [{ path: 'home-base/File' }, { path: 'home-base/file' }], pattern: /collides/ },
  { name: 'Unicode collision', entries: [{ path: 'home-base/é' }, { path: 'home-base/é' }], pattern: /collides/ },
  { name: 'entry-count overflow', entries: [{ path: 'home-base/a' }, { path: 'home-base/b' }], limits: { entries: 1, uncompressedBytes: 1024 }, pattern: /entry-count/ },
  { name: 'declared-size overflow', entries: [{ path: 'home-base/a', contents: 'ab' }], limits: { entries: 10, uncompressedBytes: 1 }, pattern: /uncompressed-size/ },
]) {
  test(`rejects archive ${fixture.name}`, () => {
    const temporary = temporaryFile(tar(fixture.entries))
    try {
      assert.throws(() => inspectTar(temporary.file, fixture.limits), fixture.pattern)
    } finally {
      fs.rmSync(temporary.root, { recursive: true })
    }
  })
}

test('rejects a truncated archive', () => {
  const temporary = temporaryFile(tar([{ path: 'home-base/file', contents: 'x', declaredSize: 1024 }], { end: false }))
  try {
    assert.throws(() => inspectTar(temporary.file), /truncated|end marker/)
  } finally {
    fs.rmSync(temporary.root, { recursive: true })
  }
})

test('deterministic archive preflights and extracts only after its hash matches', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'home-base-retrieval-happy-'))
  const archive = path.join(root, 'home-base.tgz')
  const output = path.join(root, 'output')
  try {
    const receipt = createDeterministicArchive([
      { path: 'home-base/README.md', contents: Buffer.from('# Home Base\n'), mode: 0o644 },
      { path: 'home-base/system/test.mjs', contents: Buffer.from('export {}\n'), mode: 0o755 },
    ], archive)
    const extracted = await extractVerifiedArchive({ archivePath: archive, expectedSha256: receipt.sha256, destinationRoot: output })
    assert.equal(fs.readFileSync(path.join(extracted.homeBaseRoot, 'README.md'), 'utf8'), '# Home Base\n')
    assert.equal(extracted.entryCount, 2)
  } finally {
    fs.rmSync(root, { recursive: true })
  }
})

test('hash mismatch leaves the destination absent', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'home-base-retrieval-hash-'))
  const archive = path.join(root, 'home-base.tgz')
  const output = path.join(root, 'output')
  try {
    fs.writeFileSync(archive, gzipSync(tar([{ path: 'home-base/file', contents: 'safe' }])))
    await assert.rejects(() => extractVerifiedArchive({ archivePath: archive, expectedSha256: '0'.repeat(64), destinationRoot: output }), /SHA-256/)
    assert.equal(fs.existsSync(output), false)
  } finally {
    fs.rmSync(root, { recursive: true })
  }
})

console.log('Release retrieval fixtures completed.')
