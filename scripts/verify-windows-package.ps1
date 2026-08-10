[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$repositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$releaseDirectory = Join-Path $repositoryRoot "release"
$unpackedDirectory = Join-Path $releaseDirectory "win-unpacked"
$appExecutable = Join-Path $unpackedDirectory "AMZ.API.exe"
$asarPath = Join-Path $unpackedDirectory "resources\app.asar"
$installerPath = Join-Path $releaseDirectory "AMZ.API-Notebook-Key-Windows-x64-Setup.exe"
$zipPath = Join-Path $releaseDirectory "AMZ.API-Notebook-Key-Windows-x64.zip"
$checksumsPath = Join-Path $releaseDirectory "SHA256SUMS.txt"
$addonName = "windows-hello.node"
$addonPath = Join-Path $unpackedDirectory "resources\app.asar.unpacked\out\main\native\$addonName"
$manifestEntry = "out/main/windows-hello-manifest.json"
$addonEntry = "out/main/native/$addonName"

function Get-Sha256Hex {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)]
    [string]$Path
  )

  $stream = [System.IO.File]::OpenRead($Path)
  try {
    $hasher = [System.Security.Cryptography.SHA256]::Create()
    try {
      $digest = $hasher.ComputeHash($stream)
      return ([System.BitConverter]::ToString($digest)).Replace("-", "").ToLowerInvariant()
    }
    finally {
      $hasher.Dispose()
    }
  }
  finally {
    $stream.Dispose()
  }
}

foreach ($path in @($appExecutable, $asarPath, $addonPath, $installerPath, $zipPath)) {
  if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
    throw "Expected Windows package output is missing: $path"
  }
  if ((Get-Item -LiteralPath $path).Length -le 0) {
    throw "Windows package output is empty: $path"
  }
}

$package = Get-Content -LiteralPath (Join-Path $repositoryRoot "package.json") -Raw |
  ConvertFrom-Json
$productVersion = (Get-Item -LiteralPath $appExecutable).VersionInfo.ProductVersion
if (-not $productVersion.StartsWith($package.version, [StringComparison]::Ordinal)) {
  throw "Packaged app version '$productVersion' does not match package version '$($package.version)'."
}

foreach ($unsignedExecutable in @($appExecutable, $addonPath, $installerPath)) {
  $signature = Get-AuthenticodeSignature -FilePath $unsignedExecutable
  if ($signature.Status -ne [System.Management.Automation.SignatureStatus]::NotSigned) {
    throw "Internal Windows artifact must remain explicitly unsigned; $unsignedExecutable reported $($signature.Status)."
  }
}

$fusesCommand = Join-Path $repositoryRoot "node_modules\.bin\electron-fuses.cmd"
if (-not (Test-Path -LiteralPath $fusesCommand -PathType Leaf)) {
  throw "The locked Electron fuses command is unavailable."
}
$fuseOutput = @(& $fusesCommand read --app $appExecutable)
if ($LASTEXITCODE -ne 0) {
  throw "Unable to read the packaged Windows Electron fuses."
}
$fuseText = $fuseOutput -join [Environment]::NewLine
$expectedFuses = @(
  "RunAsNode is Disabled",
  "EnableCookieEncryption is Enabled",
  "EnableNodeOptionsEnvironmentVariable is Disabled",
  "EnableNodeCliInspectArguments is Disabled",
  "EnableEmbeddedAsarIntegrityValidation is Enabled",
  "OnlyLoadAppFromAsar is Enabled",
  "LoadBrowserProcessSpecificV8Snapshot is Disabled",
  "GrantFileProtocolExtraPrivileges is Disabled"
)
foreach ($expectedFuse in $expectedFuses) {
  if (-not $fuseText.Contains($expectedFuse)) {
    throw "Packaged Windows Electron fuse mismatch: $expectedFuse"
  }
}

$asarCommand = Join-Path $repositoryRoot "node_modules\.bin\asar.cmd"
if (-not (Test-Path -LiteralPath $asarCommand -PathType Leaf)) {
  throw "The locked @electron/asar command is unavailable."
}
$asarEntries = & $asarCommand list $asarPath --is-pack
if ($LASTEXITCODE -ne 0) {
  throw "Unable to inspect packaged app.asar."
}
$normalizedEntries = @($asarEntries | ForEach-Object { $_ -replace "\\", "/" })
$packedManifestPattern = "^pack\s+:\s+/$([Regex]::Escape($manifestEntry))$"
$unpackedAddonPattern = "^unpack\s+:\s+/$([Regex]::Escape($addonEntry))$"
if (-not ($normalizedEntries | Where-Object { $_ -match $packedManifestPattern })) {
  throw "Windows Hello SHA-256 manifest is not packed inside app.asar."
}
if (-not ($normalizedEntries | Where-Object { $_ -match $unpackedAddonPattern })) {
  throw "Windows Hello addon is not marked for app.asar unpacking."
}

$nativeCopies = @(Get-ChildItem -LiteralPath (Join-Path $unpackedDirectory "resources") `
  -Recurse `
  -File `
  -Filter $addonName)
if ($nativeCopies.Count -ne 1 -or $nativeCopies[0].FullName -ne $addonPath) {
  throw "Windows Hello addon must exist only at its exact app.asar.unpacked path."
}

$nodePath = (Get-Command node.exe -ErrorAction Stop).Source
$asarModulePath = Join-Path $repositoryRoot "node_modules\@electron\asar"
if (-not (Test-Path -LiteralPath $asarModulePath -PathType Container)) {
  throw "The locked @electron/asar module directory is unavailable."
}
$extractScriptPath = Join-Path `
  ([System.IO.Path]::GetTempPath()) `
  "amz-api-extract-manifest-$([Guid]::NewGuid().ToString('N')).cjs"
$extractScript = 'const asar=require(process.argv[2]);process.stdout.write(asar.extractFile(process.argv[3],process.argv[4]));'
[System.IO.File]::WriteAllText(
  $extractScriptPath,
  $extractScript,
  (New-Object System.Text.UTF8Encoding($false))
)
try {
  $manifestRaw = @(
    & $nodePath $extractScriptPath $asarModulePath $asarPath $manifestEntry
  ) -join ""
  if ($LASTEXITCODE -ne 0) {
    throw "Unable to extract the Windows Hello manifest from app.asar."
  }
}
finally {
  Remove-Item -LiteralPath $extractScriptPath -Force -ErrorAction SilentlyContinue
}
$manifest = $manifestRaw | ConvertFrom-Json
$manifestProperties = @($manifest.PSObject.Properties.Name)
if (
  $manifestProperties.Count -ne 2 -or
  -not $manifestProperties.Contains("file") -or
  -not $manifestProperties.Contains("sha256") -or
  $manifest.file -ne $addonName -or
  $manifest.sha256 -notmatch "^[a-f0-9]{64}$"
) {
  throw "Windows Hello manifest is invalid."
}
$addonHash = Get-Sha256Hex -Path $addonPath
if ($addonHash -cne $manifest.sha256) {
  throw "Windows Hello addon SHA-256 does not match the packed manifest."
}

$vswherePath = Join-Path ${env:ProgramFiles(x86)} "Microsoft Visual Studio\Installer\vswhere.exe"
if (-not (Test-Path -LiteralPath $vswherePath -PathType Leaf)) {
  throw "Visual Studio locator is unavailable; the native addon cannot be inspected."
}
$visualStudioPath = & $vswherePath `
  -latest `
  -products * `
  -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 `
  -property installationPath |
  Select-Object -First 1
if ([string]::IsNullOrWhiteSpace($visualStudioPath)) {
  throw "Visual Studio C++ x64 inspection tools are unavailable."
}
$msvcRoot = Join-Path $visualStudioPath "VC\Tools\MSVC"
$dumpbinPath = Get-ChildItem -LiteralPath $msvcRoot -Directory |
  Sort-Object { [version]$_.Name } -Descending |
  ForEach-Object { Join-Path $_.FullName "bin\Hostx64\x64\dumpbin.exe" } |
  Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } |
  Select-Object -First 1
if ([string]::IsNullOrWhiteSpace($dumpbinPath)) {
  throw "Visual Studio dumpbin.exe is unavailable."
}
$dumpbinOutput = @(& $dumpbinPath /headers /exports $addonPath)
if ($LASTEXITCODE -ne 0) {
  throw "Unable to inspect the Windows Hello addon PE headers and exports."
}
$dumpbinText = $dumpbinOutput -join [Environment]::NewLine
if ($dumpbinText -notmatch "(?im)^\s*8664 machine \(x64\)\s*$") {
  throw "Windows Hello addon is not an AMD64 PE module."
}
if ($dumpbinText -notmatch "(?m)^\s*\d+\s+[0-9A-Fa-f]+\s+[0-9A-Fa-f]+\s+napi_register_module_v1\s*$") {
  throw "Windows Hello addon does not export napi_register_module_v1."
}

$temporaryRoot = if ([string]::IsNullOrWhiteSpace($env:RUNNER_TEMP)) {
  [System.IO.Path]::GetTempPath()
} else {
  $env:RUNNER_TEMP
}

function Invoke-PackagedSmoke {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)]
    [string]$Executable,
    [Parameter(Mandatory = $true)]
    [ValidatePattern("^[a-z0-9-]+$")]
    [string]$Name
  )

  if (-not (Test-Path -LiteralPath $Executable -PathType Leaf)) {
    throw "Packaged smoke executable is missing: $Executable"
  }
  $smokeDirectory = Join-Path $temporaryRoot "amz-api-windows-smoke-$Name"
  if (Test-Path -LiteralPath $smokeDirectory) {
    Remove-Item -LiteralPath $smokeDirectory -Recurse -Force
  }
  New-Item -ItemType Directory -Path $smokeDirectory -Force | Out-Null
  $stdoutPath = Join-Path $smokeDirectory "stdout.log"
  $stderrPath = Join-Path $smokeDirectory "stderr.log"
  $profilePath = Join-Path $smokeDirectory "profile"
  New-Item -ItemType Directory -Path $profilePath -Force | Out-Null
  New-Item -ItemType File -Path $stdoutPath -Force | Out-Null
  New-Item -ItemType File -Path $stderrPath -Force | Out-Null

  $env:ELECTRON_ENABLE_LOGGING = "1"
  $appProcess = Start-Process `
    -FilePath $Executable `
    -ArgumentList "--user-data-dir=`"$profilePath`"" `
    -RedirectStandardOutput $stdoutPath `
    -RedirectStandardError $stderrPath `
    -PassThru
  $bridgeReady = $false
  $addonReady = $false
  try {
    for ($attempt = 0; $attempt -lt 60; $attempt += 1) {
      Start-Sleep -Seconds 1
      $appProcess.Refresh()
      if ($appProcess.HasExited) {
        $stdout = Get-Content -LiteralPath $stdoutPath -Raw
        $stderr = Get-Content -LiteralPath $stderrPath -Raw
        throw "$Name app exited before packaged readiness.`nSTDOUT:`n$stdout`nSTDERR:`n$stderr"
      }
      $combinedLog = (Get-Content -LiteralPath $stdoutPath -Raw) +
        (Get-Content -LiteralPath $stderrPath -Raw)
      $bridgeReady = $combinedLog.Contains("AMZ_API_BRIDGE_READY")
      $addonReady = $combinedLog.Contains("AMZ_API_WINDOWS_HELLO_ADDON_READY")
      if ($bridgeReady -and $addonReady) {
        break
      }
    }
    if (-not $bridgeReady -or -not $addonReady) {
      $stdout = Get-Content -LiteralPath $stdoutPath -Raw
      $stderr = Get-Content -LiteralPath $stderrPath -Raw
      throw "$Name app did not report Bridge and Windows Hello addon readiness within 60 seconds.`nSTDOUT:`n$stdout`nSTDERR:`n$stderr"
    }
  }
  finally {
    $appProcess.Refresh()
    if (-not $appProcess.HasExited) {
      & taskkill.exe /PID $appProcess.Id /T /F 2>$null | Out-Null
    }
  }
}

$archiveDirectory = Join-Path $temporaryRoot "amz-api-windows-zip"
if (Test-Path -LiteralPath $archiveDirectory) {
  Remove-Item -LiteralPath $archiveDirectory -Recurse -Force
}
Expand-Archive -LiteralPath $zipPath -DestinationPath $archiveDirectory
$archiveExecutable = Get-ChildItem -LiteralPath $archiveDirectory `
  -Recurse `
  -File `
  -Filter "AMZ.API.exe" |
  Select-Object -First 1
if ($null -eq $archiveExecutable) {
  throw "Portable ZIP does not contain AMZ.API.exe."
}

Invoke-PackagedSmoke -Executable $appExecutable -Name "win-unpacked"
Invoke-PackagedSmoke -Executable $archiveExecutable.FullName -Name "zip"

$installDirectory = Join-Path $temporaryRoot "amz-api-notebook-key-install"
if (Test-Path -LiteralPath $installDirectory) {
  Remove-Item -LiteralPath $installDirectory -Recurse -Force
}
$installProcess = Start-Process `
  -FilePath $installerPath `
  -ArgumentList @("/S", "/D=$installDirectory") `
  -Wait `
  -PassThru
if ($installProcess.ExitCode -ne 0) {
  throw "Silent NSIS installation failed with exit code $($installProcess.ExitCode)."
}
$installedExecutable = Join-Path $installDirectory "AMZ.API.exe"
if (-not (Test-Path -LiteralPath $installedExecutable -PathType Leaf)) {
  throw "Silent NSIS installation did not create the packaged app executable."
}
$installedVersion = (Get-Item -LiteralPath $installedExecutable).VersionInfo.ProductVersion
if (-not $installedVersion.StartsWith($package.version, [StringComparison]::Ordinal)) {
  throw "Installed app version '$installedVersion' does not match package version '$($package.version)'."
}
$uninstaller = Get-ChildItem -LiteralPath $installDirectory `
  -File `
  -Filter "Uninstall*.exe" |
  Select-Object -First 1
if ($null -eq $uninstaller) {
  throw "Silent NSIS installation did not create an uninstaller."
}
Invoke-PackagedSmoke -Executable $installedExecutable -Name "nsis-installed"
$uninstallProcess = Start-Process `
  -FilePath $uninstaller.FullName `
  -ArgumentList "/S" `
  -Wait `
  -PassThru
if ($uninstallProcess.ExitCode -ne 0) {
  throw "Silent NSIS uninstallation failed with exit code $($uninstallProcess.ExitCode)."
}
for ($attempt = 0; $attempt -lt 20 -and (Test-Path -LiteralPath $installedExecutable); $attempt += 1) {
  Start-Sleep -Milliseconds 250
}
if (Test-Path -LiteralPath $installedExecutable) {
  throw "Silent NSIS uninstallation left the packaged app executable installed."
}

$checksumLines = @($installerPath, $zipPath) |
  Sort-Object { Split-Path $_ -Leaf } |
  ForEach-Object {
    $hash = Get-Sha256Hex -Path $_
    "$hash  $(Split-Path $_ -Leaf)"
  }
[System.IO.File]::WriteAllLines(
  $checksumsPath,
  $checksumLines,
  (New-Object System.Text.UTF8Encoding($false))
)

Write-Host "Windows x64 win-unpacked, ZIP and installed NSIS Bridge/addon smoke passed without credentials."
Write-Host "Windows Hello AMD64 N-API export and packed SHA-256 manifest were verified."
Write-Host "CI did not prove a real Windows Hello prompt or Windows 11 Pro user-device result."
