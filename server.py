#!/usr/bin/env python3
"""Offline mouth-motion prototype. Python 3.9+, macOS for Mandarin romanization."""
import argparse
import ctypes
import json
import re
import sys
import unicodedata
from functools import lru_cache
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent
CF = None
if sys.platform == 'darwin':
    CF = ctypes.CDLL('/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation')
    CF.CFStringCreateMutable.argtypes = [ctypes.c_void_p, ctypes.c_long]
    CF.CFStringCreateMutable.restype = ctypes.c_void_p
    CF.CFStringAppendCString.argtypes = [ctypes.c_void_p, ctypes.c_char_p, ctypes.c_uint32]
    CF.CFStringTransform.argtypes = [ctypes.c_void_p, ctypes.c_void_p, ctypes.c_void_p, ctypes.c_bool]
    CF.CFStringTransform.restype = ctypes.c_bool
    CF.CFStringCreateWithCString.argtypes = [ctypes.c_void_p, ctypes.c_char_p, ctypes.c_uint32]
    CF.CFStringCreateWithCString.restype = ctypes.c_void_p
    CF.CFStringGetCString.argtypes = [ctypes.c_void_p, ctypes.c_char_p, ctypes.c_long, ctypes.c_uint32]
    CF.CFStringGetCString.restype = ctypes.c_bool
    CF.CFRelease.argtypes = [ctypes.c_void_p]

@lru_cache(maxsize=1024)
def romanize(text):
    if not CF:
        raise ValueError('Mandarin romanization requires macOS in this prototype.')
    string = CF.CFStringCreateMutable(None, 0)
    transform = CF.CFStringCreateWithCString(None, b'Han-Latin', 0x08000100)
    try:
        CF.CFStringAppendCString(string, text.encode('utf-8'), 0x08000100)
        if not CF.CFStringTransform(string, None, transform, False):
            raise ValueError('Could not romanize Mandarin text.')
        buffer = ctypes.create_string_buffer(len(text.encode('utf-8')) * 16 + 128)
        if not CF.CFStringGetCString(string, buffer, len(buffer), 0x08000100):
            raise ValueError('Mandarin conversion exceeded its buffer.')
        return ''.join(c for c in unicodedata.normalize('NFD', buffer.value.decode())
                       if unicodedata.category(c) != 'Mn').lower()
    finally:
        CF.CFRelease(string)
        CF.CFRelease(transform)

# Approximate spelling-to-mouth rules, not a phonetic dictionary or speech synthesis.
EN_EXCEPTIONS = {
    'i': 'ai', 'eye': 'ai', 'you': 'yu', 'your': 'yor', 'are': 'ar',
    'the': 'dhuh', 'a': 'uh', 'one': 'wun', 'two': 'tu', 'to': 'tu',
    'of': 'uv', 'hear': 'heer', 'here': 'heer', 'there': 'dhair',
    'where': 'wair', 'some': 'sum', 'come': 'kum', 'does': 'duz',
    'have': 'hav', 'love': 'luv', 'move': 'muv', 'live': 'liv',
    'room': 'ruum', 'noise': 'noiz', 'quiet': 'kwaiet', 'silent': 'sailent',
    'after': 'after', 'again': 'ugen', 'hello': 'helo', 'world': 'werld',
    'wind': 'wind', 'through': 'thru', 'though': 'dho', 'thought': 'thot',
    'night': 'nait', 'light': 'lait', 'time': 'taim', 'my': 'mai',
}
SHAPES = {'X': (0, 1, 0), 'A': (.02, .94, 0), 'B': (.23, 1.02, .5),
          'C': (.55, 1.02, .2), 'D': (1, .96, .1), 'E': (.42, .78, .05),
          'F': (.30, .62, 0), 'G': (.15, 1, .7), 'H': (.4, .98, .25)}

def spelling_shapes(word, chinese=False):
    if not chinese:
        word = EN_EXCEPTIONS.get(word.lower(), word.lower())
        word = re.sub(r'e$', '', word) if len(word) > 3 else word
    units = re.findall(r'zh|ch|sh|th|dh|ng|ee|oo|ou|ai|ei|ao|[a-z]', word)
    out = []
    for unit in units:
        if unit in ('b', 'p', 'm'): shape = 'A'
        elif unit in ('f', 'v'): shape = 'G'
        elif unit in ('w', 'u', 'oo', 'ou'): shape = 'F'
        elif unit in ('o', 'r'): shape = 'E'
        elif unit in ('a', 'ao'): shape = 'D'
        elif unit in ('i', 'y', 'ee', 'ei'): shape = 'B'
        elif unit == 'ai':
            out.extend(['D', 'B'])
            continue
        elif unit == 'e': shape = 'C'
        elif unit == 'l': shape = 'H'
        else: shape = 'B'
        if not out or out[-1] != shape:
            out.append(shape)
    return out or ['B']

def plan(text, speed=1.0):
    text = text.strip()
    if not text: raise ValueError('Enter a sentence first. 请先输入一句话。')
    if len(text) > 1000: raise ValueError('Please keep this test under 1,000 characters.')
    if not isinstance(speed, (int, float)) or not .5 <= speed <= 2:
        raise ValueError('Speed must be between 0.5 and 2.')
    tokens = re.findall(r'[\u3400-\u9fff]+|[A-Za-z]+(?:\x27[A-Za-z]+)?|\d+|[^\w\s]', text)
    timeline, clock, words = [], 0.0, []
    def add(shape, duration, word_index):
        nonlocal clock
        duration /= speed
        timeline.append({'start': round(clock, 4), 'end': round(clock + duration, 4),
                         'shape': shape, 'word': word_index})
        clock += duration
    add('X', .12, -1)
    number_words = ['zero','one','two','three','four','five','six','seven','eight','nine']
    for token in tokens:
        if re.fullmatch(r'[\u3400-\u9fff]+', token):
            # Convert phrases together so the OS can disambiguate some polyphonic characters.
            syllables = romanize(token).split()
            groups = [(char, syllables[i] if i < len(syllables) else romanize(char), True)
                      for i, char in enumerate(token)]
        elif token.isdigit():
            groups = [(char, number_words[int(char)], False) for char in token]
        elif re.match(r'[A-Za-z]', token): groups = [(token, token, False)]
        else:
            add('X', .38 if token in '.!?。！？' else .19, len(words) - 1)
            continue
        for display, pronunciation, chinese in groups:
            index = len(words)
            words.append({'text': display, 'pronunciation': pronunciation})
            shapes = spelling_shapes(pronunciation, chinese)
            total = .27 if chinese else max(.22, min(.75, len(shapes) * .085))
            for shape in shapes: add(shape, total / len(shapes), index)
            add('X', .025, index)
    if not words: raise ValueError('Use English letters or Chinese characters for this test.')
    add('X', .3, -1)
    en = bool(re.search('[A-Za-z]', text))
    zh = bool(re.search('[\u3400-\u9fff]', text))
    return {'timeline': timeline, 'duration': round(clock, 4), 'words': words,
            'language': 'EN + 中文' if en and zh else '中文' if zh else 'EN',
            'method': 'Approximate text-to-mouth mapping; no audio generated.'}

class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs): super().__init__(*args, directory=str(ROOT), **kwargs)
    def do_POST(self):
        if self.path != '/api/plan':
            self.send_error(404)
            return
        try:
            size = int(self.headers.get('Content-Length', '0'))
            if not 0 < size <= 16000: raise ValueError('Invalid request size.')
            data = json.loads(self.rfile.read(size))
            result = plan(data['text'], data.get('speed', 1))
            status = 200
        except (ValueError, KeyError, TypeError) as error:
            result, status = {'error': str(error)}, 400
        payload = json.dumps(result, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(payload)))
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        self.wfile.write(payload)

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--port', type=int, default=8765)
    args = parser.parse_args()
    server = ThreadingHTTPServer(('127.0.0.1', args.port), Handler)
    print(f'Afterimage is ready: http://127.0.0.1:{server.server_port}', flush=True)
    try: server.serve_forever()
    except KeyboardInterrupt: server.server_close()
