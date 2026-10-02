#!/bin/zsh
cd -- "$(dirname -- "$0")"
python3 setup_mouth.py && python3 setup_direct_audio.py
read '?Press Enter to close.'
