"""Parse structured local-model output without executing model-generated code."""
import ast
import json
import re


def parse_object(text):
    raw = text.strip()
    if raw.startswith('```') and raw.endswith('```'):
        raw = re.sub(r'^```(?:json|python)?\s*', '', raw)[:-3].strip()
    if raw.startswith('{\\"'):
        raw = raw.replace('\\"', '"')
    try:
        value = json.loads(raw)
    except json.JSONDecodeError:
        # Some audio checkpoints emit single-quoted Python dictionaries.
        # literal_eval accepts data literals only, never calls or expressions.
        value = ast.literal_eval(raw)
    if not isinstance(value, dict):
        raise ValueError('The audio model must return a decision object.')
    return value
