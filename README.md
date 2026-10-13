# Arena Prototype

A two-player top-down fighter for trying out mechanics quickly.

## Run it

```
npm install
npm run dev
```

Open http://localhost:5173 and pick a mode from the menu:

- **Play**: a two-player match. Open a second browser window and click Play there too.
- **Training**: just you and a target dummy that stands still. Runs entirely in the browser, no server needed.

Controls:

- **WASD**: move
- **Hold Shift**: charge a dash, release to dash toward the mouse
- **Hold left mouse**: charge an arrow, release to shoot
- **Hold E**: charge a blast (the longer you hold, the further it reaches and the bigger it gets), release to mark the ground at the mouse; it explodes shortly after and damages enemies inside
- **Esc**: back to the menu

The bar at the bottom shows each ability's cooldown.

## How it fits together

```
shared/game.ts   The game rules and tuning numbers. Used by both sides.
server/server.ts Runs the real game at 60 updates/sec and sends the state to both players.
client/main.ts   The menu, keyboard/mouse input, drawing, and the Training mode loop.
```

In Play mode the browser never decides what happens. It only sends input and draws. The server runs the rules, so both players always see the same result.

In Training mode the browser runs the same rules from `shared/game.ts` itself, so it plays exactly like a real match.

## Changing things

- **Tuning:** edit the numbers at the top of `shared/game.ts`.
- **New mechanics:** add them to `step()` in `shared/game.ts`.

Saving a file restarts the server and reloads the page automatically.
