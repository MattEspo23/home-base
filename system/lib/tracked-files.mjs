import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

// Release inputs come from the committed tree at HEAD, never from the working
// directory, so untracked or Git-ignored files inside maintained paths (and the
// ignored instance/ overlay) can never reach an archive.

function git(repositoryRoot, args, { input, encoding = 'utf8' } = {}) {
  const result = spawnSync('git', ['-C', repositoryRoot, ...args], {
    encoding,
    input,
    maxBuffer: 512 * 1024 * 1024,
  })
  if (result.status !== 0) {
    const stderr = Buffer.isBuffer(result.stderr) ? result.stderr.toString('utf8') : result.stderr
    throw new Error(`git ${args[0]} failed: ${stderr ?? result.error?.message ?? 'unknown error'}`)
  }
  return result.stdout
}

function isInside(relativePath, roots) {
  return roots.some((root) => relativePath === root || relativePath.startsWith(`${root}/`))
}

// Returns Map<homeBaseRelativePath, { mode, blob }> for every tracked file under
// the Home Base folder. Symbolic links (mode 120000) and submodules or other
// non-blob entries are refused rather than skipped.
export function trackedHomeBaseTree(repositoryRoot, relativeHomeBase = '.') {
  const prefix = relativeHomeBase === '.' ? '' : `${relativeHomeBase}/`
  const output = git(repositoryRoot, ['ls-tree', '-r', '-z', '--full-tree', 'HEAD', '--', relativeHomeBase === '.' ? '.' : relativeHomeBase])
  const tree = new Map()
  for (const record of output.split('\0').filter(Boolean)) {
    const tab = record.indexOf('\t')
    const [mode, type, blob] = record.slice(0, tab).split(' ')
    const filePath = record.slice(tab + 1)
    if (!filePath.startsWith(prefix)) continue
    const relativePath = filePath.slice(prefix.length)
    if (mode === '120000') throw new Error(`Tracked symbolic links may not be packaged: ${relativePath}`)
    if (type !== 'blob' || !['100644', '100755'].includes(mode)) {
      throw new Error(`Tracked submodules or non-file entries may not be packaged: ${relativePath}`)
    }
    tree.set(relativePath, { mode, blob })
  }
  return tree
}

// The archive file list: tracked files inside maintained paths plus the
// starter targets (whose bytes come from the pristine starter sources).
export function trackedReleaseFiles(tree, manifest) {
  const maintained = [...tree.keys()].filter((file) => isInside(file, manifest.maintainedPaths))
  return [...new Set([...maintained, ...manifest.starterFiles])].sort()
}

export function trackedReleaseSource(tree, manifest, relativePath) {
  const sourceRelative = manifest.starterFiles.includes(relativePath)
    ? `${manifest.starterSourceRoot}/${relativePath}`
    : relativePath
  const entry = tree.get(sourceRelative)
  if (!entry) throw new Error(`Release source is not tracked at HEAD for ${relativePath}: ${sourceRelative}`)
  return { sourceRelative, ...entry }
}

// Reads many blobs with one `git cat-file --batch` process.
export function readTrackedBlobs(repositoryRoot, blobs) {
  const unique = [...new Set(blobs)]
  const contents = new Map()
  if (unique.length === 0) return contents
  const output = git(repositoryRoot, ['cat-file', '--batch'], { input: Buffer.from(`${unique.join('\n')}\n`), encoding: 'buffer' })
  let offset = 0
  for (const blob of unique) {
    const headerEnd = output.indexOf(0x0a, offset)
    const [sha, type, size] = output.subarray(offset, headerEnd).toString('utf8').split(' ')
    if (sha !== blob || type !== 'blob') throw new Error(`git cat-file returned an unexpected object for ${blob}`)
    const start = headerEnd + 1
    const end = start + Number(size)
    contents.set(blob, Buffer.from(output.subarray(start, end)))
    offset = end + 1
  }
  return contents
}

// Local-only names that never belong in a release copy, mirroring .gitignore.
const NEVER_COPIED_SEGMENTS = new Set(['instance', '.home-base', '.git', 'node_modules', '.DS_Store'])
function localOnly(relativePath) {
  const segments = relativePath.split('/')
  const base = segments.at(-1).toLowerCase()
  if (segments.some((segment) => NEVER_COPIED_SEGMENTS.has(segment))) return true
  if (base === '.env' || base.startsWith('.env.')) return true
  if (/\.(?:key|pem|p12|tgz)$/.test(base)) return true
  if (base === 'claude.local.md') return true
  return base === 'settings.local.json' && segments.at(-2) === '.claude'
}

// Tracked files inside the maintained paths, relative to homeBaseRoot, when
// homeBaseRoot is a development checkout; otherwise null. An installed
// release carries system/distribution/release.json (written only by the
// packager), and is never treated as a development checkout even when the
// user keeps it in their own Git repository: there, Git's tracked list is the
// user's history, not the release, and lags behind every update.
function trackedMaintainedFiles(homeBaseRoot, maintainedPaths) {
  if (fs.existsSync(path.join(homeBaseRoot, 'system', 'distribution', 'release.json'))) return null
  const probe = spawnSync('git', ['-C', homeBaseRoot, 'ls-files', '--error-unmatch', '--', 'system/release-manifest.json'], { encoding: 'utf8' })
  if (probe.status !== 0) return null
  const listed = spawnSync('git', ['-C', homeBaseRoot, 'ls-files', '-z', '--', ...maintainedPaths], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  if (listed.status !== 0) return null
  return new Set(listed.stdout.split('\0').filter(Boolean))
}

// Builds a release-shaped copy for proofs: the maintained paths plus pristine
// starter copies of the user-owned files. In a development checkout only
// tracked files are copied (working-tree bytes, so uncommitted edits are still
// proven); in an installed release local-only names (.env*, keys, local
// settings) are skipped. The user's own files, instance/, and runtime state are
// never copied.
export function copyReleaseShapedTree(homeBaseRoot, destination, manifest) {
  const tracked = trackedMaintainedFiles(homeBaseRoot, manifest.maintainedPaths)
  const copied = []
  const visit = (relativePath) => {
    const source = path.join(homeBaseRoot, relativePath)
    const stat = fs.lstatSync(source, { throwIfNoEntry: false })
    if (!stat || localOnly(relativePath)) return
    if (stat.isDirectory()) {
      for (const entry of fs.readdirSync(source).sort()) visit(`${relativePath}/${entry}`)
      return
    }
    if (tracked ? !tracked.has(relativePath) : false) return
    const target = path.join(destination, relativePath)
    fs.mkdirSync(path.dirname(target), { recursive: true })
    if (stat.isSymbolicLink()) fs.symlinkSync(fs.readlinkSync(source), target)
    else {
      fs.copyFileSync(source, target)
      fs.chmodSync(target, stat.mode & 0o777)
    }
    copied.push(relativePath)
  }
  fs.mkdirSync(destination, { recursive: true })
  for (const maintained of manifest.maintainedPaths) visit(maintained)
  for (const starterFile of manifest.starterFiles) {
    const target = path.join(destination, starterFile)
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.copyFileSync(path.join(homeBaseRoot, manifest.starterSourceRoot, starterFile), target)
    copied.push(starterFile)
  }
  return copied
}
