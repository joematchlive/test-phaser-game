# Phaser Couch Multiplayer Template

A zero-asset Phaser 3 starter kit for fast prototyping of **couch-friendly multiplayer** arcade games. The template renders responsive HTML5 canvases in the browser, and the Capacitor config allows you to ship the same build as an Android app.

https://github.com/user-attachments/assets/placeholder

## Features

- ⚡️ **Vite + TypeScript** dev environment with hot-module reloading
- 🕹️ **Two-player arena** example with WASD/Arrow controls, dash ability, and collectible objectives
- 🧩 **UI overlay helper** to show per-player status/control hints without touching Phaser scenes
- 📱 **Capacitor 6 config** so you can sync the Vite build into a native Android project
- 📦 Ready-to-use npm scripts for dev server, production build, and Android sync/open

## Getting started

```bash
npm install
npm run dev
```

Visit `http://localhost:5173` to play locally. The included arena scene is intentionally compact so you can easily swap in your own art, systems, and networking logic.

### Production build

```bash
npm run build
npm run preview
```

The compiled assets land in `dist/`.

## Android (Capacitor) workflow

1. Make sure you have the Android SDK + Android Studio installed locally.
2. Create the native shell (one time only):
   ```bash
   npx cap add android
   ```
3. After each web build, sync the assets into Android Studio:
   ```bash
   npm run android:sync
   ```
4. Open the Android project:
   ```bash
   npm run android:open
   ```
5. Build/run from Android Studio onto a device or emulator.

> Tip: Capacitor uses the `dist/` folder as its web asset directory, so always run `npm run build` before syncing.

## Project structure

```
├─ src/
│  ├─ scenes/        # Phaser scenes (ArenaScene shows local multiplayer patterns)
│  ├─ ui/            # DOM overlay helpers shared between scenes
│  ├─ main.ts        # Phaser bootstrap + game config
│  └─ styles.css     # Global HUD styling
├─ index.html        # Vite entry point
├─ capacitor.config.ts
└─ vite.config.ts
```

## Extending the template

- Drop in spritesheets or atlases, then load them inside new Phaser scenes.
- Replace the local input handling with your preferred networking stack (Colyseus, socket.io, etc.) to go online.
- Expand `Overlay` to surface timers, stamina, inventories, or match state from multiple scenes.
- Use Capacitor plugins (Haptics, Storage, etc.) to add native-friendly feedback while keeping a single codebase.

Enjoy building!
