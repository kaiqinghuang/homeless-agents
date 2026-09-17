"""Text -> local pronunciation events -> timed, approximate visual mouth poses."""
from bisect import bisect_right
from functools import lru_cache
import json
import math
from pathlib import Path
import re
import subprocess
import sys
import unicodedata

ROOT = Path(__file__).resolve().parent
METHOD = 'phonemes-v1'


def language_runs(text):
    """Keep whole phrases for pronunciation context; switch only between scripts."""
    runs, start, current = [], 0, None
    for index, char in enumerate(text):
        language = ('zh' if '\u3400' <= char <= '\u9fff' else
                    'en' if char.isalpha() and 'LATIN' in unicodedata.name(char, '') else None)
        if language and current and language != current:
            runs.append({'text': text[start:index], 'offset': start, 'language': current})
            start = index
        if language:
            current = language
    runs.append({'text': text[start:], 'offset': start, 'language': current or 'en'})
    return runs


def pose_sequence(ipa):
    """IPA articulation classes, not spelling. Split diphthongs into moving poses."""
    if not ipa:
        return ['X']
    base = ''.join(c for c in unicodedata.normalize('NFD', ipa)
                   if unicodedata.category(c) != 'Mn' and c not in 'ˈˌːˑ.[]|')
    # Aspirated/affricated consonants are single gestures, not separate H sounds.
    if base in ('ph', 'pʰ'):
        return ['A']
    if base in ('th', 'kh', 'tʰ', 'kʰ', 'ts', 'tsh', 'tɕ', 'tɕh', 'tʃ', 'dʒ', 'tʂ', 'tʂh'):
        return ['B']
    groups = [('A', 'mpb'), ('G', 'fv'), ('H', 'lɫ'),
              ('F', 'uʊwyɥʍʉʏ'), ('E', 'oɔɒœøɹɻɚɝr'),
              ('D', 'aɑæɐʌ'), ('C', 'eɛəɜɤ'), ('B', 'iɪɨɯᵻj')]
    poses = []
    for char in base:
        if char.isspace() or char.isdigit() or char in '˥˦˧˨˩':
            continue
        pose = next((shape for shape, symbols in groups if char in symbols), 'B')
        if not poses or poses[-1] != pose:
            poses.append(pose)
    return poses or ['B']


@lru_cache(maxsize=64)
def pronunciation(text):
    segments = language_runs(text)
    try:
        process = subprocess.run([sys.executable, str(ROOT / 'phoneme_engine.py')],
                                 input=json.dumps(segments, ensure_ascii=False), text=True,
                                 capture_output=True, timeout=20, cwd=ROOT)
    except subprocess.TimeoutExpired as error:
        raise ValueError('Local phoneme preparation timed out. Try a shorter sentence.') from error
    if process.returncode:
        raise ValueError(process.stderr.strip()[-500:] or 'Local phoneme engine failed.')
    return segments, json.loads(process.stdout)


def word_start(segment, position):
    # The engine expands numbers into several spoken words whose positions can
    # lie inside the same written number. Keep their highlight on that number.
    for token in re.finditer(r"[\w]+(?:['’.-][\w]+)*", segment, re.UNICODE):
        if token.start() <= position < token.end() and not re.search(r'[\u3400-\u9fff]', token[0]):
            return token.start()
    return position


def plan(text, speed=1.0):
    if not isinstance(text, str) or not text.strip():
        raise ValueError('Enter a sentence first. 请先输入一句话。')
    text = text.strip()
    if len(text) > 1000:
        raise ValueError('Please keep this test under 1,000 characters.')
    if isinstance(speed, bool) or not isinstance(speed, (int, float)) or not math.isfinite(speed) or not .5 <= speed <= 2:
        raise ValueError('Speed must be between 0.5 and 2.')
    if not any(c.isalnum() for c in text):
        raise ValueError('Use English letters or Chinese characters for this test.')
    segments, output = pronunciation(text)
    starts = set()
    for segment, result in zip(segments, output):
        for event in result['events']:
            if event['type'] == 'word' and 0 <= event['position'] < len(segment['text']):
                starts.add(segment['offset'] + word_start(segment['text'], event['position']))
    if not starts:
        raise ValueError('No pronunciation found for this text.')
    starts = sorted(starts)
    # Retain punctuation and spacing exactly. A Mandarin dictionary phrase may
    # have one word event for several characters; highlight the whole phrase.
    boundaries = [0] + starts[1:] + [len(text)]
    words = [{'text': text[a:b], 'phonemes': [], 'start': a, 'end': b}
             for a, b in zip(boundaries, boundaries[1:])]
    timeline, clock = [], 0.0

    def add(shape, duration, word=-1, ipa=''):
        nonlocal clock
        if duration <= 0:
            return
        end = clock + duration / speed
        timeline.append({'start': round(clock, 6), 'end': round(end, 6),
                         'shape': shape, 'word': word, 'phoneme': ipa})
        clock = end

    add('X', .12)
    for segment, result in zip(segments, output):
        phones = [e for e in result['events'] if e['type'] == 'phoneme']
        if not phones:
            add('X', result['duration'])
            continue
        add('X', phones[0]['time'])
        for index, event in enumerate(phones):
            end = phones[index + 1]['time'] if index + 1 < len(phones) else result['duration']
            duration = end - event['time']
            if duration <= 0:
                continue
            ipa = event['ipa']
            position = segment['offset'] + word_start(segment['text'], event['position'])
            word = max(0, bisect_right(starts, position) - 1) if ipa else -1
            poses = pose_sequence(ipa)
            if ipa:
                words[word]['phonemes'].append(ipa)
            for pose in poses:
                add(pose, duration / len(poses), word, ipa)
    add('X', .18)
    languages = {s['language'] for s in segments}
    return {'timeline': timeline, 'duration': round(clock, 6), 'words': words,
            'language': 'EN + 中文' if len(languages) > 1 else '中文' if 'zh' in languages else 'EN',
            'method': METHOD, 'engine': 'eSpeak NG 1.52.0 · en-US / Mandarin',
            'timing': 'Local synthesis phoneme events; PCM discarded, no playback.'}
