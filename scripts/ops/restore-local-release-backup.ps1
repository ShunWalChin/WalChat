param(
  [Parameter(Mandatory = $true)][string]$BackupPath,
  [string]$Destination,
  [switch]$VerifyOnly
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Unprotect-BackupFile([string]$Source, [string]$Destination, [byte[]]$Key) {
  $inputBytes = [IO.File]::ReadAllBytes($Source)
  $magic = [Text.Encoding]::ASCII.GetBytes('WALBACKUP1')
  if ($inputBytes.Length -lt 37) { throw "Arquivo cifrado inválido: $Source" }
  for ($index = 0; $index -lt $magic.Length; $index += 1) {
    if ($inputBytes[$index] -ne $magic[$index]) { throw "Cabeçalho inválido: $Source" }
  }
  $nonce = $inputBytes[$magic.Length..($magic.Length + 11)]
  $tag = $inputBytes[($magic.Length + 12)..($magic.Length + 27)]
  $cipherStart = $magic.Length + 28
  $cipher = $inputBytes[$cipherStart..($inputBytes.Length - 1)]
  $plain = [byte[]]::new($cipher.Length)
  $aes = [Security.Cryptography.AesGcm]::new($Key, 16)
  try { $aes.Decrypt($nonce, $cipher, $tag, $plain) } finally { $aes.Dispose() }
  [IO.File]::WriteAllBytes($Destination, $plain)
}

$backup = (Resolve-Path -LiteralPath $BackupPath).Path
$manifestPath = Join-Path $backup 'manifest.sha256.json'
$manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
foreach ($entry in $manifest) {
  $target = Join-Path $backup $entry.file
  if (-not (Test-Path -LiteralPath $target)) { throw "Arquivo ausente: $($entry.file)" }
  $actual = (Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($actual -ne $entry.sha256) { throw "SHA-256 divergente: $($entry.file)" }
}

$entropy = [Text.Encoding]::UTF8.GetBytes('WalChat local release backup v1')
$protectedKey = [IO.File]::ReadAllBytes((Join-Path $backup 'backup-key.dpapi'))
$key = [Security.Cryptography.ProtectedData]::Unprotect(
  $protectedKey,
  $entropy,
  [Security.Cryptography.DataProtectionScope]::CurrentUser
)
$temporary = Join-Path ([IO.Path]::GetTempPath()) ("walchat-restore-{0}" -f [guid]::NewGuid())
New-Item -ItemType Directory -Path $temporary | Out-Null
try {
  $sourceArchive = Join-Path $temporary 'source.tar.gz'
  $historyBundle = Join-Path $temporary 'history.bundle'
  Unprotect-BackupFile (Join-Path $backup 'source.tar.gz.aes') $sourceArchive $key
  Unprotect-BackupFile (Join-Path $backup 'history.bundle.aes') $historyBundle $key
  & git bundle verify $historyBundle | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Bundle Git inválido.' }
  & tar -tzf $sourceArchive | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Archive de código inválido.' }

  if (-not $VerifyOnly) {
    if (-not $Destination) { throw 'Informe -Destination para restaurar o código.' }
    $restorePath = [IO.Path]::GetFullPath($Destination)
    if (Test-Path -LiteralPath $restorePath) { throw "O destino já existe: $restorePath" }
    New-Item -ItemType Directory -Path $restorePath | Out-Null
    & tar -xzf $sourceArchive -C $restorePath
    if ($LASTEXITCODE -ne 0) { throw 'Falha ao extrair o código.' }
    Copy-Item -LiteralPath $historyBundle -Destination (Join-Path $restorePath 'walchat-history.bundle')
    Write-Output "RESTORE_PATH=$restorePath"
  }
} finally {
  $resolvedTemporary = [IO.Path]::GetFullPath($temporary)
  $systemTemporary = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
  if ($resolvedTemporary.StartsWith($systemTemporary, [StringComparison]::OrdinalIgnoreCase) -and (Test-Path -LiteralPath $resolvedTemporary)) {
    Remove-Item -LiteralPath $resolvedTemporary -Recurse -Force
  }
}

Write-Output 'BACKUP_VERIFIED=true'
