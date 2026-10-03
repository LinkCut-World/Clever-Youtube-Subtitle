param(
  [string]$SourceRoot = '',
  [string]$SdkRoot = '',
  [string]$ModelPath = ''
)
$ErrorActionPreference = 'Stop'
$projectRoot = $PSScriptRoot
if (-not $SourceRoot) {
  $SourceRoot = Join-Path $projectRoot 'dist\morphodita-wasm-kit\source\morphodita-d1617496b2ae7fcb031d5a2e38511d7401c74afc'
}
if (-not $SdkRoot) { $SdkRoot = Join-Path $projectRoot 'dist\morphodita-wasm-kit\toolchain\emsdk-main' }
if (-not $ModelPath) {
  $ModelPath = Join-Path $projectRoot 'dist\lemma-research\morphodita\models\english-morphium-wsj-140407\english-morphium-wsj-140407-no_negation.tagger'
}
$SourceRoot = [IO.Path]::GetFullPath($SourceRoot)
$SdkRoot = [IO.Path]::GetFullPath($SdkRoot)
$ModelPath = [IO.Path]::GetFullPath($ModelPath)
if (-not (Test-Path -LiteralPath (Join-Path $SdkRoot '.emscripten'))) { throw 'Activate Emscripten 3.1.73 in the local SDK first.' }
$env:EM_CONFIG = Join-Path $SdkRoot '.emscripten'
$env:EM_CACHE = Join-Path $SdkRoot 'upstream\emscripten\cache'
$sourceDirectory = Join-Path $SourceRoot 'src'
$sourceFiles = @()
foreach ($line in Get-Content -LiteralPath (Join-Path $sourceDirectory 'Makefile.include')) {
  if ($line -match '^MORPHODITA_OBJECTS\s*(?:\+)?=\s*(.+)$') {
    foreach ($name in ($Matches[1] -split '\s+')) { $sourceFiles += Join-Path $sourceDirectory "$name.cpp" }
  }
}
if ($sourceFiles.Count -ne 28) { throw 'Use the pinned MorphoDiTa 1.11.3 source.' }
$runtime = Join-Path $projectRoot 'morphodita'
$compiler = Join-Path $SdkRoot 'upstream\emscripten\em++.py'
$arguments = @($compiler, '-std=c++17', '-O3', '-fexceptions',
  "-I$sourceDirectory", "-I$(Join-Path $SourceRoot 'src_lib_only')") + $sourceFiles + @(
  (Join-Path $runtime 'bridge.cpp'), '-o', (Join-Path $runtime 'morphodita.js'),
  '-sMODULARIZE=1', '-sEXPORT_NAME=createMorphoModule', '-sENVIRONMENT=web,worker,node',
  '-sDYNAMIC_EXECUTION=0', '-sFILESYSTEM=0', '-sALLOW_MEMORY_GROWTH=1',
  '-sINITIAL_MEMORY=16777216', '-sMAXIMUM_MEMORY=268435456', '-sSTACK_SIZE=1048576',
  '-sMALLOC=emmalloc', '-sDISABLE_EXCEPTION_CATCHING=0',
  '-sEXPORTED_FUNCTIONS=["_malloc","_free","_morpho_create","_morpho_analyze","_morpho_destroy","_morpho_error"]',
  '-sEXPORTED_RUNTIME_METHODS=["UTF8ToString"]'
)
& python @arguments
if ($LASTEXITCODE -ne 0) { throw 'WASM compilation failed.' }
Copy-Item -LiteralPath $ModelPath -Destination (Join-Path $runtime 'english-model.tagger')
Copy-Item -LiteralPath (Join-Path $SourceRoot 'LICENSE') -Destination (Join-Path $projectRoot 'third-party\MorphoDiTa-MPL-2.0.txt')
Copy-Item -LiteralPath (Join-Path ([IO.Path]::GetDirectoryName($ModelPath)) 'LICENSE') -Destination (Join-Path $projectRoot 'third-party\MorphoDiTa-Model-CC-BY-NC-SA-3.0.txt')
Copy-Item -LiteralPath (Join-Path ([IO.Path]::GetDirectoryName($ModelPath)) 'README') -Destination (Join-Path $projectRoot 'third-party\MorphoDiTa-Model-README.txt')
Copy-Item -LiteralPath (Join-Path $SdkRoot 'upstream\emscripten\LICENSE') -Destination (Join-Path $projectRoot 'third-party\Emscripten-LICENSE.txt')
$provenancePath = Join-Path $runtime 'provenance.json'
$provenance = Get-Content -Raw -LiteralPath $provenancePath | ConvertFrom-Json
foreach ($asset in @(
  @('english-model.tagger', 'modelSha256'), @('morphodita.wasm', 'wasmSha256'), @('morphodita.js', 'glueSha256')
)) {
  $hash = (Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path $runtime $asset[0])).Hash.ToLowerInvariant()
  $provenance.($asset[1]) = $hash
}
[IO.File]::WriteAllText($provenancePath, ($provenance | ConvertTo-Json -Depth 8))
Write-Output 'Built unmodified MorphoDiTa 1.11.3 with Emscripten 3.1.73.'
