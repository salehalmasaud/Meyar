$ErrorActionPreference='Stop'
if((git branch --show-current)-ne 'trackcare-relay-v3'){throw 'Requires trackcare-relay-v3 branch.'}
$values=@{}
Get-Content -LiteralPath (Join-Path $env:LOCALAPPDATA 'TrackcareRelay\v3\.env')|ForEach-Object{$at=$_.IndexOf('=');if($at -gt 0){$values[$_.Substring(0,$at)]=$_.Substring($at+1)}}
npm run build
if($LASTEXITCODE -ne 0){throw 'Build failed'}
$deployArgs=@('--yes','netlify-cli','deploy','--site','b732edae-0583-4d95-929b-319944d0c95e','--dir','dist','--functions','netlify/functions','--alias','trackcare-relay-v3','--no-build','--message','Trackcare Relay V3 isolated inbox preview','--secret-env',('RELAY_V3_GATEWAY_SECRET='+$values.RELAY_V3_GATEWAY_SECRET),'--env',('RELAY_V3_EDGE_URL='+$values.RELAY_V3_EDGE_URL),'--env',('RELAY_V3_ALLOWED_ORIGINS='+$values.RELAY_V3_ALLOWED_ORIGINS))
& npx @deployArgs
if($LASTEXITCODE -ne 0){throw 'Preview deployment failed'}
