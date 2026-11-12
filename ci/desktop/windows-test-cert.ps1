# Create the Veldris test code-signing certificate for Windows test builds
# (P12.2, ADR-HS-010). Run once, by the person who will hold the key, on a
# trusted Windows machine. Never use this certificate for a stable release.
#
# Writes to -OutDir:
#   hearth-test-signing.pfx  private key + certificate, for the CI secret
#                            HEARTH_WIN_TEST_PFX_B64 (base64 of this file)
#   hearth-test-signing.cer  public certificate, installed on tester machines
#
# The export password is prompted for and never echoed or written to disk.
#
# Usage: powershell -ExecutionPolicy Bypass -File windows-test-cert.ps1 -OutDir <dir> [-Years 2]
param(
  [Parameter(Mandatory = $true)]
  [string] $OutDir,
  [ValidateRange(1, 3)]
  [int] $Years = 2
)

$ErrorActionPreference = "Stop"
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null

$cert = New-SelfSignedCertificate `
  -Type CodeSigningCert `
  -Subject "CN=Veldris Ltd Hearth Suite Test Signing, O=Veldris Ltd, C=GB" `
  -KeyAlgorithm RSA -KeyLength 3072 -HashAlgorithm SHA256 `
  -KeyExportPolicy Exportable `
  -NotAfter (Get-Date).AddYears($Years) `
  -CertStoreLocation "Cert:\CurrentUser\My"

$password = Read-Host -AsSecureString "Export password for the .pfx"
$pfxPath = Join-Path $OutDir "hearth-test-signing.pfx"
$cerPath = Join-Path $OutDir "hearth-test-signing.cer"
Export-PfxCertificate -Cert $cert -FilePath $pfxPath -Password $password | Out-Null
Export-Certificate -Cert $cert -FilePath $cerPath | Out-Null

# Keep the private key only in the exported .pfx, not in this user's store.
Remove-Item -Path ("Cert:\CurrentUser\My\" + $cert.Thumbprint)

Write-Host "Thumbprint: $($cert.Thumbprint)"
Write-Host "Wrote $pfxPath (keep secret) and $cerPath (give to testers)."
