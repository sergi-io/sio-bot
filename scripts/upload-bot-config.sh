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
  #"jb-sio-bot"
  #"rob-sio-bot"
  #"stg-sio-bot"
)

BACKUP_TIMESTAMP=$(date +"%Y%m%d-%H%M%S")

echo "🔄 Uploading bot-config..."

for entry in "${BOTS_TO_DEPLOY[@]}"; do
  local_path="./bot-config.json"
  remote_dir="~/${entry}"
  remote_path="${remote_dir}/bot-config.json"
  remote_backup_dir="${remote_dir}/backups"
  remote_backup_path="${remote_backup_dir}/bot-config.${BACKUP_TIMESTAMP}.json"

  echo "💾 Backing up remote ${remote_path} -> ${remote_backup_path}..."
  ssh -p "${SSH_PORT}" "${SSH_USER}@${SSH_HOST}" \
    "mkdir -p ${remote_backup_dir} && if [ -f ${remote_path} ]; then cp ${remote_path} ${remote_backup_path}; else echo 'No remote bot-config.json found for ${entry}; skipping backup.'; fi"

  echo "📄 Copying file ${local_path} -> ${remote_path}..."
  rsync -avz -e "ssh -p ${SSH_PORT}" \
    "${local_path}" \
    "${SSH_USER}@${SSH_HOST}:${remote_path}"
  echo "File copied to remote server for ${entry}."
done

echo "Done!"
