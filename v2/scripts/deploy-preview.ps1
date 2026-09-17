$ErrorActionPreference = 'Stop'
if ((git branch --show-current) -ne 'trackcare-relay-v2') { throw 'Preview deploy requires trackcare-relay-v2 branch.' }
$privateValues=@{}
Get-Content -LiteralPath (Join-Path $env:LOCALAPPDATA 'TrackcareRelay\v2\.env') | ForEach-Object {
  $at=$_.IndexOf('='); if($at -gt 0){$privateValues[$_.Substring(0,$at)]=$_.Substring($at+1)}
}
npm run build
if ($LASTEXITCODE -ne 0) { throw 'Build failed' }
$deployArgs=@('--yes','netlify-cli','deploy','--site','b732edae-0583-4d95-929b-319944d0c95e',
  '--dir','dist','--functions','netlify/functions','--alias','trackcare-relay-v2','--no-build',
  '--message','Trackcare Relay V2 isolated preview',
  '--secret-env',('RELAY_GATEWAY_SECRET='+$privateValues.RELAY_GATEWAY_SECRET),
  '--env',('RELAY_EDGE_URL='+$privateValues.RELAY_EDGE_URL),
  '--env',('RELAY_ALLOWED_ORIGINS='+$privateValues.RELAY_ALLOWED_ORIGINS))
& npx @deployArgs
if ($LASTEXITCODE -ne 0) { throw 'Preview deployment failed' }
