"""Shared audio: eight-second descriptions and one measurement per text chunk."""
import base64,json,queue,subprocess,threading,time
from pathlib import Path
from noise_sampling import NoiseSampling

class EnvironmentMonitor:
    def __init__(self, root, agent):
        self.root=Path(root);self.agent=agent;self.lock=threading.RLock();self.sample_lock=threading.Lock();self.revision=0
        self.process=None;self.active=False;self.state='off';self.text='';self.error='';self.device='';self.observations=0
        self.features={};self.seconds=None;self.updated_at=None;self.captured=0;self.preference='builtin';self.session=None
        self.noise=NoiseSampling();self.interpret=True;self.pending=None;self.ready=threading.Event();self.waiter=None;self.sample_id=0
    def sampling(self):
        with self.lock:return self.noise.snapshot(self.active)
    def devices(self):
        result=subprocess.run([str(self.root/'.venv-audio/bin/python'),str(self.root/'environment_capture.py'),'--devices'],capture_output=True,text=True,timeout=15)
        data=json.loads(result.stdout.strip().splitlines()[-1])
        if result.returncode:raise RuntimeError(data.get('error','Microphone devices unavailable.'))
        return data['devices']
    def status(self):
        with self.lock:
            return {'active':self.active,'state':self.state,'text':self.text,'error':self.error,'device':self.device,
                    'observations':self.observations,'captured':self.captured,'features':self.features,
                    'processing_seconds':self.seconds,'updated_at':self.updated_at,'training':False,'archived':False,
                    'sampling':self.sampling(),'interpret':self.interpret,'capture_mode':'8s_descriptions_2s_on_demand'}
    def start(self, device='builtin', session=None, interpret=True):
        if not isinstance(interpret,bool):raise ValueError('Invalid interpretation option.')
        if not isinstance(device,str) or not 1<=len(device)<=200:raise ValueError('Invalid microphone selection.')
        if not isinstance(session,str) or not 1<=len(session)<=80:raise ValueError('A monitor session is required.')
        with self.lock:
            if self.active:
                self.session=session
                return self.status()
            self.session=session;self.interpret=interpret;self.noise.reset()
            self.revision+=1;ticket=self.revision;self.active=True;self.state='waiting';self.error='';self.text='';self.device=''
            self.observations=0;self.captured=0;self.features={};self.seconds=None;self.updated_at=None;self.preference=device
            self.pending=queue.Queue(maxsize=1);self.ready=threading.Event()
            threading.Thread(target=self._capture,args=(ticket,device,self.pending,self.ready),daemon=True).start()
            # Descriptions consume the eight-second clips independently.
            if self.interpret:threading.Thread(target=self._observe,args=(ticket,self.pending),daemon=True).start()
            return self.status()
    def _current(self,ticket):return self.active and self.revision==ticket
    def _capture(self,ticket,device,pending,ready):
        process=None
        try:
            with self.lock:
                if not self._current(ticket):return
                command=[str(self.root/'.venv-audio/bin/python'),'-u',str(self.root/'environment_capture.py'),'--device',device]
                if not self.interpret:command.append('--features-only')
                process=subprocess.Popen(command,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,text=True,bufsize=1)
                self.process=process
            for line in process.stdout:
                if not self._current(ticket):break
                data=json.loads(line)
                if data.get('error'):raise RuntimeError(data['error'])
                if data.get('ready'):
                    with self.lock:
                        if self._current(ticket):self.device=data['device'];self.state='listening';ready.set()
                elif data.get('features'):
                    with self.lock:
                        if self._current(ticket) and self.waiter and data.get('request_id')==self.waiter['id']:
                            self.features=data['features'];self.captured+=1
                            self.noise.update(self.features['rms_dbfs'],self.features['change'])
                            self.waiter['result']=self.sampling();self.waiter['event'].set();self.state='listening'
                elif data.get('audio'):
                    audio=base64.b64decode(data['audio'],validate=True)
                    try:pending.put_nowait(audio)
                    except queue.Full:
                        try:pending.get_nowait()
                        except queue.Empty:pass
                        pending.put_nowait(audio)
            if self._current(ticket):raise RuntimeError('Microphone disconnected. Stop and restart listening.')
        except Exception as error:
            with self.lock:
                if self._current(ticket):
                    self.error=str(error);self.state='error';self.active=False;self.noise.reset()
                    if self.waiter:self.waiter['event'].set()
                    try:pending.put_nowait(None)
                    except queue.Full:pass
        finally:
            ready.set()
            if process:
                if process.poll() is None:process.terminate()
                try:process.wait(timeout=3)
                except subprocess.TimeoutExpired:process.kill();process.wait()
                for stream in (process.stdin,process.stdout):
                    if stream:stream.close()
    def sample_now(self):
        """Request one fresh window while the previous sentence is playing."""
        with self.sample_lock:
            with self.lock:
                if not self.active:return self.noise.snapshot(False)
                ticket=self.revision;ready=self.ready
            if not ready.wait(12):return self.noise.snapshot(False)
            with self.lock:
                if not self._current(ticket) or not self.process:return self.noise.snapshot(False)
                self.sample_id+=1
                waiter={'id':self.sample_id,'event':threading.Event(),'result':None}
                self.waiter=waiter;self.state='capturing'
                try:
                    self.process.stdin.write(json.dumps({'sample':waiter['id']})+'\n');self.process.stdin.flush()
                except (OSError,ValueError):
                    self.waiter=None;self.noise.reset();return self.noise.snapshot(False)
            waiter['event'].wait(8)
            with self.lock:
                if self.waiter is waiter:self.waiter=None
                if not self._current(ticket):return self.noise.snapshot(False)
                if waiter['result'] is None:
                    self.noise.reset();self.error='Sound measurement timed out.';self.state='error'
                    return self.noise.snapshot(False)
                return waiter['result']
    def _observe(self,ticket,pending):
        while self._current(ticket):
            audio=pending.get()  # One description per eight-second clip; no feature-analysis timer.
            if audio is None or not self._current(ticket):break
            try:
                with self.lock:
                    if not self._current(ticket):break
                    self.agent.start()
                deadline=time.monotonic()+180
                while self._current(ticket) and self.agent.status()['state']=='loading' and time.monotonic()<deadline:time.sleep(.25)
                if not self._current(ticket):break
                status=self.agent.status()
                if status['state']!='ready':raise RuntimeError(status.get('error') or 'Audio model unavailable.')
                result=self.agent.observe(audio)
                if result.get('busy'):continue
                with self.lock:
                    if self._current(ticket):
                        self.text='[silence]' if result['silent'] else result['text'];self.error=''
                        self.observations+=1;self.seconds=result['processing_seconds'];self.updated_at=time.time()
            except Exception as e:
                with self.lock:
                    if self._current(ticket):self.error=str(e)
    def stop(self, session=None):
        with self.lock:
            if session is not None and session!=self.session:return self.status()
            self.session=None;self.noise.reset()
            self.revision+=1;self.active=False;self.state='off';self.error='';self.text='';process=self.process;self.process=None
            self.ready.set()
            if self.waiter:self.waiter['event'].set()
            if self.pending:
                try:self.pending.put_nowait(None)
                except queue.Full:
                    try:self.pending.get_nowait()
                    except queue.Empty:pass
                    self.pending.put_nowait(None)
        if process and process.poll() is None:process.terminate()
        if self.interpret:self.agent.unload()
        return self.status()
    def close(self):self.stop()
