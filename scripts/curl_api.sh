#!/usr/bin/env bash
set -euo pipefail
curl -s http://127.0.0.1:8787/health
echo
curl -s "http://127.0.0.1:8787/elections/9qXjWU8WoPvbjSx3bsrNuaEJHeozbzqEvpA82TgghRNA/tally"
echo
