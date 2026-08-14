import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

function normalize(relativePath) {
  const value = relativePath.split(path.sep).join('/').replace(/^\.\/+/, '')
  if (!value || value === '..' || value.startsWith('../') || path.isAbsolute(value)) {
    throw new Error(`Unsafe release path: ${relativePath}`)
  }
  return value
}

function isInside(relativePath, roots) {
  return roots.some(
    (root) => relativePath === root || relativePath.startsWith(`${root}/`),
  )
}

function pathsOverlap(left, right) {
  return (
    left === right ||
    left.startsWith(`${right}/`) ||
    right.startsWith(`${left}/`)
  )
}

function walk(root, relativePath = '') {
  const absolutePath = path.join(root, relativePath)
  if (!fs.existsSync(absolutePath)) return []
  const stat = fs.lstatSync(absolutePath)
  if (stat.isSymbolicLink()) {
    throw new Error(`Release paths may not be symbolic links: ${normalize(relativePath)}`)
  }
  if (stat.isFile()) return [normalize(relativePath)]
  return fs
    .readdirSync(absolutePath, { withFileTypes: true })
    .flatMap((entry) =>
      walk(root, path.join(relativePath, entry.name)),
    )
}

function hashFile(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex')
}

export function loadReleaseManifest(homeBaseRoot) {
  const manifestPath = path.join(homeBaseRoot, 'system', 'release-manifest.json')
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
  if (
    ![1, 2].includes(manifest.schemaVersion) ||
    !manifest.version ||
    !manifest.starterSourceRoot
  ) {
    throw new Error('Unsupported or incomplete Home Base release manifest')
  }
  for (const field of ['maintainedPaths', 'userOwnedPaths', 'starterFiles']) {
    if (!Array.isArray(manifest[field])) {
      throw new Error(`Release manifest is missing ${field}`)
    }
    manifest[field] = manifest[field].map(normalize)
  }
  manifest.starterSourceRoot = normalize(manifest.starterSourceRoot)
  return manifest
}

export function releaseFiles(homeBaseRoot, manifest) {
  const maintained = manifest.maintainedPaths.flatMap((entry) =>
    walk(homeBaseRoot, entry),
  )
  return [...new Set([...maintained, ...manifest.starterFiles])].sort()
}

export function releaseSourcePath(homeBaseRoot, manifest, relativePath) {
  const sourceRelative = manifest.starterFiles.includes(relativePath)
    ? path.join(manifest.starterSourceRoot, relativePath)
    : relativePath
  return path.join(homeBaseRoot, sourceRelative)
}

export function planUpdate(currentRoot, candidateRoot) {
  const currentManifest = loadReleaseManifest(currentRoot)
  const candidateManifest = loadReleaseManifest(candidateRoot)
  const unsafeMaintainedPaths = candidateManifest.maintainedPaths.filter(
    (maintainedPath) =>
      currentManifest.userOwnedPaths.some((userOwnedPath) =>
        pathsOverlap(maintainedPath, userOwnedPath),
      ),
  )
  if (unsafeMaintainedPaths.length > 0) {
    throw new Error(
      `Candidate maintained paths overlap protected user-owned paths: ${unsafeMaintainedPaths.join(', ')}`,
    )
  }
  const candidateFiles = releaseFiles(candidateRoot, candidateManifest)
  const candidateAllFiles = walk(candidateRoot)
  const ignoredUserOwned = candidateAllFiles
    .filter((file) => isInside(file, currentManifest.userOwnedPaths))
    .filter((file) => {
      const currentPath = path.join(currentRoot, file)
      const candidatePath = path.join(candidateRoot, file)
      return (
        !fs.existsSync(currentPath) ||
        hashFile(currentPath) !== hashFile(candidatePath)
      )
    })
  const blockedUserOwned = candidateAllFiles.filter(
    (file) =>
      isInside(file, currentManifest.userOwnedPaths) &&
      !currentManifest.starterFiles.includes(file),
  )
  const changes = []

  for (const file of candidateFiles) {
    if (!isInside(file, candidateManifest.maintainedPaths)) continue
    if (isInside(file, currentManifest.userOwnedPaths)) continue
    const currentPath = path.join(currentRoot, file)
    const candidatePath = path.join(candidateRoot, file)
    const action = !fs.existsSync(currentPath)
      ? 'create'
      : hashFile(currentPath) === hashFile(candidatePath)
        ? 'unchanged'
        : 'update'
    changes.push({ file, action })
  }
  const candidateMaintainedFiles = new Set(
    candidateFiles.filter((file) =>
      isInside(file, candidateManifest.maintainedPaths),
    ),
  )
  const deletes = currentManifest.maintainedPaths
    .flatMap((entry) => walk(currentRoot, entry))
    .filter((file) => !isInside(file, currentManifest.userOwnedPaths))
    .filter((file) => !candidateMaintainedFiles.has(file))
    .sort()

  return {
    currentVersion: currentManifest.version,
    candidateVersion: candidateManifest.version,
    changes,
    ignoredUserOwned,
    blockedUserOwned,
    deletes,
  }
}

function copyFile(sourceRoot, destinationRoot, relativePath) {
  const source = path.join(sourceRoot, relativePath)
  const destination = path.join(destinationRoot, relativePath)
  fs.mkdirSync(path.dirname(destination), { recursive: true })
  fs.copyFileSync(source, destination)
}

export function applyUpdate(
  currentRoot,
  candidateRoot,
  checkpointRoot,
  options = {},
) {
  const plan = planUpdate(currentRoot, candidateRoot)
  if (plan.blockedUserOwned.length > 0) {
    throw new Error(
      `Candidate contains personalized files outside the starter manifest: ${plan.blockedUserOwned.join(', ')}`,
    )
  }
  if (plan.deletes.length > 0 && options.approveDeletes !== true) {
    throw new Error(
      `Candidate retires maintained files. Review deletes and rerun with explicit deletion approval: ${plan.deletes.join(', ')}`,
    )
  }

  const changed = plan.changes.filter((item) => item.action !== 'unchanged')
  fs.mkdirSync(checkpointRoot, { recursive: true })
  const checkpoint = {
    ...plan,
    created: changed.filter((item) => item.action === 'create').map((item) => item.file),
    backedUp: [
      ...changed.filter((item) => item.action === 'update').map((item) => item.file),
      ...plan.deletes,
    ],
  }
  for (const file of checkpoint.backedUp) copyFile(currentRoot, checkpointRoot, file)
  fs.writeFileSync(
    path.join(checkpointRoot, 'checkpoint.json'),
    `${JSON.stringify(checkpoint, null, 2)}\n`,
  )
  try {
    for (const { file } of changed) copyFile(candidateRoot, currentRoot, file)
    for (const file of plan.deletes) {
      fs.rmSync(path.join(currentRoot, normalize(file)))
    }
  } catch (error) {
    try {
      rollbackUpdate(currentRoot, checkpointRoot)
    } catch (rollbackError) {
      throw new Error(
        `Update copy failed and checkpoint rollback also failed. Original: ${error.message}. Rollback: ${rollbackError.message}`,
      )
    }
    const wrapped = new Error(
      `Update copy failed and checkpoint rollback succeeded: ${error.message}`,
    )
    wrapped.updateRolledBack = true
    throw wrapped
  }
  return checkpoint
}

export function rollbackUpdate(currentRoot, checkpointRoot) {
  const checkpoint = JSON.parse(
    fs.readFileSync(path.join(checkpointRoot, 'checkpoint.json'), 'utf8'),
  )
  for (const file of checkpoint.created) {
    const target = path.join(currentRoot, normalize(file))
    if (fs.existsSync(target)) fs.rmSync(target)
  }
  for (const file of checkpoint.backedUp) copyFile(checkpointRoot, currentRoot, file)
  return checkpoint
}
