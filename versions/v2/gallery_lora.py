"""Reproducible waveform-conditioned self-training, with source-separated evaluation.
Run with .venv-audio/bin/python gallery_lora.py --phase seed|train|compare|all.
No ASR, human targets, synthetic replacement replies, or downloads at model runtime.
"""
import argparse
import hashlib
import json
from pathlib import Path
import random
import time
import numpy as np
import soundfile as sf
import mlx.core as mx
import mlx.nn as nn
import mlx.optimizers as optim
from mlx.utils import tree_flatten
from mlx_audio.lm.models.base import create_attention_mask
from environment_model import ROOT, load_audio_model, add_lora, load_adapter
from environment_policy import normalize_response

RUN=ROOT/'training/gallery-seed-20260929'
CONTEXT={'response_language':'en','previous_generated_replies':[]}
RANK,SCALE,LAYERS=4,8.0,4

def dump(path,value):
    path=Path(path);path.parent.mkdir(parents=True,exist_ok=True)
    tmp=path.with_suffix(path.suffix+'.tmp');tmp.write_text(json.dumps(value,ensure_ascii=False,indent=2)+'\n');tmp.replace(path)

def log(**values):print(json.dumps(values,ensure_ascii=False),flush=True)

def pcm(row):
    a,sr=sf.read(RUN/row['audio'],dtype='float32');assert sr==16000 and a.ndim==1;return a

def response(model,row,temp,seed):
    mx.random.seed(seed)
    a=np.zeros(128000,dtype=np.float32) if row.get('control')=='silence' else pcm(row)
    t=time.monotonic();o=model.generate(a,prompt=json.dumps(CONTEXT),max_tokens=48,temperature=temp,prefill_step_size=256)
    result={'raw':o.text,'tokens':o.generation_tokens,'seconds':round(time.monotonic()-t,3),'seed':seed,'temperature':temp}
    try:
        d=normalize_response(o.text)
        if o.generation_tokens>=48:raise ValueError('truncated')
        result.update(valid=True,text=d['text'],respond=d['respond'])
    except ValueError as e:result.update(valid=False,error=str(e))
    return result

def seed(model,clips):
    path=RUN/'pairs.json';existing=json.loads(path.read_text()) if path.exists() else []
    done={r['id'] for r in existing}
    prompt_hash=hashlib.sha256(model.environment_system.encode()).hexdigest()
    for i,row in enumerate(clips):
        if row['split']=='test' or row['id'] in done:continue
        out=response(model,row,.8,20260929+i)
        record={**row,'generation':out,'target':out.get('text',''),'context':CONTEXT,'prompt_sha256':prompt_hash,'base_revision':json.loads((ROOT/'agent_config.json').read_text())['revision'],'audio_sha256':hashlib.sha256((RUN/row['audio']).read_bytes()).hexdigest(),'eligible':out.get('valid',False) and out.get('respond',False),'label_source':'base-model self-generated response'}
        existing.append(record);dump(path,existing)
        log(phase='seed',id=row['id'],split=row['split'],**out);mx.clear_cache()
    dump(RUN/'prompt.json',{'system':model.environment_system,'context':CONTEXT,'sha256':prompt_hash})

def evaluation(model,clips,label):
    path=RUN/(label+'.json');results=[]
    rows=[r for r in clips if r['split']=='test']+[dict(id='digital-silence',control='silence',split='control')]
    for i,row in enumerate(rows):
        for temp in (0.0,.8):
            out=response(model,row,temp,7900+i)
            results.append({'id':row['id'],'audio':row.get('audio'),'source_id':row.get('source_id'),'split':row['split'],**out})
            dump(path,results);log(phase=label,id=row['id'],**out);mx.clear_cache()
    return results

def cache_sample(model,row):
    path=RUN/'features'/(row['id']+'.npz');path.parent.mkdir(exist_ok=True)
    signature=hashlib.sha256((row['audio_sha256']+row['target']+row['prompt_sha256']+row['base_revision']+str(LAYERS)).encode()).hexdigest()
    if path.exists():
        with np.load(path) as saved:
            if 'signature' in saved and str(saved['signature'])==signature:
                return {'h':mx.array(saved['h']).astype(mx.bfloat16),'target':mx.array(saved['target']),'start':int(saved['start'])}
    ids,emb,prompt_len=model.get_input_embeddings(pcm(row),json.dumps(CONTEXT))
    assert int(mx.sum(ids==model.audio_token_id))>0,'audio must be present during training'
    tok=model._processor.tokenizer
    target=mx.array(tok.encode(row['target'],add_special_tokens=False)+[tok.eos_token_id])
    text_emb=model.language_model.model.embed_tokens(target[None,:-1])
    h=mx.concatenate([emb,text_emb],axis=1)
    mask=create_attention_mask(h,None)
    for layer in model.layers[:-LAYERS]:h=layer(h,mask,cache=None)
    h=mx.stop_gradient(h);mx.eval(h,target)
    np.savez(path,h=np.array(h.astype(mx.float32)),target=np.array(target),start=prompt_len-1,signature=signature)
    mx.clear_cache()
    return {'h':h,'target':target,'start':prompt_len-1}

def sample_loss(model,sample):
    h=sample['h'];mask=create_attention_mask(h,None)
    for layer in model.layers[-LAYERS:]:h=layer(h,mask,cache=None)
    h=model.language_model.model.norm(h[:,sample['start']:,:])
    logits=model.language_model.lm_head(h) if not model.language_model.args.tie_word_embeddings else model.language_model.model.embed_tokens.as_linear(h)
    assert logits.shape[1]==sample['target'].shape[0]
    return nn.losses.cross_entropy(logits.astype(mx.float32),sample['target'][None],reduction='mean')

def train(model,steps,parent=None,selection='validation'):
    if (RUN/'adapter/adapter.json').exists():
        raise FileExistsError('This run already has a trained adapter. Use a fresh --run-dir for another experiment; use --phase compare to inspect this one.')
    pairs=[r for r in json.loads((RUN/'pairs.json').read_text()) if r['eligible']]
    assert all(r['prompt_sha256']==hashlib.sha256(model.environment_system.encode()).hexdigest() for r in pairs)
    cache={}
    for row in pairs:
        cache[row['id']]=cache_sample(model,row);log(phase='features',id=row['id'])
    trainrows=[r for r in pairs if r['split']=='train'];valrows=[r for r in pairs if r['split']=='validation']
    assert len(trainrows)>=8 and valrows,'not enough usable training/validation pairs'
    # Check full-model loss against frozen-prefix loss before training.
    row=trainrows[0];ids,emb,p=model.get_input_embeddings(pcm(row),json.dumps(CONTEXT));target=cache[row['id']]['target']
    e=mx.concatenate([emb,model.language_model.model.embed_tokens(target[None,:-1])],axis=1)
    logits=model(mx.zeros((1,e.shape[1]),dtype=mx.int32),input_embeddings=e)[:,p-1:,:]
    full=float(nn.losses.cross_entropy(logits.astype(mx.float32),target[None],reduction='mean'))
    prefix=float(sample_loss(model,cache[row['id']]))
    assert abs(full-prefix)<.03,(full,prefix)
    del logits,e,emb;mx.clear_cache()
    mx.random.seed(42)
    # A continuation already has the parent's adapters installed. Wrapping them
    # again would train nested adapters rather than continue the saved weights.
    targets=parent['targets'] if parent else add_lora(model,RANK,SCALE,LAYERS)
    weights=dict(tree_flatten(model.trainable_parameters()))
    assert weights and all(k.endswith(('.lora_a','.lora_b')) for k in weights),list(weights)
    count=sum(v.size for v in weights.values());log(phase='trainable',parameters=count,full_loss=full,cached_loss=prefix)
    optimizer=optim.Adam(learning_rate=5e-5)
    loss_grad=nn.value_and_grad(model,sample_loss)
    def validation():
        model.eval();losses=[float(sample_loss(model,cache[r['id']])) for r in valrows];model.train();mx.clear_cache();return sum(losses)/len(losses)
    before=validation();best=before;best_step=0;out=RUN/'adapter';out.mkdir(exist_ok=True);history=[]
    initial={k:mx.array(v) for k,v in weights.items()};mx.eval(initial)
    # Keep the starting checkpoint so regressions cannot be silently promoted.
    mx.save_safetensors(str(out/'adapters.safetensors'),weights)
    ordering=list(trainrows);rng=random.Random(42);rng.shuffle(ordering)
    start=time.monotonic()
    for step in range(1,steps+1):
        if (step-1)%len(ordering)==0:rng.shuffle(ordering)
        row=ordering[(step-1)%len(ordering)];loss,grads=loss_grad(model,cache[row['id']]);grads,norm=optim.clip_grad_norm(grads,1.0)
        if not bool(mx.isfinite(loss)) or not bool(mx.isfinite(norm)):raise ValueError('Nonfinite loss/gradient; no adapter activation.')
        optimizer.update(model,grads);mx.eval(model.trainable_parameters(),optimizer.state,loss)
        item={'step':step,'loss':float(loss),'gradient_norm':float(norm),'elapsed':round(time.monotonic()-start,2),'peak_gb':round(mx.get_peak_memory()/1e9,3)}
        if step%10==0 or step==steps:
            item['validation_loss']=validation()
            if item['validation_loss']<best:
                best=item['validation_loss'];best_step=step
                mx.save_safetensors(str(out/'adapters.safetensors'),dict(tree_flatten(model.trainable_parameters())))
        history.append(item);dump(RUN/'training-log.json',history);log(phase='train',**item);mx.clear_cache()
    if selection=='final':
        # Artistic drift is not measured by self-target validation loss. Keep
        # an explicitly requested late checkpoint for inspection, with its
        # actual validation loss recorded rather than claiming improvement.
        best=history[-1]['validation_loss'];best_step=steps
        mx.save_safetensors(str(out/'adapters.safetensors'),dict(tree_flatten(model.trainable_parameters())))
    saved=mx.load(str(out/'adapters.safetensors'))
    delta=sum(float(mx.sum((saved[k]-initial[k])**2)) for k in saved)
    meta={'format':'afterimage-audio-lora-v1','base_revision':json.loads((ROOT/'agent_config.json').read_text())['revision'],'prompt_sha256':hashlib.sha256(model.environment_system.encode()).hexdigest(),'rank':RANK,'scale':SCALE,'layers':LAYERS,'targets':targets,'trainable_parameters':count,'train_samples':len(trainrows),'validation_samples':len(valrows),'steps':steps,'selected_step':best_step,'validation_before':before,'validation_after':best,'weight_delta_squared':delta,'audio_conditioned':True,'label_source':'model self-generated','test_sources_seen_in_training':False}
    meta['selection_criterion']=selection
    if parent:
        meta.update(parent_adapter=parent['path'],parent_sha256=parent['sha256'],
                    optimizer_restarted=True,improved_over_parent=best<before and delta>0)
    dump(out/'adapter.json',meta)
    if not parent:
        assert best_step>0 and delta>0,'No improving nonzero adapter; not suitable for activation.'
    model.load_weights(list(saved.items()),strict=False);model.eval();log(phase='trained',**meta)

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--phase',choices=['all','seed','train','compare'],default='all');parser.add_argument('--steps',type=int,default=60);parser.add_argument('--run-dir',type=Path,default=RUN)
    parser.add_argument('--init-adapter',type=Path,help='Continue a saved adapter; optimizer state starts fresh. Training phase only.')
    parser.add_argument('--checkpoint-selection',choices=['validation','final'],default='validation',help='Final keeps all requested updates for an explicit drift experiment, even if validation loss worsens.')
    args=parser.parse_args()
    if args.steps<1:parser.error('--steps must be positive')
    if args.init_adapter and args.phase!='train':parser.error('--init-adapter requires --phase train')
    RUN=args.run_dir.resolve()
    if not RUN.is_relative_to((ROOT/'training').resolve()):raise ValueError('Experiment directory must be inside training/.')
    clips=json.loads((RUN/'clips.json').read_text());model=load_audio_model();model.eval()
    parent=None
    if args.init_adapter:
        directory=args.init_adapter.resolve()
        if not directory.is_relative_to((ROOT/'training').resolve()):raise ValueError('Parent adapter must be inside training/.')
        if directory==(RUN/'adapter').resolve():raise ValueError('Use a fresh run directory for continuation.')
        parent=load_adapter(model,directory)
        parent={**parent,'path':str(directory.relative_to(ROOT)),
                'sha256':hashlib.sha256((directory/'adapters.safetensors').read_bytes()).hexdigest()}
        RANK,SCALE,LAYERS=parent['rank'],parent['scale'],parent['layers']
        evaluation(model,clips,'before')
    if args.phase in ('all','seed'):
        seed(model,clips)
        evaluation(model,clips,'before')
    if args.phase in ('all','train'):train(model,args.steps,parent,args.checkpoint_selection)
    if args.phase=='compare':load_adapter(model,RUN/'adapter')
    if args.phase in ('all','train','compare'):evaluation(model,clips,'after')
    log(phase='complete')
