# Launch Control

Your Apple Reminders as a 3D launch control room. Live at **https://www.davyrockett.com/launch-control/**

- **Stations** along the arc hold your reminders by due date: Overdue, Today, Tomorrow, This week, This month, Later.
  Reminders with no date orbit the hologram in the middle (**Deep space**): Freeze stops them, Spread fans them out with names.
- The **big screen** counts down to your next deadline. Click it to face it; its timeline, "Next launch" line and radar
  blips open the matching station.
- **Walk** lets you wander the room (W A S D or arrows on a Mac, the arrow pad on a phone). **Launch** fires the rocket.
- **Done** ticks a reminder off. You get a few seconds to Undo; then your Mac ticks it off in Reminders, usually within a minute.

## How it stays in sync

A small program on your Mac, **Launch Control Sync** (in `~/Applications`, started at login), reads Reminders whenever
they change and saves them to the private `davyrockett/launch-control-data` repo. The page reads them from there, so it
works on your phone too. It only updates while the Mac is on; the top of the page says when the Mac last checked.

- The page needs your access key (Apps screen > Settings > Access key, or Settings here), and the key needs access to
  `launch-control-data` on GitHub.
- If Reminders stops syncing: check `~/Library/Logs/launch-control-sync.log`, and System Settings > Privacy & Security >
  Reminders > Launch Control Sync must be on.
- After changing `mac/LaunchControlSync.swift`, double-click `mac/install.command` to rebuild and restart it.

## Testing on the Mac

Double-click **Start Launch Control.command** (http://localhost:8784/).
