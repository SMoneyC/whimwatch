- Adding a download page now refuses an address that only looks like a supported site. A link such
  as `javascript://wicked.cc/…` parsed as a wicked.cc page and was accepted, because only the host
  was ever checked. Present since 0.1.0; nothing is known to have used it.
