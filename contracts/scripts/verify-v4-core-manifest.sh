#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd "$script_dir/../lib/v4-core"
sha256sum --check V4_CORE_MANIFEST.sha256
