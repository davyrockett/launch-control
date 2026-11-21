#!/bin/bash
# Builds "Launch Control Sync" and starts it, now and at every login. Run it again after changing the program.
# The first time, macOS asks whether Launch Control Sync may use Reminders: click Allow.
set -e
cd "$(dirname "$0")"
APP="$HOME/Applications/Launch Control Sync.app"
LABEL=com.davyrockett.launch-control-sync
mkdir -p "$APP/Contents/MacOS" "$HOME/Library/LaunchAgents"
cp Info.plist "$APP/Contents/Info.plist"
swiftc -O -swift-version 5 -o "$APP/Contents/MacOS/Launch Control Sync" LaunchControlSync.swift
codesign --force --sign - "$APP"
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
cp "$LABEL.plist" "$HOME/Library/LaunchAgents/"
launchctl bootstrap "gui/$(id -u)" "$HOME/Library/LaunchAgents/$LABEL.plist"
echo "Launch Control Sync is running. Its notes go to ~/Library/Logs/launch-control-sync.log"
