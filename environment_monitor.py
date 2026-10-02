"""Display-only native audio monitor, independent of text generation and training."""
import base64,json,queue,subprocess,threading,time
from pathlib import Path

class EnvironmentMonitor:
    def __init__(self, root, agent):
        self.root=Path(root);self.agent=agent;self.lock=threading.RLock();self.revision=0
        self.process=None;self.active=False;self.state='off';self.text='';self.error='';self.device='';self.observations=0
        self.features={};self.seconds=None;self.updated_at=None;self.captured=0;self.preference='builtin';self.session=None
    def devices(self):
        result=subprocess.run([str(self.root/'.venv-audio/bin/python'),str(self.root/'environment_capture.py'),'--devices'],capture_output=True,text=True,timeout=15)
        data=json.loads(result.stdout.strip().splitlines()[-1])
        if result.returncode:raise RuntimeError(data.get('error','Microphone devices unavailable.'))
        return data['devices']
    def status(self):
        with self.lock:
            return {'active':self.active,'state':self.state,'text':self.text,'error':self.error,'device':self.device,
                    'observations':self.observations,'captured':self.captured,'features':self.features,
                    'processing_seconds':self.seconds,'updated_at':self.updated_at,'training':False,'archived':False}
    def start(self, device='builtin', session=None):
        if not isinstance(device,str) or not 1<=len(device)<=200:raise ValueError('Invalid microphone selection.')
        if not isinstance(session,str) or not 1<=len(session)<=80:raise ValueError('A monitor session is required.')
        with self.lock:
            if self.active:
                self.session=session
                return self.status()
            self.session=session
            self.revision+=1;ticket=self.revision;self.active=True;self.state='starting';self.error='';self.text='';self.device=''
            self.observations=0;self.captured=0;self.features={};self.seconds=None;self.updated_at=None;self.preference=device
            pending=queue.Queue(maxsize=1)
            threading.Thread(target=self._capture,args=(ticket,device,pending),daemon=True).start()
            threading.Thread(target=self._observe,args=(ticket,pending),daemon=True).start()
            return self.status()
    def _current(self,ticket):return self.active and self.revision==ticket
    def _capture(self,ticket,device,pending):
        process=None
        try:
            with self.lock:
                if not self._current(ticket):return
                process=subprocess.Popen([str(self.root/'.venv-audio/bin/python'),'-u',str(self.root/'environment_capture.py'),'--device',device],stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,text=True,bufsize=1)
                self.process=process
            for line in process.stdout:
                if not self._current(ticket):break
                data=json.loads(line)
                if data.get('error'):raise RuntimeError(data['error'])
                if data.get('ready'):
                    with self.lock:
                        if self._current(ticket):self.device=data['device'];self.state='loading'
                    self.agent.start(restart=True)
                elif data.get('audio'):
                    audio=base64.b64decode(data['audio'],validate=True)
                    from audio_runtime import audio_features
                    features=audio_features(audio)
                    with self.lock:
                        if self._current(ticket):self.captured+=1;self.features=features
                    try:pending.put_nowait(audio)
                    except queue.Full:
                        try:pending.get_nowait()
                        except queue.Empty:pass
                        pending.put_nowait(audio)
            if self._current(ticket):raise RuntimeError('Microphone disconnected. Stop and restart listening.')
        except Exception as e:
            with self.lock:
                if self._current(ticket):self.error=str(e);self.state='error';self.active=False
        finally:
            if process:
                if process.poll() is None:process.terminate()
                try:process.wait(timeout=3)
                except subprocess.TimeoutExpired:process.kill();process.wait()
                if process.stdout:process.stdout.close()
    def _observe(self,ticket,pending):
        while self._current(ticket):
            status=self.agent.status()
            if status['state']=='error':
                with self.lock:
                    if self._current(ticket):self.state='error';self.error=status['error']
                time.sleep(1);continue
            if status['state']!='ready':time.sleep(.25);continue
            with self.lock:
                if self._current(ticket) and not self.text:self.state='listening'
            try:audio=pending.get(timeout=.5)
            except queue.Empty:continue
            if not self._current(ticket):break
            try:
                result=self.agent.observe(audio)
                if result.get('busy'):continue
                with self.lock:
                    if self._current(ticket):
                        self.text='[silence]' if result['silent'] else result['text'];self.error='';self.state='listening'
                        self.observations+=1;self.seconds=result['processing_seconds'];self.updated_at=time.time()
            except Exception as e:
                with self.lock:
                    if self._current(ticket):self.error=str(e);self.state='error'
    def stop(self, session=None):
        with self.lock:
            if session is not None and session!=self.session:return self.status()
            self.session=None
            self.revision+=1;self.active=False;self.state='off';self.error='';self.text='';process=self.process;self.process=None
        if process and process.poll() is None:
            process.terminate()
        return self.status()
    def close(self):self.stop()
