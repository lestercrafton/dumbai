# Release verification — The Last Bell of Xenaland

Verified September 15, 2026 (America/Chicago).

- **Engine:** 10 tests passed. Complete Adventure and Story routes, all memories, optional-memory skipping, different upgrade combinations, both wizard boss phases, bounded resources, interrupt/defend/heal effects, retry checkpoints, immutable state, and damaged-save rejection.
- **Desktop browser:** Chromium at 1280×800, fresh game through complete ending via visible DOM controls. 126 actions, 35 combat rounds, all six encounters, all six memories, two upgrades, and both phases of Vadish. All five combat actions separately exercised.
- **Saving:** Reload during battle 1, turn 3; Continue restored the exact serialized state. Ending could be revisited from title and after reload.
- **Controls:** Help, tutorial, journal, settings, mute, reduced motion, battle notes, credits and return buttons worked.
- **Mobile:** Chromium at 390×844; document and body widths exactly 390; five battle actions unobstructed and reachable; Shelter tap advanced the turn.
- **Visual inspection:** Painted first battle, second boss phase, title, dialogue, ending and mobile combat screens checked for clipping and overlap.
- **Errors:** No console errors, page errors, or failed network requests in the final complete desktop playthrough or mobile check.
- **Story requirements:** Oshn is the protagonist; Isha is the moth; Xenaland is the land; Vadish is a male wizard. After defeat he becomes loving and rings the great bell himself alongside Oshn and Isha. The final screen reads “Morning, together.”

Automated checks use a deterministic engine and real browser clicks, not shortcuts that set the game to its ending. The game is static and does not need external gameplay services. Save data belongs to the browser where it was created. Mobile Safari and physical touchscreen hardware were not separately tested.
