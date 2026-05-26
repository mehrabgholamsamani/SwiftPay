$ErrorActionPreference = 'Stop'

Write-Host 'CoreBank local demonstration (educational sandbox only)'
docker compose up -d --build

Invoke-RestMethod http://localhost:3010/health | ConvertTo-Json -Compress
Invoke-RestMethod http://localhost:3010/ready | ConvertTo-Json -Compress
Invoke-RestMethod http://localhost:9090/api/v1/targets | ConvertTo-Json -Depth 4 -Compress
Invoke-RestMethod http://localhost:3008/api/health | ConvertTo-Json -Compress

Write-Host 'OpenAPI: http://localhost:3010/openapi'
Write-Host 'Grafana: http://localhost:3008 (admin / corebank-local-only)'
Write-Host 'Prometheus: http://localhost:9090'
