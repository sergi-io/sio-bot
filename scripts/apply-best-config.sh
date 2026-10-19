#!/bin/bash

# Check if snapshot number is provided
if [ -z "$1" ]; then
  echo "Error: Snapshot number required"
  echo "Usage: bun apply-best-config <snapshot_number> <pnl|fitness>"
  echo "Example: bun apply-best-config 1 fitness"
  exit 1
fi

SNAPSHOT_NUM=$1
RANKING=$2

if [ -z "$RANKING" ]; then
  echo "Error: parameter needed. Allowed parameters: pnl or fitness"
  echo "Usage: bun apply-best-config <snapshot_number> <pnl|fitness>"
  exit 1
fi

if [ "$RANKING" != "pnl" ] && [ "$RANKING" != "fitness" ]; then
  echo "Error: Ranking must be either 'pnl' or 'fitness'"
  exit 1
fi

CONFIG_FILE="./outputs/configs/genetic_best_${RANKING}_config_snapshot_${SNAPSHOT_NUM}.json"

# Check if the config file exists
if [ ! -f "$CONFIG_FILE" ]; then
  echo "Error: Config file not found: $CONFIG_FILE"
  exit 1
fi

# Copy the config file
cp "$CONFIG_FILE" ./bot-config.json
echo "✓ Applied config from snapshot ${SNAPSHOT_NUM}"
