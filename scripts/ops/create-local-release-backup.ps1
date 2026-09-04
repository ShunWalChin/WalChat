param(
  [string]$Repository = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path,
  [string]$DestinationRoot = (Join-Path (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path 'backups')
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Invoke-Checked([scriptblock]$Command, [string]$Failure) {
  & $Command
  if ($LASTEXITCODE -ne 0) { throw $Failure }
}

function Protect-BackupFile([string]$Source, [string]$Destination, [byte[]]$Key) {
  $plain = [IO.File]::ReadAllBytes($Source)
  $nonce = [byte[]]::new(12)
  [Security.Cryptography.RandomNumberGenerator]::Fill($nonce)
  $tag = [byte[]]::new(16)
  $cipher = [byte[]]::new($plain.Length)
  $aes = [Security.Cryptography.AesGcm]::new($Key, 16)
  try { $aes.Encrypt($nonce, $plain, $cipher, $tag) } finally { $aes.Dispose() }
  $magic = [Text.Encoding]::ASCII.GetBytes('WALBACKUP1')
  $output = [byte[]]::new($magic.Length + $nonce.Length + $tag.Length + $cipher.Length)
  [Array]::Copy($magic, 0, $output, 0, $magic.Length)
  [Array]::Copy($nonce, 0, $output, $magic.Length, $nonce.Length)
  [Array]::Copy($tag, 0, $output, $magic.Length + $nonce.Length, $tag.Length)
  [Array]::Copy($cipher, 0, $output, $magic.Length + $nonce.Length + $tag.Length, $cipher.Length)
  [IO.File]::WriteAllBytes($Destination, $output)
}

$repo = (Resolve-Path -LiteralPath $Repository).Path
$dirty = & git -C $repo status --porcelain=v1
if ($LASTEXITCODE -ne 0) { throw 'Não foi possível ler o repositório.' }
if ($dirty) { throw 'O backup de release exige um worktree limpo e totalmente versionado.' }

$backupId = '{0}-local-release' -f (Get-Date -Format 'yyyyMMddTHHmmss')
$backupRoot = [IO.Path]::GetFullPath($DestinationRoot)
$backupPath = Join-Path $backupRoot $backupId
if (Test-Path -LiteralPath $backupPath) { throw "Destino já existe: $backupPath" }
New-Item -ItemType Directory -Path $backupPath -Force | Out-Null

$temporary = Join-Path ([IO.Path]::GetTempPath()) ("walchat-backup-{0}" -f [guid]::NewGuid())
New-Item -ItemType Directory -Path $temporary | Out-Null
try {
  $sourceArchive = Join-Path $temporary 'source.tar.gz'
  $historyBundle = Join-Path $temporary 'history.bundle'
  Invoke-Checked { git -C $repo archive --format=tar.gz --output=$sourceArchive HEAD } 'Falha ao arquivar o código.'
  Invoke-Checked { git -C $repo bundle create $historyBundle --all } 'Falha ao criar o bundle Git.'

  $key = [byte[]]::new(32)
  [Security.Cryptography.RandomNumberGenerator]::Fill($key)
  $entropy = [Text.Encoding]::UTF8.GetBytes('WalChat local release backup v1')
  $protectedKey = [Security.Cryptography.ProtectedData]::Protect(
    $key,
    $entropy,
    [Security.Cryptography.DataProtectionScope]::CurrentUser
  )
  [IO.File]::WriteAllBytes((Join-Path $backupPath 'backup-key.dpapi'), $protectedKey)
  Protect-BackupFile $sourceArchive (Join-Path $backupPath 'source.tar.gz.aes') $key
  Protect-BackupFile $historyBundle (Join-Path $backupPath 'history.bundle.aes') $key

  $metadata = [ordered]@{
    backupId = $backupId
    createdAt = (Get-Date).ToUniversalTime().ToString('o')
    repository = $repo
    branch = (& git -C $repo branch --show-current).Trim()
    commit = (& git -C $repo rev-parse HEAD).Trim()
    encryption = 'AES-256-GCM; key protected by Windows DPAPI CurrentUser'
    secrets = 'Arquivos ignorados pelo Git, incluindo .env.*, não fazem parte deste snapshot.'
  }
  $metadata | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $backupPath 'metadata.json') -Encoding utf8

  $manifest = Get-ChildItem -LiteralPath $backupPath -File |
    Sort-Object Name |
    ForEach-Object {
      [ordered]@{ file = $_.Name; bytes = $_.Length; sha256 = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant() }
    }
  $manifest | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $backupPath 'manifest.sha256.json') -Encoding utf8
} finally {
  $resolvedTemporary = [IO.Path]::GetFullPath($temporary)
  $systemTemporary = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
  if ($resolvedTemporary.StartsWith($systemTemporary, [StringComparison]::OrdinalIgnoreCase) -and (Test-Path -LiteralPath $resolvedTemporary)) {
    Remove-Item -LiteralPath $resolvedTemporary -Recurse -Force
  }
}

& (Join-Path $PSScriptRoot 'restore-local-release-backup.ps1') -BackupPath $backupPath -VerifyOnly
if ($LASTEXITCODE -ne 0) { throw 'O ensaio automático de restauração falhou.' }
Write-Output "BACKUP_PATH=$backupPath"
Write-Output "BACKUP_COMMIT=$($metadata.commit)"
