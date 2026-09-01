#!/bin/sh
set -eu

mkdir -p /data/cooket-objects
chown -R nobody:nobody /data/cooket-objects
exec su-exec nobody "$@"
