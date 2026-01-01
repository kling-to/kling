#!/bin/bash
set -e

VERSION=${1:-latest}

echo "Updating Kling to $VERSION..."

# Fetch latest tags
git fetch --tags

# Checkout specific version
if [ "$VERSION" = "latest" ]; then
  VERSION=$(git describe --tags $(git rev-list --tags --max-count=1))
fi

echo "Checking out version $VERSION..."
git checkout $VERSION

# Install dependencies
echo "Installing dependencies..."
npm install --omit=dev

# Generate Prisma client
echo "Generating Prisma client..."
npx prisma generate

# Run migrations
echo "Running database migrations..."
npx prisma migrate deploy

echo ""
echo "Update complete!"
echo "Restart with: sudo systemctl restart kling"
