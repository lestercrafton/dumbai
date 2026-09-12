# SPEC.md
# GlimmerWisp — Mobile Storybook Action-RPG (Original IP) — Spec v1

## 1) Goal
Build a premium, original-IP mobile game that captures the *feel* of a watercolor storybook platform-RPG with:
- side-scrolling exploration
- a controllable “wisp” companion (light-based puzzles + combat channeling)
- timeline-based turn combat with interrupts

Deliver a **vertical slice** that is store-ready in quality (not content volume): stable, performant, original assets, no infringement.

## 2) Engine & Tech
**Engine:** Godot 4.x (2D) using **GDScript**.

**Why Godot 4:**
- Great 2D tooling (tilemaps, particles, animation) :contentReference[oaicite:2]{index=2}
- Clean Android export flow documented by Godot and Android’s official guidance :contentReference[oaicite:3]{index=3}
- Beginner-friendly scripting + simpler project footprint than many alternatives

**Mobile exports:**
- **Android:** uses Godot export templates + Android SDK/JDK setup :contentReference[oaicite:4]{index=4}
- **iOS:** requires **macOS with Xcode** to produce an iOS build/archive :contentReference[oaicite:5]{index=5}

## 3) Non-negotiables (IP + store reality)
### Original IP only
Do NOT use any copyrighted names, story, characters, dialogue, music, maps, or recognizable UI layouts from existing games.

### Store compliance
- No scraped assets
- Clear privacy stance (prefer “no data collected” for slice)
- Reliable save/load
- Performance targets met on mid-range devices

## 4) Target Platforms & Performance
- iOS + Android
- 60 FPS target on iPhone-class and mid-range Android
- Portrait-first UX (exploration), optional landscape for combat

## 5) Vertical Slice Scope (what “done” means)
### Playtime
60–90 minutes end-to-end.

### Content
- 1 region: **The Glimmerwood**
- 10–14 rooms (small, varied)
- 3 puzzle types (wisp-light bridges, mirror redirect, growth/vines)
- 6 enemy types + 1 miniboss + 1 boss
- 3 playable party members (protagonist + 2 companions)

### Systems included
- Exploration controller (run/jump/float), gates/abilities
- Room transitions (additive scene load), checkpoints, autosave
- Wisp companion (drag control + meter)
- Timeline combat + interrupts + basic status effects
- Progression: XP/levels + simple skill unlocks
- “Charmcraft-lite”: 3 slots (Attack/Defense/Tempo) + small fusion system
- Settings + accessibility basics (text speed, vibration toggle, high-contrast UI toggle)
- Crash-safe save, simple debug console

## 6) Controls & UX (mobile-first)
### Exploration (portrait)
- Left thumb: virtual joystick (move)
- Right thumb: Jump + Action/Interact
- Wisp: drag anywhere to position; hold to channel glow (meter drains)

### Combat (landscape optional)
- Timeline bar bottom
- Tap hero to pick action, tap target to confirm
- Wisp channel:
  - channel enemy → slow their timeline progress
  - channel ally → heal-over-time
  - drains meter; meter regenerates slowly

## 7) Core Mechanics Specs

### 7.1 Exploration
- Player controller: acceleration + coyote time + jump buffering
- Interactions: unified `Interactable` component
- Rooms: each room is a scene with:
  - collision/tilemap
  - spawn points
  - room-local enemy spawners (optional)
- Autosave:
  - on room enter
  - on key pickups
  - before boss

**Acceptance criteria**
- 3-room loop playable with saves restoring position + inventory reliably.

### 7.2 Wisp Companion
**Inputs**
- Drag to move (screen-space → world target)
- Hold to channel (drain meter)

**Explore effects**
- Reveal hidden objects within radius (only while channeling)
- Power puzzle nodes (bridges/mirrors/growth)

**Combat effects**
- If channeling enemy: multiply enemy timeline speed by 0.6 (tunable)
- If channeling ally: heal 1–2% max HP per second (tunable)
- Meter: max 100, drains while channeling, regen while idle, pickups grant bursts

**Acceptance criteria**
- Meter behavior predictable; never blocks player inputs; always visible; effects are readable.

### 7.3 Combat — Timeline With Interrupts
**Core**
- Each combatant has `speed`
- Timeline position 0→100 increases by `speed * delta`
- At “ACT” threshold, player chooses action
- Skills have cast time; during cast window, if hit by interrupt-tagged attack:
  - apply pushback (e.g., -20 timeline)
  - cancel cast

**Status effects**
- Slow: reduces speed multiplier
- Stun: position freeze for N seconds
- DoT: periodic damage

**Acceptance criteria**
- Interrupts are demonstrable and reliable (no desync, no softlocks).

### 7.4 Progression
- XP per battle; level-ups grant small stat bumps
- Skills: 4 skills per character in slice (12 total), linear unlocks
- Crafting: “Charms”
  - Slots: Attack/Defense/Tempo
  - 6 gem families, 3 tiers
  - Fusion rule: 2 of same tier+family → 1 next tier, with a small random secondary mod
  - (Keep chart small; do not emulate any existing fusion table.)

**Acceptance criteria**
- Player can make 2–3 distinct builds by end of slice.

## 8) Art & Audio Direction (original)
- Painterly backgrounds + soft bloom + particle dust
- UI: minimal, modern storybook (no “rune UI” mimicry)
- Music: 2 explore loops, 2 combat loops, 1 boss track (original)

## 9) Export & Build Notes (high-level)
### Android
Godot’s Android export pipeline requires export templates + Android SDK/JDK configuration :contentReference[oaicite:6]{index=6}.
Google’s guidance notes Godot can generate APK (testing) and **AAB** (Play submission) :contentReference[oaicite:7]{index=7}.

### iOS
Godot iOS export requires a Mac with Xcode, and you load/build/archive in Xcode :contentReference[oaicite:8]{index=8}.

## 10) Definition of Done (vertical slice)
- 60–90 min playable start-to-boss
- No crashes in 30 min soak test
- Save/load stable
- 60 FPS target on reference devices (your actual phone(s))
- Original assets only
- Android release build exports cleanly; iOS build instructions verified on macOS/Xcode
