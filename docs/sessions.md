# Sessions: your own panes beside this one

Ask in a plain prompt: "open three sessions", "open a codex session", "open two shells in ../api". The mod opens real Herdr or tmux panes beside yours, unfocused, up to 8 at once.

Each one is yours, like a pane opened by hand: no worker role or worker environment, no reports, and no `/agt` run unless one is typed into it. `/storm`'s hand-off is the one case that types for you: it opens one session and sends `/agt heavy "…"` as its first prompt, which runs as a typed `/agt` in that session.

- **Kinds**: Claude (default, on your default model unless you name one), Codex (Herdr only) or a plain shell. Give each one a first prompt in the same sentence if you like: it has to be your own words from that prompt, anything else is dropped and the session opens empty.
- **Follow-ups**: on Herdr, your session can prompt one (`herdr agent prompt <name> "…"`) or read its screen (`herdr agent read <name>`). "Close both sessions" closes them.
- **Auto-close**: a Herdr Claude or Codex session closes after 10 minutes idle and unfocused, and at session end when idle. One with an answer you have not looked at yet stays open.
- **Never auto-closed**: shells, a session whose agent has exited, and every tmux session. They close when you ask or when you close the pane.
- **Got one closed too early?** `claude --resume` in that directory brings the conversation back.
- **What unlocks the tool:** `open_sessions` exists only on a turn whose typed prompt asked for sessions, panes or terminals, and a shell's first command must be one you quoted in that sentence: [guards.md](./guards.md#pane-tools).
