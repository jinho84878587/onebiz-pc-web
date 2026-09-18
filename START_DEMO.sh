#!/bin/sh
cd "$(dirname "$0")" || exit 1
OPEN_BROWSER=1 node scripts/demo.js
