# Afterimage · Step 02

A local listening installation: microphone → environmental observations + bilingual speech recognition → optional silent echo through the supplied portrait.

## Run

On this Mac, double-click `Start.command`, then open **http://127.0.0.1:8766** in Safari or Chrome. Keep the terminal window open. Control-C stops the server.

Alternatively, run `python3 server.py` in this directory. Python 3.9+ and macOS are required. Speech dependencies have already been set up on this Mac. On another Mac, open `Setup.command` once (requires Git, CMake, and Xcode command-line tools). It downloads pinned whisper.cpp source, a 466 MiB multilingual Whisper small model, and Silero VAD. No pip packages are needed. Runtime speech recognition is entirely local; no audio is sent to cloud APIs. Mouth pronunciation uses a project-local eSpeak NG build. It extracts IPA phonemes, word boundaries, and synthesis timestamps; generated PCM is discarded in memory and never played or archived. For an existing installation, run `python3 setup_mouth.py` once, then restart `Start.command`. `Setup.command` now installs both mouth and listening dependencies.

## Try

1. Play the English example.
2. Select the Chinese example and play it.
3. Enter mixed text, such as `Hello，你还在这里吗？`.
4. Use **Inspect face** to examine the mouth.
5. Adjust movement strength. Pace applies to the next playback; changing it stops current playback.
6. Expand the mouth-shape inspector to hold an individual shape.

Command-Enter plays the current text. Stop smoothly returns the mouth to rest. Full screen shows the image alone.

## What this version does

- Converts whole English and Mandarin phrases to pronunciation phonemes with eSpeak NG, then maps those phonemes to the existing nine mouth poses. English uses the en-US pronunciation voice. Script changes select the voice for mixed-language text.
- Uses phoneme event timestamps from local synthesis, rather than equal time per letter. Diphthongs move through multiple poses (e.g. /eɪ/ → EH → EE). Punctuation pauses and all original caption text are preserved. Mandarin dictionary phrases can share one highlight across several characters.
- Exposes the generated IPA in **Inspect pronunciation / 检查发音** and on hover over the playback words. The playback label includes **PHONEMES**; an old server is rejected with a restart prompt instead of silently using spelling rules.
- Pronunciation is still imperfect for names, heteronyms such as past-tense “read,” and some Chinese polyphonic words. The nine visual poses are approximate; this is not a full facial articulator or alignment to incoming microphone audio. Numbers follow the pronunciation engine and the surrounding language, rather than being hard-coded English digits.
- Deforms the original lip texture locally using WebGL, with a procedural dark mouth interior. This tests motion and timing; it is not final photorealistic mouth artwork.
- Leaves the rest of the original image still. No AI-generated replacement images are used.

## Not connected yet

Generated replies, persistent model memory, and LoRA training are future steps. The face currently echoes recognized speech or manually entered text; it does not yet generate AI answers.

Planned reply policy: English speech → English reply; Mandarin speech → Mandarin reply; non-speech environment → English by default. Mixed-language utterances follow the predominant language, with a later manual override.

## 下一步

点击 Start listening 后授权麦克风，开始收音。英文保持英文、中文保持中文；Auto 对很短的语句可能判断不准，可以手动选择 English 或中文。当前脸部复述识别出的文字，并非 AI 回答。下一步接入本地语言模型的沉默／回应决策。

Files: `mouth_plan.py` creates the timeline via the isolated `phoneme_engine.py` worker; `server.py` serves the local API; `app.js` renders and plays it; `index.html` is the test interface; `assets/portrait.png` is an unchanged copy of the supplied image.
# homeless-agents

## Mouth guide overlay

Toggle **Guide points / 定位点** above the image to show black circular guides. It is off by default and works in the full image, face close-up, and fullscreen view. The guides show the fixed mouth center, moving corners and opening contour, plus four surrounding skin anchors initialized at the falloff scales. These use the renderer's shared manual calibration. They are not automatically detected facial landmarks; the surrounding anchors do not mark a hard boundary. The overlay does not alter mouth motion.

The overlay also includes four decorative points on each cheek; these follow the exact skin deformation every frame without driving it. All guide dots are rendered at 75% of the original diameter.

## Slider defaults and ranges

Both sliders start in the middle. Pace runs from **0.15× → 0.17× (current default) → 1.05×**. Mouth opening runs from **0 → 0.30× (default) → 0.90×**, with a separate linear scale on each half so the preferred value stays centered. The slower/smaller side extends below the previous minimum; the faster/larger side retains half of the previous range. Opening is clamped at zero rather than becoming negative. Pace scales the returned base timeline in the browser, so these changes require only a page refresh, not a server restart.

## Listening workflow

1. Wait until **Whisper small · Metal/CPU · 本地** is ready.
2. The microphone defaults to **Mac built-in**, selected by its device ID rather than the OS default (which can be an iPhone Continuity mic). You can choose an external USB microphone; your selection is remembered in this browser. A missing selected device prompts you to choose again, without silently falling back. Choose Auto, English, or Mandarin for recognition.
3. Click **Start listening** and grant the browser microphone permission. **Active input** shows the actual track's device name. If the browser hides device names before its first permission grant, set macOS **System Settings → Sound → Input → MacBook Microphone**, explicitly select **System default** in the page, and start once to grant access. Then stop and select **Mac built-in**. Noise suppression, echo cancellation, and auto gain are requested off to preserve ambient sound; actual hardware/browser support may vary.
4. Speak near the microphone, then pause for about a second. The activity gate sends candidate utterances (up to 10 seconds) to Silero VAD and Whisper. Audio is transcribed, never translated to English.
5. The checked **Echo recognized speech through the face** option tests the full path. It starts motion only when the face is idle; later transcripts are still saved if the face is busy. Uncheck it to collect sound without moving the mouth.
6. **Stop listening** stops microphone tracks, clears pending browser clips and aborts its request. A clip already accepted by the local server may finish processing and be archived. An unfinished current utterance is discarded.
7. **Test audio file** accepts a local 0.4–15-second audio file and sends it through the same local recognizer and echo path. This does not turn on the microphone. Test files are archived too.

The microphone is off initially and stops when the page closes. The image stays silent. This step is a local browser app, so the page must remain open and the computer awake while listening.

## Environment observations and daily archive

- Input level is digital **dBFS**, not a calibrated physical sound-pressure measurement.
- Lightweight room observations (level, peak and spectral centroid) are saved every 10 seconds.
- When there is no active candidate utterance, a 5-second background sample is submitted about every 20 seconds. Continuous sound activity is split into clips of about 10 seconds.
- VAD and recognition confidence checks separate accepted speech from environmental recordings; they reduce but cannot eliminate misrecognition. Noise is not assigned invented semantic labels.
- Queue size is bounded. If recognition falls behind, the page explicitly reports skipped clips. This is representative sampling plus utterance recording, **not lossless 24-hour audio recording**.
- Audio is stored as 16 kHz, mono, PCM16 WAV. Every event records local timestamp, language mode, source, sound features, model identifier and recognition result.
- `data/YYYY-MM-DD/` contains WAV clips and `events.jsonl`; `data/events.sqlite3` indexes the events. Model diagnostics are in `data/whisper.log`.
- Audio, models, compiled dependencies, and local data are excluded from Git. The web server serves only the app assets, not raw archive folders or model files.
- No training occurs yet. The archives are source material for a later, separately defined training-data pipeline.

## Speech runtime

The app starts a persistent `whisper-server` process on a loopback-only ephemeral port. It loads Whisper small once, uses Silero 6.2 VAD, and preserves the source language. It tries Metal first; if the Metal backend cannot allocate buffers, it retries on CPU and shows **CPU** in the page. The app and worker shut down when the terminal is stopped with Control-C.

Pinned source: [whisper.cpp v1.9.4](https://github.com/ggml-org/whisper.cpp/releases/tag/v1.9.4), revision `927cfce34f31707e17f2bff35c349632fb9e2c3a`. Model URLs and SHA-256 checksums are in `setup_audio.py`.

## Validation

Local synthesized English and Mandarin fixtures were recognized in their source languages. Four-second silence and seeded white noise yielded no accepted speech. Browser file-to-recognition-to-mouth playback was checked separately. Tests use a separate archive directory so these fixtures do not populate the exhibition archive. External microphone positioning and room sensitivity still need an on-site listening test.

The listening app uses port **8766**, so an older portrait-only preview still running on 8765 can remain open. Use the new URL above.

## Phoneme-driven mouth runtime

Pinned [eSpeak NG 1.52.0](https://github.com/espeak-ng/espeak-ng/tree/1.52.0), revision `4870adfa25b1a32b4361592f1be8a40337c58d6c`, lives under `vendor/espeak-ng`. Its upstream GPL license is retained there. `setup_mouth.py` builds a shared library and pronunciation dictionaries locally; audio-device playback, async synthesis, MBROLA, and sonic support are disabled. CMake may fetch its upstream-pinned sonic source during configuration even though it is not used. No Homebrew/system libraries are installed or modified.

Each uncached phrase is processed in a separate Python worker using the native synchronous-retrieval API, so simultaneous browser requests cannot mix voices or callbacks. Preparation is bounded by a 20-second timeout and 1,000-character input limit. The server caches up to 64 recent pronunciation results in memory. Missing dependencies cause an explicit error; there is no spelling-based fallback. The visual pace slider still scales both mouth cues and word highlights together.

Run `python3 -m unittest -v test_mouth_plan.py` for pronunciation, bilingual text preservation, event timing, concurrent requests, pace, and validation checks. Frontend playback checks are in `test_playback.cjs` and can be run with Node.js.
