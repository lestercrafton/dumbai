# TASKS.md
# GlimmerWisp — Implementation Tasks (Codex-friendly)

## How to use this with Codex
Work in small PR-sized chunks. For each task:
1) Implement
2) Run the verification steps listed
3) Commit with message `task(X): ...`
4) Move to next task

---

## TASK 0 — Toolchain Setup (You do once; Codex can guide you step-by-step)
### 0.1 Install Godot & export templates
- Install Godot 4.x (stable)
- In Godot: install **Export Templates** (Editor → Manage Export Templates)

### 0.2 Android prerequisites
Follow Godot’s “Exporting for Android” setup (Android SDK + JDK) :contentReference[oaicite:9]{index=9}.
Also note Google’s Godot export guidance for APK/AAB :contentReference[oaicite:10]{index=10}.

### 0.3 iOS prerequisites
You need macOS + Xcode for iOS builds :contentReference[oaicite:11]{index=11}.

**Verification**
- Godot opens project
- Export presets visible (Android)
- On Mac: iOS export preset visible (even if you don’t build yet)

---

## TASK 1 — Repo Skeleton + Conventions
### Deliverables
- Create folders:
  - `res://game/`
  - `res://game/explore/`
  - `res://game/combat/`
  - `res://game/wisp/`
  - `res://game/ui/`
  - `res://game/data/`
  - `res://scenes/rooms/`
  - `res://art/`, `res://audio/`
- Add `README.md` with:
  - how to run
  - how to export Android
  - iOS note (Mac required) :contentReference[oaicite:12]{index=12}

**Verify**
- Project runs with empty main scene

**Codex prompt**
“Create Godot project structure and a README with run/export steps. Don’t add gameplay yet.”

---

## TASK 2 — Player Controller (Exploration)
### Deliverables
- Player scene: `Player.tscn` (CharacterBody2D)
- Features:
  - smooth acceleration
  - coyote time + jump buffer
  - short/long jump (hold to extend)
  - simple animation state machine hooks
- Virtual joystick + jump/action buttons (mobile UI)

**Verify**
- Playable with keyboard/mouse AND touch simulation
- No jitter, consistent jump feel

**Codex prompt**
“Implement CharacterBody2D controller with coyote time + jump buffer, plus mobile UI joystick/jump button.”

---

## TASK 3 — Room System + Autosave
### Deliverables
- Room scenes: `Room_01.tscn`, `Room_02.tscn`, `Room_03.tscn`
- Room transition trigger areas
- Save system:
  - save on room enter
  - save on pickup
  - JSON or ConfigFile-based save (simple)

**Verify**
- Quit + relaunch restores room + position + inventory

**Codex prompt**
“Implement a minimal save/load system and room transitions for 3 rooms. Autosave on room enter.”

---

## TASK 4 — Interactables + Pickups
### Deliverables
- `Interactable.gd` base
- Pickup types:
  - currency (stardust)
  - wisp meter burst
  - crafting shard
- UI toast for pickups

**Verify**
- Pickup increments inventory and persists after reload

**Codex prompt**
“Create an Interactable base + 3 pickup prefabs, with persistence.”

---

## TASK 5 — Wisp MVP (Exploration)
### Deliverables
- Wisp scene: `Wisp.tscn`
- Drag-to-move + channel button/hold
- Glow meter:
  - drains while channeling
  - regenerates while idle
  - pickups add burst
- Hidden objects:
  - `HiddenObject` reveals only while channeling nearby
- Puzzle nodes:
  - `PuzzleNode` receives power while channeling

**Verify**
- Meter drain/regen feels predictable
- Reveal + puzzle powering works

**Codex prompt**
“Implement Wisp with drag movement + glow meter + reveal/puzzle interactions.”

---

## TASK 6 — Puzzle Set (3 types)
### Deliverables
1) Light bridge:
   - nodes activate platforms while powered
2) Mirror redirect:
   - wisp powers emitter, ray redirects through mirrors to target
3) Growth/vines:
   - power node causes vines to retract (opens path)

**Verify**
- Each puzzle is solvable in a test room using only the wisp + action button

**Codex prompt**
“Implement three puzzle prefabs: bridge, mirror redirect, vines.”

---

## TASK 7 — Combat MVP (Timeline Engine)
### Deliverables
- Combat scene (separate from exploration initially)
- Timeline system:
  - position 0–100
  - speed-based advance
  - ACT threshold pause for player input
- Actions:
  - basic attack
  - 1 skill per hero
- UI:
  - timeline bar with icons
  - action menu

**Verify**
- 1 hero vs 2 enemies works end-to-end (win/lose)
- No softlocks, no “stuck in pause” bugs

**Codex prompt**
“Create deterministic timeline combat with an ACT threshold pause, basic attack, and 1 skill.”

---

## TASK 8 — Interrupts + Cast Times
### Deliverables
- Skills can have cast time
- Interrupt rule:
  - if hit during cast window, cancel cast and push timeline back
- Add debug overlay showing:
  - timeline pos
  - casting state

**Verify**
- Interrupt happens reliably and visibly

**Codex prompt**
“Add cast times + interrupt pushback; include a debug HUD.”

---

## TASK 9 — Status Effects (Slice set)
### Deliverables
- Slow, Stun, DoT
- UI icons over combatants

**Verify**
- Effects apply/expire correctly; save not required for combat

**Codex prompt**
“Implement 3 status effects with clear UI indicators.”

---

## TASK 10 — Wisp in Combat
### Deliverables
- Channel enemy: slow their timeline speed multiplier
- Channel ally: heal-over-time
- Meter drains while channeling

**Verify**
- Wisp meaningfully changes outcome; meter constraints prevent infinite lock

**Codex prompt**
“Integrate wisp channeling into combat with drain/regeneration.”

---

## TASK 11 — Progression (XP + Skills)
### Deliverables
- XP rewards
- Level-ups: stat bumps
- Skill unlocks (simple linear list)

**Verify**
- Win fights → level increases → stats change

**Codex prompt**
“Add XP/levels and a simple skill unlock UI.”

---

## TASK 12 — Charmcraft-lite (3 slots + fusion)
### Deliverables
- Item system:
  - 3 slots: Attack / Defense / Tempo
  - 6 gem families, 3 tiers
- Fusion:
  - 2 same family+tier → 1 higher tier
  - inherit one minor modifier
- UI for equip + fuse

**Verify**
- Craft changes combat stats; persists in save

**Codex prompt**
“Implement simple gem crafting with 3-slot charms and 2→1 fusion upgrades.”

---

## TASK 13 — Vertical Slice Content Pass
### Deliverables
- 10–14 rooms with:
  - enemies placed
  - 3 puzzle types distributed
  - miniboss + boss rooms
- Basic dialogue triggers + story beats

**Verify**
- Full slice playable start-to-boss in 60–90 minutes

**Codex prompt**
“Build the Glimmerwood region rooms and place content according to SPEC.md.”

---

## TASK 14 — Store-Readiness Polish
### Deliverables
- Settings menu (audio, vibration, text speed)
- Accessibility toggles (high contrast UI, reduced motion option)
- Error-safe save
- Credits screen (asset attribution)

**Verify**
- No crashes in 30-minute continuous play
- Clean export attempt for Android (APK for testing, AAB later) :contentReference[oaicite:13]{index=13}

**Codex prompt**
“Add settings/accessibility/credits and harden save/load.”

---

## TASK 15 — Android Export (Test) + iOS Export (If on Mac)
### Android
- Export APK for device testing
- Then set up AAB pipeline for Play submission :contentReference[oaicite:14]{index=14}

### iOS (Mac required)
- Export and open in Xcode for build/archive :contentReference[oaicite:15]{index=15}

**Verify**
- Installs and runs on at least one real Android phone
- On Mac: builds to device or simulator

**Codex prompt**
“Walk me through Android export step-by-step in Godot, then iOS export on macOS/Xcode if available.”
