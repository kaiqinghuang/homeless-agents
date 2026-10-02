"""Pronounce words normally; give otherwise silent symbols visible mouth cues."""
import math
import re
import secrets
import unicodedata
from mouth_plan import plan, METHOD

UNPRONOUNCEABLE = {'No pronunciation found for this text.',
                  'Use English letters or Chinese characters for this test.'}


def visual_spans(text):
    """Separate standalone symbols and embedded emoji without rewriting text."""
    marked = [False] * len(text)
    for m in re.finditer(r'\S+', text):
        if not any(c.isalnum() for c in m.group()):
            marked[m.start():m.end()] = [True] * len(m.group())
    for i, char in enumerate(text):
        if unicodedata.category(char) in ('So', 'Sk') or char in '\u200d\ufe0e\ufe0f\u20e3':
            marked[i] = True
            if char == '\u20e3':
                j = i - 1
                while j >= 0 and text[j] in '\ufe0e\ufe0f':
                    marked[j] = True
                    j -= 1
                if j >= 0:
                    marked[j] = True
    # Keep separating whitespace with the preceding span.
    for i, char in enumerate(text):
        if char.isspace() and i:
            marked[i] = marked[i - 1]
    start = 0
    for i in range(1, len(text)):
        if marked[i] != marked[start]:
            yield marked[start], start, text[start:i]
            start = i
    yield marked[start], start, text[start:]


def residue_plan(text, speed=1):
    if not isinstance(text, str) or not text.strip():
        raise ValueError('Enter a sentence first. 请先输入一句话。')
    text = text.strip()
    if len(text) > 1000:
        raise ValueError('Please keep this test under 1,000 characters.')
    if isinstance(speed, bool) or not isinstance(speed, (int, float)) or not math.isfinite(speed) or not .5 <= speed <= 2:
        raise ValueError('Speed must be between 0.5 and 2.')

    words, timeline, clock, languages = [], [], 0., set()
    previous_pose = None
    for visual, offset, part in visual_spans(text):
        if not visual:
            try:
                p = plan(part, speed)
            except ValueError as error:
                if str(error) not in UNPRONOUNCEABLE:
                    raise
                visual = True
        if visual:
            languages.add('SYMBOLS')
            for m in re.finditer(r'\S+\s*', part):
                pose = secrets.choice([s for s in 'BCDEFGH' if s != previous_pose])
                previous_pose = pose
                timeline.append({'shape': pose, 'word': len(words),
                                 'start': round(clock, 6), 'end': round(clock + .3 / speed, 6),
                                 'phoneme': '', 'visual': True})
                words.append({'text': m.group(), 'phonemes': [],
                              'start': offset + m.start(), 'end': offset + m.end()})
                clock += .3 / speed
        else:
            languages.add(p['language'])
            base = len(words)
            for cue in p['timeline']:
                timeline.append({**cue, 'start': round(clock + cue['start'], 6),
                                 'end': round(clock + cue['end'], 6),
                                 'word': base + cue['word'] if cue['word'] >= 0 else -1})
            left = len(part) - len(part.lstrip())
            for word in p['words']:
                words.append({**word, 'start': offset + left + word['start'],
                              'end': offset + left + word['end']})
            # plan() strips outer whitespace; restore it for exact captions.
            words[base]['text'] = part[:left] + words[base]['text']
            words[base]['start'] = offset
            words[-1]['text'] += part[len(part.rstrip()):]
            words[-1]['end'] = offset + len(part)
            clock += p['duration']
    return {'words': words, 'timeline': timeline, 'duration': round(clock, 6),
            'language': ' + '.join(sorted(languages)), 'method': METHOD,
            'engine': 'Local pronunciation + visual symbol poses'}
