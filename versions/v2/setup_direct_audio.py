#!/usr/bin/env python3
"""Install pinned local audio runtime and download weights; no recording uploads."""
import json
from pathlib import Path
import os
import subprocess
import sys
import venv

ROOT = Path(__file__).resolve().parent

def main():
    python = ROOT / '.venv-audio/bin/python'
    if not python.is_file():
        venv.create(ROOT / '.venv-audio', with_pip=True)
    env = {**os.environ, 'HF_HOME': str(ROOT / 'models/.hf-cache'), 'PIP_CACHE_DIR': str(ROOT / 'vendor/pip-cache')}
    subprocess.run([str(python), '-m', 'pip', 'install', '-r', str(ROOT / 'requirements-audio.txt')], check=True, env=env)
    config = json.loads((ROOT / 'agent_config.json').read_text())
    script = ('from huggingface_hub import snapshot_download; '
              'snapshot_download(repo_id=' + repr(config['repository']) + ',revision=' + repr(config['revision']) +
              ',local_dir=' + repr(str(ROOT / 'models/qwen2-audio-7b-4bit')) +
              ',allow_patterns=["*.json","*.safetensors","*.txt","*.jinja","README.md"])')
    subprocess.run([str(python), '-c', script], check=True, env=env)
    print('Direct audio ready. Open Start.command, then Start listening in the page.')

if __name__ == '__main__':
    main()
