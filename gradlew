#!/bin/sh
# Convenience wrapper delegating to apps/backend/gradlew
cd "$(dirname "$0")/apps/backend" && exec ./gradlew "$@"
