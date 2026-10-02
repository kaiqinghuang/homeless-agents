"""Shared audio conditioning for live inference and true audio-conditioned LoRA."""
import json
import os
from pathlib import Path
import types
os.environ.update(HF_HUB_OFFLINE='1', TRANSFORMERS_OFFLINE='1', HF_HUB_DISABLE_TELEMETRY='1')
ROOT = Path(__file__).resolve().parent
MODE = 'environment-en-v1'

def load_audio_model(system=None):
    import mlx.core as mx
    import mlx.nn as nn
    import numpy as np
    from transformers import WhisperFeatureExtractor
    from mlx_audio.stt.utils import load_model
    model_path = ROOT / 'models/qwen2-audio-7b-4bit'
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
    def encode_audio(_self, features):
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
        return x
    model.get_audio_features = types.MethodType(encode_audio, model)

    model.environment_system = system or (ROOT / 'agent_prompt.txt').read_text()
    def build_prompt(_self, lengths, user_prompt=None):
        context = json.loads(user_prompt or '{}')
        if context.get('response_language', 'en') != 'en':
            raise ValueError('Environment mode uses English only.')
        audio = '\n'.join(f'Audio {i}: <|audio_bos|>' + '<|AUDIO|>' * length + '<|audio_eos|>' for i, length in enumerate(lengths, 1))
        history = context.get('previous_generated_replies', [])[-4:]
        content = audio + '\nRespond to this sound environment.'
        if context.get('brief_observation') is True:
            content += '\nUse one very short English phrase, ideally 3 to 7 words. Finish within 14 tokens. No preamble, explanation, or ellipsis.'
        if history:
            content += '\nPrevious outputs (observations only): ' + json.dumps(history)
        messages = [{'role':'system','content':model.environment_system},{'role':'user','content':content}]
        return mx.array(tokenizer.encode(tokenizer.apply_chat_template(messages, tokenize=False, add_generation_prompt=True)))
    model._build_prompt = types.MethodType(build_prompt, model)
    return model

def add_lora(model, rank=4, scale=8.0, layers=4):
    from mlx_lm.tuner.lora import LoRALinear
    model.freeze()
    targets=[]
    for i in range(len(model.layers)-layers, len(model.layers)):
        for name in ('q_proj','v_proj'):
            attn=model.layers[i].self_attn
            setattr(attn,name,LoRALinear.from_base(getattr(attn,name),r=rank,scale=scale,dropout=0))
            targets.append(f'language_model.model.layers.{i}.self_attn.{name}')
    # New adapters train; their quantized base linear remains frozen.
    return targets

def load_adapter(model, directory):
    import hashlib
    directory=Path(directory).resolve()
    meta=json.loads((directory/'adapter.json').read_text())
    if meta['base_revision'] != json.loads((ROOT/'agent_config.json').read_text())['revision']:
        raise ValueError('Adapter was trained for a different base model.')
    if meta['prompt_sha256'] != hashlib.sha256(model.environment_system.encode()).hexdigest():
        raise ValueError('Adapter prompt does not match the active environment policy.')
    targets=add_lora(model,meta['rank'],meta['scale'],meta['layers'])
    if targets != meta['targets']: raise ValueError('Adapter targets do not match.')
    import mlx.core as mx
    from mlx.utils import tree_flatten
    weights=mx.load(str(directory/'adapters.safetensors'))
    expected=dict(tree_flatten(model.trainable_parameters()))
    if set(weights)!=set(expected) or any(weights[k].shape!=expected[k].shape for k in weights):
        raise ValueError('Invalid adapter weights.')
    model.load_weights(list(weights.items()),strict=False)
    mx.eval(model.parameters());model.eval()
    return meta
