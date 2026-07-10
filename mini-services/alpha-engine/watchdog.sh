#!/bin/bash
# Alpha-engine watchdog — restarts the engine if it dies
cd /home/z/my-project/mini-services/alpha-engine

while true; do
  # Check if the engine is running
  if ! pgrep -f "bun --hot index.ts" > /dev/null 2>&1; then
    echo "[$(date)] alpha-engine not running — starting..." >> /home/z/my-project/alpha-engine-watchdog.log
    nohup bun run dev >> /home/z/my-project/alpha-engine.log 2>&1 &
    echo "[$(date)] started PID: $!" >> /home/z/my-project/alpha-engine-watchdog.log
  fi
  sleep 10
done
