[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$repositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$nativeDirectory = Join-Path $repositoryRoot "native\windows-hello"
$bindingPath = Join-Path $nativeDirectory "binding.gyp"
$sourcePath = Join-Path $nativeDirectory "windows_hello.cc"
$compiledPath = Join-Path $nativeDirectory "build\Release\windows_hello.node"
$outputDirectory = Join-Path $repositoryRoot "out\main\native"
$outputPath = Join-Path $outputDirectory "windows-hello.node"
$manifestPath = Join-Path $repositoryRoot "out\main\windows-hello-manifest.json"
$nodeGypPath = Join-Path $repositoryRoot "node_modules\.bin\node-gyp.cmd"
$electronVersion = "43.3.0"

if (-not (Test-Path -LiteralPath $bindingPath -PathType Leaf)) {
  throw "Windows Hello binding configuration is missing: $bindingPath"
}
if (-not (Test-Path -LiteralPath $sourcePath -PathType Leaf)) {
  throw "Windows Hello addon source is missing: $sourcePath"
}
if (-not (Test-Path -LiteralPath $nodeGypPath -PathType Leaf)) {
  throw "Locked node-gyp executable is missing: $nodeGypPath"
}

$package = Get-Content -LiteralPath (Join-Path $repositoryRoot "package.json") -Raw |
  ConvertFrom-Json
if ($package.devDependencies.electron -ne $electronVersion) {
  throw "Windows Hello target $electronVersion does not match the locked Electron version."
}

New-Item -ItemType Directory -Path $outputDirectory -Force | Out-Null

& $nodeGypPath `
  rebuild `
  "--directory=$nativeDirectory" `
  "--target=$electronVersion" `
  "--arch=x64" `
  "--dist-url=https://electronjs.org/headers" `
  "--msvs_version=2022"
if ($LASTEXITCODE -ne 0) {
  throw "Windows Hello addon compilation failed with exit code $LASTEXITCODE."
}
if (-not (Test-Path -LiteralPath $compiledPath -PathType Leaf)) {
  throw "Windows Hello addon compilation did not create $compiledPath."
}

Copy-Item -LiteralPath $compiledPath -Destination $outputPath -Force
$bytes = [System.IO.File]::ReadAllBytes($outputPath)
if ($bytes.Length -lt 1024 -or $bytes[0] -ne 0x4d -or $bytes[1] -ne 0x5a) {
  throw "Windows Hello addon is not a valid non-empty PE module."
}

$hash = (Get-FileHash -LiteralPath $outputPath -Algorithm SHA256).Hash.ToLowerInvariant()
$manifest = [ordered]@{
  file = "windows-hello.node"
  sha256 = $hash
} | ConvertTo-Json -Compress
[System.IO.File]::WriteAllText(
  $manifestPath,
  $manifest,
  (New-Object System.Text.UTF8Encoding($false))
)

Write-Host "Built Windows Hello N-API addon for Electron $electronVersion x64: $outputPath"
Write-Host "Recorded Windows Hello addon SHA-256 manifest: $manifestPath"
