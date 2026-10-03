"""Single local text worker, demand-driven chunks and bounded generation logs."""
import hashlib,json,logging,os,queue,subprocess,threading,uuid
from logging.handlers import RotatingFileHandler
from pathlib import Path
class ResidueGenerator:
 def __init__(self,root,data_dir):
  self.root=Path(root);self.lock=threading.RLock();self.process=None;self.session=None;self.state='idle';self.error='';self.responses=queue.Queue();self.log=None
  self.config=json.loads((self.root/'residue_config.json').read_text())
  self.data=Path(data_dir);self.data.mkdir(parents=True,exist_ok=True)
  self.logger=logging.getLogger('residue.'+uuid.uuid4().hex);self.logger.setLevel(logging.INFO);self.logger.propagate=False
  self.handler=RotatingFileHandler(self.data/'text-output.jsonl',maxBytes=5_000_000,backupCount=3,encoding='utf-8');self.logger.addHandler(self.handler)
 def status(self):
  if self.process and self.process.poll() is not None:self.state='error';self.error='Text model stopped. Press Start generating to reload.'
  return {'state':self.state,'error':self.error,'model':self.config['model'],'mode':'continuous-text','adapter_sha256':self.config['adapter_sha256'],'microphone':False}
 def _read(self,p,q):
  try:
   for line in p.stdout:
    try:q.put(json.loads(line))
    except json.JSONDecodeError:pass
  finally:q.put({'error':'Text model process stopped.'})
 def _receive(self):
  try:r=self.responses.get(timeout=60)
  except queue.Empty:
   self._terminate();self.state='error';raise RuntimeError('Text model timed out. Press Start generating to reload.')
  if 'error' in r:raise RuntimeError(r['error'])
  return r
 def _terminate(self):
  if self.process:
   if self.process.poll() is None:
    self.process.terminate()
    try:self.process.wait(timeout=5)
    except subprocess.TimeoutExpired:self.process.kill();self.process.wait()
   for s in (self.process.stdin,self.process.stdout):s.close()
  self.process=None
  if self.log:self.log.close();self.log=None
 def _boot(self):
  if self.process and self.process.poll() is None:return
  self._terminate();self.state='loading';self.error='';self.responses=queue.Queue()
  self.log=(self.data/'text-worker.log').open('a')
  env={**os.environ,'HF_HUB_OFFLINE':'1','TRANSFORMERS_OFFLINE':'1','HF_HUB_DISABLE_TELEMETRY':'1','TOKENIZERS_PARALLELISM':'false','HF_HOME':str(self.root/'models/.hf-cache')}
  self.process=subprocess.Popen([str(self.root/'.venv-audio/bin/python'),'-u',str(self.root/'residue_worker.py')],cwd=self.root,env=env,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=self.log,text=True,bufsize=1)
  threading.Thread(target=self._read,args=(self.process,self.responses),daemon=True).start()
  if not self._receive().get('ready'):raise RuntimeError('Text model did not become ready.')
  self.state='ready'
 def _request(self,request):
  self.process.stdin.write(json.dumps(request)+'\n');self.process.stdin.flush();return self._receive()
 def start(self):
  with self.lock:
   try:
    self._boot();sid=uuid.uuid4().hex;result=self._request({'op':'start','session':sid});self.session=sid
    self.logger.info(json.dumps({'kind':'start',**result,'adapter_sha256':self.config['adapter_sha256']},ensure_ascii=False));return result
   except Exception as e:self.error=str(e);self.state='error';self._terminate();raise
 def next(self,sid,sampling=None):
  with self.lock:
   if not sid or sid!=self.session:raise ValueError('Generation session expired.')
   r=self._request({'op':'next','session':sid,'sampling':sampling})
   if r.get('session')!=sid:raise RuntimeError('Unexpected text session.')
   self.logger.info(json.dumps({'kind':'generated',**{k:v for k,v in r.items() if k!='sampling'}},ensure_ascii=False));return r
 def stop(self,sid):
  with self.lock:
   if sid==self.session:self.session=None
   return {'stopped':True}
 def close(self):
  with self.lock:self.session=None;self._terminate();self.handler.close();self.logger.removeHandler(self.handler)
