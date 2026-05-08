#!/bin/bash
# BOAT Protocol build script for Linux/Mac

set -e  # Exit on error

echo "Building BOAT Protocol Docker image..."
docker-compose build

if [ $? -ne 0 ]; then
    echo "Error: Docker build failed"
    echo "Make sure Docker is running"
    exit 1
fi

echo ""
echo "Successfully built BOAT Protocol container!"
echo ""
echo "To start the build environment, run:"
echo "  docker-compose run boat-build"
echo ""
echo "Or to build directly:"
echo "  docker-compose run boat-build anchor build"
echo ""
echo "To deploy to devnet:"
echo "  docker-compose run boat-build anchor deploy --provider.cluster devnet"
echo ""
