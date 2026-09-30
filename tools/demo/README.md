# Demo media generator

Builds `docs/media/demo.gif` and the two stills next to it. This is a **tool for the repository's media, not part of the
zero-dependency product**: it needs a Chrome or Chromium executable (set `WARRANT_CHROME` if it is not in a standard place) and
Python with Pillow.

```bash
node tools/demo/make-demo.js                       # runs the examples for real, renders one PNG per frame into tools/demo/.frames
python tools/demo/assemble.py docs/media/demo.gif  # frames -> GIF
```

What is real and what is condensed:

- The terminal panes are generated from the JSON reports that `warrant run` and `warrant verify-log` print when the script runs them
  on `examples/pipeline`; the task names, statuses, failed requirements, entry count and log head all come from that output.
  The panes show those fields in a short table, not the full JSON (a note in each frame says so).
- The bars in the last scene come from `results/agent-claims/final/router-arm/summary.json` (the two complete arms), not from typed numbers.
- Titles and captions are written by hand.

`gate-catches-liar.png` and `study-result.png` are single frames of the same GIF.

The log head and other hashes differ from run to run (the log records timestamps), so regenerating gives a new GIF with the same content.
