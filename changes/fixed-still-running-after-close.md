- WhimWatch now closes gracefully on quit. After a check had run, closing the window could leave it running with
  nothing on screen — and because it still held the single-instance lock, opening WhimWatch again
  did nothing until the old one was ended in Task Manager. The hidden windows it uses to read sites
  were keeping it alive.
