# Cópia de segurança do banco do Assistente DETRAN e teste de restauração.
#
# Cópia:      $env:DB_URL = "mysql://usuario:senha@host:porta/banco"; .\scripts\backup-banco.ps1 -Saida C:\Backups\detran
# Restaurar:  .\scripts\backup-banco.ps1 -Restaurar C:\Backups\detran\detran-2026-11-22.sql.gz -Porta 3399 [-Usuario root]
#             (restaura num banco NOVO "restauracao_teste" do MySQL local e confere as contagens; não toca a produção)
#
# A senha nunca vai na linha de comando (usa MYSQL_PWD só para o processo do mysqldump).
param(
  [string]$Saida = "",
  [string]$Restaurar = "",
  [int]$Porta = 3306,
  [string]$Usuario = "root",
  [string]$MySqlBin = "C:\Program Files\MySQL\MySQL Server 8.4\bin"
)
$ErrorActionPreference = "Stop"

function LerUrl($u) {
  if ($u -notmatch '^mysql://([^:@/]+)(?::([^@]*))?@([^:/]+)(?::(\d+))?/([^?]+)') { throw "DB_URL inválida (esperado mysql://usuario:senha@host:porta/banco)" }
  return @{ usuario = [uri]::UnescapeDataString($matches[1]); senha = [uri]::UnescapeDataString($matches[2]); host = $matches[3]; porta = $(if ($matches[4]) { $matches[4] } else { "3306" }); banco = $matches[5] }
}

if ($Saida) {
  if (-not $env:DB_URL) { throw "Defina `$env:DB_URL com a DATABASE_URL do banco." }
  $d = LerUrl $env:DB_URL
  New-Item -ItemType Directory -Force $Saida | Out-Null
  $sql = Join-Path $Saida ("detran-" + (Get-Date -Format "yyyy-MM-dd-HHmm") + ".sql")
  $env:MYSQL_PWD = $d.senha
  try {
    & "$MySqlBin\mysqldump.exe" --host=$($d.host) --port=$($d.porta) --user=$($d.usuario) --single-transaction --routines --no-tablespaces --set-gtid-purged=OFF --default-character-set=utf8mb4 --result-file=$sql $d.banco
    if ($LASTEXITCODE -ne 0) { throw "mysqldump falhou (código $LASTEXITCODE)" }
  } finally { Remove-Item Env:MYSQL_PWD -ErrorAction SilentlyContinue }
  $gz = "$sql.gz"
  $in = [IO.File]::OpenRead($sql); $out = [IO.File]::Create($gz); $z = New-Object IO.Compression.GZipStream($out, [IO.Compression.CompressionLevel]::Optimal)
  $in.CopyTo($z); $z.Dispose(); $out.Dispose(); $in.Dispose(); Remove-Item $sql
  $hash = (Get-FileHash $gz -Algorithm SHA256).Hash
  "$hash  $(Split-Path $gz -Leaf)" | Out-File "$gz.sha256" -Encoding ascii
  Write-Host "Cópia pronta: $gz ($([math]::Round((Get-Item $gz).Length/1MB,2)) MB). SHA-256 em $gz.sha256"
  exit 0
}

if ($Restaurar) {
  if (-not (Test-Path $Restaurar)) { throw "Arquivo não encontrado: $Restaurar" }
  $sql = [IO.Path]::Combine([IO.Path]::GetTempPath(), "restauracao-" + [guid]::NewGuid().ToString("N") + ".sql")
  $in = [IO.File]::OpenRead($Restaurar); $z = New-Object IO.Compression.GZipStream($in, [IO.Compression.CompressionMode]::Decompress); $out = [IO.File]::Create($sql)
  $z.CopyTo($out); $out.Dispose(); $z.Dispose(); $in.Dispose()
  $m = "$MySqlBin\mysql.exe"
  $base = @("--host=127.0.0.1", "--port=$Porta", "--user=$Usuario", "--default-character-set=utf8mb4")
  & $m @base -e "DROP DATABASE IF EXISTS restauracao_teste; CREATE DATABASE restauracao_teste CHARACTER SET utf8mb4;"
  # "source" lê o arquivo direto (não passa pelo PowerShell, que estragaria dados binários).
  & $m @base restauracao_teste --execute="source $($sql -replace '\\','/')"
  if ($LASTEXITCODE -ne 0) { throw "restauração falhou (código $LASTEXITCODE)" }
  Remove-Item $sql
  Write-Host "Restaurado em restauracao_teste. Contagem exata por tabela:"
  $tabs = & $m @base -N -e "SELECT table_name FROM information_schema.tables WHERE table_schema='restauracao_teste' ORDER BY table_name;"
  $q = ($tabs | Where-Object { $_ } | ForEach-Object { "SELECT '$_', COUNT(*) FROM restauracao_teste.``$_``" }) -join " UNION ALL "
  & $m @base -N -e $q
  exit 0
}

Write-Host "Use -Saida <pasta> (cópia) ou -Restaurar <arquivo.sql.gz> (teste de restauração)."
