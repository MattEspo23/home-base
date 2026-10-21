# Home Base distribution inputs

Home Base ships with two Skill layers:

- 15 Home Base core Skills, maintained in this repository; and
- 27 Skill Vault packages projected from the exact reviewed source identity
  recorded in `skill-vault.lock.json`.

The public source paths stay unchanged. `sync-skill-vault.mjs` validates the
version state, tag when present, commit, tree, package names, case-folded
uniqueness, file hashes, and license/provenance receipts before it writes identical package projections to
`.agents/skills/` and `.claude/skills/`.

Regenerate from an exact local checkout:

```bash
node system/distribution/sync-skill-vault.mjs \
  --source /path/to/MattEspo23/skills \
  --write
```

The generated files are release inputs. User-created workflows continue to
live in the user-owned `skills/` directory and are never overwritten by this
projection.

The current lock is regenerated from the immutable public `v0.1.3` tag. The
sync refuses any checkout whose tag, commit, or tree differs from that release.
