#!/bin/bash
cd /root/.openclaw/workspace/meridian
pkill -f "node index.js" 2>/dev/null || true
sleep 1
node index.js > /tmp/meridian.log 2>&1 &
echo "Started Meridian PID: $!"
sleep 3
tail -15 /tmp/meridian.log