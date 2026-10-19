#!/bin/bash

set -euo pipefail

# Read .env file and extract SSH configuration
if [ -f .env ]; then
  export $(grep -v '^#' .env | xargs)
fi

SSH_HOST=${SIOBOT_SSH_HOST}
SSH_USER=${SIOBOT_SSH_USERNAME}
SSH_PORT=${SIOBOT_SSH_PORT}

BOTS_TO_DEPLOY=(
  "sio-bot"
#  "jb-sio-bot"
#  "rob-sio-bot"
#  "stg-sio-bot"
)

echo "🔄 Building SIOBOT..."
bun typecheck && bun test && bun run build
echo "🚀 Starting SIOBOT deployment to ${SSH_USER}@${SSH_HOST}:${SSH_PORT}..."

for entry in "${BOTS_TO_DEPLOY[@]}"; do
  local_path="./build/x64/sio-bot"
  remote_path="~/${entry}/${entry}"

  echo "📄 Copying file ${local_path} -> ${remote_path}"
  rsync -avz -e "ssh -p ${SSH_PORT}" \
    "${local_path}" \
    "${SSH_USER}@${SSH_HOST}:${remote_path}"
done


echo "File copied to remote server."
sleep 2
read -r -p "Restart sio-bot service? [Y/n] " restart_choice

if [[ -z "${restart_choice}" || "${restart_choice}" =~ ^[Yy]$ ]]; then

  for entry in "${BOTS_TO_DEPLOY[@]}"; do
    echo "Restarting ${entry}..."
    ssh -t -p ${SSH_PORT} ${SSH_USER}@${SSH_HOST} "sudo systemctl restart ${entry}"
  done

  
  echo "New version deployed and started."
else
  echo "New version deployed without restarting the service."
fi
