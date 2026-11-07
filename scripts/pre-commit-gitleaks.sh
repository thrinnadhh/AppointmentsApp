#!/usr/bin/env bash
# scripts/pre-commit-gitleaks.sh
# Runs gitleaks protect on staged changes before git commit

set -euo pipefail

if command -v gitleaks >/dev/null 2>&1; then
  echo "🔒 Running Gitleaks staged secret scan..."
  gitleaks protect --staged -v --config .gitleaks.toml
else
  echo "⚠️ Warning: gitleaks CLI is not installed on PATH. Skipping staged secret scan."
  echo "  Install gitleaks (e.g. brew install gitleaks) to enforce secret scanning locally."
fi
