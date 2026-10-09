param(
  [string]$Ref = 'HEAD',
  [string[]]$GitServers = @('https://*/*', 'http://*/*'),
  [switch]$WorkingTree
)
$ErrorActionPreference = 'Stop'
$projectRoot = $PSScriptRoot
if (-not $GitServers.Count) { throw 'Choose at least one Git server origin.' }
foreach ($origin in $GitServers) {
  if ($origin -notmatch '^https?://(?:\*|[^/@?#\s]+)\/\*$') {
    throw 'GitServers must be HTTP/HTTPS origin patterns without login details.'
  }
}
if ($WorkingTree) {
  $manifestText = Get-Content -LiteralPath (Join-Path $projectRoot 'manifest.json') -Raw
  $provenanceText = Get-Content -LiteralPath (Join-Path $projectRoot 'morphodita/provenance.json') -Raw
} else {
  $commit = (& git -C $projectRoot rev-parse --verify --end-of-options "${Ref}^{commit}").Trim()
  if ($LASTEXITCODE -ne 0) { throw 'Could not resolve the release commit.' }
  $manifestText = & git -C $projectRoot show "${commit}:manifest.json"
  if ($LASTEXITCODE -ne 0) { throw 'Could not read the release manifest.' }
  $provenanceText = & git -C $projectRoot show "${commit}:morphodita/provenance.json"
  if ($LASTEXITCODE -ne 0) { throw 'Could not read runtime provenance.' }
}
$manifest = $manifestText | ConvertFrom-Json
$provenance = $provenanceText | ConvertFrom-Json
$files = @(
  'manifest.json', 'nlp-client.js', 'nlp-service.js', 'morphodita', 'word-utils.js', 'caption-stream.js', 'content.js', 'captions.css',
  'popup.html', 'popup.css', 'popup.js', 'options.html', 'options.css', 'options.js', 'vocabulary.js',
  'background.js', 'sync-model.js', 'sync-codec.js', 'sync-git.js', 'sync-access.js', 'git-bundle.js',
  'dictionary.js', 'dictionary-service.js', 'microsoft-dictionary.js', 'dictionary-settings.js', 'word-meaning.js', 'caption-interaction.js',
  'dictionary-catalog.js', 'dictionary-store.js', 'dictionary-packs.js', 'dictionary-manager.js', 'dictionaries.html',
  'wikdict-sqlite.js', 'wikdict-client.js', 'wikdict-worker.js', 'sqlite', 'third-party/SQL-js-MIT.txt',
  'third-party/WikDict-NOTICE.txt', 'third-party/Dictionary-CC-BY-SA-4.0.txt',
  'README.md', 'docs', 'LICENSE', 'THIRD_PARTY_LICENSES.txt', 'GIT_THIRD_PARTY_LICENSES.txt',
  'third-party/MorphoDiTa-MPL-2.0.txt', 'third-party/MorphoDiTa-Model-CC-BY-NC-SA-3.0.txt',
  'third-party/MorphoDiTa-Model-README.txt', 'third-party/Emscripten-LICENSE.txt', 'build-morphodita.ps1'
)
$outputDirectory = Join-Path $projectRoot 'dist'
New-Item -ItemType Directory -Path $outputDirectory -Force | Out-Null
Add-Type -AssemblyName System.IO.Compression.FileSystem
$checksums = @()
foreach ($browser in @('Chrome', 'Kiwi')) {
  $suffix = if ($WorkingTree) { '-local' } else { '' }
  $zipPath = Join-Path $outputDirectory "Clever-Youtube-Subtitle-$browser-v$($manifest.version)$suffix.zip"
  if ($WorkingTree) {
    $previewStream = [IO.File]::Open($zipPath, [IO.FileMode]::Create)
    $previewArchive = [IO.Compression.ZipArchive]::new($previewStream, [IO.Compression.ZipArchiveMode]::Create, $false)
    try {
      foreach ($relative in $files) {
        $item = Get-Item -LiteralPath (Join-Path $projectRoot $relative)
        $entries = if ($item.PSIsContainer) { Get-ChildItem -LiteralPath $item.FullName -Recurse -File } else { @($item) }
        foreach ($sourceFile in $entries) {
          $entryName = $sourceFile.FullName.Substring($projectRoot.Length + 1).Replace('\', '/')
          [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($previewArchive, $sourceFile.FullName, $entryName, [IO.Compression.CompressionLevel]::Optimal) | Out-Null
        }
      }
    } finally { $previewArchive.Dispose() }
  } else {
    & git -C $projectRoot archive --format=zip "--output=$zipPath" $commit -- $files
    if ($LASTEXITCODE -ne 0) { throw "Could not create the $browser ZIP." }
  }
  $zip = [IO.Compression.ZipFile]::Open($zipPath, [IO.Compression.ZipArchiveMode]::Update)
  try {
    if ($browser -eq 'Kiwi') {
      $kiwiManifest = $manifestText | ConvertFrom-Json
      $kiwiManifest.PSObject.Properties.Remove('optional_host_permissions')
      $kiwiManifest | Add-Member -NotePropertyName host_permissions -NotePropertyValue @($GitServers) -Force
      if ($manifest.content_scripts.js -contains 'dictionary.js') {
        $kiwiManifest.host_permissions = @($kiwiManifest.host_permissions + 'https://api.cognitive.microsofttranslator.com/*' | Select-Object -Unique)
        $kiwiManifest.host_permissions = @($kiwiManifest.host_permissions + 'https://download.wikdict.com/*' | Select-Object -Unique)
      }
      $zip.GetEntry('manifest.json').Delete()
      $entry = $zip.CreateEntry('manifest.json', [IO.Compression.CompressionLevel]::Optimal)
      $writer = [IO.StreamWriter]::new($entry.Open(), [Text.UTF8Encoding]::new($false))
      try { $writer.Write(($kiwiManifest | ConvertTo-Json -Depth 20)) } finally { $writer.Dispose() }
    }
    foreach ($file in @('background.js', 'content.js', 'nlp-client.js', 'nlp-service.js', 'caption-stream.js', 'morphodita/engine.js',
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
    if ($manifest.content_scripts.js -contains 'dictionary.js') {
      foreach ($file in @('dictionary.js', 'dictionary-service.js', 'word-meaning.js', 'caption-interaction.js', 'dictionary-catalog.js',
        'dictionary-store.js', 'dictionary-packs.js', 'dictionary-manager.js', 'dictionaries.html', 'third-party/WikDict-NOTICE.txt', 'third-party/Dictionary-CC-BY-SA-4.0.txt')) {
        if (-not $zip.GetEntry($file)) { throw "Missing dictionary file: $file" }
      }
      foreach ($file in @('microsoft-dictionary.js', 'dictionary-settings.js')) {
        if (-not $zip.GetEntry($file)) { throw "Missing Microsoft dictionary file: $file" }
      }
      foreach ($file in @('wikdict-sqlite.js', 'wikdict-client.js', 'wikdict-worker.js', 'sqlite/sql-wasm.js', 'sqlite/sql-wasm.wasm', 'third-party/SQL-js-MIT.txt')) {
        if (-not $zip.GetEntry($file)) { throw "Missing official dictionary reader: $file" }
      }
    }
    if ($zip.Entries.FullName -match 'shanbay|clever-youtube-subtitle-words|lemma-bundle|fixtures.json|test-fixtures/|experiments/|node_modules/|^dictionaries/|\.json\.gz$') {
      throw 'An unexpected private, development, or obsolete file entered the package.'
    }
  } finally { $zip.Dispose() }
  $hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $zipPath).Hash.ToLowerInvariant()
  $checksums += "$hash  $([IO.Path]::GetFileName($zipPath))"
  Write-Output "$browser ZIP: $zipPath"
}
$checksumName = if ($WorkingTree) { 'SHA256SUMS-local.txt' } else { 'SHA256SUMS.txt' }
$checksumPath = Join-Path $outputDirectory $checksumName
[IO.File]::WriteAllText($checksumPath, ($checksums -join "`n") + "`n", [Text.UTF8Encoding]::new($false))
Write-Output "Checksums: $checksumPath"
