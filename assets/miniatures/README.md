# Fleet miniatures

Six illustration assets generated with the built-in image tool on 2026-10-31. The command ship was the shared style reference; prompts are recorded in prompts.json.

The checked-in Web versions are 768×512 PNG with alpha, downsampled from the 1536×1024 originals to keep the panel payload small. They are displayed at roughly 100–340 CSS px, so the 768px copies retain at least 2× detail on common screens. Replace them with larger files only if a future layout needs it, and keep the fixed whitelist in `lib/panel.js` in sync.

- command-ship: local controller
- compute-ship: worker device
- docking-pad: empty device berth
- discovery-beacon: LAN discovery
- report-capsule: incoming notices
- standby-diorama: no-task / initial connection state

Keep these as decorative illustration assets. Text, online state, task status, controls and focus remain HTML/CSS. Do not infer actual online state from the painted mint lights. The diorama is an independent illustration, not an exact animation frame or an anchor-calibrated composition of the separate ship and dock.
