# Building the Windows test client

This guide builds the Hearth Suite installers (`.msi` and NSIS `-setup.exe`) on a clean Windows 11
machine. Local builds and CI take the same path, `ci/desktop/package.sh`. Without signing material
the installers are unsigned and the in-app updater is switched off, which is expected for a test
build.

CI produces the same installers without a local set-up: run the **windows-test** workflow
(Actions, `windows-test`, Run workflow) and download the artefact.

## 1. Prerequisites

Windows 11 23H2 or later, x64, with an administrator account for the installs below. Run each block
in **PowerShell**.

Visual Studio 2022 Build Tools with the C++ workload (the MSVC linker and Windows SDK):

```powershell
winget install --id Microsoft.VisualStudio.2022.BuildTools --exact --override "--wait --passive --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"
```

Rust through rustup. The repository pins the toolchain in `rust-toolchain.toml`, so the first cargo
command installs the right version:

```powershell
winget install --id Rustlang.Rustup --exact
rustup default stable-x86_64-pc-windows-msvc
```

Git for Windows, which also provides the `bash` that the build script needs:

```powershell
winget install --id Git.Git --exact
```

Node.js 22 or later, then pnpm at the version pinned in `package.json` through Corepack:

```powershell
winget install --id OpenJS.NodeJS.LTS --exact
corepack enable
```

Check that `node --version` reports v22 or later. If the LTS release is older, install Node.js 22
from nodejs.org instead.

WebView2 ships with Windows 11. The installers also embed the WebView2 bootstrapper, so a machine
without it is handled at install time.

Close and reopen PowerShell so the new `PATH` entries apply.

## 2. Build

Clone and build from **Git Bash** (Start menu, "Git Bash"), not PowerShell:

```bash
git clone https://github.com/veldris-ltd/hearth-suite.git
cd hearth-suite
bash ci/desktop/package.sh windows
```

`just desktop` runs the same script. On Windows, `just` runs recipes through PowerShell, so Git for
Windows' `bash` must come before `C:\Windows\System32\bash.exe` (WSL) on `PATH`. If in doubt, use
the `bash ci/desktop/package.sh windows` form above.

The first build compiles the Rust core and downloads WiX and NSIS, so it is anticipated to take
several minutes. The installers and their `.sha256` files land in `dist/`.

If the repository sits on a network drive, a link-time `os error 121` can occur. Point the build at
a local target directory first:

```bash
export CARGO_TARGET_DIR="$LOCALAPPDATA/hearth-target"
```

If the MSI step fails while WiX runs, enable the VBSCRIPT optional feature (Settings, System,
Optional features, View features, VBSCRIPT) and build again.

## 3. Check the build

Check the installers against acceptance criterion AC-WIN-1:

```bash
HEARTH_DIST_DIR="$PWD/dist" node --test apps/desktop/tests/ac_win_1.test.mjs
```

## 4. First-run check (AC-WIN-2)

Do this on a clean Windows 11 virtual machine, not the build machine, so leftover data cannot hide a
problem.

1. Copy the `.msi` to the VM and disconnect the VM's network adapter.
2. Install silently from an administrator PowerShell:
   ```powershell
   msiexec /i "Hearth Suite_<version>_x64_en-US.msi" /qn /l*v install.log
   ```
3. Start Hearth Suite from the Start menu.
4. Complete onboarding. Confirm the 24 recovery words are shown.
5. Create a Writer document, type a sentence, close the app, reopen it and confirm the text is
   still there.
6. Open Settings, About, and confirm it shows the version and build commit.
7. Take a screenshot of steps 4, 5 and 6 and file them with the build number.

Until P13.1 lands, the identity seed is still stored unencrypted under `%APPDATA%\Hearth`. Do not use
test builds for real documents.

## 5. Trust the test certificate (tester machines)

Test builds are signed with the Veldris test certificate, which Windows does not trust by default.
On a **test machine only**, import the public certificate `hearth-test-signing.cer` (supplied by
the programme lead) from an administrator PowerShell:

```powershell
Import-Certificate -FilePath .\hearth-test-signing.cer -CertStoreLocation Cert:\LocalMachine\Root
Import-Certificate -FilePath .\hearth-test-signing.cer -CertStoreLocation Cert:\LocalMachine\TrustedPublisher
```

The installer's UAC prompt then names "Veldris Ltd Hearth Suite Test Signing" as the publisher.
Remove the certificate when the test programme ends:

```powershell
Get-ChildItem Cert:\LocalMachine\Root, Cert:\LocalMachine\TrustedPublisher |
  Where-Object Subject -like "CN=Veldris Ltd Hearth Suite Test Signing*" | Remove-Item
```

Never import this certificate on a machine used for anything else.

## 6. Check an in-app update (AC-WIN-4)

1. Install beta build N by hand (section 4, step 2).
2. Publish build N+1 to the beta feed (section 7).
3. Start Hearth Suite. The update panel offers N+1 and shows the three checks.
4. Install it. After the restart, Settings, About shows version `0.1.<N+1>`.

## 7. Set up the beta channel (maintainers)

This is done once, by the person who will hold the keys, on a trusted machine. The commands read
every secret from a file or a prompt, so no secret reaches the shell history. Keep
`~/.hearth-keys` in an encrypted location (KeePass attachment or OpenBao) and delete the working
copies afterwards. These keys are for the beta channel only and are never used for stable.

Create the key directory and the beta TUF role seed (Git Bash or Linux):

```bash
mkdir -p "$HOME/.hearth-keys" && chmod 700 "$HOME/.hearth-keys"
head -c 32 /dev/urandom | base64 > "$HOME/.hearth-keys/beta-tuf-seed.b64"
HEARTH_RELEASE_ROLE_SEED="$(cat "$HOME/.hearth-keys/beta-tuf-seed.b64")" \
  cargo run -q -p hearth-release --bin hearth-tuf-sign -- pubkey > "$HOME/.hearth-keys/beta-tuf.pub"
```

Create the beta updater key pair. Tauri prompts for a password:

```bash
pnpm --filter @hearth/desktop exec tauri signer generate -w "$HOME/.hearth-keys/beta-updater.key"
```

Create the test code-signing certificate (Windows PowerShell). The script prompts for the export
password:

```powershell
powershell -ExecutionPolicy Bypass -File ci\desktop\windows-test-cert.ps1 -OutDir "$HOME\.hearth-keys"
```

Create the feed upload key:

```bash
ssh-keygen -t ed25519 -N "" -C "hearth beta feed CI" -f "$HOME/.hearth-keys/beta-feed"
```

Feed host: create a subdomain for the feed in Plesk, issue its Let's Encrypt certificate, and
create an SSH user for it whose `authorized_keys` holds `beta-feed.pub`. Configure everything
through Plesk; do not edit the web server configuration by hand. Record the host's SSH key once
and check its fingerprint against the server before trusting it:

```bash
ssh-keyscan -t ed25519 <feed-ssh-host> > "$HOME/.hearth-keys/beta-feed.known_hosts"
ssh-keygen -lf "$HOME/.hearth-keys/beta-feed.known_hosts"
```

Load everything into the `beta` environment with the GitHub CLI, signed in as a repository admin.
Replace every placeholder in angle brackets first. `FEED_PATH` is the subdomain's document root
relative to the SSH user's home directory, as Plesk shows it:

```bash
R=<owner>/<repository>
K="$HOME/.hearth-keys"
gh secret set HEARTH_RELEASE_ROLE_SEED --env beta --repo "$R" < "$K/beta-tuf-seed.b64"
gh secret set TAURI_SIGNING_PRIVATE_KEY --env beta --repo "$R" < "$K/beta-updater.key"
gh secret set TAURI_SIGNING_PRIVATE_KEY_PASSWORD --env beta --repo "$R"
base64 -w0 "$K/hearth-test-signing.pfx" | gh secret set HEARTH_WIN_TEST_PFX_B64 --env beta --repo "$R"
gh secret set HEARTH_WIN_TEST_PFX_PASSWORD --env beta --repo "$R"
gh secret set FEED_SSH_KEY --env beta --repo "$R" < "$K/beta-feed"
gh variable set HEARTH_BETA_ROOT_KEY_ID --env beta --repo "$R" --body hearth-beta
gh variable set HEARTH_BETA_ROOT_PUBKEY_B64 --env beta --repo "$R" < "$K/beta-tuf.pub"
gh variable set HEARTH_BETA_UPDATER_PUBKEY --env beta --repo "$R" < "$K/beta-updater.key.pub"
gh variable set FEED_KNOWN_HOSTS --env beta --repo "$R" < "$K/beta-feed.known_hosts"
gh variable set HEARTH_FEED_URL --env beta --repo "$R" --body "https://<feed-domain>"
gh variable set FEED_HOST --env beta --repo "$R" --body "<feed-ssh-host>"
gh variable set FEED_USER --env beta --repo "$R" --body "<feed-ssh-user>"
gh variable set FEED_PATH --env beta --repo "$R" --body "<feed-document-root>"
```

The two `PASSWORD` commands prompt for the value. Then run the `windows-test` workflow with channel
`beta`, and with `publish` ticked to upload to the feed.
