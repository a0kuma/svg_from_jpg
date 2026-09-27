#!/usr/bin/env bash
# Pure static frontend on 0.0.0.0:48489
set -e
cd "$(dirname "$0")"
exec python3 -m http.server 48489 --bind 0.0.0.0
