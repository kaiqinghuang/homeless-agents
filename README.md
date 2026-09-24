# Afterimage · Step 04 — Direct audio

Microphone waveform → local Qwen2-Audio encoder and language model → respond/silence decision → phoneme-driven silent portrait. Incoming recordings are **not transcribed or captioned** before the decision. There is no training yet.

## Run

On this Mac, double-click `Start.command` in Finder, then open http://127.0.0.1:8766 in Safari or Chrome. Keep the terminal and page open and the Mac awake. Click **Start listening** to enable the microphone; **Stop listening** releases it and cancels pending playback. Control-C stops the server and its owned audio worker. Ollama is no longer required.

The direct-audio model is already downloaded into `models/qwen2-audio-7b-4bit/` (~6.56 GB). Dependencies are isolated in `.venv-audio/`. On another Apple Silicon Mac, install Python 3.10+, Git and the Xcode command-line tools, then run `Setup.command`. Setup needs internet; normal operation loads local assets only, with Hugging Face offline mode enabled. MLX requires a Metal-capable local session; if the page says GPU unavailable, launch from Finder/Terminal rather than a restricted agent session. No cloud inference or transcription fallback is used.

## Direct listening

- The audio model is **Qwen2-Audio-7B-Instruct**, a 4-bit MLX conversion, with the audio encoder and projector kept in bf16. It can receive speech, environmental sound and music. Although its audio encoder uses a Whisper architecture, no Whisper transcription decoder is run: numeric sound features are projected directly into the language model's embedding sequence.
- The same audio model first decides whether to respond, then generates a reply if appropriate. Both passes consume audio embeddings; no intermediate transcript or caption is created. Encoded audio is reused within the request. The worker normalizes JSON / literal-dictionary formatting without executing generated code.
- The worker uses the model's official WhisperFeatureExtractor (Slaney mel filters), the actual audio token length, and excludes padding from audio attention. It emits only the final response decision, not an intermediate transcript.
- **Language mode** has only **English** (default) and **中文 / Mandarin**. It fixes the listening instruction and reply language for audio and text tests; there is no Auto/Mix mode. The browser remembers the selection. Switching clears pending audio/replies and starts a fresh conversation context. Backend memory is also filtered by language. Both modes share one loaded audio model, with no extra model or inference pass. This is a fixed model instruction and output validation, not an acoustic filter that rejects all other languages.
- **Autonomous response** lets the model decide; **Collect only** records without model decisions or mouth playback. The old transcript echo option has been removed. The collapsed text test is still available for testing the decision policy, independently of audio.
- The built-in Mac microphone is selected by its exact device ID when its name is available. iPhone/Continuity inputs are excluded from that default. An external input can be selected and remembered. If names are hidden, choose an explicitly named device after granting browser access; the System default option may route to a phone.
- Noise suppression, echo cancellation and auto gain are requested off. Actual microphone/browser support varies.
- **Test audio file** accepts a local 0.4–15-second clip and passes its waveform through the same decision path. Files are recorded in the archive too.

## Response control

The functional prompt in `agent_prompt.txt` retains respond/silence, fixed-language replies and the JSON output contract. It has no artistic persona or poetic style. The default response threshold is 0.60 (hidden slider); edit `agent_config.json` and restart to change it. Model salience is a judgment, not a calibrated probability.

The quiet gate (< −65 dBFS), 12-second post-reply cooldown, 45-second periodic ambient decision interval, bounded latest-input queue, cancellation and face-busy protection remain. Ambient is a capture source, not an ASR classification. Active sounds are allowed through regardless of whether they contain speech. The frontend can capture/record while inference runs. Invalid model JSON and inference failures are shown as errors, never silently replaced with an invented reply or transcription pipeline.

Previous generated replies from the same session and prompt version may be supplied as text context. Previous transcripts and numeric sound descriptors are not sent to the audio model. Historical records remain on disk. Text tests do not enter live conversation memory. A saved generated reply is not proof that the mouth actually played it.

## Recording and archive

This version retains the existing **representative sampling** scheme: sound activity becomes clips of up to about 10 seconds; a 5-second background sample is captured about every 20 seconds while idle. It is not lossless continuous recording of every sound. Room level measurements are saved every 10 seconds but are not used as a substitute for audio model input.

Recordings are 16 kHz mono PCM16 WAV, saved under `data/YYYY-MM-DD/`, alongside `events.jsonl`; `data/events.sqlite3` indexes events. New nonquiet recordings have kind `audio`, empty text and `transcription: false`. Decisions record `input_representation: audio_embeddings`, model revision, prompt hash, result and duration. The response language field describes the reply, not an ASR-detected language. Very quiet clips use the existing silence gate.

Recordings, models and dependencies are ignored by Git and blocked from static HTTP access. Worker diagnostics are in `data/direct-audio.log`. Old Whisper/Ollama assets and archived events are retained, but neither engine is started by this application now. No daily LoRA or automatic parameter changes are included in this step.

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
- Exposes the generated IPA on hover over the playback words. The **Inspect pronunciation / 检查发音** panel is retained but hidden in the simplified interface. The playback label includes **PHONEMES**; an old server is rejected with a restart prompt instead of silently using spelling rules.
- Pronunciation is still imperfect for names, heteronyms such as past-tense “read,” and some Chinese polyphonic words. The nine visual poses are approximate; this is not a full facial articulator or alignment to incoming microphone audio. Numbers follow the pronunciation engine and the surrounding language, rather than being hard-coded English digits.
- Deforms the original lip texture locally using WebGL, with a procedural dark mouth interior. This tests motion and timing; it is not final photorealistic mouth artwork.
- Leaves the rest of the original image still. No AI-generated replacement images are used.

## Dependencies and verification

Model: `mlx-community/Qwen2-Audio-7B-Instruct-4bit`, revision `c65570002626f41b4dc08b7b54f42f99f3e82e7f`. Runtime dependencies and mlx-audio commit are pinned in `requirements-audio.txt`; setup is in `setup_direct_audio.py`. The official model card is https://huggingface.co/Qwen/Qwen2-Audio-7B-Instruct and the MLX implementation is https://github.com/Blaizzy/mlx-audio/tree/main/mlx_audio/stt/models/qwen2_audio.

Automated checks:

```sh
python3 -m unittest test_agent test_audio_decision test_direct_audio_http test_mouth_plan
node test_agent_ui.cjs
node test_language_switch.cjs
node test_playback.cjs
node test_faces.cjs
```

These cover waveform upload without an ASR engine, passing the archived WAV to inference (never its transcript), language policy, gates, errors, history isolation, cancellation, private file access and response-to-phoneme playback. Real GPU inference must also be tested from a normal local session.

### Local validation, 2026-09-17

The user-launched Metal worker was tested with synthesized English and Mandarin WAV files and synthetic white noise. English “What color is a ripe banana?” produced “Yellow”; a Mandarin greeting produced a Chinese reply; white noise produced a model-selected silent decision; zero audio used the quiet gate. The earlier automatic language mode sometimes answered Mandarin in English; it has now been removed in favor of fixed English and Mandarin modes. These are functional smoke tests, not an accuracy benchmark or a 24-hour soak test. Typical tested decisions took about 1.7–4 seconds after loading, excluding capture and mouth playback.

Fixed-mode regression: English → Mandarin → English audio produced “Yellow”, “2加3等于5”, and “Two plus three equals five” in the selected modes. White noise produced silence in each mode. These five local GPU checks took approximately 1.2–3.3 seconds per decision. Automated switching checks also reject late uploads and files still decoding under the previous mode.

### Portrait composition

The active image is the 4608 × 2592 multi-face composition from `0.4/9.22.1.jpg` (converted to PNG for the existing asset endpoint). Canvas and texture use the full native resolution; animation retains its 1184 × 666 calibration space so mouth movement and guide dots keep their previous apparent sizes. All 21 faces with visible mouths are animated together from the same phoneme timeline; the partial object cropped at the top has no visible mouth and remains static. Each face has a manually calibrated mouth center, width, tilt, curvature and local animation boundary. The guide toggle shows lip anchors and four cheek anchors on each side of every face; small faces use proportionally smaller dots. Inspect face keeps the existing central-face zoom. One full-resolution background pass is followed by scissored local face passes, limited to the local mouth regions; one guide array is reused per face to avoid oversized GPU uniform arrays. No additional AI model or inference calls are introduced. Existing pace, mouth amount and OO/OH shapes are retained. The earlier single-face image is backed up as `assets/portrait-original.png`. Reload the browser after replacing visual assets; no model restart is needed.


### Individual face image-pose libraries

The central, red-eye-shadow and lower-right brown faces switch directly between their own nine stills in `assets/central-visemes-v1`, `assets/red-eyes-visemes-v1` and `assets/brown-face-visemes-v1`, using the existing phoneme timeline (X rest, A pressed, B wide, C parted, D open, E OH, F OO, G folded lip, H skew). There is no temporal blending, interpolation, generated intermediate frame, or geometric mouth warp on these three faces. Each whole head (including eyes and forehead) comes from its own selected still. A fixed inset silhouette follows the crown, ears, cheeks and chin. Its 8px feather is clipped entirely inside the head, so the surrounding soil and cast shadow always come from the original portrait. Approximate guide anchors switch with each still. Rest and Stop show the original main image. All stills are preloaded as GPU textures before playback is enabled.

Pace still controls the shared timeline. The amplitude slider is labelled Other faces: the three image-driven faces retain their authored small amplitudes. The other eighteen faces keep their previous geometric motion, with tooth/tongue shading removed to match the toothless artwork direction. No audio/model behavior changes. Static serving explicitly allows only the twenty-seven PNG filenames; restart Start.command once after this update, then refresh.

Each face has its own asymmetric character. The central face stays tense and rigid; the red-eye-shadow face is vacant and fatigued, with a subtly heavier viewer-left eyelid and slack, off-center lips. Three red-eye-shadow poses were refined specifically for that direction. The brown face below the red-eye-shadow face has smaller mouth openings and a furtive, inward character: interrupted lip seams, local folds, tiny pinhole rounding and over-under displacement. Each pose pairs those with different subtle brow, eye and cheek tension instead of repeating or mirroring the same diagonal mouth pull. Future libraries should define their own character, rather than copying the same asymmetric expression onto every head.

Image passes discard pixels outside their individual head masks, so overlapping crop rectangles cannot overwrite a previously rendered face. The static ground and cast shadows always come from the main photograph.
