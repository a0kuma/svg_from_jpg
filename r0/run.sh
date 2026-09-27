#!/usr/bin/env bash
# Launch the ERS -> SVG web UI on 0.0.0.0:48489
set -e
cd "$(dirname "$0")"
exec python3 server.py
