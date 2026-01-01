#!/bin/bash
set -e

VERSION=$1

if [ -z "$VERSION" ]; then
  echo "Usage: ./scripts/rollback.sh <version>"
  echo "Example: ./scripts/rollback.sh v1.0.2"
  exit 1
fi

echo "Rolling back Kling to $VERSION..."

# Checkout specific version
git checkout $VERSION

# Install dependencies
echo "Installing dependencies..."
npm install --omit=dev

# Generate Prisma client
echo "Generating Prisma client..."
npx prisma generate

echo ""
echo "Rollback complete!"
echo "Restart with: sudo systemctl restart kling"
echo ""
echo "Note: Database migrations are NOT rolled back automatically."
echo "Restore from backup if needed."
