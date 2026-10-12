# Orbit — serverless peer‑to‑peer chat rooms, on every website

Orbit is a Chrome / Edge / Brave (Manifest V3) extension that puts a tiny floating dot on every page.
Click it and a panel slides out where you create rooms with a display name and join them using a
random room code. The name is for people; the code is the actual room address.

Orbit uses [PeerJS](https://peerjs.com/) with its public PeerServer to broker WebRTC connections.
Creating a room reserves a namespaced PeerJS host ID derived from a five-letter code; members connect to the creator, who stays online
and forwards room traffic between them. PeerJS is bundled locally; its signaling service is
remote. Optional room passwords add end‑to‑end encryption.

> **Renaming:** the product name lives in exactly one constant, `BRAND_NAME` in `shared/brand.js`
> (plus the human‑readable `name`/`short_name` in `manifest.json`).

---

## Contents

1. [Architecture](#architecture)
2. [Load it (unpacked)](#load-it-unpacked)
3. [Test with two profiles](#test-with-two-profiles)
4. [Everyday use](#everyday-use)
5. [Configuring STUN/TURN and signaling](#configuring-stunturn-and-signaling)
6. [Peer protocol](#peer-protocol)
7. [Security & privacy — what leaves your browser](#security--privacy--what-leaves-your-browser)
8. [Storage layout](#storage-layout)
9. [Scripts](#scripts)
10. [Limitations](#limitations)
11. [Troubleshooting](#troubleshooting)
12. [File map](#file-map)

---

## Architecture

```
┌──────────────────────────── every tab ─────────────────────────────┐
│ content/content.js  (tiny: dot + closed Shadow DOM host)            │
│   └─ lazily loads ui/*.js via chrome.scripting when the dot opens   │
│        ui/panel.js + ui/panel-settings.js + ui/ui-kit.js (the UI)   │
└───────────────▲──────── chrome.runtime port (shared/bridge.js) ─────┘
                │
┌───────────────▼──────────── service worker ────────────────────────┐
│ background/service-worker.js: port hub, badge, notifications,      │
│ commands, side-panel fallback, keep-alive alarm, offscreen owner    │
└───────────────▲──────── chrome.runtime.sendMessage ────────────────┘
                │
┌───────────────▼──────────── offscreen document (WEB_RTC) ──────────┐
│ offscreen/offscreen.js: ALL networking & room state                 │
│   PeerJS (lib/) → creator-hosted WebRTC data channels               │
│   crypto.js (room ids, AES‑GCM), db.js (IndexedDB history/images), │
│   protocol.js (validation, rate limits), images.js, sounds.js       │
└─────────────────────────────────────────────────────────────────────┘
```

* **Content script** — creates `<orbit-host>` with a *closed* shadow root (z‑index 2147483647,
  `all: initial`), draws the dot, handles drag/snap/peek/context menu, and re‑attaches itself if the
  page removes it (MutationObserver + SPA guard). It opens a `runtime.Port` (`shared/bridge.js`) and
  asks the service worker to inject the heavy UI files only when the panel is first opened.
* **Service worker** — owns the offscreen document (creates it on demand, recreates it if Chrome
  kills it, keep‑alive alarm + heartbeat), routes port messages, maintains the toolbar badge and
  desktop notifications, handles keyboard commands and falls back to the side panel on restricted
  pages (`chrome://`, the Web Store, PDF viewer).
* **Offscreen document** — the only place with network access. It hosts PeerJS/WebRTC connections,
  uses a namespaced PeerJS ID derived from the creator's five-letter code, relays messages through that creator,
  runs room state machines (presence, typing, seen markers, acknowledgements, history sync, chunked
  images with backpressure), persists history in IndexedDB and plays synthesized notification sounds.
* **Side panel** — the same UI mounted in `ui/sidepanel.html`, used on pages where content scripts
  cannot run.

## Load it (unpacked)

1. `git clone` / unzip this folder. Nothing needs building — `lib/` already contains the vendored
   PeerJS and legacy Trystero bundles and `icons/` the generated icons. (To regenerate: see [Scripts](#scripts).)
2. Open `chrome://extensions` (Edge: `edge://extensions`, Brave: `brave://extensions`).
3. Turn on **Developer mode** → **Load unpacked** → select the folder containing `manifest.json`.
4. Open any http(s) page. A small dot appears docked to the right edge; click it.
5. Optional: pin the toolbar icon. Clicking it toggles the panel; on restricted pages it opens the
   side panel instead. Shortcuts: **Alt+Shift+C** toggle, **Alt+Shift+H** boss key
   (change them at `chrome://extensions/shortcuts`).

## Test with two profiles

Orbit identifies you per browser profile, so the easiest local test is two profiles (or Chrome + Edge):

1. Create a second Chrome profile (avatar menu → *Add*), load the unpacked extension there too.
2. In one profile, click the dot, enter a display name and press **Create room**. The room screen
   shows a generated code; copy it. In the other profile, paste that code under **Join room** and
   press Join. The code—not the display name—is used for peer discovery.
3. Within a few seconds the status line reads *Connected · 1 person*, the presence ring on the dot
   turns green, and the avatar of the other member pops into the members sidebar.
4. Send text, paste a screenshot (Ctrl+V into the composer), drag a GIF onto the panel, react, reply,
   edit, `/roll 2d6`, and close/re‑open tabs — messages keep flowing because networking lives in the
   offscreen document, not in the tab.
5. Add a password in one profile only: the code/password pair resolves to a different room. Use the
   same generated code and password in both profiles to meet again.

The room creator owns the namespaced PeerJS ID associated with the five-letter code and acts as the forwarding hub, so they must stay
online for others to communicate. **Create room** reserves a new random code; **Join room** connects
to that PeerJS host. Share the code (and, if set, the password) out of band. Both machines need the
extension and outbound access to PeerJS Cloud. Most home/mobile networks connect directly via STUN;
corporate/school networks may need TURN.

## Everyday use

* **Dot** — drag it vertically; it snaps back to the edge and remembers its spot. Right‑click for
  *Hide on this site / Hide everywhere for 1 h / Move to other side / Settings*. Hover to peek the
  latest message; unread messages pulse a badge (muted rooms stay quiet). It tucks half off‑screen
  when idle and auto‑hides during fullscreen video (configurable).
* **Panel** — drag the header to the opposite edge to move it, drag the inner edge to resize
  (320–560 px), pin it open to keep using the page underneath, adjust its opacity. `Esc` closes,
  `/` focuses the composer, `Ctrl+K` opens the fuzzy room switcher.
* **Messages** — `Enter` sends, `Shift+Enter` newline. `**bold** *italic* \`code\` \`\`\`blocks\`\`\`
  ~~strike~~`, links (http/https only), `@mentions` with autocomplete, reply/edit/delete/reactions,
  typing indicator, seen markers, date separators, search, jump‑to-latest, shared message pins, automatic host handoff, up to 4 inline images per message
  (drag‑drop or paste), in‑panel lightbox with zoom/pan/download/copy, emoji picker for reactions,
  custom sticker tray, voice notes, configurable polls, and file attachments (any type up to 50 MB; confirmation above 25 MB).
* **Slash commands** — `/me`, `/shrug`, `/clear`, `/nick Name`, `/roll 2d6`, `/flip`, `/mute Name`,
  `/leave`, `/help`.
* **Rooms** — pinned & recent lists with unread + online counts, multiple rooms at once, per‑room
  mute (1 h / 8 h / until tomorrow / forever), per‑room nickname, per‑room chat background,
  "Share history with newcomers" toggle (default on), clear local history, Copy invite.
* **Room keeper** — the member who has been present the longest. The keeper can give the room a
  cosmetic title and soft‑mute a member for everyone. This is *cooperative*: peers honour it because
  they run the same code, not because anything enforces it (see comments in `offscreen/offscreen.js`).
* **Profile** — display name (≤ 24 chars), avatar (procedural, emoji, or an uploaded picture cropped
  to a 128×128 WebP under 20 KB — EXIF is stripped by re‑encoding), banner, status line, presence
  (Online/Away/DND/Invisible), name colour, export/import as JSON.
* **Appearance** — light/dark/auto, six accent presets + custom, font size, compact mode, bubbles or
  flat, panel side, dot size/opacity, chat backgrounds (patterns or your own image with blur/dim,
  global or per room), reduce motion, colour or monochrome toolbar icon.
* **Notifications & privacy** — desktop notifications, synthesized sounds (no audio files), notify on
  @mention even when muted, DND schedule, hidden‑sites list, link previews (off by default — see
  warning in settings), max image size and image cache size, clear all local data.

## Configuring STUN/TURN and signaling

Settings → **Advanced**:

* **Peer discovery (signaling)** — the PeerJS server is set by `PEER_SERVER` in `shared/brand.js`. This
  repo points it at a **local PeerServer** (`localhost:9000`, plain WebSocket, key `peerjs`) for local
  testing. The creator's namespaced PeerJS ID is derived from the five-letter code, and the creator
  forwards envelopes to members. To use the public cloud instead, set it to `0.peerjs.com`, port `443`,
  `secure: true`, path `/`, key `peerjs`, and add `wss://0.peerjs.com` back to the CSP `connect-src`.

  **Run the local PeerServer** (needs Node 18+), in a terminal that stays open:

  ```bash
  npm install
  npm run peer-server   # PeerServer on ws://localhost:9000/peerjs
  ```

  Then load the extension and test with two Chrome profiles on the same computer. The CSP in
  `manifest.json` already allows `ws://localhost:9000`. If you change the port, update both places.
* **STUN / TURN servers (JSON)** — an array of `RTCIceServer` objects. The defaults are public STUN
  servers only. If two peers cannot connect (diagnostics show `connecting` / `failed` forever) add a
  TURN server:

  ```json
  [
    { "urls": ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] },
    { "urls": "turn:turn.example.com:3478", "username": "user", "credential": "secret" },
    { "urls": "turns:turn.example.com:5349", "username": "user", "credential": "secret" }
  ]
  ```

  Free options: run [coturn](https://github.com/coturn/coturn) on any VPS, or use a metered TURN
  provider. Saving reconnects your rooms with the new configuration.
* **Connection diagnostics** — per room: signaling provider and per‑peer connection state/RTT. **Test connection** checks PeerJS signaling, gathers available host/STUN/TURN ICE candidate types using your ICE settings, and sends two round-trip pings to each online room member; where the browser exposes stats, it also reports the selected ICE candidate path. Keep another member online for the end-to-end check. Candidate gathering alone does not prove a path can connect.

## Peer protocol

All peer traffic uses Orbit JSON envelopes inside PeerJS/WebRTC data connections. Every envelope:

```json
{ "v": 1, "type": "chat", "id": "uuid", "roomId": "16 hex", "senderId": "u…", "ts": 1727000000000, "payload": { } }
```

| type              | payload                                                                                   | notes |
|-------------------|-------------------------------------------------------------------------------------------|-------|
| `hello`           | `{userId, name, avatar, banner, status, presence, nameColor, joinedAt, proto}`             | sent to each new peer; maps PeerJS transport IDs to your stable per‑install `userId` |
| `presence`        | same profile fields as `hello`                                                            | profile / presence changes |
| `chat`            | `{text, kind: "chat"\|"me", replyTo?, images?: [meta], mentions?, sticker?, seq}`         | `seq` is per‑sender & monotonically increasing; receivers **ack** the envelope id |
| `ack`             | `{ids: [envelopeId, …]}`                                                                  | batched acknowledgements; unacked chat messages are re‑sent on reconnect |
| `edit`            | `{msgId, text}`                                                                           | only the original sender may edit |
| `delete`          | `{msgId}`                                                                                 | only the original sender may delete |
| `reaction`        | `{msgId, emoji, add}`                                                                     | one entry per user per emoji |
| `typing`          | `{on}`                                                                                    | throttled (≈ 1 per 2.5 s) |
| `seen`            | `{msgId, ts}`                                                                             | read pointer, shown as "Seen by …" |
| `history-offer`   | `{count, latestTs}`                                                                       | sent to newcomers when *Share history* is on |
| `history-request` | `{since, limit}`                                                                          | newcomer asks for up to ~200 messages newer than what it already has |
| `history-batch`   | `{messages: [record…] (≤ 40 per batch), more}`                                            | text + small thumbnails only, never full images |
| `image-meta`      | `{imageId, msgId, size, mime, chunks, chunkBytes}`                                        | announces a transfer (only for images referenced by a known message) |
| *(binary action)* | chunk bytes, metadata `{i: imageId, n: index}`                                            | 64 KB chunks, window of 8 in flight, sent on the separate `chunk` action |
| `image-ack`       | `{imageId, upTo, done}`                                                                   | backpressure / completion |
| `image-request`   | `{imageId}`                                                                               | ask a peer for a full‑size image (e.g. after history sync) |
| `room-title`      | `{title}`                                                                                 | keeper only (cosmetic room title) |
| `room-mute`       | `{userId, on}`                                                                            | keeper only, honoured cooperatively |

Orbit multiplexes control envelopes as `ctl` and binary image chunks as `chunk` over PeerJS data
connections. The room creator forwards these frames to room members; password-protected content has an additional AES-GCM layer.

Ordering is by `(ts, senderId)`; envelopes are validated for shape and size (512 KB max control
message, 4 000 chars text, ≤ 4 images/message, 6 MB per image by default) and every peer is
rate‑limited (token bucket) before any state changes. The room code is five random lowercase letters. The room id is the first 16 hex characters of
`SHA‑256("orbit:room:" + fiveLetterCode [+ ":pw:" + SHA‑256("orbit:pw:" + password)])`. With a room
password every payload and image chunk is AES‑GCM-encrypted with a key derived by PBKDF2 (210 000
iterations) from the normalized code + password. A wrong code/password simply finds no active room.

**Name normalization** (identical in `offscreen/crypto.js` and `ui/ui-kit.js`): NFKC → lowercase →
every character that is not a letter/number/mark/space/`-`/`_` becomes a space → runs of
space/`-`/`_` collapse to a single `-` → trim → max 64 chars.

## Security & privacy — what leaves your browser

* **PeerJS PeerServer** sees your IP address, namespaced room PeerJS ID, peer IDs and WebRTC
  session descriptions (sent over TLS). It brokers connections but does not carry chat payloads.
* **Peers** in a room see: your IP address (inherent to WebRTC unless you use a TURN relay), your
  profile (name, avatar, status, presence, colour), your messages/images, typing and read state.
* **STUN/TURN servers** see your IP address; TURN servers relay WebRTC traffic when direct
  connections fail. The WebRTC hop is DTLS-protected.
* **Link previews** are *off* by default. When enabled, the extension's service worker fetches the
  linked page, which reveals your IP to that site.
* No analytics, update pings, CDN scripts or external fonts. PeerJS is the explicit exception for
  signaling: the bundled client connects to `0.peerjs.com`; icons and UI code remain local.
* Your identity is a random per‑install id (`userId`) plus the display name you choose. Images are
  re‑encoded client‑side, which strips EXIF/location metadata before sending.
* Hardening: no `eval`/inline scripts (strict extension CSP), no `innerHTML` with peer content,
  links limited to `http(s)` and opened with `rel="noopener noreferrer"`, per‑peer rate limits, size
  limits on every field, image bytes sniffed for a real PNG/JPEG/WebP/GIF signature, closed Shadow DOM
  so pages cannot read the chat, and page keyboard handlers never see what you type in the panel.

## Storage layout

| where                       | what                                                                                  |
|-----------------------------|---------------------------------------------------------------------------------------|
| `chrome.storage.local`      | `settings`, `profile`, `rooms` (recent/pinned list incl. per‑room password & prefs), `userId`, `stickers`, `recentEmoji`, `schemaVersion` |
| `chrome.storage.sync`       | `settingsSync` — a small subset of appearance settings (theme, accent, font size, side…) |
| IndexedDB `orbit-db`        | `messages` (capped at 5 000 per room), `images` (blob cache, LRU‑pruned to the configured MB), `meta` |

*Clear all local data* wipes everything above and re‑seeds defaults with a fresh `userId`.

## Scripts

| script                       | purpose |
|------------------------------|---------|
| `scripts/build-vendor.sh`    | Rebuilds the local Trystero and PeerJS bundles with esbuild (see `lib/README.md`). |
| `scripts/make-icons.py`      | Regenerates `icons/` (colour + monochrome PNGs 16/32/48/128 and `orbit.svg`) with Pillow. |
| `scripts/gen-emoji.py`       | Regenerates `ui/emoji-data.js` from Python's Unicode database (no network). |

## Limitations

* **Discovery depends on public relays.** If every default relay of the chosen strategy is down or
  blocked, peers cannot find each other — switch strategy in Advanced settings.
* **Symmetric NATs / strict firewalls** need a TURN server; none is bundled (running one costs
  bandwidth). Diagnostics tell you when this is the case.
* **Creator must stay online.** The creator's browser owns the namespaced PeerJS ID associated with the five-letter code and forwards
  room traffic (passwords add AES-GCM content encryption). If it closes or disconnects, the room becomes unavailable until the creator
  reconnects. There is no offline delivery or room directory. Messages reach online peers; unacked messages are
  re‑sent when a peer reconnects while you are still there, and newcomers get the last ~200 messages
  from anyone who shares history. If everyone leaves, history exists only in members' local databases.
* **Room size** is capped at 12. Joiners connect to the creator, who forwards messages (a creator-hosted hub).
* **Five-letter codes** are easy to share but are not strong secrets and can collide; PeerJS rejects an
  occupied code and Orbit generates another. Use a room password for content confidentiality.
* **Identity is not authenticated.** Anyone can pick any display name; the per‑install `userId` is
  random and could be spoofed by a modified client. Room codes identify the room but do not authenticate
  a member; optional passwords protect content.
* **Keeper powers are cooperative** (title, soft mute) — a modified client can ignore them.
* Content scripts cannot run on `chrome://` pages, the Web Store, other extensions' pages or the PDF
  viewer; there Orbit opens in the **side panel**.
* Very large pages with aggressive CSPs: the UI works (Shadow DOM + `adoptedStyleSheets`; images fall
  back to canvas rendering when `img-src` blocks `data:` URLs), but a page that removes unknown
  elements in a tight loop will fight the MutationObserver.
* Firefox is not supported (no `chrome.offscreen`).

## Reliability features

Image and file transfers use acknowledged chunks. Failed image transfers can be retried, and interrupted image/file chunks are retained locally so reconnects can resume. File attachments support any file type up to 50 MB; Orbit asks for confirmation above 25 MB. Voice messages are recorded in-browser and capped at 30 seconds. Poll creation supports custom questions/options, single- or multiple-choice voting, and an optional close time; voters can change their vote while the poll is open. Message pins are shared across room members and included in shared history. If the current PeerJS host disappears, online members deterministically elect a replacement that claims the same five-letter room ID; the handoff notice is a bold `@everyone` timeline message and is removed after everyone online at handoff has read through it. Host recovery depends on members retaining a live Orbit session and a usable PeerJS/WebRTC connection.

## Troubleshooting

| symptom | what to check |
|---------|---------------|
| Dot never appears | Is the site in *Hide on these sites*? Is "Hide everywhere for 1 h" or the boss key active (Alt+Shift+H)? Reload the page after installing/updating the extension. Some pages (`chrome://`, Web Store) never get content scripts — use the toolbar icon → side panel. |
| "Connecting…" forever, 0 peers | At least one room member must remain online. Orbit attempts automatic host handoff when the current host disappears, but if all members leave, the room is offline. Check that the five-letter code/password are exact and outbound TLS/WebSocket access to `0.peerjs.com:443` is allowed. |
| Peers visible but connection stuck in `connecting`/`failed` | NAT traversal failed; add a TURN server in Advanced settings (both sides). |
| Messages arrive only after reopening the panel | The offscreen document was restarted (Chrome killed it); it recovers automatically. Check `chrome://extensions` → Orbit → *service worker* console for errors. |
| Images or files stay waiting | The sender may have left, or the attachment may exceed its size limit. Click *Get file* or the image placeholder to request it from a connected member who has it; interrupted chunks are resumed when a peer reconnects. |
| Voice note cannot record | Allow Orbit microphone access when prompted and retry. The microphone is only used after clicking the voice-record button; recordings stop at 30 seconds. |
| Sounds don't play | Enable *Notification sound*; the boss key and DND schedule mute sounds; Chrome may require the offscreen document to have played once — use *Test*. |
| Panel looks unstyled or tiny on a site | The site's CSS cannot leak in (closed shadow root + `all: initial`), but very old Chrome (<116) lacks `adoptedStyleSheets` in shadow roots — update Chrome. |
| "Orbit was updated — reload this page" | The extension was reloaded; content scripts of already‑open tabs lose their connection by design. Reload the tab. |
| Keyboard shortcut does nothing | Another extension may own it; reassign at `chrome://extensions/shortcuts`. |

Console logs: page console for the content script (`[Orbit]` prefix), `chrome://extensions` →
*service worker* for the background, and `chrome://extensions` → *offscreen.html* (Inspect views)
for networking.

## File map

```
manifest.json                 MV3 manifest (permissions explained inline in the service worker header)
shared/brand.js               BRAND_NAME + every constant/default (rename here)
shared/bridge.js              runtime.Port bridge with reconnect, request/response, heartbeat
background/service-worker.js  hub: ports, offscreen lifecycle, badge, notifications, commands, side panel
offscreen/offscreen.html/.js  networking host: rooms, peers, protocol, history sync, images
offscreen/crypto.js           room id/key derivation, AES-GCM, name normalization
offscreen/db.js               IndexedDB (messages, images, meta) with caps/pruning
offscreen/protocol.js         envelope validation, limits, rate limiter
offscreen/images.js           image sniffing, size probing, thumbnails
offscreen/sounds.js           Web Audio synthesized notification sounds
content/content.js            the dot (closed Shadow DOM, drag/snap, peek, context menu, lazy UI load)
ui/panel.js                   panel core: shell, rooms, room view, composer, images, lightbox, menus
ui/panel-settings.js          profile, appearance, notifications/privacy, advanced, diagnostics, tour
ui/ui-kit.js                  DOM builder, inline SVG icons, avatars, rich text renderer, image utils
ui/strings.js                 every user-facing string (single object, t(key, vars))
ui/emoji-data.js              local emoji dataset (generated)
ui/panel.css                  the design system (CSS custom properties, light/dark, compact, grain)
ui/sidepanel.html/.js/.css    side panel host (fallback UI)
lib/peerjs-client.js         vendored PeerJS browser client — see lib/README.md
lib/trystero-*.js             legacy Trystero bundles — see lib/README.md
icons/                        generated icons (colour + monochrome) and orbit.svg
scripts/                      build-vendor.sh, make-icons.py, gen-emoji.py
```

License: MIT for Orbit's own code. PeerJS and legacy Trystero bundles are MIT — see `lib/README.md`.
