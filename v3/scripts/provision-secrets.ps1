param([string]$OutputDirectory=(Join-Path $env:LOCALAPPDATA 'TrackcareRelay\v3'))
$ErrorActionPreference='Stop'
New-Item -ItemType Directory -Force -Path $OutputDirectory | Out-Null
$identity=[System.Security.Principal.WindowsIdentity]::GetCurrent().Name
icacls $OutputDirectory /inheritance:r /grant:r "${identity}:(OI)(CI)F" 'SYSTEM:(OI)(CI)F' | Out-Null
$target=Join-Path $OutputDirectory '.env'
if(Test-Path -LiteralPath $target){throw 'V3 secrets already exist. Refusing to rotate them implicitly.'}
$values=@{}
foreach($purpose in @('VIEWER','PUSH_HMAC','ENCRYPTION','GATEWAY','RATE','LINK','TICKET')){
 $bytes=[byte[]]::new(32);[Security.Cryptography.RandomNumberGenerator]::Fill($bytes)
 $values["RELAY_V3_${purpose}_SECRET"]=[Convert]::ToBase64String($bytes).TrimEnd('=').Replace('+','-').Replace('/','_')
}
$values.RELAY_V3_ALLOWED_ORIGINS='https://trackcare-relay-v3--trackcare-relay.netlify.app'
$values.RELAY_V3_EDGE_URL='https://gvuuiazenabtsbmozrbk.supabase.co/functions/v1/relay-v3'
$values.RELAY_V3_FILE_TTL_SECONDS='86400'
$values.RELAY_V3_SESSION_TTL_SECONDS='28800'
$values.RELAY_V3_ALLOW_GET_PUSH='true'
[IO.File]::WriteAllLines($target,($values.GetEnumerator()|ForEach-Object{"$($_.Key)=$($_.Value)"}),[Text.UTF8Encoding]::new($false))
[IO.File]::WriteAllText((Join-Path $OutputDirectory 'receiver-url.txt'),($values.RELAY_V3_ALLOWED_ORIGINS+'/#access='+$values.RELAY_V3_VIEWER_SECRET),[Text.UTF8Encoding]::new($false))
Write-Output 'V3 secrets and one stable receiver URL created in the private local directory. Values omitted.'
