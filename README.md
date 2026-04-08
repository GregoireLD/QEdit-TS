# QEdit v3

A cross-platform quest editor for **Phantasy Star Online** (Blue Burst), built with Tauri, React, and TypeScript.

QEdit v3 is a ground-up rewrite of [QEdit v2](https://github.com/schthack/qedit) by Schthack. No source code is shared — the file format knowledge was reverse-engineered from the original Delphi source.

---

## Features

### Quest editing
- Open `.qst` quest archives (Blue Burst format, with PRS decompression)
- Save quests back to `.qst` *(TBD — untested)*
- Edit quest metadata: name, description, episode, category *(WIP)*
- Place and browse monsters and objects per floor *(WIP — view only, editing limited)*

### 3D map viewer
- Real-time first-person noclip viewer using Three.js
- Textured geometry from `*n.rel` visual meshes (DXT1/DXT3 via XVM)
- Texture animations: UV scrolling and frame-cycling from `.tam` animation files
- Collision wireframe overlay from `*c.rel` (toggleable)
- Sky dome per area
- Monster and object position markers

### Script editor *(WIP)*
- Full bytecode disassembler for `.bin` script files
- Syntax-highlighted assembly editor (Monaco) with PSO opcode definitions
- Planned: complete mnemonic coverage and shorthand aliases used by the community
- Planned: inline annotation system — comments stored in a sidecar file and woven into the disassembly on display

### Supported file formats
| Format | Description |
|--------|-------------|
| `.qst` | Quest archive (encrypted, PRS-compressed) |
| `.bin` | Quest bytecode (script) |
| `.dat` | Quest entity data (monsters, objects, events) |
| `*n.rel` | Visual mesh geometry |
| `*c.rel` | Collision geometry |
| `.xvm` / `.xvr` | Texture archives (DXT1/DXT3) |
| `.tam` | Texture animation data (UV slide, texture swap) |

---

## Getting started

### Requirements
- [Node.js](https://nodejs.org/) 22+
- [Rust](https://rustup.rs/) (stable)
- [Tauri prerequisites](https://tauri.app/start/prerequisites/) for your platform

### Development
```bash
npm install
npm run tauri dev
```

### Build
```bash
npm run tauri build
```

Compiled binaries are placed in `src-tauri/target/release/bundle/`.

---

## Usage

1. Launch QEdit v3
2. Use **File → Open Quest** to load a `.qst` file
3. Set the **map directory** to your PSO Blue Burst `map/` folder (needed for 3D preview)
4. Navigate floors in the sidebar — the 3D viewer loads the area automatically

### 3D viewer controls
| Input | Action |
|-------|--------|
| Right-click drag | Look around |
| W / A / S / D | Move |
| Space | Fly up |
| Shift | Fly down |

---

## Releases

Pre-built binaries for Windows and macOS (Intel + Apple Silicon) are available on the [Releases](../../releases) page.

macOS builds are unsigned for now. You must run command line `xattr -c <AppPath>` prior to first launch.

---

## Acknowledgements

- **Schthack** — original QEdit v2 (Delphi), whose file format research made this port possible
- **Alisaryn** - QEdit v2 (Delphi) relentless improvments and fixes
- **Soly** — PSO file format documentation
- The **Sylverant** and **Tethealla** open-source projects for additional format reference
