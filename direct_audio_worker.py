"""Single-threaded, offline MLX audio inference. JSON lines on stdin/stdout."""
import contextlib
import math
from audio_decision import parse_object
import json
import os
import re
from pathlib import Path
import sys
import time
import types

# Model assets are provisioned by setup_direct_audio.py; inference never downloads.
os.environ.update(HF_HUB_OFFLINE='1', TRANSFORMERS_OFFLINE='1', HF_HUB_DISABLE_TELEMETRY='1')
protocol = sys.stdout

def emit(value):
    protocol.write(json.dumps(value, ensure_ascii=False, allow_nan=False) + '\n')
    protocol.flush()


def main():
    with contextlib.redirect_stdout(sys.stderr):
        import mlx.core as mx
        import mlx.nn as nn
        import numpy as np
        import soundfile as sf
        from transformers import WhisperFeatureExtractor
        from mlx_audio.stt.utils import load_model
        from mlx_audio.lm.generate import generate_step
        from mlx_audio.lm.sample_utils import make_sampler

        root = Path(__file__).resolve().parent
        model_path = root / 'models/qwen2-audio-7b-4bit'
        model = load_model(str(model_path), strict=True)
        extractor = WhisperFeatureExtractor.from_pretrained(str(model_path), local_files_only=True)
        tokenizer = model._processor.tokenizer
        # Match the pretrained model's Slaney mel filters and valid audio length.
        # The upstream convenience method uses a different mel bank and 750
        # placeholders even for short clips. No transcription is performed here.
        def extract_features(_self, audio):
            pcm = np.asarray(audio, dtype=np.float32).reshape(-1)
            features = extractor(pcm, sampling_rate=16000, return_attention_mask=True, return_tensors='np')
            length = int(features.attention_mask[0].sum())
            model._valid_audio_frames = (length - 1) // 2 + 1
            audio_tokens = ((length - 1) // 2 + 1 - 2) // 2 + 1
            return mx.array(features.input_features, dtype=model.audio_tower.conv1.weight.dtype), audio_tokens
        model._extract_features = types.MethodType(extract_features, model)
        encoded_audio = None
        def encode_audio(_self, features):
            nonlocal encoded_audio
            if encoded_audio is not None:
                return encoded_audio
            encoder = model.audio_tower
            x = nn.gelu(encoder.conv1(features.transpose(0, 2, 1)))
            x = nn.gelu(encoder.conv2(x))
            # Equivalent to masking padded keys for the valid prefix, but avoids
            # spending attention on the rest of the fixed 30-second padding.
            x = x[:, :model._valid_audio_frames, :]
            x = x + encoder.embed_positions[:x.shape[1]]
            for layer in encoder.layers:
                x = layer(x)
            b, length, dims = x.shape
            x = x[:, :length // 2 * 2, :].reshape(b, length // 2, 2, dims).mean(axis=2)
            x = model.multi_modal_projector(encoder.layer_norm(x))
            # Embedding weights can be packed integers in some quantizations,
            # whereas their output is float. Casting audio to the weight dtype destroys
            # signed acoustic embeddings. get_input_embeddings casts correctly
            # against the actual floating text-embedding output afterwards.
            encoded_audio = x
            return encoded_audio
        model.get_audio_features = types.MethodType(encode_audio, model)
        system_prompt = ''
        def build_prompt(_self, lengths, user_prompt=None):
            audio = '\n'.join(f'Audio {i}: <|audio_bos|>' + '<|AUDIO|>' * length + '<|audio_eos|>'
                              for i, length in enumerate(lengths, 1))
            try:
                settings = json.loads(user_prompt or '{}')
            except ValueError:
                # The response gate uses the same audio embeddings, without transcription.
                settings = {}
                messages = [{'role': 'user', 'content': audio + '\n' + user_prompt}]
                return mx.array(tokenizer.encode(tokenizer.apply_chat_template(messages, tokenize=False, add_generation_prompt=True)))
            language_rule = {'zh': '当前为中文模式。按普通话理解语音，text 字段只用中文回答，不要切换语言。用可直接朗读的中文句子回答；数字答案也用汉字写出，不要只输出数字或数学公式。', 'en': 'English mode. Interpret speech as English. Answer only in English in the text field. Never switch languages. Use speakable words for numbers, not bare mathematical notation.'}[settings['response_language']]
            messages = [{'role': 'system', 'content': system_prompt},
                        {'role': 'user', 'content': audio + '\n' + (user_prompt or '') + '\n' + language_rule + '\nDecide whether to respond to this recording. Steady noise, hiss, hum, and incidental background with no direct speech require silence, even if loud: {"respond":false,"salience":0.1,"text":"","reason":"background"}. A direct spoken question or greeting usually requires a brief answer with salience above 0.8. Return ONLY JSON with respond, salience, text, reason. Answer any question in the recording; do not transcribe it. reason must be exactly one of: addressed, question, ambient_change, background, unclear.'}]
            return mx.array(tokenizer.encode(tokenizer.apply_chat_template(messages, tokenize=False, add_generation_prompt=True)))
        model._build_prompt = types.MethodType(build_prompt, model)
        emit({'ready': True, 'backend': 'MLX · Metal'})
        for line in sys.stdin:
            try:
                request = json.loads(line)
                system_prompt = request['system']
                encoded_audio = None
                began = time.monotonic()
                if request.get('audio_path'):
                    pcm, rate = sf.read(request['audio_path'], dtype='float32')
                    if rate != 16000 or pcm.ndim != 1 or not 4000 <= len(pcm) <= 240000:
                        raise ValueError('Expected a mono 16 kHz recording of 0.25–15 seconds.')
                    context = json.loads(request['prompt'])
                    if context.get('response_language') not in ('en', 'zh'):
                        raise ValueError('Select English or Mandarin mode.')
                    original_system = system_prompt
                    system_prompt = 'You decide whether a microphone recording calls for a response. Do not answer or transcribe speech. Follow the requested output format.'
                    gate_prompt = 'Listen to the audio. Should an interactive face respond? Direct speech addressed to it, questions and greetings: yes. Only steady noise, hum, hiss, silence, music or incidental background: no. A distinct significant non-speech event can merit a response. Return only JSON with respond (boolean), salience (0 to 1), reason (addressed, question, ambient_change, background, or unclear). No text reply. Do not identify or choose a response language.'
                    gate_prompt += ' Selected listening language: ' + {'en': 'English.', 'zh': 'Mandarin Chinese.'}[context['response_language']]
                    gate_output = model.generate(pcm, prompt=gate_prompt, max_tokens=100, temperature=0).text.strip()
                    if gate_output.startswith('```') and gate_output.endswith('```'):
                        gate_output = re.sub(r'^```(?:json)?\s*', '', gate_output)[:-3].strip()
                    print('Audio decision:', gate_output, file=sys.stderr, flush=True)
                    gate = parse_object(gate_output)
                    if type(gate.get('respond')) is not bool or type(gate.get('salience')) not in (float, int) or not math.isfinite(gate['salience']) or not 0 <= gate['salience'] <= 1:
                        raise ValueError('Invalid audio response decision.')
                    if not gate['respond']:
                        emit({'text': json.dumps({'respond': False, 'salience': gate['salience'], 'text': '', 'reason': 'background'}),
                              'tokens': 0, 'seconds': round(time.monotonic() - began, 2), 'truncated': False})
                        encoded_audio = None
                        mx.clear_cache()
                        continue
                    system_prompt = original_system.replace('"Your brief reply"', '""')
                    output = model.generate(pcm, prompt=json.dumps(context, ensure_ascii=False), max_tokens=request['max_tokens'],
                                            temperature=request['temperature'], prefill_step_size=256)
                    text, tokens = output.text, output.generation_tokens
                else:
                    messages = [{'role': 'system', 'content': system_prompt},
                                {'role': 'user', 'content': request['prompt']}]
                    ids = mx.array(tokenizer.encode(tokenizer.apply_chat_template(messages, tokenize=False, add_generation_prompt=True)))
                    generated = []
                    for token, _ in generate_step(prompt=ids, model=model, max_tokens=request['max_tokens'],
                                                  sampler=make_sampler(request['temperature']), prefill_step_size=256):
                        if token == tokenizer.eos_token_id:
                            break
                        generated.append(token)
                    text, tokens = tokenizer.decode(generated, skip_special_tokens=True), len(generated)
                # Reason is diagnostic only. Normalize a descriptive label without
                # changing the model's respond flag, salience or spoken words.
                raw = text.strip()
                if raw.startswith('```') and raw.endswith('```'):
                    raw = re.sub(r'^```(?:json)?\s*', '', raw)[:-3].strip()
                try:
                    decision = parse_object(raw)
                    reason = decision.get('reason')
                    if reason is None:
                        decision['reason'] = 'unclear'
                    if isinstance(reason, str) and reason not in ('addressed', 'question', 'ambient_change', 'background', 'unclear'):
                        decision['reason'] = 'question' if 'question' in reason.lower() else 'unclear'
                    text = json.dumps(decision, ensure_ascii=False)
                except (ValueError, AttributeError):
                    print('Invalid model format:', repr(text[:2000]), file=sys.stderr, flush=True)
                emit({'text': text, 'tokens': tokens, 'seconds': round(time.monotonic() - began, 2),
                      'truncated': tokens >= request['max_tokens']})
                encoded_audio = None
                mx.clear_cache()
            except Exception as error:
                emit({'error': str(error)})

if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        emit({'error': str(error)})
        sys.exit(1)
