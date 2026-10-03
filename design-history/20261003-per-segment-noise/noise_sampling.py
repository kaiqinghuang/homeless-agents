"""Ephemeral acoustic sampling control; no model, recordings or training writes."""
import math
import time

BASE = {'temperature': 0.9, 'top_p': 0.95}

def validated_sampling(value):
    value = value or BASE
    result = {}
    for key, lo, hi in [('temperature', .75, 1.15), ('top_p', .88, .98)]:
        number = value.get(key, BASE[key])
        if isinstance(number, bool) or not isinstance(number, (int, float)) or not math.isfinite(number):
            raise ValueError('Invalid sampling parameter: ' + key)
        result[key] = round(max(lo, min(hi, number)), 4)
    return result

class NoiseSampling:
    def __init__(self):
        self.reset()

    def reset(self):
        self.values = dict(BASE)
        self.updated = None

    def update(self, rms_dbfs, change, now=None):
        if not math.isfinite(rms_dbfs) or not math.isfinite(change):
            return
        now = time.monotonic() if now is None else now
        dt = 1 if self.updated is None else max(0, min(2, now-self.updated))
        # About five seconds of smoothing. Calibrate these fixed dBFS anchors
        # against the gallery microphone gain; they are not physical SPL.
        alpha = 1-math.exp(-dt/5)
        level = max(0, min(1, (rms_dbfs+60)/40))
        target = {'temperature': .75+.4*level, 'top_p': .88+.10*max(0, min(1, change))}
        for key in target:
            self.values[key] += alpha*(target[key]-self.values[key])
        self.updated = now

    def snapshot(self, active=True, now=None):
        now = time.monotonic() if now is None else now
        live = active and self.updated is not None and now-self.updated <= 5
        return {**validated_sampling(self.values if live else BASE), 'source': 'noise' if live else 'default'}

class AcousticFeatures:
    """RMS plus spectral/amplitude changes across 100 ms frames at 16 kHz."""
    def __init__(self):
        self.previous_spectrum = None
        self.previous_db = None

    def measure(self, pcm):
        import numpy as np
        pcm = np.asarray(pcm, dtype=float)
        rms = float(np.sqrt(np.mean(pcm*pcm)))
        db = max(-120., 20*math.log10(max(rms, 1e-6)))
        changes = []
        for start in range(0, len(pcm)-1599, 1600):
            frame = pcm[start:start+1600]
            frame_db = max(-120., 20*math.log10(max(float(np.sqrt(np.mean(frame*frame))), 1e-6)))
            if frame_db < -65:
                self.previous_spectrum = None
                self.previous_db = None
                changes.append(0.)
                continue
            spectrum = np.abs(np.fft.rfft(frame*np.hanning(1600)))
            spectrum /= max(float(spectrum.sum()), 1e-12)
            if self.previous_spectrum is not None:
                flux = float(np.abs(spectrum-self.previous_spectrum).sum())/2
                amplitude = min(1., abs(frame_db-self.previous_db)/12)
                changes.append(min(1., 3*flux+amplitude))
            self.previous_spectrum, self.previous_db = spectrum, frame_db
        return {'rms_dbfs': db, 'change': float(np.mean(changes)) if changes else 0.}
