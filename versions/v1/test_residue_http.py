"""Integration smoke test against a running local server; uses real LoRA inference."""
import json,urllib.request,urllib.error
from residue_plan import residue_plan
BASE='http://127.0.0.1:8766'
def post(route,payload):
 req=urllib.request.Request(BASE+route,data=json.dumps(payload).encode(),headers={'Content-Type':'application/json'})
 with urllib.request.urlopen(req,timeout=90) as r:return json.load(r)
def main():
 info=json.load(urllib.request.urlopen(BASE+'/api/residue/status'));assert info['mode']=='continuous-text'
 session=post('/api/residue/start',{})['session'];rows=[]
 try:
  for i in range(6):
   r=post('/api/residue/next',{'session':session});rows.append(r)
   assert r['session']==session and r['sequence']==i+1 and r['context_tokens']<=2048
   if i and not r.get('recovery'):assert r['context_tokens']==min(2048,rows[-2]['context_tokens']+r['tokens'])
   if r['text'].strip():
    p=post('/api/plan',{'text':r['text'],'mode':'residue','speed':1});assert p['duration']>0 and p['timeline']
    assert ''.join(w['text'] for w in p['words'])==r['text'].strip()
  post('/api/residue/stop',{'session':session})
  try:post('/api/residue/next',{'session':session});raise AssertionError('Stopped session still generates')
  except urllib.error.HTTPError as e:assert e.code==400
  newer=post('/api/residue/start',{})['session'];assert newer!=session
  post('/api/residue/stop',{'session':session})
  assert post('/api/residue/next',{'session':newer})['sequence']==1
  post('/api/residue/stop',{'session':newer})
 finally:post('/api/residue/stop',{'session':session})
 for text in ['!!! /// 🙂','C0:\nR0000:\n17 replies','ภาษาไทย 中文!?','https://example.com/%d1%87']:
  p=residue_plan(text);assert p['duration']>0 and ''.join(w['text'] for w in p['words'])==text.strip()
 print('PASS: real 180-step inference, six consecutive chunks, retained token context, matching plans, stop, stale session isolation, symbols and mixed scripts.')
 print(json.dumps([r['text'] for r in rows],ensure_ascii=False))
if __name__=='__main__':main()
