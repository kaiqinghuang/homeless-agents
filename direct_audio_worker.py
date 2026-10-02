"""Offline English environment responses; waveform -> embeddings -> words."""
import contextlib
import hashlib
import json
import sys
import time
from pathlib import Path
from environment_model import ROOT, MODE, load_audio_model, load_adapter
protocol=sys.stdout

def emit(value):
    protocol.write(json.dumps(value,ensure_ascii=False,allow_nan=False)+'\n');protocol.flush()

def main():
    with contextlib.redirect_stdout(sys.stderr):
        import mlx.core as mx
        import soundfile as sf
        from mlx_audio.lm.generate import generate_step
        from mlx_audio.lm.sample_utils import make_sampler
        from environment_policy import normalize_response
        model=load_audio_model()
        config=json.loads((ROOT/'agent_config.json').read_text())
        adapter=config.get('adapter_path')
        digest=config['revision']
        if adapter:
            path=(ROOT/adapter).resolve()
            if not path.is_relative_to((ROOT/'training').resolve()): raise ValueError('Adapter must be inside training/.')
            load_adapter(model,path)
            digest+=':'+hashlib.sha256((path/'adapters.safetensors').read_bytes()).hexdigest()[:16]
        emit({'ready':True,'backend':'MLX · Metal','mode':MODE,'digest':digest,'adapter':adapter})
        for line in sys.stdin:
            try:
                request=json.loads(line);began=time.monotonic()
                context=json.loads(request['prompt'])
                if context.get('response_language')!='en': raise ValueError('Environment mode uses English only.')
                if request.get('audio_path'):
                    pcm,rate=sf.read(request['audio_path'],dtype='float32')
                    if rate!=16000 or pcm.ndim!=1 or not 4000<=len(pcm)<=240000:raise ValueError('Expected mono 16 kHz audio, 0.25–15 seconds.')
                    output=model.generate(pcm,prompt=request['prompt'],max_tokens=request['max_tokens'],temperature=request['temperature'],prefill_step_size=256)
                    text,tokens=output.text,output.generation_tokens
                else:
                    # Diagnostic text path only; microphone input never becomes a transcript.
                    tok=model._processor.tokenizer
                    messages=[{'role':'system','content':model.environment_system},{'role':'user','content':context.get('test_message','')}]
                    ids=mx.array(tok.encode(tok.apply_chat_template(messages,tokenize=False,add_generation_prompt=True)))
                    generated=[]
                    for token,_ in generate_step(prompt=ids,model=model,max_tokens=request['max_tokens'],sampler=make_sampler(request['temperature']),prefill_step_size=256):
                        if token==tok.eos_token_id:break
                        generated.append(token)
                    text,tokens=tok.decode(generated,skip_special_tokens=True),len(generated)
                decision=normalize_response(text)
                emit({'text':json.dumps(decision),'raw_response':text,'tokens':tokens,'seconds':round(time.monotonic()-began,2),'truncated':tokens>=request['max_tokens'],'digest':digest,'adapter':adapter})
                mx.clear_cache()
            except Exception as error:emit({'error':str(error)})
if __name__=='__main__':
    try:main()
    except Exception as error:emit({'error':str(error)});sys.exit(1)
