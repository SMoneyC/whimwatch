- The portable Windows build no longer fails silently forever once its unpacked copy is damaged.
  It used to unpack into one folder shared by every launch; if a file was held open while it
  unpacked, that folder stayed incomplete and every later launch started nothing at all — no
  window, no error, nothing in the log. Each launch now unpacks into its own folder. The README
  says what to do if you hit this on 0.1.1 or earlier.
