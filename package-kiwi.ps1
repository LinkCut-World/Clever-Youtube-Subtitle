param(
  [string]$Ref = 'HEAD',
  [string[]]$GitServers = @('https://*/*', 'http://*/*')
)

$ErrorActionPreference = 'Stop'
$projectRoot = $PSScriptRoot
if (-not $GitServers.Count) { throw 'Choose at least one Git server origin.' }
foreach ($origin in $GitServers) {
  if ($origin -notmatch '^https?://(?:\*|[^/@?#\s]+)\/\*$') {
    throw 'GitServers must be HTTP/HTTPS origin patterns without login details.'
  }
}

$commit = (& git -C $projectRoot rev-parse --verify --end-of-options "${Ref}^{commit}").Trim()
if ($LASTEXITCODE -ne 0) { throw 'Could not resolve the release commit.' }
$manifestText = & git -C $projectRoot show "${commit}:manifest.json"
if ($LASTEXITCODE -ne 0) { throw 'Could not read the release manifest.' }
$manifest = $manifestText | ConvertFrom-Json
$manifest.PSObject.Properties.Remove('optional_host_permissions')
$manifest | Add-Member -NotePropertyName host_permissions -NotePropertyValue @($GitServers) -Force

$files = @(
  'manifest.json', 'lemma-bundle.js', 'word-utils.js', 'content.js', 'captions.css',
  'popup.html', 'popup.css', 'popup.js', 'options.html', 'options.css', 'options.js',
  'vocabulary.js', 'background.js', 'sync-model.js', 'sync-codec.js', 'sync-git.js',
  'sync-access.js', 'git-bundle.js', 'LICENSE', 'THIRD_PARTY_LICENSES.txt',
  'GIT_THIRD_PARTY_LICENSES.txt'
)
$outputDirectory = Join-Path $projectRoot 'dist'
New-Item -ItemType Directory -Path $outputDirectory -Force | Out-Null
$zipPath = Join-Path $outputDirectory "Clever-Youtube-Subtitle-Kiwi-v$($manifest.version).zip"
& git -C $projectRoot archive --format=zip "--output=$zipPath" $commit -- $files
if ($LASTEXITCODE -ne 0) { throw 'Could not create the extension ZIP.' }

Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [IO.Compression.ZipFile]::Open($zipPath, [IO.Compression.ZipArchiveMode]::Update)
try {
  $zip.GetEntry('manifest.json').Delete()
  $entry = $zip.CreateEntry('manifest.json', [IO.Compression.CompressionLevel]::Optimal)
  $writer = [IO.StreamWriter]::new($entry.Open(), [Text.UTF8Encoding]::new($false))
  try { $writer.Write(($manifest | ConvertTo-Json -Depth 20)) }
  finally { $writer.Dispose() }
} finally { $zip.Dispose() }

Write-Output "Kiwi ZIP: $zipPath"
