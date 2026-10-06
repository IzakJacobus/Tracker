# Releasing Stint

Releases are built by GitHub Actions (`.github/workflows/release.yml`) when a `v*` tag is
pushed. Everything is attached to a **draft** release. Running servers only see a release
once a maintainer publishes it.

## Steps

1. Make sure `main` is green in CI (lint, type-check, tests, e2e, package, Linux install).
2. Pick the version ([Semantic Versioning](https://semver.org/)): a patch for fixes, a minor
   release for features, and a major one when an upgrade needs manual steps.
3. Set it everywhere and update the changelog:

   ```bash
   bun scripts/set-version.ts 1.2.0
   # In CHANGELOG.md, rename "## [Unreleased]" to "## [1.2.0] - YYYY-MM-DD" and add a new
   # empty Unreleased section above it.
   git commit -am "Release 1.2.0"
   ```

4. Start the build, either way:

   **On github.com (no git needed):** Releases → **Draft a new release** → *Choose a tag* → type
   `v1.2.0` → **Create new tag on publish**, pick the branch as *Target*, leave the description
   empty (it's filled from the CHANGELOG), tick **Set as a pre-release** while it builds, and click
   **Publish release**. When the build is done, edit the release and untick *pre-release*, so
   it becomes the "latest" that servers and `get-stint.sh` see.

   **Or with git:**

   ```bash
   git tag v1.2.0
   git push origin main v1.2.0
   ```

5. Wait for the **Release** workflow. It builds:
   - `StintServer-Setup-1.2.0.exe`: the Windows server installer (NSIS + WinSW, with the
     checksum pinned),
   - `stint-server-1.2.0-windows-x64-portable.zip`: just the executable,
   - `stint-server-1.2.0-{linux-x64,linux-arm64,darwin-arm64,darwin-x64}.tar.gz`: with a
     systemd unit,
   - `SHA256SUMS.txt`.

   The release notes are taken from the matching CHANGELOG section.
6. Test the draft. At minimum run sections 1–3 of [INSTALL_TEST.md](INSTALL_TEST.md) on a
   Windows VM, and record the result there.
7. **Publish** the draft on GitHub. Within a day every server's Health page, and the admin
   sidebar, show "Stint 1.2.0 is available".

The workflow can also be run by hand (*Actions → Release → Run workflow*) for an existing tag,
for example to rebuild after a CI hiccup. Assets are replaced, not duplicated.

## Database changes

- Add a new file, `apps/server/src/db/migrations/NNNN_description.sql`, and register it in
  `migrations/index.ts`. **Never edit a migration that has been released.** The server refuses
  to start if an applied migration's checksum changes.
- Migrations run inside a transaction at startup, after an automatic pre-migration backup.
- A release that changes the schema can't be downgraded without restoring that backup. Say so
  in the changelog.

## Code signing (not set up yet)

Installers are currently **unsigned**:

- **Windows:** SmartScreen shows "Windows protected your PC" until an installer has built up a
  reputation. Users click *More info → Run anyway*. To remove the warning, buy an OV or EV
  code-signing certificate (or use Azure Trusted Signing). Then sign `stint-server.exe` and the
  installer in the workflow (`signtool sign /fd sha256 /tr …`).

People use Stint in a browser, so there is no client app to sign.

Keep signing credentials in GitHub Actions secrets, never in the repository.
