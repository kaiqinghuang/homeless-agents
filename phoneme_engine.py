"""Isolated, silent eSpeak NG worker. PCM stays in memory and is discarded."""
import ctypes as C
import json
from pathlib import Path
import sys

BUILD = Path(__file__).resolve().parent / 'vendor/espeak-ng/build'


class EventID(C.Union):
    _fields_ = [('number', C.c_int), ('name', C.c_char_p), ('string', C.c_char * 8)]


class Event(C.Structure):
    _fields_ = [('type', C.c_int), ('identifier', C.c_uint), ('text_position', C.c_int),
                ('length', C.c_int), ('audio_position', C.c_int), ('sample', C.c_int),
                ('user_data', C.c_void_p), ('id', EventID)]


CALLBACK = C.CFUNCTYPE(C.c_int, C.POINTER(C.c_short), C.c_int, C.POINTER(Event))


def synthesize(segments):
    library = BUILD / 'src/libespeak-ng/libespeak-ng.dylib'
    if not library.exists() or not (BUILD / 'espeak-ng-data/cmn_dict').exists():
        raise RuntimeError('Phoneme engine missing. Run python3 setup_mouth.py. / 请先安装音素引擎。')
    lib = C.CDLL(str(library))
    lib.espeak_Initialize.argtypes = [C.c_int, C.c_int, C.c_char_p, C.c_int]
    lib.espeak_SetSynthCallback.argtypes = [CALLBACK]
    lib.espeak_SetVoiceByName.argtypes = [C.c_char_p]
    lib.espeak_SetParameter.argtypes = [C.c_int, C.c_int, C.c_int]
    lib.espeak_Synth.argtypes = [C.c_void_p, C.c_size_t, C.c_uint, C.c_int,
                                C.c_uint, C.c_uint, C.c_void_p, C.c_void_p]
    # SYNCHRONOUS retrieval (2), phoneme events + IPA (3), don't exit on error.
    # The dependency is also built WITHOUT audio-device playback support.
    rate = lib.espeak_Initialize(2, 0, str(BUILD).encode(), 0x8003)
    if rate <= 0:
        raise RuntimeError('Could not initialize the local phoneme engine.')
    result, events, sample_count, callback_errors = [], [], 0, []

    @CALLBACK
    def collect(_pcm, count, raw):
        nonlocal sample_count
        try:
            sample_count += max(0, count)
            index = 0
            while raw[index].type:
                e = raw[index]
                if e.type in (1, 7):
                    events.append({'type': 'word' if e.type == 1 else 'phoneme',
                                   'position': e.text_position - 1,
                                   'time': e.audio_position / 1000,
                                   'ipa': bytes(e.id.string).decode('utf-8') if e.type == 7 else ''})
                index += 1
            return 0
        except Exception as error:
            callback_errors.append(str(error))
            return 1

    lib.espeak_SetSynthCallback(collect)
    try:
        for segment in segments:
            voice = {'en': b'en-us', 'zh': b'cmn'}[segment['language']]
            if lib.espeak_SetVoiceByName(voice) != 0:
                raise RuntimeError('Local pronunciation voice is unavailable.')
            lib.espeak_SetParameter(1, 175, 0)  # Base WPM; the UI applies its existing pace.
            events, sample_count = [], 0
            encoded = segment['text'].encode('utf-8')
            # UTF-8 only: no SSML, embedded phoneme commands, or playback.
            code = lib.espeak_Synth(encoded, len(encoded) + 1, 0, 1, 0, 1, None, None)
            if code != 0 or callback_errors:
                raise RuntimeError('Phoneme extraction failed: ' + '; '.join(callback_errors))
            result.append({'events': events, 'duration': sample_count / rate})
    finally:
        lib.espeak_Terminate()
    return result


if __name__ == '__main__':
    try:
        print(json.dumps(synthesize(json.load(sys.stdin)), ensure_ascii=False))
    except Exception as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
