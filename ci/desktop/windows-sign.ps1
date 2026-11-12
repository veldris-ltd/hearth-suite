# Authenticode-sign one file for the Tauri Windows bundle (P12.2, AC-WIN-3).
#
# Tauri calls this once per binary through bundle.windows.signCommand, which
# ci/desktop/tauri-overrides.mjs sets only when HEARTH_WIN_SIGN_MODE is set.
#
#   HEARTH_WIN_SIGN_MODE=test        sign with the Veldris test certificate:
#     HEARTH_WIN_TEST_PFX_B64        base64 of the .pfx from windows-test-cert.ps1
#     HEARTH_WIN_TEST_PFX_PASSWORD   its export password
#   HEARTH_WIN_SIGN_MODE=production  reserved for P15.2 (Azure Trusted Signing or an
#                                    HSM-held certificate); fails until then.
#
# Usage: windows-sign.ps1 <file>
param(
  [Parameter(Mandatory = $true, Position = 0)]
  [string] $File
)

$ErrorActionPreference = "Stop"
$TimestampUrl = "http://timestamp.digicert.com"

function Find-SignTool {
  $onPath = Get-Command signtool.exe -ErrorAction SilentlyContinue
  if ($onPath) { return $onPath.Source }
  $kits = Join-Path ${env:ProgramFiles(x86)} "Windows Kits\10\bin"
  $found = Get-ChildItem -Path $kits -Recurse -Filter signtool.exe -ErrorAction SilentlyContinue |
    Where-Object { $_.FullName -match "\\x64\\" } |
    Sort-Object FullName -Descending |
    Select-Object -First 1
  if (-not $found) { throw "signtool.exe not found; install the Windows 10/11 SDK" }
  return $found.FullName
}

switch ($env:HEARTH_WIN_SIGN_MODE) {
  "test" {
    if (-not $env:HEARTH_WIN_TEST_PFX_B64) { throw "HEARTH_WIN_TEST_PFX_B64 is not set" }
    if (-not $env:HEARTH_WIN_TEST_PFX_PASSWORD) { throw "HEARTH_WIN_TEST_PFX_PASSWORD is not set" }
    $pfx = Join-Path ([IO.Path]::GetTempPath()) ("hearth-test-sign-" + [Guid]::NewGuid() + ".pfx")
    try {
      [IO.File]::WriteAllBytes($pfx, [Convert]::FromBase64String($env:HEARTH_WIN_TEST_PFX_B64))
      & (Find-SignTool) sign /fd sha256 /f $pfx /p $env:HEARTH_WIN_TEST_PFX_PASSWORD `
        /tr $TimestampUrl /td sha256 /d "Hearth Suite (test build)" $File
      if ($LASTEXITCODE -ne 0) { throw "signtool failed with exit code $LASTEXITCODE for $File" }
    }
    finally {
      Remove-Item -Force -ErrorAction SilentlyContinue $pfx
    }
  }
  "production" {
    throw "Production signing is not configured yet (P15.2)"
  }
  default {
    throw "HEARTH_WIN_SIGN_MODE must be 'test' or 'production', got '$($env:HEARTH_WIN_SIGN_MODE)'"
  }
}
