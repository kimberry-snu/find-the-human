# Socket.IO E2E harness

Run from the repository root after installing workspace dependencies:

```powershell
node scripts/e2e.mjs
```

The harness builds the server, starts the compiled server on an ephemeral port,
forces mock AI mode by clearing `OPENAI_API_KEY`, and sets
`GAME_TIME_SCALE=0.06`. It verifies:

- one human plus three AIs through start, chat, vote, reveal, and game over;
- two humans plus three AIs through create, join, start, chat, vote, reveal,
  game over, and play again;
- an exact two-human plus three-AI game completing all three rounds;
- an in-game disconnect and `room:rejoin` with the same anonymous identity;
- duplicate nickname, non-host start, 141-character chat, host delegation,
  reconnect snapshot, and disconnect-grace automatic elimination guards;
- a one-human spectator room with 6-8 AI-only participants through game over;
- a fresh `aiCount: 'random'` start after returning the first room to its lobby.

Useful environment overrides:

```powershell
$env:E2E_VERBOSE = '1'          # stream server and socket event logs
$env:E2E_SKIP_BUILD = '1'       # use an existing server/dist build
$env:E2E_TIMEOUT_MS = '30000'   # per-event timeout
$env:E2E_GAME_TIME_SCALE = '0.1'
node scripts/e2e.mjs
```

On failure, the assertion includes the client's recent Socket.IO events and the
tail of the child server output. All sockets and the child process are closed in
a `finally` block.

## Playtest win-rate summary

Save the server's `game_complete` JSON lines to a log file, then run:

```powershell
npm run metrics:playtest -- render.log
```

The script reports the observed human win rate for `mild` and `spicy`
difficulty separately. Do not publish a percentage without the sample size.
