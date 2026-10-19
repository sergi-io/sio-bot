#!/bin/bash

# Read .env file and extract SSH configuration
if [ -f .env ]; then
  export $(grep -v '^#' .env | xargs)
fi

SSH_HOST=${SIOBOT_SSH_HOST}
SSH_USER=${SIOBOT_SSH_USERNAME}
SSH_PORT=${SIOBOT_SSH_PORT}

echo "🔄 Getting Positions DB..."
scp -P ${SSH_PORT} ${SSH_USER}@${SSH_HOST}:~/sio-bot/data/position_history.sqlite ./data/position_history.sqlite
echo "📒 Generating Journal..."
bun run generate-journal
echo "🚪 Serving Journal..."
bunx http-server ./outputs/journal -o --gzip -c-1
echo "Bye!"

