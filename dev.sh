#!/usr/bin/env bash
# Launch both dev servers. Ctrl+C kills both cleanly.
trap 'kill 0' INT TERM

mkdir -p .logs
uvicorn api.server:app --port 8000 --reload > .logs/api.log 2>&1 < /dev/null &
(cd vibecoded_apps/claude_talks && npm run dev) > .logs/svelte.log 2>&1 < /dev/null &

echo "Logs: .logs/api.log, .logs/svelte.log"
wait
