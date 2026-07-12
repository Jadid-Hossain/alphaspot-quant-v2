#!/bin/bash
# Auto-push script for AlphaSpot Quant V2
# Usage: ./push-to-github.sh "Chapter X.X — Description"

COMMIT_MSG="${1:-Auto-commit: update AlphaSpot Quant V2}"

cd /home/z/my-project

echo "=== Staging files ==="
git add -A

echo "=== Committing ==="
git commit -m "$COMMIT_MSG" 2>&1 | tail -3

echo "=== Pushing to GitHub ==="
git push origin main 2>&1

echo "=== Done! ==="
echo "Repo: https://github.com/Jadid-Hossain/alphaspot-quant-v2"
