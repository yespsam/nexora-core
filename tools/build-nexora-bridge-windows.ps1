param(
  [ValidateSet("win-x64", "win-arm64")]
  [string]$Runtime = "win-x64",
  [string]$CertificateThumbprint = $env:NEXORA_WINDOWS_CERT_THUMBPRINT,
  [string]$TimestampUrl = "http://timestamp.digicert.com"
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

$RuntimeRoot = Join-Path $Output "Runtime"
New-Item $RuntimeRoot -ItemType Directory -Force | Out-Null

function Copy-RuntimeFile {
  param([string]$RelativePath)
  $Source = Join-Path $Root $RelativePath
  if (-not (Test-Path $Source)) { throw "Required desktop pet asset is missing: $RelativePath" }
  $Destination = Join-Path $RuntimeRoot $RelativePath
  New-Item (Split-Path -Parent $Destination) -ItemType Directory -Force | Out-Null
  Copy-Item $Source $Destination -Force
}

@(
  "desktop-pet/index.html",
  "desktop-pet/style.css",
  "desktop-pet/app.mjs",
  "shared/creature-3d-viewer.mjs",
  "shared/creature-3d-data.mjs",
  "desktop-wallpaper/vendor/three.module.js",
  "desktop-wallpaper/vendor/GLTFLoader.js",
  "desktop-wallpaper/vendor/BufferGeometryUtils.js",
  "desktop-wallpaper/vendor/meshopt_decoder.module.js"
) | ForEach-Object { Copy-RuntimeFile $_ }

foreach ($Creature in @("CUTE_LUMO", "COOL_VEYR", "BEAUTIFUL_AERA")) {
  Copy-RuntimeFile "NEXORA_3D_CREATURES/$Creature/model/rigged.glb"
  Copy-RuntimeFile "NEXORA_3D_CREATURES/$Creature/evolution/young/rigged.glb"
  Copy-RuntimeFile "NEXORA_3D_CREATURES/$Creature/evolution/resonance/rigged.glb"
  foreach ($Action in @("idle", "affection", "nod", "run", "speaking", "walk", "wave")) {
    Copy-RuntimeFile "NEXORA_3D_CREATURES/$Creature/animations/$Action.glb"
  }
}

if ($CertificateThumbprint) {
  $NormalizedThumbprint = $CertificateThumbprint.Replace(" ", "").ToUpperInvariant()
  if ($NormalizedThumbprint -notmatch "^[0-9A-F]{40}$") {
    throw "Certificate thumbprint must contain exactly 40 hexadecimal characters"
  }
  $SignTool = (Get-Command signtool.exe -ErrorAction SilentlyContinue).Source
  if (-not $SignTool) {
    $Candidates = Get-ChildItem "${env:ProgramFiles(x86)}\Windows Kits\10\bin" -Filter signtool.exe -Recurse -ErrorAction SilentlyContinue |
      Where-Object { $_.FullName -match "\\x64\\signtool\.exe$" } |
      Sort-Object FullName -Descending
    $SignTool = $Candidates[0].FullName
  }
  if (-not $SignTool) { throw "signtool.exe was not found" }
  & $SignTool sign /sha1 $NormalizedThumbprint /fd SHA256 /tr $TimestampUrl /td SHA256 /v $Executable
  if ($LASTEXITCODE -ne 0) { throw "Authenticode signing failed for $Runtime" }
  & $SignTool verify /pa /all /v $Executable
  if ($LASTEXITCODE -ne 0) { throw "Authenticode verification failed for $Runtime" }
  Write-Host "Signing mode: Authenticode"
} else {
  Write-Host "Signing mode: unsigned internal build"
}

$CanRun = ($Runtime -eq "win-x64" -and $env:PROCESSOR_ARCHITECTURE -eq "AMD64") -or
  ($Runtime -eq "win-arm64" -and $env:PROCESSOR_ARCHITECTURE -eq "ARM64")
if ($CanRun) {
  $NativeSelfTest = Start-Process -FilePath $Executable -ArgumentList "--self-test-native" -Wait -PassThru
  if ($NativeSelfTest.ExitCode -ne 0) { throw "Windows self-test failed for $Runtime" }
  $PetSelfTest = Start-Process -FilePath $Executable -ArgumentList "--self-test-pet" -Wait -PassThru
  if ($PetSelfTest.ExitCode -ne 0) { throw "Windows desktop pet visual self-test failed for $Runtime" }
}

$Readme = @"
NEXORA Bridge for Windows ($ArchiveArchitecture)

1. Extract the entire ZIP, then double-click NEXORA Bridge.exe. Keep the Runtime folder beside it.
2. The transparent 3D desktop pet appears automatically. Drag it to move, use the mouse wheel to resize,
   click for an action, or double-click to open conversation.
3. On an already signed-in phone or primary computer, open Device > Computer Assistant > Add Computer.
4. Copy the new NXC1 pairing code and paste it into this Windows computer. This computer does not sign in.
5. Wait for the cloud verification and the Pairing Complete message.
6. Use the tray icon to show/hide the pet, select its form and action, or manage pairing.

Credentials are stored in Windows Credential Manager. The app only accepts encrypted,
short-lived allowlisted commands for volume, media controls, and fixed applications.
It never accepts arbitrary command lines or scripts.
"@
Set-Content -Path (Join-Path $Output "README-Windows.txt") -Value $Readme -Encoding UTF8

Remove-Item $Archive, $Checksum -Force -ErrorAction SilentlyContinue
Compress-Archive -Path (Join-Path $Output "*") -DestinationPath $Archive -CompressionLevel Optimal
$Hash = (Get-FileHash -Path $Archive -Algorithm SHA256).Hash.ToLowerInvariant()
$ChecksumText = "$Hash  $(Split-Path -Leaf $Archive)`n"
[System.IO.File]::WriteAllText($Checksum, $ChecksumText, [System.Text.UTF8Encoding]::new($false))

Write-Host "Built: $Executable"
Write-Host "Archive: $Archive"
Write-Host "Checksum: $Checksum"
