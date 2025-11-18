# Agent Onboarding Notes

Welcome! This repo is a Phaser 3 + Vite + TypeScript starter tailored to couch-friendly two-player arena prototypes. Keep these invariants in mind before diving into feature work:

1. **Tooling basics**
   - Use `npm run dev` for the local server, `npm run build` for production bundles, and the provided Capacitor scripts (`npm run sync:android`, `npm run open:android`) when dealing with the Android target. You shouldn't need to rediscover this workflow unless the scripts change.

2. **Bootstrapping**
   - `src/main.ts` wires up a single `ArenaScene`, configures the 800×600 responsive canvas, and enables Arcade physics without gravity. Treat this as the canonical entry point before modifying scene logic or scaling behavior.

3. **Core gameplay**
   - All player setup, dash logic/cooldowns, pickups (energy, rare energy, hazards), obstacle placement, and overlay updates live inside `src/scenes/ArenaScene.ts`. Extend these systems here instead of duplicating logic elsewhere.

4. **HUD / overlay**
   - The DOM-based HUD is implemented in `src/ui/overlay.ts` with styling in `src/styles.css`. Add or adjust scoreboard rows, dash gauges, or instruction toggles via these files—not directly inside Phaser scenes.

5. **Documentation upkeep**
   - If your changes invalidate or extend any assumption listed above, please update this `AGENTS.md` in the same PR so future agents keep enjoying fast onboarding.
