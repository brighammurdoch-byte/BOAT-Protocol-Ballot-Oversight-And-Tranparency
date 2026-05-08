
# Check if Docker is running
Write-Host "Skipping Docker status check to avoid hangs..." -ForegroundColor Yellow
Write-Host "Ensure Docker Desktop is running before proceeding." -ForegroundColor DarkGray

Write-Host "Building Docker image..." -ForegroundColor Cyan
docker-compose build boat-build

if ($LASTEXITCODE -ne 0) {
    Write-Host "Error: Docker build failed." -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "[+] Docker Image Built Successfully!" -ForegroundColor Green
Write-Host ""

# Compile the Anchor program
Write-Host "Compiling Anchor program..." -ForegroundColor Cyan
Write-Host "Running: docker-compose run --rm boat-build anchor build" -ForegroundColor DarkGray

docker-compose run --rm boat-build anchor build

if ($LASTEXITCODE -ne 0) {
    Write-Host ""
    Write-Host "[-] Compilation failed!" -ForegroundColor Red
    Write-Host "Check your dependency versions in Dockerfile and Cargo.toml." -ForegroundColor Yellow
    exit 1
}

Write-Host "[+] Compilation Successful!" -ForegroundColor Green
Write-Host ""

# Deploy to Devnet
$deploy = Read-Host "Do you want to deploy to Devnet now? (y/n)"
if ($deploy -match "^[yY]") {
    Write-Host "Deploying to Devnet..." -ForegroundColor Cyan
    docker-compose run --rm boat-build anchor deploy --provider.cluster devnet
} else {
    Write-Host "Skipping deployment." -ForegroundColor Yellow
    Write-Host "To deploy manually run:"
    Write-Host "  docker-compose run --rm boat-build anchor deploy --provider.cluster devnet" -ForegroundColor White
}

Write-Host ""
Write-Host "==================================" -ForegroundColor Green
Write-Host "[+] Process Complete!" -ForegroundColor Green
Write-Host "==================================" -ForegroundColor Green
