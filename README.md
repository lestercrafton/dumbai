# GlimmerWisp (Planning Repo)

This repository currently contains **planning documentation only**.

## Can I play it right now?
**Not yet.**
There is no Godot project scene/gameplay code in this repo yet, only:
- `SPEC.md` (vertical-slice product spec)
- `TASKS.md` (step-by-step implementation plan)

## What exists today
- Product and technical scope for a Godot 4 mobile action-RPG vertical slice
- Task breakdown from setup through export
- Per-task verification criteria

## What needs to happen before it is playable
Build at least these milestones from `TASKS.md`:
1. **Task 1:** project skeleton
2. **Task 2:** player controller + mobile controls
3. **Task 3:** 3-room loop + autosave
4. **Task 4:** interactables + pickups
5. **Task 5:** wisp MVP

After Task 5, you should have a basic playable exploration prototype.

## Suggested “first playable” goal
Target a simple 10-minute prototype:
- move/jump in 3 connected rooms
- collect pickups
- control wisp with visible meter drain/regen
- save/load works after relaunch

## How to get Codex to start building
Use this exact kickoff prompt in your next message:

```text
Start implementing TASK 1 from TASKS.md now.
- Create the Godot 4 project skeleton and folder structure.
- Add a run/export README section for Android and iOS (Mac required note).
- Keep changes small and commit as: task(1): project skeleton and run/export docs
- After coding, run checks, commit, and open a PR.
Then continue with TASK 2 in a new PR.
```

### Best workflow (recommended)
1. Ask for **one task at a time** (TASK 1, then TASK 2, etc.).
2. Require each task to include:
   - implementation
   - verification commands/results
   - git commit
   - PR summary
3. Test on your device at key checkpoints (Task 3/5/7+).

### If you want me to continue automatically
Use this prompt:

```text
Implement TASK 1 through TASK 3 from TASKS.md in sequence.
Use one commit + one PR per task.
Stop after TASK 3 and report what is playable.
```

## Run/Export
Once implementation begins, use the guidance in `TASKS.md`:
- Godot 4.x + export templates
- Android export setup (SDK/JDK)
- iOS export requires macOS + Xcode
