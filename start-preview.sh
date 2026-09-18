#!/usr/bin/env sh
cd "$(dirname "$0")"
PORT=${PORT:-10000} node server.js
