#!/usr/bin/env node

// Maintainer privacy scan for anything headed to the public repository.
//
// Inputs: a folder tree (default: this Home Base folder), a commit range
// (author and committer names and emails, messages, and every blob the range
// adds), annotated tag objects (tagger, name, message), a packaged archive
// (extracted with the system `tar` into a private temporary folder), plain
// text such as a pull-request body, and branch or tag names. Rules: email
// addresses, phone numbers, Luhn-valid card numbers, last-four phrasing,
// absolute machine paths, private denylist terms (plus the local username when
// a denylist is used), private paths in commits and archives, and files that
// cannot be read as text (archives, compressed files, office documents, PDFs,
// images, other binary data).
//
// Text is also checked after Unicode (NFKC), percent and HTML-entity
// decoding, so a fullwidth `＠` or `%40` does not hide an address.
//
// Output is redacted: rule id and location (file or commit, and line) only.
// Matched text is never printed. Exit 0 = clean, 1 = findings, 2 = usage error
// or the scan could not run.

import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { readTrackedBlobs } from './lib/tracked-files.mjs'

const systemDir = path.dirname(fileURLToPath(import.meta.url))
const homeBaseRoot = path.resolve(systemDir, '..')
const ALLOWLIST_RELATIVE = 'system/privacy-allowlist.json'
const HOOK_MARKER = 'home-base-pre-push v2'

class UsageError extends Error {}

const USAGE = `Usage: node system/privacy-scan.mjs [inputs] [--denylist <file>]

Inputs (with none, the whole Home Base folder is scanned):
  --tree <dir>           scan a folder (skips instance/, .home-base/, .git, node_modules)
  --maintained           with a tree, scan only the maintained release paths
  --commits <range>      scan commit names, emails, messages, and added blobs
  --tag <object>         scan an annotated tag: tagger, name, message (repeatable)
  --repo <dir>           repository for --commits and --tag (default: this Home Base folder)
  --archive <file>       extract a packaged archive privately with tar and scan every entry
  --text <file>          scan plain text, such as a pull-request body (repeatable)
  --ref <name>           scan a branch or tag name (repeatable)

Options:
  --denylist <file>      private terms, one per line, matched as whole words
                         ignoring case; the file must live outside the repository
  --allowlist <file>     public facts (default: ${ALLOWLIST_RELATIVE}; with --commits or
                         --tag it is read from the committed blob at --allowlist-rev)
  --allowlist-rev <rev>  commit to read the allowlist from (default: HEAD)

Setup:
  --install-hook         install the fail-closed pre-push hook into this clone's
                         .git/hooks (outside the tracked tree)

Output never includes matched text. Exit 0 clean, 1 findings, 2 usage error.`

// ---------------------------------------------------------------- arguments

function parseArguments(argv) {
  const options = { trees: [], texts: [], refs: [], tags: [], maintained: false, installHook: false }
  const single = new Map([
    ['--commits', 'commits'],
    ['--repo', 'repo'],
    ['--archive', 'archive'],
    ['--denylist', 'denylist'],
    ['--allowlist', 'allowlist'],
    ['--allowlist-rev', 'allowlistRev'],
  ])
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index]
    if (flag === '--help') return { help: true }
    if (flag === '--maintained') {
      options.maintained = true
      continue
    }
    if (flag === '--install-hook') {
      options.installHook = true
      continue
    }
    const value = argv[index + 1]
    // Never echo an unknown argument: it may be pasted private text.
    if (!['--tree', '--text', '--ref', '--tag', ...single.keys()].includes(flag)) throw new UsageError(`Unknown argument at position ${index + 1}`)
    if (value === undefined || value === '' || value.startsWith('--')) throw new UsageError(`${flag} needs a value`)
    index += 1
    if (flag === '--tree') options.trees.push(value)
    else if (flag === '--text') options.texts.push(value)
    else if (flag === '--ref') options.refs.push(value)
    else if (flag === '--tag') options.tags.push(value)
    else if (options[single.get(flag)] !== undefined) throw new UsageError(`${flag} may be given once`)
    else options[single.get(flag)] = value
  }
  if (options.installHook) return options
  if (options.repo && !options.commits && options.tags.length === 0) throw new UsageError('--repo needs --commits or --tag')
  if (options.allowlistRev && !options.commits && options.tags.length === 0) throw new UsageError('--allowlist-rev needs --commits or --tag')
  const anyInput = options.trees.length || options.texts.length || options.refs.length || options.tags.length || options.commits || options.archive
  if (!anyInput) options.trees.push(homeBaseRoot)
  if (options.maintained && options.trees.length === 0) throw new UsageError('--maintained needs a tree')
  return options
}

// Real, on-disk path. `.native` returns the stored case on case-insensitive
// file systems, and comparisons below ignore case as well.
function realOrResolved(target) {
  try {
    return fs.realpathSync.native(target)
  } catch {
    return path.resolve(target)
  }
}

function isInside(child, parent) {
  const relative = path.relative(parent.toLowerCase(), child.toLowerCase())
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

function gitTopLevel(directory) {
  const result = spawnSync('git', ['-C', directory, 'rev-parse', '--show-toplevel'], { encoding: 'utf8' })
  return result.status === 0 ? result.stdout.trim() : null
}

function loadDenylist(file, protectedRoots) {
  const real = realOrResolved(file)
  if (!fs.existsSync(real) || !fs.statSync(real).isFile()) throw new UsageError('The denylist file does not exist')
  for (const root of protectedRoots.filter(Boolean)) {
    if (isInside(real, realOrResolved(root))) {
      throw new UsageError('Refusing a denylist stored inside the repository or a scanned folder; keep it outside so it can never be committed')
    }
  }
  const terms = []
  let short = 0
  for (const raw of fs.readFileSync(real, 'utf8').split(/\r?\n/)) {
    const term = raw.trim().normalize('NFKC')
    if (!term || term.startsWith('#')) continue
    if (term.length < 3) short += 1
    else terms.push(term)
  }
  if (short > 0) console.error(`Ignored ${short} denylist line(s) shorter than 3 characters.`)
  if (terms.length === 0) throw new UsageError('The denylist has no usable terms')
  return terms
}

function parseAllowlist(bytes) {
  let allowlist
  try {
    allowlist = JSON.parse(bytes.toString('utf8'))
  } catch {
    throw new UsageError('The allowlist is missing or is not valid JSON')
  }
  if (allowlist.schemaVersion !== 1 || !Array.isArray(allowlist.identityFacts)) throw new UsageError('The allowlist has an unsupported shape')
  const unscannable = allowlist.unscannableFiles ?? []
  if (!Array.isArray(unscannable) || unscannable.some((item) => typeof item?.path !== 'string' || !/^[0-9a-f]{64}$/.test(item?.sha256 ?? ''))) {
    throw new UsageError('The allowlist unscannableFiles entries need an exact path and sha256')
  }
  return {
    reservedEmailDomains: (allowlist.reservedEmailDomains ?? []).map((item) => item.toLowerCase()),
    publicEmails: new Set((allowlist.publicEmails ?? []).map((item) => item.toLowerCase())),
    identityFacts: allowlist.identityFacts.map((fact) => ({
      files: new Set(fact.files ?? []),
      patterns: (fact.values ?? []).map((value) => phrasePattern(value)),
    })),
    unscannable: new Set(unscannable.map((item) => `${item.path}\0${item.sha256}`)),
  }
}

function loadAllowlist(options) {
  if (options.allowlist) {
    try {
      return parseAllowlist(fs.readFileSync(path.resolve(options.allowlist)))
    } catch (error) {
      if (error instanceof UsageError) throw error
      throw new UsageError('The allowlist is missing or is not valid JSON')
    }
  }
  // Commit and push scans trust only the committed allowlist, never an
  // uncommitted working-copy edit.
  if (options.commits || options.tags.length > 0) {
    const repository = path.resolve(options.repo ?? homeBaseRoot)
    const revision = options.allowlistRev ?? 'HEAD'
    if (!/^[\w./@^~{}-]+$/.test(revision) || revision.startsWith('-')) throw new UsageError('--allowlist-rev needs a revision')
    const result = spawnSync('git', ['-C', repository, 'cat-file', 'blob', `${revision}:./${ALLOWLIST_RELATIVE}`], { maxBuffer: 16 * 1024 * 1024 })
    if (result.status !== 0) throw new UsageError(`The allowlist is not committed at ${revision === 'HEAD' ? 'HEAD' : 'the given revision'}`)
    return parseAllowlist(result.stdout)
  }
  try {
    return parseAllowlist(fs.readFileSync(path.join(systemDir, 'privacy-allowlist.json')))
  } catch (error) {
    if (error instanceof UsageError) throw error
    throw new UsageError('The allowlist is missing or is not valid JSON')
  }
}

// -------------------------------------------------------------------- rules

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// Whole word or phrase, ignoring case; spaces in a term also match line
// breaks, hyphens, and underscores, so wrapped text and slugs are caught.
function phrasePattern(term) {
  const body = term.trim().split(/[\s_-]+/).map(escapeRegExp).join('[\\s_-]+')
  return new RegExp(`(?<![\\p{L}\\p{N}])${body}(?![\\p{L}\\p{N}])`, 'giu')
}

function luhn(digits) {
  let sum = 0
  let double = false
  for (let index = digits.length - 1; index >= 0; index -= 1) {
    let value = Number(digits[index])
    if (double) {
      value *= 2
      if (value > 9) value -= 9
    }
    sum += value
    double = !double
  }
  return sum % 10 === 0
}

const EMAIL = /(?<![A-Za-z0-9._%+-])([A-Za-z0-9._%+-]+)@([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,})(?![A-Za-z0-9-])/g
const PHONE_PATTERNS = [
  /(?<![\w+])(?:\+?1[ .-]?)?(?:\(\d{3}\)\s?|\d{3}[ .-])\d{3}[ .-]\d{4}(?![\w])/g,
  /(?<![\w+])\+[1-9]\d{0,2}(?:[ .-]?\(?\d{1,4}\)?){2,5}(?![\w])/g,
]
const CARD = /(?<![\w])\d(?:[ -]?\d){12,18}(?![\w])/g
const LAST_FOUR_PATTERNS = [
  /\b(?:ending|ends)\s+(?:in|with)\s*[:#]?\s*\d{4}(?!\d)/gi,
  /\blast\s+(?:four|4)(?:\s+digits)?(?:\s+of\s+[\w-]+)?\s*(?:is|are|was|:|=|-)?\s*\d{4}(?!\d)/gi,
  /(?<![\w*•])(?:[*•xX]{2,}[ -]?|[xX•])\d{4}(?![\w])/g,
  /(?<![\w.])(?:\.{3}|…)\d{4}(?![\w])/g,
]
const MACHINE_PATH_PATTERNS = [
  /\/(?:Users|home)\/(?!Shared(?![\w.-]))[A-Za-z0-9._-]+/g,
  /\b[A-Za-z]:\\+(?:Users|Documents and Settings)\\+[^\\\s"'`<>|]+/gi,
]
const GENERIC_USERNAMES = new Set(['root', 'runner', 'runneradmin', 'user', 'admin', 'ubuntu', 'node', 'vscode', 'codespace', 'codespaces', 'github'])

function emailAllowed(local, domain, allowlist) {
  const lowerDomain = domain.toLowerCase()
  if (allowlist.publicEmails.has(`${local}@${domain}`.toLowerCase())) return true
  return allowlist.reservedEmailDomains.some((reserved) => lowerDomain === reserved || lowerDomain.endsWith(`.${reserved}`))
}

function* matches(pattern, text) {
  pattern.lastIndex = 0
  for (const match of text.matchAll(pattern)) yield match
}

// Identity rules (email, path, denylist, username) also run on a decoded copy.
function identityFindings(text, context, add) {
  for (const match of matches(EMAIL, text)) {
    if (!emailAllowed(match[1], match[2], context.allowlist)) add('email', match)
  }
  for (const pattern of MACHINE_PATH_PATTERNS) for (const match of matches(pattern, text)) add('machine-path', match)
  for (const term of context.denyPatterns) for (const match of matches(term, text)) add('denylist', match)
  for (const term of context.usernamePatterns) for (const match of matches(term, text)) add('local-username', match)
}

function rawFindings(text, context) {
  const found = []
  const add = (rule, match) => found.push({ rule, start: match.index, end: match.index + match[0].length })
  identityFindings(text, context, add)
  if (context.binary) return found
  for (const pattern of PHONE_PATTERNS) {
    for (const match of matches(pattern, text)) {
      const digits = match[0].replace(/\D/g, '')
      if (digits.length >= 10 && digits.length <= 15) add('phone', match)
    }
  }
  for (const match of matches(CARD, text)) {
    const digits = match[0].replace(/\D/g, '')
    if (digits.length >= 13 && digits.length <= 19 && luhn(digits)) add('card-number', match)
  }
  for (const pattern of LAST_FOUR_PATTERNS) for (const match of matches(pattern, text)) add('last-four', match)
  return found
}

const NAMED_ENTITIES = { at: '@', commat: '@', period: '.', dot: '.', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', sol: '/', bsol: '\\', colon: ':', lowbar: '_', hyphen: '-', dash: '-' }

function codePoint(value) {
  if (!Number.isFinite(value) || value <= 0 || value > 0x10ffff || value === 0x0a || value === 0x0d) return ' '
  return String.fromCodePoint(value)
}

// One decoded line per input line, so line numbers still match.
function decodedVariant(text) {
  return text.split('\n').map((line) => {
    let value = line
    for (let round = 0; round < 3; round += 1) {
      const before = value
      value = value
        .normalize('NFKC')
        .replace(/[​-‍⁠﻿­]/g, '')
        .replace(/%([0-9A-Fa-f]{2})/g, (_, hex) => {
          const code = Number.parseInt(hex, 16)
          return code >= 0x20 && code < 0x7f ? String.fromCharCode(code) : ' '
        })
        .replace(/&#(\d{1,7});?/g, (_, decimal) => codePoint(Number(decimal)))
        .replace(/&#x([0-9a-f]{1,6});?/gi, (_, hex) => codePoint(Number.parseInt(hex, 16)))
        .replace(/&([a-z]+);/gi, (entity, name) => NAMED_ENTITIES[name.toLowerCase()] ?? entity)
      if (value === before) break
    }
    return value.replace(/[\r\n]/g, ' ')
  }).join('\n')
}

// Public identity facts are allowed only in the files the allowlist names.
function identitySpans(text, fileKey, allowlist) {
  const spans = []
  for (const fact of allowlist.identityFacts) {
    if (!fact.files.has(fileKey)) continue
    for (const pattern of fact.patterns) {
      for (const match of matches(pattern, text)) spans.push([match.index, match.index + match[0].length])
    }
  }
  return spans
}

function lineAt(text, offset) {
  let line = 1
  for (let index = text.indexOf('\n'); index !== -1 && index < offset; index = text.indexOf('\n', index + 1)) line += 1
  return line
}

function scanString(text, fileKey, context, binary = false) {
  const seen = new Set()
  const results = []
  const collect = (source, findings) => {
    const spans = identitySpans(source, fileKey, context.allowlist)
    for (const finding of findings) {
      if (spans.some(([start, end]) => start <= finding.start && finding.end <= end)) continue
      const line = lineAt(source, finding.start)
      const key = `${finding.rule}:${line}`
      if (seen.has(key)) continue
      seen.add(key)
      results.push({ rule: finding.rule, line })
    }
  }
  collect(text, rawFindings(text, { ...context, binary }))
  const variant = decodedVariant(text)
  if (variant !== text) {
    const found = []
    identityFindings(variant, context, (rule, match) => found.push({ rule, start: match.index, end: match.index + match[0].length }))
    collect(variant, found)
  }
  return results.sort((left, right) => left.line - right.line || left.rule.localeCompare(right.rule))
}

// ------------------------------------------------------------ content types

// Files whose content cannot be read as text are findings unless their exact
// path and sha256 are listed in the allowlist's unscannableFiles section.
const UNSCANNABLE_EXTENSIONS = /\.(?:zip|gz|tgz|bz2|tbz2?|xz|txz|7z|rar|zst|lz4|lzma|tar|jar|war|apk|ipa|dmg|iso|pdf|docx?|docm|xlsx?|xlsm|pptx?|odt|ods|odp|numbers|pages|epub|png|jpe?g|gif|webp|heic|heif|tiff?|bmp|ico|icns|psd|ai|sketch|fig|mp3|mp4|m4a|m4v|mov|wav|aac|flac|ogg|avi|mkv|webm|woff2?|ttf|otf|eot|sqlite3?|db|realm|exe|dll|so|dylib|class|wasm|bin|pyc|p12|pfx)$/i

const MAGIC = [
  [0, [0x1f, 0x8b]], // gzip
  [0, [0x50, 0x4b, 0x03, 0x04]], // zip, docx, xlsx, pptx, jar
  [0, [0x50, 0x4b, 0x05, 0x06]], // empty zip
  [0, [0x50, 0x4b, 0x07, 0x08]], // spanned zip
  [0, [0x25, 0x50, 0x44, 0x46]], // %PDF
  [0, [0x42, 0x5a, 0x68]], // bzip2
  [0, [0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00]], // xz
  [0, [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c]], // 7z
  [0, [0x28, 0xb5, 0x2f, 0xfd]], // zstd
  [0, [0x52, 0x61, 0x72, 0x21]], // rar
  [0, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]], // legacy office
  [0, [0x89, 0x50, 0x4e, 0x47]], // png
  [0, [0xff, 0xd8, 0xff]], // jpeg
  [0, [0x47, 0x49, 0x46, 0x38]], // gif
  [0, [0x52, 0x49, 0x46, 0x46]], // riff (webp, wav, avi)
  [0, [0x53, 0x51, 0x4c, 0x69, 0x74, 0x65, 0x20, 0x66]], // sqlite
  [0, [0x7f, 0x45, 0x4c, 0x46]], // elf
  [0, [0x00, 0x61, 0x73, 0x6d]], // wasm
  [4, [0x66, 0x74, 0x79, 0x70]], // iso media (mp4, mov, heic)
  [257, [0x75, 0x73, 0x74, 0x61, 0x72]], // tar
]

function hasMagic(bytes) {
  return MAGIC.some(([offset, signature]) => bytes.length >= offset + signature.length && signature.every((byte, index) => bytes[offset + index] === byte))
}

function swapBytes(bytes) {
  const swapped = Buffer.from(bytes.subarray(0, bytes.length - (bytes.length % 2)))
  return swapped.swap16()
}

// UTF-16 without a byte-order mark: nearly every high byte is zero.
function bomlessUtf16(bytes) {
  const sample = bytes.subarray(0, Math.min(bytes.length, 8192))
  if (sample.length < 8) return null
  let evenZero = 0
  let oddZero = 0
  for (let index = 0; index + 1 < sample.length; index += 2) {
    if (sample[index] === 0) evenZero += 1
    if (sample[index + 1] === 0) oddZero += 1
  }
  const pairs = Math.floor(sample.length / 2)
  if (oddZero >= pairs * 0.9 && evenZero <= pairs * 0.05) return 'utf16le'
  if (evenZero >= pairs * 0.9 && oddZero <= pairs * 0.05) return 'utf16be'
  return null
}

function decodeContent(bytes, name) {
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) return { text: bytes.subarray(2).toString('utf16le') }
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) return { text: swapBytes(bytes.subarray(2)).toString('utf16le') }
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return { text: bytes.subarray(3).toString('utf8') }
  if (UNSCANNABLE_EXTENSIONS.test(name) || hasMagic(bytes)) return { unscannable: true }
  if (bytes.includes(0)) {
    const utf16 = bomlessUtf16(bytes)
    if (utf16 === 'utf16le') return { text: bytes.toString('utf16le') }
    if (utf16 === 'utf16be') return { text: swapBytes(bytes).toString('utf16le') }
    return { unscannable: true }
  }
  return { text: bytes.toString('utf8') }
}

// Paths that must never be committed or packaged, whatever their content.
function isPrivatePath(filePath) {
  const segments = filePath.split('/').filter(Boolean)
  if (segments.length === 0) return false
  const fold = (value) => value.normalize('NFKC').toLocaleLowerCase('en-US')
  const first = fold(segments[0])
  const base = fold(segments.at(-1))
  if (first === 'instance' || first === '.home-base') return true
  if (base === '.env' || base.startsWith('.env.')) return true
  if (/\.(?:key|pem|p12|pfx)$/.test(base)) return true
  if (base === 'claude.local.md') return true
  if (base === 'settings.local.json' && segments.length >= 2 && fold(segments.at(-2)) === '.claude') return true
  return false
}

// ------------------------------------------------------------------ reports

// Redacted path labels are keyed with a random per-run secret, so they cannot
// be checked against guessed names.
const RUN_KEY = crypto.randomBytes(32)

class Report {
  constructor(context) {
    this.context = context
    this.findings = []
    this.redactedPaths = new Map()
    this.counts = { files: 0, commits: 0, tags: 0, archiveEntries: 0, texts: 0, refs: 0, unscannable: 0 }
  }

  // A location is printed only when the path itself is clean; otherwise it is
  // replaced with a label that is stable within this run only.
  location(prefix, displayPath, fileKey = displayPath) {
    const pathFindings = scanString(displayPath, fileKey, this.context)
    if (pathFindings.length === 0) return `${prefix}${displayPath}`
    if (!this.redactedPaths.has(displayPath)) {
      const label = crypto.createHmac('sha256', RUN_KEY).update(displayPath).digest('hex').slice(0, 12)
      this.redactedPaths.set(displayPath, `[redacted path ${label}]`)
      for (const finding of pathFindings) this.add(finding.rule, `${prefix}${this.redactedPaths.get(displayPath)}`, 'name')
    }
    return `${prefix}${this.redactedPaths.get(displayPath)}`
  }

  add(rule, where, line) {
    this.findings.push({ rule, where, line })
  }

  checkPrivatePath(prefix, displayPath, fileKey) {
    if (isPrivatePath(fileKey)) this.add('private-path', this.location(prefix, displayPath, fileKey), 'name')
  }

  scanBytes(bytes, prefix, displayPath, fileKey) {
    const where = this.location(prefix, displayPath, fileKey)
    const decoded = decodeContent(bytes, displayPath)
    if (decoded.unscannable) {
      const digest = crypto.createHash('sha256').update(bytes).digest('hex')
      if (!this.context.allowlist.unscannable.has(`${fileKey}\0${digest}`)) {
        this.counts.unscannable += 1
        this.add('unscannable', where, '-')
      }
      // Plain strings inside binary data still get the identity rules.
      for (const finding of scanString(bytes.toString('latin1'), fileKey, this.context, true)) this.add(finding.rule, where, finding.line)
      return
    }
    for (const finding of scanString(decoded.text, fileKey, this.context)) this.add(finding.rule, where, finding.line)
  }
}

// ------------------------------------------------------------------- inputs

function scanFolder(report, root, starts, { prefix = '', keyFor = (relative) => relative, skipRootPrivate = true, privatePaths = false } = {}) {
  const visit = (relativePath) => {
    const absolute = path.join(root, relativePath)
    const stat = fs.lstatSync(absolute, { throwIfNoEntry: false })
    if (!stat) return
    const name = path.basename(relativePath)
    const atRoot = !relativePath.includes('/')
    const folded = name.toLocaleLowerCase('en-US')
    if (skipRootPrivate && relativePath && (name === '.git' || name === 'node_modules' || (atRoot && (folded === 'instance' || folded === '.home-base')))) return
    if (stat.isDirectory()) {
      for (const entry of fs.readdirSync(absolute).sort()) visit(relativePath ? `${relativePath}/${entry}` : entry)
      return
    }
    const fileKey = keyFor(relativePath)
    if (privatePaths) report.checkPrivatePath(prefix, relativePath, fileKey)
    if (stat.isSymbolicLink()) {
      report.counts.files += 1
      report.scanBytes(Buffer.from(fs.readlinkSync(absolute)), prefix, relativePath, fileKey)
      return
    }
    if (!stat.isFile()) {
      report.location(prefix, relativePath, fileKey)
      return
    }
    report.counts.files += 1
    report.scanBytes(fs.readFileSync(absolute), prefix, relativePath, fileKey)
  }
  for (const start of starts) visit(start)
}

function scanTree(report, treeRoot, maintainedOnly) {
  const root = path.resolve(treeRoot)
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) throw new UsageError('A --tree folder does not exist')
  let starts = ['']
  if (maintainedOnly) {
    const manifest = JSON.parse(fs.readFileSync(path.join(root, 'system', 'release-manifest.json'), 'utf8'))
    starts = manifest.maintainedPaths
  }
  scanFolder(report, root, starts)
}

function git(repository, args, input) {
  const result = spawnSync('git', ['-C', repository, ...args], { encoding: 'utf8', input, maxBuffer: 512 * 1024 * 1024 })
  if (result.status !== 0) throw new UsageError(`git ${args[0]} could not read the requested commits`)
  return result.stdout
}

const REVISION = /^[\w./@^~:{}-]+$/

function revisionArguments(range) {
  const tokens = range.trim().split(/\s+/).filter(Boolean)
  for (const token of tokens) {
    const allowed = token.startsWith('-')
      ? ['--not', '--all', '--branches', '--remotes'].includes(token) || /^--remotes=[\w./*-]+$/.test(token)
      : REVISION.test(token)
    if (!allowed) throw new UsageError('--commits accepts revisions, ranges, and --not/--all/--branches/--remotes only')
  }
  if (tokens.length === 0) throw new UsageError('--commits needs a revision range')
  return tokens
}

function scanIdentity(report, where, name, email) {
  for (const [field, value] of [[`${where}-name`, name], [`${where}-email`, email]]) {
    for (const finding of scanString(value ?? '', '@commit-identity', report.context)) report.add(finding.rule, field, '-')
  }
}

function scanCommits(report, repository, range) {
  const commits = git(repository, ['rev-list', '--reverse', ...revisionArguments(range), '--']).split('\n').filter(Boolean)
  const blobs = new Map()
  for (const commit of commits) {
    report.counts.commits += 1
    const short = commit.slice(0, 12)
    const [authorName, authorEmail, committerName, committerEmail, message] = git(repository, ['show', '-s', '--format=%an%x00%ae%x00%cn%x00%ce%x00%B', commit]).split('\0')
    scanIdentity(report, `commit ${short} author`, authorName, authorEmail)
    scanIdentity(report, `commit ${short} committer`, committerName, committerEmail)
    for (const finding of scanString(message ?? '', '@commit-message', report.context)) report.add(finding.rule, `commit ${short} message`, finding.line)
    const changes = git(repository, ['diff-tree', '-r', '-z', '-m', '--root', '--no-commit-id', '--no-renames', commit]).split('\0')
    for (let index = 0; index + 1 < changes.length; index += 2) {
      const meta = changes[index]
      const filePath = changes[index + 1]
      if (!meta.startsWith(':')) continue
      const [, newMode, , newBlob, status] = meta.slice(1).split(' ')
      if (status === 'D' || /^0+$/.test(newBlob)) continue
      report.checkPrivatePath(`commit ${short} `, filePath, filePath)
      if (newMode === '160000') continue
      if (!blobs.has(newBlob)) blobs.set(newBlob, { commit: short, filePath })
    }
  }
  const contents = readTrackedBlobs(repository, [...blobs.keys()])
  for (const [blob, origin] of blobs) {
    report.counts.files += 1
    report.scanBytes(contents.get(blob), `commit ${origin.commit} `, origin.filePath, origin.filePath)
  }
}

// Annotated tags carry their own tagger identity and message; nested tags are
// followed to the object they finally name.
function scanTags(report, repository, tags) {
  for (const tag of tags) {
    if (!REVISION.test(tag) || tag.startsWith('-')) throw new UsageError('--tag needs a tag name or object id')
    let object = git(repository, ['rev-parse', '--verify', `${tag}^{object}`]).trim()
    for (let depth = 0; depth < 16; depth += 1) {
      if (git(repository, ['cat-file', '-t', object]).trim() !== 'tag') break
      report.counts.tags += 1
      const short = object.slice(0, 12)
      const raw = git(repository, ['cat-file', 'tag', object])
      const split = raw.indexOf('\n\n')
      const headers = (split === -1 ? raw : raw.slice(0, split)).split('\n')
      const message = split === -1 ? '' : raw.slice(split + 2)
      let next = null
      for (const header of headers) {
        if (header.startsWith('object ')) next = header.slice(7).trim()
        if (header.startsWith('tag ')) {
          for (const finding of scanString(header.slice(4), '@ref', report.context)) report.add(finding.rule, `tag ${short} name`, 'name')
        }
        if (header.startsWith('tagger ')) {
          const identity = header.slice(7).match(/^(.*?) <([^>]*)>/)
          scanIdentity(report, `tag ${short} tagger`, identity?.[1] ?? header.slice(7), identity?.[2] ?? '')
        }
      }
      for (const finding of scanString(message, '@tag-message', report.context)) report.add(finding.rule, `tag ${short} message`, finding.line)
      if (!next || !/^[0-9a-f]{40,64}$/.test(next)) break
      object = next
    }
  }
}

// The archive is listed first (absolute or `..` names refuse the scan), then
// extracted with the system tar into a private temporary folder that is
// always removed, and every entry is scanned like a file in a tree.
function scanArchive(report, archivePath) {
  if (!fs.existsSync(archivePath) || !fs.statSync(archivePath).isFile()) throw new UsageError('The --archive file does not exist')
  const listing = spawnSync('tar', ['-tf', archivePath], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 })
  if (listing.status !== 0) throw new UsageError('The --archive file could not be read by tar')
  for (const name of listing.stdout.split('\n').filter(Boolean)) {
    if (name.startsWith('/') || /^[A-Za-z]:/.test(name) || name.split(/[\\/]/).includes('..')) throw new UsageError('The --archive file contains an absolute or parent-relative entry name')
  }
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'home-base-privacy-archive-'))
  try {
    fs.chmodSync(work, 0o700)
    const extracted = spawnSync('tar', ['-xf', archivePath, '-C', work], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
    if (extracted.status !== 0) throw new UsageError('The --archive file could not be extracted by tar')
    const before = report.counts.files
    scanFolder(report, work, [''], {
      prefix: 'archive:',
      keyFor: (relative) => relative.replace(/^home-base\//, ''),
      skipRootPrivate: false,
      privatePaths: true,
    })
    report.counts.archiveEntries += report.counts.files - before
    report.counts.files = before
  } finally {
    fs.rmSync(work, { recursive: true, force: true })
  }
}

function scanText(report, file) {
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) throw new UsageError('A --text file does not exist')
  report.counts.texts += 1
  const name = path.basename(file)
  report.scanBytes(fs.readFileSync(file), 'text ', name, `@text:${name}`)
}

function scanRefs(report, refs) {
  refs.forEach((ref, index) => {
    report.counts.refs += 1
    for (const finding of scanString(ref, '@ref', report.context)) report.add(finding.rule, `ref #${index + 1}`, 'name')
  })
}

// ------------------------------------------------------------- hook install

// Installs system/hooks/pre-push into the clone's own hooks folder (shared by
// its worktrees), outside the tracked tree, so every branch is scanned,
// including branches cut from a commit that has no hook.
export function installHook(repositoryDirectory = homeBaseRoot) {
  const top = gitTopLevel(repositoryDirectory)
  if (!top) throw new UsageError('--install-hook must run inside a Git clone')
  const hooksPath = spawnSync('git', ['-C', top, 'config', '--get', 'core.hooksPath'], { encoding: 'utf8' })
  if (hooksPath.status === 0 && hooksPath.stdout.trim()) {
    throw new UsageError('core.hooksPath is set, so Git would ignore hooks in .git/hooks. Remove it first with: git config --unset core.hooksPath (and check --global)')
  }
  const common = spawnSync('git', ['-C', top, 'rev-parse', '--git-common-dir'], { encoding: 'utf8' })
  if (common.status !== 0) throw new UsageError('Could not find the Git folder of this clone')
  const hooksDirectory = path.join(path.resolve(top, common.stdout.trim()), 'hooks')
  const target = path.join(hooksDirectory, 'pre-push')
  const source = fs.readFileSync(path.join(systemDir, 'hooks', 'pre-push'))
  if (!source.includes(HOOK_MARKER)) throw new UsageError('system/hooks/pre-push is not the expected hook')
  const existing = fs.existsSync(target) ? fs.readFileSync(target) : null
  if (existing && !existing.includes('home-base-pre-push')) {
    throw new UsageError('A different pre-push hook is already installed; merge it by hand with system/hooks/pre-push')
  }
  fs.mkdirSync(hooksDirectory, { recursive: true })
  const temporary = `${target}.tmp-${process.pid}`
  fs.writeFileSync(temporary, source, { mode: 0o755 })
  fs.chmodSync(temporary, 0o755)
  fs.renameSync(temporary, target)
  return { target, relative: path.relative(top, target).split(path.sep).join('/') }
}

// --------------------------------------------------------------------- main

export function runPrivacyScan(argv) {
  const options = parseArguments(argv)
  if (options.help) return { usage: USAGE }
  if (options.installHook) return { installed: installHook(path.resolve(options.repo ?? homeBaseRoot)) }
  const allowlist = loadAllowlist(options)
  let denyPatterns = []
  let usernamePatterns = []
  if (options.denylist !== undefined) {
    const protectedRoots = [homeBaseRoot, gitTopLevel(homeBaseRoot), ...options.trees, options.repo, options.repo && gitTopLevel(options.repo)]
    denyPatterns = loadDenylist(options.denylist, protectedRoots).map(phrasePattern)
    // On the maintainer's own machine, also flag the local account name.
    const username = os.userInfo().username
    if (username.length >= 4 && !GENERIC_USERNAMES.has(username.toLowerCase())) usernamePatterns = [phrasePattern(username)]
  }
  const report = new Report({ allowlist, denyPatterns, usernamePatterns })
  for (const tree of options.trees) scanTree(report, tree, options.maintained)
  const repository = path.resolve(options.repo ?? homeBaseRoot)
  if (options.commits) scanCommits(report, repository, options.commits)
  if (options.tags.length > 0) scanTags(report, repository, options.tags)
  if (options.archive) scanArchive(report, path.resolve(options.archive))
  for (const text of options.texts) scanText(report, path.resolve(text))
  scanRefs(report, options.refs)
  return report
}

function main() {
  let report
  try {
    report = runPrivacyScan(process.argv.slice(2))
  } catch (error) {
    if (error instanceof UsageError) {
      console.error(`privacy-scan: ${error.message}`)
      console.error(USAGE)
    } else {
      console.error(`privacy-scan: the scan could not run (${error.code ?? error.name})`)
    }
    return 2
  }
  if (report.usage) {
    console.log(report.usage)
    return 0
  }
  if (report.installed) {
    console.log(`Installed the Home Base privacy pre-push hook at ${report.installed.relative}. Set HOME_BASE_PRIVATE_DENYLIST before pushing; without it every push is refused.`)
    return 0
  }
  const { counts, findings } = report
  const scope = `${counts.files} file(s), ${counts.commits} commit(s), ${counts.tags} tag(s), ${counts.archiveEntries} archive entr(ies), ${counts.texts} text(s), ${counts.refs} ref name(s)`
  if (findings.length === 0) {
    console.log(`Privacy scan clean: ${scope}.`)
    return 0
  }
  for (const finding of findings) console.log(`FINDING ${finding.rule} ${finding.where}:${finding.line}`)
  if (counts.unscannable > 0) {
    console.log(`${counts.unscannable} file(s) could not be read as text (archive, compressed, office, PDF, image, or other binary). Scan archives with --archive; after review, list an exact path and sha256 under unscannableFiles in ${ALLOWLIST_RELATIVE}.`)
  }
  console.log(`Privacy scan found ${findings.length} finding(s) in ${scope}. Matched text is never printed; open each location to review it.`)
  return 1
}

// Compare real paths: a symlinked folder (for example macOS /var -> /private/var)
// must never make the script import cleanly and exit 0 without scanning.
function invokedDirectly() {
  if (!process.argv[1]) return false
  try {
    return fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url))
  } catch {
    return false
  }
}

if (invokedDirectly()) {
  process.exitCode = main()
}
