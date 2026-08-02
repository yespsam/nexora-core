param(
  [ValidateSet("win-x64", "win-arm64")]
  [string]$Runtime = "win-x64"
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$Project = Join-Path $Root "windows/NexoraBridge/NexoraBridge.csproj"
$Output = Join-Path $Root "dist/nexora-bridge-windows/$Runtime"
$ArchiveArchitecture = if ($Runtime -eq "win-x64") { "x64" } else { "ARM64" }
$Archive = Join-Path $Root "dist/NEXORA-Bridge-Windows-$ArchiveArchitecture.zip"
$Checksum = "$Archive.sha256"

Remove-Item $Output -Recurse -Force -ErrorAction SilentlyContinue
New-Item $Output -ItemType Directory -Force | Out-Null

$PublishArguments = @(
  "publish",
  $Project,
  "--configuration", "Release",
  "--runtime", $Runtime,
  "--self-contained", "true",
  "--output", $Output,
  "-p:PublishSingleFile=true",
  "-p:IncludeNativeLibrariesForSelfExtract=true",
  "-p:PublishTrimmed=false",
  "-p:DebugType=None",
  "-p:DebugSymbols=false"
)
& dotnet @PublishArguments
if ($LASTEXITCODE -ne 0) { throw "dotnet publish failed for $Runtime" }

$Executable = Join-Path $Output "NEXORA Bridge.exe"
if (-not (Test-Path $Executable)) { throw "Windows executable was not produced" }

$CanRun = ($Runtime -eq "win-x64" -and $env:PROCESSOR_ARCHITECTURE -eq "AMD64") -or
  ($Runtime -eq "win-arm64" -and $env:PROCESSOR_ARCHITECTURE -eq "ARM64")
if ($CanRun) {
  & $Executable --self-test
  if ($LASTEXITCODE -ne 0) { throw "Windows self-test failed for $Runtime" }
}

$Readme = @"
NEXORA Bridge for Windows ($ArchiveArchitecture)

1. Double-click NEXORA Bridge.exe. It will stay in the Windows system tray.
2. In NEXORA CORE, open Device > Computer Assistant > Pair Computer.
3. Copy the complete NXC1 pairing code and paste it into the pairing window.
4. Use the tray icon to view status, pause, re-pair, or remove this computer.

Credentials are stored in Windows Credential Manager. The app only accepts encrypted,
short-lived allowlisted commands for volume, media controls, and fixed applications.
It never accepts arbitrary command lines or scripts.
"@
Set-Content -Path (Join-Path $Output "README-Windows.txt") -Value $Readme -Encoding UTF8

Remove-Item $Archive, $Checksum -Force -ErrorAction SilentlyContinue
Compress-Archive -Path (Join-Path $Output "*") -DestinationPath $Archive -CompressionLevel Optimal
$Hash = (Get-FileHash -Path $Archive -Algorithm SHA256).Hash.ToLowerInvariant()
Set-Content -Path $Checksum -Value "$Hash  $(Split-Path -Leaf $Archive)" -Encoding ASCII

Write-Host "Built: $Executable"
Write-Host "Archive: $Archive"
Write-Host "Checksum: $Checksum"
