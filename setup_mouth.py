"""Build a pinned, project-local phoneme engine without sound-device output."""
from pathlib import Path
import shutil
import subprocess

ROOT = Path(__file__).resolve().parent
SOURCE = ROOT / 'vendor/espeak-ng'
REVISION = '4870adfa25b1a32b4361592f1be8a40337c58d6c'


def main():
    for name in ('git', 'cmake', 'clang'):
        if not shutil.which(name):
            raise SystemExit('Missing ' + name + '. Install Xcode command-line tools and CMake.')
    SOURCE.parent.mkdir(exist_ok=True)
    if not SOURCE.exists():
        subprocess.run(['git', 'clone', '--depth', '1', '--branch', '1.52.0',
                        'https://github.com/espeak-ng/espeak-ng.git', str(SOURCE)], check=True)
    actual = subprocess.check_output(['git', '-C', str(SOURCE), 'rev-parse', 'HEAD'], text=True).strip()
    if actual != REVISION:
        raise SystemExit('The local eSpeak NG revision differs from the pinned version; leaving it unchanged.')
    build = SOURCE / 'build'
    subprocess.run(['cmake', '-S', str(SOURCE), '-B', str(build), '-DCMAKE_BUILD_TYPE=Release',
                    '-DBUILD_SHARED_LIBS=ON', '-DUSE_LIBPCAUDIO=OFF', '-DUSE_LIBSONIC=OFF',
                    '-DUSE_MBROLA=OFF', '-DUSE_SPEECHPLAYER=OFF', '-DUSE_ASYNC=OFF',
                    '-DESPEAK_BUILD_MANPAGES=OFF'], check=True)
    subprocess.run(['cmake', '--build', str(build), '--config', 'Release', '-j', '6'], check=True)
    from mouth_plan import plan
    for sentence in ('Make a face. You move through the room.', '你好，妈妈。'):
        assert any(c['phoneme'] for c in plan(sentence)['timeline'])
    print('Local phoneme setup complete. Restart Start.command.', flush=True)


if __name__ == '__main__':
    main()
