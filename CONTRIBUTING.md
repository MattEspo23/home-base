# Contributing

Thanks for helping make Home Base clearer and safer.

1. Open or reference a sanitized issue that explains the user problem.
2. Keep one pull request focused on one product or update contract.
3. Preserve the maintained-versus-user-owned boundary in
   `system/release-manifest.json`.
4. Run every proof command in [`RELEASE-NOTES.md`](./RELEASE-NOTES.md). The
   GitHub workflows run only in the public `MattEspo23/home-base` repository
   (pull requests included), never in a fork or a user's own copy.
5. Describe the behavior change, proof, compatibility impact, and rollback.

Maintainers bringing work over from a private Home Base or project follow the
[promotion checklist](./system/PROMOTION.md): classify what stays private,
author fresh on a public branch, scan with a private denylist (install the
fail-closed pre-push hook with `node system/privacy-scan.mjs --install-hook`;
never point `core.hooksPath` into the repository), run every test with sample
data, get an independent review, and open a draft pull request for the owner
to merge.

Do not include credentials, client data, proprietary source, private prompts,
copied paid material, or third-party material without an exact license and
provenance record. Contributions are accepted under this repository's MIT
license unless an included third-party notice says otherwise.
