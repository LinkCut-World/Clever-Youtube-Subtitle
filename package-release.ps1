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
$provenanceText = & git -C $projectRoot show "${commit}:morphodita/provenance.json"
if ($LASTEXITCODE -ne 0) { throw 'Could not read runtime provenance.' }
$provenance = $provenanceText | ConvertFrom-Json
$files = @(
  'manifest.json', 'nlp-client.js', 'nlp-service.js', 'morphodita', 'word-utils.js', 'content.js', 'captions.css',
  'popup.html', 'popup.css', 'popup.js', 'options.html', 'options.css', 'options.js', 'vocabulary.js',
  'background.js', 'sync-model.js', 'sync-codec.js', 'sync-git.js', 'sync-access.js', 'git-bundle.js',
  'README.md', 'docs', 'LICENSE', 'THIRD_PARTY_LICENSES.txt', 'GIT_THIRD_PARTY_LICENSES.txt',
  'third-party/MorphoDiTa-MPL-2.0.txt', 'third-party/MorphoDiTa-Model-CC-BY-NC-SA-3.0.txt',
  'third-party/MorphoDiTa-Model-README.txt', 'third-party/Emscripten-LICENSE.txt', 'build-morphodita.ps1'
)
$outputDirectory = Join-Path $projectRoot 'dist'
New-Item -ItemType Directory -Path $outputDirectory -Force | Out-Null
Add-Type -AssemblyName System.IO.Compression.FileSystem
$checksums = @()
foreach ($browser in @('Chrome', 'Kiwi')) {
  $zipPath = Join-Path $outputDirectory "Clever-Youtube-Subtitle-$browser-v$($manifest.version).zip"
  & git -C $projectRoot archive --format=zip "--output=$zipPath" $commit -- $files
  if ($LASTEXITCODE -ne 0) { throw "Could not create the $browser ZIP." }
  $zip = [IO.Compression.ZipFile]::Open($zipPath, [IO.Compression.ZipArchiveMode]::Update)
  try {
    if ($browser -eq 'Kiwi') {
      $kiwiManifest = $manifestText | ConvertFrom-Json
      $kiwiManifest.PSObject.Properties.Remove('optional_host_permissions')
      $kiwiManifest | Add-Member -NotePropertyName host_permissions -NotePropertyValue @($GitServers) -Force
      $zip.GetEntry('manifest.json').Delete()
      $entry = $zip.CreateEntry('manifest.json', [IO.Compression.CompressionLevel]::Optimal)
      $writer = [IO.StreamWriter]::new($entry.Open(), [Text.UTF8Encoding]::new($false))
      try { $writer.Write(($kiwiManifest | ConvertTo-Json -Depth 20)) } finally { $writer.Dispose() }
    }
    foreach ($file in @('background.js', 'content.js', 'nlp-client.js', 'nlp-service.js', 'morphodita/engine.js',
      'README.md', 'THIRD_PARTY_LICENSES.txt', 'third-party/MorphoDiTa-MPL-2.0.txt',
      'third-party/MorphoDiTa-Model-CC-BY-NC-SA-3.0.txt', 'third-party/MorphoDiTa-Model-README.txt')) {
      if (-not $zip.GetEntry($file)) { throw "Missing packaged file: $file" }
    }
    foreach ($asset in @(
      @('morphodita/english-model.tagger', $provenance.modelSha256),
      @('morphodita/morphodita.wasm', $provenance.wasmSha256),
      @('morphodita/morphodita.js', $provenance.glueSha256)
    )) {
      $stream = $zip.GetEntry($asset[0]).Open()
      $hasher = [Security.Cryptography.SHA256]::Create()
      try {
        $hash = [BitConverter]::ToString($hasher.ComputeHash($stream)).Replace('-', '').ToLowerInvariant()
        if ($hash -ne $asset[1]) { throw "Packaged runtime hash mismatch: $($asset[0])" }
      } finally { $stream.Dispose(); $hasher.Dispose() }
    }
    if ($zip.Entries.FullName -match 'shanbay|clever-youtube-subtitle-words|lemma-bundle|fixtures.json|experiments/|node_modules/') {
      throw 'An unexpected private, development, or obsolete file entered the package.'
    }
  } finally { $zip.Dispose() }
  $hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $zipPath).Hash.ToLowerInvariant()
  $checksums += "$hash  $([IO.Path]::GetFileName($zipPath))"
  Write-Output "$browser ZIP: $zipPath"
}
$checksumPath = Join-Path $outputDirectory 'SHA256SUMS.txt'
[IO.File]::WriteAllText($checksumPath, ($checksums -join "`n") + "`n", [Text.UTF8Encoding]::new($false))
Write-Output "Checksums: $checksumPath"
