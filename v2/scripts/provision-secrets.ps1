param([string]$OutputDirectory = (Join-Path $env:LOCALAPPDATA 'TrackcareRelay\v2'))
$ErrorActionPreference = 'Stop'
New-Item -ItemType Directory -Force -Path $OutputDirectory | Out-Null
$identity = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
icacls $OutputDirectory /inheritance:r /grant:r "${identity}:(OI)(CI)F" 'SYSTEM:(OI)(CI)F' | Out-Null
$target = Join-Path $OutputDirectory '.env'
if (Test-Path -LiteralPath $target) { throw 'Secret file already exists. Refusing to rotate implicitly.' }
$lines = @('RELAY_VIEW_PIN=000')
foreach ($purpose in @('SESSION','PUSH_HMAC','ENCRYPTION','GATEWAY','RATE','LINK','ADMIN','CRON')) {
  $bytes = [byte[]]::new(32)
  [System.Security.Cryptography.RandomNumberGenerator]::Fill($bytes)
  $secret = [Convert]::ToBase64String($bytes).TrimEnd('=').Replace('+','-').Replace('/','_')
  $lines += "RELAY_${purpose}_SECRET=$secret"
}
$lines += @(
  'RELAY_TEXT_TTL_SECONDS=1800','RELAY_FILE_TTL_SECONDS=86400','RELAY_SESSION_TTL_SECONDS=3600',
  'RELAY_DEVICE_TTL_SECONDS=2592000','RELAY_SIGNED_URL_TTL_SECONDS=60','RELAY_REQUEST_WINDOW_SECONDS=120',
  'RELAY_ALLOW_GET_PUSH=true','RELAY_PREVIEW_ONLY=true',
  'RELAY_ALLOWED_ORIGINS=https://trackcare-relay-v2--trackcare-relay.netlify.app',
  'RELAY_EDGE_URL=https://gvuuiazenabtsbmozrbk.supabase.co/functions/v1/relay-v2'
)
[IO.File]::WriteAllLines($target,$lines,[Text.UTF8Encoding]::new($false))
Write-Output 'Independent secrets created in the private local environment file. Values omitted.'
