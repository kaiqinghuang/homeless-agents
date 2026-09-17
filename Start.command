#!/bin/zsh
cd -- "$(dirname -- "$0")"
if ! command -v python3 >/dev/null 2>&1; then
  print 'Python 3 is required. Install Python 3, then open this file again.'
  read '?Press Enter to close.'
  exit 1
fi
print 'Open http://127.0.0.1:8765 in Safari or Chrome once the server is ready.'
print 'Keep this window open. Press Control-C to stop.'
python3 server.py --port 8765
read '?Press Enter to close.'
