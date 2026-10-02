"""Bounded-context continuous text generation; no microphone or chat prompt."""
import contextlib,hashlib,json,os,re,secrets,sys
from pathlib import Path
from residue_loop import LoopGuard
ROOT=Path(__file__).resolve().parent
protocol=sys.stdout
def emit(value):
 protocol.write(json.dumps(value,ensure_ascii=False)+'\n');protocol.flush()
def chunk_complete(text, count, cfg):
 # Prefer a sentence boundary after the minimum; allow a word/line boundary
 # after the soft target, so fragmentary residue need not form proper prose.
 if not text or text.endswith('\ufffd') or count < cfg['chunk_min_tokens']:return False
 if re.search(r"[.!?。！？][\"'”’）)\]]*\s*$", text):return True
 return count >= cfg.get('chunk_soft_tokens', cfg['chunk_min_tokens']) and bool(re.search(r'\s$', text))
def main():
 with contextlib.redirect_stdout(sys.stderr):
  import mlx.core as mx
  from mlx_lm import load
  from mlx_lm.generate import generate_step
  from mlx_lm.sample_utils import make_sampler,make_logits_processors
  cfg=json.loads((ROOT/'residue_config.json').read_text());ap=ROOT/cfg['adapter_path']
  if hashlib.sha256((ap/'adapters.safetensors').read_bytes()).hexdigest()!=cfg['adapter_sha256']:raise ValueError('Selected LoRA checksum changed.')
  model,tok=load(str(ROOT/cfg['model_path']),adapter_path=str(ap),tokenizer_config={'trust_remote_code':False});model.eval()
  sampler=make_sampler(temp=cfg['temperature'],top_p=cfg['top_p'])
  # An installation continues until stopped. Exclude model end/control tokens,
  # without adding style instructions or synthetic sentences to its context.
  processors=make_logits_processors(logit_bias={i:-1e9 for i in tok.all_special_ids})
  context=[];session=None;sequence=0;pending=[];guard=LoopGuard()
  emit({'ready':True,'model':cfg['model'],'adapter_sha256':cfg['adapter_sha256']})
  for line in sys.stdin:
   try:
    req=json.loads(line)
    if req['op']=='start':
     session=req['session'];sequence=0;pending=[];guard=LoopGuard();seed=secrets.randbits(32);mx.random.seed(seed)
     context=tok.encode(cfg['prefix'],add_special_tokens=False)
     emit({'session':session,'seed':seed,'prefix':cfg['prefix']});continue
    if req['session']!=session:raise ValueError('Generation session expired.')
    ids=[];text=''
    for token,_ in generate_step(mx.array(context[-cfg['context_tokens']:]),model,max_tokens=cfg['chunk_max_tokens'],sampler=sampler,logits_processors=processors):
     ids.append(int(token));text=tok.decode(pending+ids,skip_special_tokens=True)
     if not text.endswith('\ufffd') and guard.repeating(text):break
     if chunk_complete(text,len(ids),cfg):break
    context=(context+ids)[-cfg['context_tokens']:]
    pending+=ids
    # Preserve an incomplete UTF-8 character for the next chunk rather than
    # introducing a replacement glyph at an arbitrary generation boundary.
    if text.endswith('\ufffd') and len(pending)<256:text=''
    else:pending=[]
    recovery=guard.accept(text)
    if recovery:
     # Keep brief repetitions visible, but stop feeding a loop back into itself.
     context=tok.encode(cfg['prefix'],add_special_tokens=False);pending=[]
    sequence+=1
    emit({'session':session,'sequence':sequence,'text':text,'tokens':len(ids),'context_tokens':len(context),'recovery':recovery})
    mx.clear_cache()
   except Exception as e:emit({'error':str(e)})
if __name__=='__main__':
 try:main()
 except Exception as e:emit({'error':str(e)});sys.exit(1)
