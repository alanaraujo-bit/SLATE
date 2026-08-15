$ErrorActionPreference = "Stop"

$pastaChaves = Join-Path $env:LOCALAPPDATA "Aionixdev\SLATE\release"
$chavePrivada = Join-Path $pastaChaves "updater.key"
$arquivoSenha = Join-Path $pastaChaves "updater.password.txt"

if (-not (Test-Path -LiteralPath $chavePrivada) -or -not (Test-Path -LiteralPath $arquivoSenha)) {
  throw @"
As chaves de atualização do SLATE não foram encontradas em:
  $pastaChaves

Sem elas o instalador não pode produzir um pacote de atualização verificável.
Consulte apps/desktop/LEIAME.md — nunca crie uma segunda chave para uma release.
"@
}

$chaveAnterior = $env:TAURI_SIGNING_PRIVATE_KEY_PATH
$conteudoAnterior = $env:TAURI_SIGNING_PRIVATE_KEY
$senhaAnterior = $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD

try {
  $env:TAURI_SIGNING_PRIVATE_KEY_PATH = $chavePrivada
  # O bundler 2.11 ainda consulta esta variável mesmo quando a CLI anuncia a
  # variante *_PATH. O conteúdo permanece só no ambiente do processo filho.
  $env:TAURI_SIGNING_PRIVATE_KEY = [System.IO.File]::ReadAllText($chavePrivada)
  $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = [System.IO.File]::ReadAllText($arquivoSenha).Trim()
  pnpm tauri build
  if ($LASTEXITCODE -ne 0) { throw "O empacotamento do SLATE falhou." }
} finally {
  $env:TAURI_SIGNING_PRIVATE_KEY_PATH = $chaveAnterior
  $env:TAURI_SIGNING_PRIVATE_KEY = $conteudoAnterior
  $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = $senhaAnterior
}
