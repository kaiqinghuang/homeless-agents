#!/usr/bin/env python3
"""Reproduce the local speech setup using pinned official source and model hashes."""
import hashlib
import shutil
import subprocess
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent
SOURCE = ROOT / 'vendor/whisper.cpp'
REVISION = '927cfce34f31707e17f2bff35c349632fb9e2c3a'
MODELS = [
    ('ggml-small.bin', 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin?download=true',
     '1be3a9b2063867b937e64e2ec7483364a79917e157fa98c5d94b5c1fffea987b'),
    ('ggml-silero-v6.2.0.bin', 'https://huggingface.co/ggml-org/whisper-vad/resolve/main/ggml-silero-v6.2.0.bin',
     '2aa269b785eeb53a82983a20501ddf7c1d9c48e33ab63a41391ac6c9f7fb6987'),
]


def digest(path):
    h = hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            h.update(chunk)
    return h.hexdigest()


def main():
    for name in ('git', 'cmake', 'clang'):
        if not shutil.which(name):
            raise SystemExit(f'Missing {name}. Install the Xcode command-line tools and CMake first.')
    SOURCE.parent.mkdir(exist_ok=True)
    if not SOURCE.exists():
        subprocess.run(['git', 'clone', '--depth', '1', '--branch', 'v1.9.4',
                        'https://github.com/ggml-org/whisper.cpp.git', str(SOURCE)], check=True)
    actual = subprocess.check_output(['git', '-C', str(SOURCE), 'rev-parse', 'HEAD'], text=True).strip()
    if actual != REVISION:
        raise SystemExit('The local whisper.cpp revision differs from the pinned version; leaving it unchanged.')
    models = ROOT / 'models'
    models.mkdir(exist_ok=True)
    for name, url, expected in MODELS:
        target = models / name
        if target.exists() and digest(target) == expected:
            print('Verified:', name, flush=True)
            continue
        temporary = target.with_suffix(target.suffix + '.part')
        print('Downloading:', name, flush=True)
        with urllib.request.urlopen(url, timeout=90) as response, temporary.open('wb') as output:
            shutil.copyfileobj(response, output, length=1024 * 1024)
        if digest(temporary) != expected:
            raise SystemExit('Checksum mismatch: ' + name + '. The existing model was not replaced.')
        temporary.replace(target)
    build = SOURCE / 'build'
    subprocess.run(['cmake', '-S', str(SOURCE), '-B', str(build), '-DCMAKE_BUILD_TYPE=Release',
                    '-DGGML_METAL=ON', '-DWHISPER_BUILD_TESTS=OFF', '-DWHISPER_BUILD_SERVER=ON'], check=True)
    subprocess.run(['cmake', '--build', str(build), '--config', 'Release', '-j', '6',
                    '--target', 'whisper-server', 'whisper-cli'], check=True)
    print('Local speech setup complete. Open Start.command.', flush=True)


if __name__ == '__main__':
    main()
