# Adaptive spawning playtests

Open the settings panel with the backtick key. The **adaptive spawning** folder
takes effect live; **adaptive status** shows the next batch, living count and
why spawning is waiting. Use **reset spawn ramp** to compare settings from the
starting difficulty; use New Village to also clear enemies.

Enabled by default. Raw HP must be strictly above 50 (not 50%).
Starts at 1 raider every 8 simulation seconds. Batch size grows by 0.25 per
successful batch, rounded down: 1,1,1,1,2,2,2,2,3...
Batch cap is 20; living adaptive enemy cap is 100.
Spawns appear 18–22 tiles away on unblocked map tiles and pursue the player.
This uses the current raider simulation, not a new high-density horde engine.

At or below the threshold, indoors, dead, or at the population cap: new spawns
stop and the countdown restarts. Existing enemies remain. The batch ramp is
retained, so healing resumes at the same difficulty after a full interval.
Disabling the system or starting a new run resets the ramp.
Pausing the game freezes simulation time. Speed controls also affect spawning.
Unsuccessful placement does not advance the ramp; long frames never queue bursts.

Suggested comparisons (interval / growth):
- Gentle: 12 seconds / 0.25
- Steady: 8 seconds / 0.5
- Aggressive: 4 seconds / 1

Scheduled raids, wild enemies, and their settings remain independent. Peaceful
disables scheduled raids but deliberately leaves this experimental mode active;
turn adaptiveSpawns off to disable it too. Other enemies do not count toward its cap.
Use copy settings to export the knobs alongside the existing settings.

Run scheduler checks with: node scripts/test-adaptive-spawn.mjs
