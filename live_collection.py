"""Session-only Common Crawl residue collection, independent of model training."""
import collections,datetime,fcntl,hashlib,json,os,shutil,sqlite3,subprocess,threading,time,uuid
from pathlib import Path
from urllib.parse import urlsplit

MARKER='afterimage-live-collection-v1'

def normalized_hash(text):
    return hashlib.sha256(' '.join(text.casefold().split()).encode()).hexdigest()

class LiveCollection:
    def __init__(self,root,interval=8,autostart=True):
        self.root=Path(root).resolve();self.interval=interval
        self.lock=threading.RLock();self.stopped=threading.Event();self.process=None;self.thread=None
        self.run_id=uuid.uuid4().hex;self.sequence=0;self.state='starting';self.error='';self.crawl=None
        self.last_publish=time.monotonic();self.db=None;self.guard=None
        seed=json.loads((self.root/'assets/training-sources.json').read_text())
        self.base=seed['training_records'];assert self.base==len(seed['sources']) and self.base>0
        self.corpus_path=self.root/seed.get('corpus_path','training/residue-qwen05-20261001/corpus.jsonl')
        self.recent=collections.deque(seed['sources'][:7],maxlen=7)
        self.folder=self.root/'data/live-collection'
        self._prepare(seed['sources'])
        if autostart:
            self.thread=threading.Thread(target=self._run,daemon=True,name='live-collection');self.thread.start()

    def _prepare(self,sources):
        parent=self.folder.parent;parent.mkdir(exist_ok=True)
        if parent.is_symlink() or self.folder.is_symlink():raise ValueError('Refusing a linked collection directory')
        self.guard=(parent/'live-collection.lock').open('a')
        try:fcntl.flock(self.guard,fcntl.LOCK_EX|fcntl.LOCK_NB)
        except Exception:
            self.guard.close();raise RuntimeError('A live collector already owns this folder')
        try:
            if self.folder.exists():
                marker=self.folder/'.collection-owned'
                if not marker.is_file() or marker.read_text()!=MARKER:raise ValueError('Refusing to clear an unrecognized folder')
                shutil.rmtree(self.folder)
            self.folder.mkdir();(self.folder/'.collection-owned').write_text(MARKER)
            (self.folder/'records').mkdir()
            self.db=sqlite3.connect(self.folder/'seen.sqlite3',check_same_thread=False)
            self.db.execute('PRAGMA cache_size=-2048')
            self.db.execute('CREATE TABLE seen (url TEXT UNIQUE, host TEXT UNIQUE, digest TEXT UNIQUE)')
            for row in sources:
                self.db.execute('INSERT OR IGNORE INTO seen VALUES (?,?,NULL)',(row['url'],urlsplit(row['url']).hostname))
            corpus=self.corpus_path
            if corpus.is_file():
                with corpus.open() as stream:
                    for line in stream:
                        row=json.loads(line)
                        self.db.execute('INSERT OR IGNORE INTO seen VALUES (NULL,NULL,?)',(normalized_hash(row['text']),))
                        if row.get('url'):
                            self.db.execute('INSERT OR IGNORE INTO seen VALUES (?,?,NULL)',(row['url'],urlsplit(row['url']).hostname))
            self.db.commit()
            self._manifest()
        except Exception:
            if self.db:self.db.close()
            self.guard.close();raise

    def _manifest(self):
        record={'run_id':self.run_id,'base_count':self.base,'new_records':self.sequence,
                'total_display_count':self.base+self.sequence,'interval_seconds':self.interval,
                'source':'Common Crawl WARC -> HTML text nodes -> existing residue preferences',
                'training':False,'reset':'This directory is cleared at the next server startup.',
                'english_share':'Approximate alphabetic-character coverage >= 30%, not classifier confidence.',
                'selection':'Automated preference filtering, not manual review or verified FineWeb rejection.'}
        temp=self.folder/'session.json.tmp';temp.write_text(json.dumps(record,ensure_ascii=False,indent=2)+'\n')
        temp.replace(self.folder/'session.json')

    def status(self):
        with self.lock:
            return {'run_id':self.run_id,'base_count':self.base,'count':self.base+self.sequence,
                    'sequence':self.sequence,'state':self.state,'error':self.error,'crawl':self.crawl,
                    'interval_ms':int(self.interval*1000),'entries':list(self.recent),'training':False}

    def _novel(self,row):
        return not self.db.execute('SELECT 1 FROM seen WHERE url=? OR host=? OR digest=? LIMIT 1',
            (row['url'],row['display'],normalized_hash(row['text']))).fetchone()

    def publish(self,row):
        """Only a successfully stored, unique real record can increment the UI."""
        parts=urlsplit(row.get('url',''));text=row.get('text','')
        if parts.scheme not in ('http','https') or not parts.hostname or len(row['url'])>8192:return False
        if not 30<=len(text)<=2000 or row.get('english_share_estimate',0)<.3:return False
        if not row.get('warc_file','').startswith('crawl-data/CC-MAIN-'):return False
        if hashlib.sha256(text.encode()).hexdigest()!=row.get('text_sha256'):return False
        row={**row,'display':parts.hostname}
        with self.lock:
            if self.stopped.is_set() or not self._novel(row):return False
            number=self.sequence+1
            row.update(id=f'live-{self.run_id}-{number}',sequence=number,training=False,
                       collected_at=datetime.datetime.now(datetime.timezone.utc).isoformat())
            destination=self.folder/'records'/f'{number:06d}.json';temp=destination.with_suffix('.json.tmp')
            temp.write_text(json.dumps(row,ensure_ascii=False,indent=2)+'\n');temp.replace(destination)
            self.db.execute('INSERT INTO seen VALUES (?,?,?)',(row['url'],row['display'],normalized_hash(text)))
            self.db.commit()
            self.sequence=number;self.last_publish=time.monotonic();self.crawl=row.get('crawl');self.state='collecting';self.error=''
            self.recent.append({key:row.get(key) for key in ['id','url','display','sequence','snapshot_date','collected_at']})
            self._manifest()
            return True

    def _launch(self):
        python=self.root/'research/commoncrawl-fineweb-20261001/.venv/bin/python'
        if not python.is_file():raise RuntimeError('The existing Common Crawl research environment is unavailable')
        env={**os.environ,'OMP_NUM_THREADS':'1','OPENBLAS_NUM_THREADS':'1','VECLIB_MAXIMUM_THREADS':'1','TOKENIZERS_PARALLELISM':'false'}
        with self.lock:
            if self.stopped.is_set():return None
            p=subprocess.Popen([str(python),'-u',str(self.root/'live_collection_worker.py')],
                cwd=self.root,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,text=True,bufsize=1,env=env)
            self.process=p
        return p

    def _next(self,p):
        p.stdin.write('{"op":"next"}\n');p.stdin.flush()
        for line in p.stdout:
            if len(line)>64000:raise RuntimeError('Collector record exceeded size limit')
            message=json.loads(line)
            if message.get('error') and 'state' not in message:raise RuntimeError(message['error'])
            if 'candidate' in message:return message['candidate']
            with self.lock:
                self.state=message.get('state','collecting');self.crawl=message.get('crawl',self.crawl)
        raise RuntimeError('Common Crawl worker stopped')

    def _terminate(self,p):
        if not p:return
        if p.poll() is None:
            p.terminate()
            try:p.wait(timeout=3)
            except subprocess.TimeoutExpired:p.kill();p.wait()
        for stream in (p.stdin,p.stdout):
            if stream:
                try:stream.close()
                except OSError:pass  # A terminated worker may already have closed its pipe.
        with self.lock:
            if self.process is p:self.process=None

    def _run(self):
        retry=5
        while not self.stopped.is_set():
            p=None
            try:
                p=self._launch()
                if p is None:return
                while not self.stopped.is_set():
                    row=self._next(p)
                    with self.lock:novel=self._novel(row)
                    if not novel:continue
                    delay=max(0,self.interval-(time.monotonic()-self.last_publish))
                    if self.stopped.wait(delay):break
                    if self.publish(row):retry=5
            except Exception as error:
                with self.lock:self.state='waiting';self.error=str(error)[:250]
            finally:self._terminate(p)
            if self.stopped.wait(retry):break
            retry=min(60,retry*2)

    def close(self):
        self.stopped.set()
        with self.lock:p=self.process
        if p and p.poll() is None:p.terminate()
        if self.thread:self.thread.join(timeout=5)
        with self.lock:
            if self.db:self.db.close();self.db=None
            if self.guard:self.guard.close();self.guard=None
