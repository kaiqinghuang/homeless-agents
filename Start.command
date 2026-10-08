#!/bin/zsh
cd -- "$(dirname -- "$0")"
if ! command -v python3 >/dev/null 2>&1; then
  print 'Python 3 is required. Install Python 3, then open this file again.'
  read '?Press Enter to close.'
  exit 1
fi
print 'Afterimage · continuous text and silent faces'
print 'Open http://127.0.0.1:8766 in Safari or Chrome once the server is ready.'
print 'Use Start generating for the faces. Audio is off. Live Common Crawl collection is paused.'
print 'Text uses Qwen2.5-0.5B with the selected LoRA: original 180 steps + 120 continued steps, 189 training samples.'
print 'Keep this window open. Press Control-C to stop.'
python3 server.py --port 8766
read '?Press Enter to close.'
