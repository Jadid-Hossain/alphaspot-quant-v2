#!/bin/bash
# Alpha-engine watchdog — restarts the engine if it dies
cd /home/z/my-project/mini-services/alpha-engine

while true; do
  # Check if the engine is running (matches both "bun index.ts" and "bun --hot index.ts")
  if ! pgrep -f "bun.*index\.ts" > /dev/null 2>&1; then
    echo "[$(date)] alpha-engine not running — starting..." >> /home/z/my-project/alpha-engine-watchdog.log
    setsid bun index.ts >> /home/z/my-project/alpha-engine.log 2>&1 &
    echo "[$(date)] started PID: $!" >> /home/z/my-project/alpha-engine-watchdog.log
  fi
  sleep 5
done
