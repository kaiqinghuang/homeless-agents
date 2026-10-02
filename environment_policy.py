"""Small, GPU-free response contract. No authored replacement words."""
import re

def normalize_response(text):
    text=text.strip()
    if re.fullmatch(r'\[\s*silence\s*\]',text,re.I):return dict(respond=False,salience=0.0,text='',reason='background')
    if not text or len(text)>200 or re.search(r'[\u3400-\u9fff]',text) or not re.search('[A-Za-z]',text):
        raise ValueError('Expected a short English environment response.')
    if text.startswith(('{','```')):raise ValueError('Expected plain words, not a data structure.')
    return dict(respond=True,salience=1.0,text=text,reason='ambient_change')
