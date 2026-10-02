"""Detect sustained literal loops, allowing brief artistic repetitions."""
import re


class LoopGuard:
    def __init__(self):
        self.recent = ''
        self.blank_chunks = 0

    def repeating(self, text):
        # Whitespace variations such as ')!\n)! )!' are still the same loop.
        compact = re.sub(r'\s+', '', (self.recent + text)[-2048:])[-512:]
        return any(len(m.group()) >= 12
                   for m in re.finditer(r'(.{1,80}?)\1{5,}', compact))

    def accept(self, text):
        self.blank_chunks = 0 if text.strip() else self.blank_chunks + 1
        reason = ('repeated-text' if self.repeating(text) else
                  'empty-output' if self.blank_chunks >= 4 else None)
        if reason:
            self.recent = ''
            self.blank_chunks = 0
        else:
            self.recent = (self.recent + text)[-2048:]
        return reason
