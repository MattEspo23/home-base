import crypto from 'node:crypto'
import fs from 'node:fs'
import https from 'node:https'
import os from 'node:os'
import path from 'node:path'
import { Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { createGunzip, gzipSync } from 'node:zlib'

export const retrievalLimits = Object.freeze({
  compressedBytes: 64 * 1024 * 1024,
  redirects: 3,
  connectMs: 10_000,
  totalMs: 120_000,
  entries: 10_000,
  uncompressedBytes: 256 * 1024 * 1024,
})

const repository = Object.freeze({
  owner: 'MattEspo23',
  name: 'home-base',
  url: 'https://github.com/MattEspo23/home-base',
})
const allowedHosts = new Set([
  'github.com',
  'api.github.com',
  'objects.githubusercontent.com',
  'release-assets.githubusercontent.com',
])

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex')
}

function requireCondition(condition, message) {
  if (!condition) throw new Error(message)
}

function normalizedUrl(value) {
  const parsed = new URL(value)
  requireCondition(parsed.protocol === 'https:', 'Release retrieval requires HTTPS')
  requireCondition(!parsed.username && !parsed.password, 'Release URL must not contain credentials')
  requireCondition(allowedHosts.has(parsed.hostname), `Release host is not allowlisted: ${parsed.hostname}`)
  return parsed
}

export function validateRetrievalUrl(value, kind = 'redirect') {
  const parsed = normalizedUrl(value)
  if (parsed.hostname === 'github.com') {
    requireCondition(parsed.pathname.startsWith(`/${repository.owner}/${repository.name}/releases/download/`), 'GitHub release URL is outside the Home Base release path')
  } else if (parsed.hostname === 'api.github.com') {
    requireCondition(parsed.pathname.startsWith(`/repos/${repository.owner}/${repository.name}/`), 'GitHub API URL is outside the Home Base repository')
  } else {
    requireCondition(kind === 'redirect', 'GitHub asset hosts are valid only after an allowlisted redirect')
  }
  return parsed
}

export function validateRedirect(from, to, redirectCount) {
  requireCondition(redirectCount <= retrievalLimits.redirects, 'Release retrieval exceeded the redirect limit')
  const source = normalizedUrl(from)
  const target = new URL(to, source)
  validateRetrievalUrl(target.href, 'redirect')
  return target
}

export function validateReleaseMetadata(metadata) {
  requireCondition(metadata?.schemaVersion === 1, 'Release metadata schema is invalid')
  requireCondition(['stable', 'preview'].includes(metadata.channel), 'Release channel is invalid')
  requireCondition(metadata.state === 'public' && metadata.publicRelease === true, 'Only public release metadata can be retrieved')
  requireCondition(metadata.repository === repository.url, 'Release metadata repository is invalid')
  requireCondition(/^1\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(metadata.version), 'Release version is invalid')
  requireCondition(metadata.tag === `v${metadata.version}`, 'Release tag must exactly match the version')
  requireCondition(/^[0-9a-f]{40}$/.test(metadata.commit), 'Release commit must be a full Git commit')
  requireCondition(metadata.trustRoot === 'github_repository', 'Release trust root must be GitHub repository authority')
  requireCondition(metadata.signing === 'not_claimed', 'Release metadata must not claim an unproven signing system')
  requireCondition(metadata.artifact?.file === `home-base-${metadata.version}.tgz`, 'Release artifact filename is invalid')
  requireCondition(/^[0-9a-f]{64}$/.test(metadata.artifact?.sha256 ?? ''), 'Release artifact SHA-256 is invalid')
  requireCondition(Number.isInteger(metadata.artifact?.bytes) && metadata.artifact.bytes > 0 && metadata.artifact.bytes <= retrievalLimits.compressedBytes, 'Release artifact byte size is invalid')
  const artifactUrl = validateRetrievalUrl(metadata.artifact.url, 'initial')
  requireCondition(artifactUrl.search === '' && artifactUrl.hash === '', 'Initial release URL must not contain a query or fragment')
  const expectedPrefix = `/${repository.owner}/${repository.name}/releases/download/${metadata.tag}/`
  requireCondition(artifactUrl.hostname === 'github.com' && artifactUrl.pathname === `${expectedPrefix}${metadata.artifact.file}`, 'Release asset URL does not match the immutable tag and filename')
  requireCondition(metadata.skillVault?.version === '0.1.3', 'Skill Vault release version is invalid')
  requireCondition(metadata.skillVault?.tag === 'v0.1.3', 'Skill Vault tag is invalid')
  requireCondition(/^[0-9a-f]{40}$/.test(metadata.skillVault?.commit ?? ''), 'Skill Vault commit must be a full Git commit')
  requireCondition(/^[0-9a-f]{64}$/.test(metadata.skillVault?.projectionDigest ?? ''), 'Skill Vault projection digest is invalid')
  return metadata
}

function requestBuffer(url, { maxBytes, deadline, redirectCount = 0, headers = {} }) {
  return new Promise((resolve, reject) => {
    let settled = false
    const remaining = deadline - Date.now()
    if (remaining <= 0) return reject(new Error('Release retrieval exceeded the total timeout'))
    const timer = setTimeout(() => request.destroy(new Error('Release retrieval exceeded the total timeout')), remaining)
    const request = https.get(url, { headers: { 'user-agent': 'EspoAI-Home-Base/1.0', accept: 'application/octet-stream', ...headers } }, (response) => {
      const status = response.statusCode ?? 0
      if (status >= 300 && status < 400 && response.headers.location) {
        response.resume()
        clearTimeout(timer)
        try {
          const target = validateRedirect(url, response.headers.location, redirectCount + 1)
          requestBuffer(target.href, { maxBytes, deadline, redirectCount: redirectCount + 1, headers }).then(resolve, reject)
        } catch (error) {
          reject(error)
        }
        return
      }
      if (status !== 200) {
        response.resume()
        clearTimeout(timer)
        reject(new Error(`Release retrieval returned HTTP ${status}`))
        return
      }
      const declared = Number(response.headers['content-length'] ?? 0)
      if (declared > maxBytes) {
        response.destroy()
        clearTimeout(timer)
        reject(new Error('Release retrieval exceeded the byte limit'))
        return
      }
      const chunks = []
      let total = 0
      response.on('data', (chunk) => {
        total += chunk.length
        if (total > maxBytes) response.destroy(new Error('Release retrieval exceeded the byte limit'))
        else chunks.push(chunk)
      })
      response.on('end', () => {
        clearTimeout(timer)
        if (!settled) {
          settled = true
          resolve(Buffer.concat(chunks))
        }
      })
      response.on('error', (error) => {
        clearTimeout(timer)
        if (!settled) {
          settled = true
          reject(error)
        }
      })
    })
    request.on('socket', (socket) => {
      if (!socket.connecting) return
      const connectTimer = setTimeout(() => request.destroy(new Error('Release retrieval exceeded the connect timeout')), Math.min(retrievalLimits.connectMs, remaining))
      const clear = () => clearTimeout(connectTimer)
      socket.once('secureConnect', clear)
      socket.once('error', clear)
    })
    request.on('error', (error) => {
      clearTimeout(timer)
      if (!settled) {
        settled = true
        reject(error)
      }
    })
  })
}

export async function fetchJson(url, maxBytes = 1024 * 1024) {
  validateRetrievalUrl(url, 'initial')
  const payload = await requestBuffer(url, { maxBytes, deadline: Date.now() + retrievalLimits.totalMs })
  let parsed
  try {
    parsed = JSON.parse(payload.toString('utf8'))
  } catch (error) {
    throw new Error(`Release metadata is not valid JSON: ${error.message}`)
  }
  return parsed
}

export function validateChannelPointer(pointer, channel) {
  requireCondition(pointer?.schemaVersion === 1 && pointer.channel === channel, 'Update channel pointer is invalid')
  requireCondition(pointer.state === 'available', `Home Base ${channel} channel is not publicly available`)
  const metadataUrl = validateRetrievalUrl(pointer.metadataUrl, 'initial')
  requireCondition(metadataUrl.hostname === 'github.com' && metadataUrl.search === '' && metadataUrl.hash === '', 'Channel metadata must be a GitHub release asset URL')
  return metadataUrl.href
}

export async function discoverChannel(channel, jsonFetcher = fetchJson) {
  requireCondition(['stable', 'preview'].includes(channel), 'Update channel must be stable or preview')
  const pointerUrl = `https://api.github.com/repos/${repository.owner}/${repository.name}/contents/channels/${channel}.json?ref=main`
  const response = await jsonFetcher(pointerUrl)
  requireCondition(response?.encoding === 'base64' && typeof response.content === 'string', 'GitHub channel response is invalid')
  let pointer
  try {
    pointer = JSON.parse(Buffer.from(response.content.replace(/\s/g, ''), 'base64').toString('utf8'))
  } catch (error) {
    throw new Error(`Update channel is not valid JSON: ${error.message}`)
  }
  const metadataUrl = validateChannelPointer(pointer, channel)
  const metadata = validateReleaseMetadata(await jsonFetcher(metadataUrl))
  requireCondition(metadata.channel === channel, 'Channel pointer and release metadata disagree')
  await verifyGitHubTag(metadata, jsonFetcher)
  return { pointerUrl, metadataUrl, metadata }
}

export async function verifyGitHubTag(metadata, jsonFetcher = fetchJson) {
  validateReleaseMetadata(metadata)
  const encodedTag = encodeURIComponent(metadata.tag)
  const ref = await jsonFetcher(`https://api.github.com/repos/${repository.owner}/${repository.name}/git/ref/tags/${encodedTag}`)
  let target = ref?.object
  if (target?.type === 'tag') {
    const annotated = await jsonFetcher(`https://api.github.com/repos/${repository.owner}/${repository.name}/git/tags/${target.sha}`)
    target = annotated?.object
  }
  requireCondition(target?.type === 'commit' && target.sha === metadata.commit, 'GitHub tag target does not match release metadata')
  return target
}

function textField(header, start, length) {
  const field = header.subarray(start, start + length)
  const zero = field.indexOf(0)
  return field.subarray(0, zero >= 0 ? zero : field.length).toString('utf8')
}

function octalField(header, start, length, label) {
  const value = textField(header, start, length).trim().replace(/\0/g, '')
  requireCondition(/^[0-7]*$/.test(value), `Archive ${label} field is invalid`)
  return value ? Number.parseInt(value, 8) : 0
}

function assertTarChecksum(header) {
  const expected = octalField(header, 148, 8, 'checksum')
  const copy = Buffer.from(header)
  copy.fill(0x20, 148, 156)
  const observed = copy.reduce((sum, byte) => sum + byte, 0)
  requireCondition(observed === expected, 'Archive header checksum is invalid')
}

function portableArchivePath(value) {
  requireCondition(value && !value.includes('\0') && !value.includes('\\'), 'Archive path is invalid')
  requireCondition(!value.startsWith('/') && !path.posix.isAbsolute(value), 'Archive contains an absolute path')
  const segments = value.split('/')
  requireCondition(segments.every((segment) => segment && segment !== '.' && segment !== '..'), 'Archive contains traversal or empty path segments')
  requireCondition(segments[0] === 'home-base' && segments.length > 1, 'Archive must contain one home-base root')
  return value.normalize('NFC')
}

export function inspectTar(tarPath, limits = retrievalLimits) {
  const descriptor = fs.openSync(tarPath, 'r')
  const stat = fs.fstatSync(descriptor)
  const records = []
  const folded = new Map()
  let offset = 0
  let totalBytes = 0
  let zeroBlocks = 0
  try {
    while (offset + 512 <= stat.size) {
      const header = Buffer.alloc(512)
      fs.readSync(descriptor, header, 0, 512, offset)
      offset += 512
      if (header.every((byte) => byte === 0)) {
        zeroBlocks += 1
        if (zeroBlocks === 2) break
        continue
      }
      requireCondition(zeroBlocks === 0, 'Archive has content after an end marker')
      assertTarChecksum(header)
      const type = String.fromCharCode(header[156] || 48)
      requireCondition(type === '0', `Archive entry type is not a regular file: ${type}`)
      const name = textField(header, 0, 100)
      const prefix = textField(header, 345, 155)
      const relativePath = portableArchivePath(prefix ? `${prefix}/${name}` : name)
      requireCondition(!relativePath.includes('\uFFFD'), 'Archive path is not valid UTF-8')
      const collisionKey = relativePath.normalize('NFKC').toLocaleLowerCase('en-US')
      requireCondition(!folded.has(collisionKey), `Archive path collides with ${folded.get(collisionKey)}`)
      folded.set(collisionKey, relativePath)
      const size = octalField(header, 124, 12, 'size')
      totalBytes += size
      requireCondition(records.length + 1 <= limits.entries, 'Archive exceeds the entry-count limit')
      requireCondition(totalBytes <= limits.uncompressedBytes, 'Archive exceeds the uncompressed-size limit')
      const padded = Math.ceil(size / 512) * 512
      requireCondition(offset + padded <= stat.size, 'Archive is truncated')
      records.push({ path: relativePath, offset, size, mode: octalField(header, 100, 8, 'mode') })
      offset += padded
    }
    requireCondition(zeroBlocks === 2, 'Archive is missing its complete end marker')
    const trailing = Buffer.alloc(Math.max(0, stat.size - offset))
    if (trailing.length > 0) fs.readSync(descriptor, trailing, 0, trailing.length, offset)
    requireCondition(trailing.every((byte) => byte === 0), 'Archive has non-zero trailing content')
    return { records, totalBytes }
  } finally {
    fs.closeSync(descriptor)
  }
}

async function gunzipBounded(archivePath, tarPath, maxBytes) {
  let total = 0
  const counter = new Transform({
    transform(chunk, _encoding, callback) {
      total += chunk.length
      if (total > maxBytes) callback(new Error('Archive exceeds the uncompressed-size limit'))
      else callback(null, chunk)
    },
  })
  await pipeline(fs.createReadStream(archivePath), createGunzip(), counter, fs.createWriteStream(tarPath, { flags: 'wx', mode: 0o600 }))
  return total
}

function copyRecord(descriptor, record, destination) {
  fs.mkdirSync(path.dirname(destination), { recursive: true })
  const output = fs.openSync(destination, 'wx', record.mode & 0o111 ? 0o755 : 0o644)
  try {
    const buffer = Buffer.alloc(Math.min(1024 * 1024, Math.max(record.size, 1)))
    let remaining = record.size
    let sourceOffset = record.offset
    while (remaining > 0) {
      const length = Math.min(buffer.length, remaining)
      const read = fs.readSync(descriptor, buffer, 0, length, sourceOffset)
      requireCondition(read === length, 'Archive changed during controlled extraction')
      fs.writeSync(output, buffer, 0, read)
      remaining -= read
      sourceOffset += read
    }
  } finally {
    fs.closeSync(output)
  }
}

export async function extractVerifiedArchive({ archivePath, expectedSha256, destinationRoot, limits = retrievalLimits }) {
  const resolvedArchive = path.resolve(archivePath)
  const resolvedDestination = path.resolve(destinationRoot)
  requireCondition(resolvedDestination !== path.parse(resolvedDestination).root && resolvedDestination !== os.homedir(), 'Archive destination is too broad')
  requireCondition(!fs.existsSync(resolvedDestination), 'Archive destination must not already exist')
  const archiveStat = fs.statSync(resolvedArchive)
  requireCondition(archiveStat.isFile() && archiveStat.size <= limits.compressedBytes, 'Compressed archive exceeds the byte limit')
  requireCondition(sha256(fs.readFileSync(resolvedArchive)) === expectedSha256, 'Archive SHA-256 does not match release metadata')
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'home-base-archive-'))
  const tarPath = path.join(temporaryRoot, 'payload.tar')
  let destinationCreated = false
  try {
    await gunzipBounded(resolvedArchive, tarPath, limits.uncompressedBytes)
    const inspected = inspectTar(tarPath, limits)
    fs.mkdirSync(resolvedDestination, { recursive: false })
    destinationCreated = true
    const descriptor = fs.openSync(tarPath, 'r')
    try {
      for (const record of inspected.records) copyRecord(descriptor, record, path.join(resolvedDestination, ...record.path.split('/')))
    } finally {
      fs.closeSync(descriptor)
    }
    return {
      homeBaseRoot: path.join(resolvedDestination, 'home-base'),
      entryCount: inspected.records.length,
      uncompressedBytes: inspected.totalBytes,
    }
  } catch (error) {
    if (destinationCreated && fs.existsSync(resolvedDestination)) fs.rmSync(resolvedDestination, { recursive: true })
    throw error
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true })
  }
}

function putString(header, value, offset, length) {
  const bytes = Buffer.from(value)
  requireCondition(bytes.length <= length, `Tar field is too long: ${value}`)
  bytes.copy(header, offset)
}

function putOctal(header, value, offset, length) {
  const encoded = `${value.toString(8).padStart(length - 1, '0')}\0`
  putString(header, encoded, offset, length)
}

function splitTarPath(relativePath) {
  const bytes = Buffer.byteLength(relativePath)
  if (bytes <= 100) return { name: relativePath, prefix: '' }
  for (let index = relativePath.lastIndexOf('/'); index > 0; index = relativePath.lastIndexOf('/', index - 1)) {
    const prefix = relativePath.slice(0, index)
    const name = relativePath.slice(index + 1)
    if (Buffer.byteLength(prefix) <= 155 && Buffer.byteLength(name) <= 100) return { name, prefix }
  }
  throw new Error(`Archive path is too long for ustar: ${relativePath}`)
}

export function createDeterministicArchive(entries, outputPath) {
  const blocks = []
  for (const entry of [...entries].sort((left, right) => left.path.localeCompare(right.path))) {
    const relativePath = portableArchivePath(entry.path)
    const contents = Buffer.isBuffer(entry.contents) ? entry.contents : Buffer.from(entry.contents)
    const { name, prefix } = splitTarPath(relativePath)
    const header = Buffer.alloc(512)
    putString(header, name, 0, 100)
    putOctal(header, entry.mode & 0o111 ? 0o755 : 0o644, 100, 8)
    putOctal(header, 0, 108, 8)
    putOctal(header, 0, 116, 8)
    putOctal(header, contents.length, 124, 12)
    putOctal(header, 0, 136, 12)
    header.fill(0x20, 148, 156)
    header[156] = '0'.charCodeAt(0)
    putString(header, 'ustar\0', 257, 6)
    putString(header, '00', 263, 2)
    putString(header, 'root', 265, 32)
    putString(header, 'root', 297, 32)
    putString(header, prefix, 345, 155)
    const checksum = header.reduce((sum, byte) => sum + byte, 0)
    putString(header, `${checksum.toString(8).padStart(6, '0')}\0 `, 148, 8)
    blocks.push(header, contents)
    const padding = (512 - (contents.length % 512)) % 512
    if (padding) blocks.push(Buffer.alloc(padding))
  }
  blocks.push(Buffer.alloc(1024))
  const compressed = gzipSync(Buffer.concat(blocks), { level: 9, mtime: 0 })
  requireCondition(compressed.length <= retrievalLimits.compressedBytes, 'Generated archive exceeds the compressed-size limit')
  fs.writeFileSync(outputPath, compressed, { flag: 'wx', mode: 0o644 })
  return { sha256: sha256(compressed), bytes: compressed.length }
}

export const releaseRetrievalInternals = Object.freeze({ requestBuffer, portableArchivePath, sha256 })
