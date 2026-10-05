"""Fresh bounded Common Crawl WARC ranges -> the established residue selector.

Runs in the existing research venv. One candidate per stdin request, drawn from three bounded archive batches.
Only selected fragments are buffered; downloads pause while the display waits.
This is preference-driven selection inspired by FineWeb, not official rejects.
"""
import gzip,hashlib,io,json,os,random,re,sys,urllib.request,zlib
from pathlib import Path
from urllib.parse import urlsplit

ROOT=Path(__file__).resolve().parent
sys.path.insert(0,str(ROOT/'research/residue-100-20261001'))
from mine import features,english_share,RUNTIME,PLACE,ENC,INTERFACE,EMOJI
from fetch_new import text_nodes
from lxml import etree
from warcio.archiveiterator import ArchiveIterator
from datatrove.pipeline.readers.warc import process_record

UA='AfterimageResidue/1.0 (bounded Common Crawl archive reader)'
SIZE=4*1024*1024
RNG=random.SystemRandom()

def emit(value):
    print(json.dumps(value,ensure_ascii=False),flush=True)

def fetch(url,limit,headers=None):
    request=urllib.request.Request(url,headers={'User-Agent':UA,**(headers or {})})
    with urllib.request.urlopen(request,timeout=20) as response:
        raw=response.read(limit+1)
        if len(raw)>limit:raise ValueError('Archive response exceeded byte limit')
        return raw,response.status,response.headers

def archive_paths():
    raw,_,_=fetch('https://index.commoncrawl.org/collinfo.json',512*1024)
    crawls=json.loads(raw)
    crawl=next(row['id'] for row in crawls if re.fullmatch(r'CC-MAIN-20\d\d-\d\d',row.get('id','')))
    raw,_,_=fetch(f'https://data.commoncrawl.org/crawl-data/{crawl}/warc.paths.gz',8*1024*1024)
    # Reservoir sampling avoids retaining the entire expanded archive manifest.
    paths=[]
    with gzip.GzipFile(fileobj=io.BytesIO(raw)) as stream:
        for i,line in enumerate(stream):
            path=line.decode().strip()
            if not re.fullmatch(r'crawl-data/CC-MAIN-[\d-]+/segments/[\d.]+/warc/[A-Za-z\d.-]+\.warc\.gz',path):continue
            if len(paths)<96:paths.append(path)
            else:
                j=RNG.randrange(i+1)
                if j<96:paths[j]=path
    if not paths:raise ValueError('No Common Crawl archive paths')
    RNG.shuffle(paths)
    return crawl,paths

def members(raw,base):
    """Only complete CRC-checked gzip members, with bounded decompression."""
    cursor=0
    while cursor<len(raw):
        start=raw.find(b'\x1f\x8b\x08',cursor)
        if start<0:return
        cursor=start+3
        try:
            decoder=zlib.decompressobj(31)
            payload=decoder.decompress(memoryview(raw)[start:],2*1024*1024+1)
            if not decoder.eof or len(payload)>2*1024*1024 or not payload.startswith(b'WARC/'):continue
            length=len(raw)-start-len(decoder.unused_data)
            cursor=start+length
            yield payload,base+start,length
        except zlib.error:continue

def select_fragment(text):
    lines=list(re.finditer(r'[^\n]+(?:\n|$)',text));spans=set()
    if 30<=len(text)<=500:spans.add((0,len(text)))
    for i in range(0,min(len(lines),600),4):
        a=lines[i].start();b=lines[min(i+7,len(lines))-1].end()
        if 35<=b-a<=900:spans.add((a,b))
    for signal in [RUNTIME,PLACE,ENC,INTERFACE,EMOJI]:
        for m in list(signal.finditer(text))[:8]:
            a=text.rfind('\n',max(0,m.start()-140),m.start())+1
            if m.start()-a>180:a=max(0,m.start()-100)
            b=text.find('\n',m.end()+160)
            if b<0 or b-a>700:b=min(len(text),m.end()+250)
            spans.add((a,b))
    choices=[]
    weights={'runtime':14,'placeholder':12,'encoding':10,'emoji':10,'fields':8,'mixed':7,'error':7,'numbers':5,'interface':5,'symbols':4,'table':4,'navigation':3,'calendar':4,'link':2,'contact':1}
    for a,b in spans:
        fragment=text[a:b];tags,short=features(fragment)
        if len(fragment)<30 or not(set(tags)-{'link','contact'}):continue
        strong=set(tags)&{'runtime','placeholder','encoding','error','emoji','mixed','interface'}
        if short<.55 and not strong:continue
        if len(fragment)>550 and short<.65 and not set(tags)&{'runtime','encoding','emoji'}:continue
        choices.append((sum(weights[k] for k in tags)+short*3,a,b,tags))
    # Bound language-classification work per page. Prefer the strongest signals.
    for score,a,b,tags in sorted(choices,reverse=True)[:8]:
        fragment=text[a:b];share,other=english_share(fragment)
        if share>=.3:
            return {'text':fragment,'source_start':a,'source_end':b,'tags':tags,
                    'english_share_estimate':round(share,3),'other_languages_or_scripts':other,
                    'score':round(score,2),'source_text_sha256':hashlib.sha256(text.encode()).hexdigest()}
    return None

def candidate_batches():
    crawl,paths=archive_paths()
    emit({'state':'collecting','crawl':crawl})
    while True:
        RNG.shuffle(paths)
        for path in paths:
            # Interior byte ranges avoid only ever seeing the alphabetic prefix.
            offset=RNG.randrange(16,600)*1024*1024
            try:
                raw,status,headers=fetch('https://data.commoncrawl.org/'+path,SIZE,
                    {'Range':f'bytes={offset}-{offset+SIZE-1}'})
                if status!=206 or not headers.get('Content-Range','').startswith(f'bytes {offset}-'):
                    raise ValueError('Common Crawl did not honor the bounded range request')
            except Exception as error:
                emit({'state':'retrying','error':type(error).__name__})
                raise  # Supervisor backs off rather than flooding failing endpoints.
            # Keep only byte spans while shuffling, not expanded HTML payloads.
            spans=[(start,length) for _,start,length in members(raw,offset)]
            RNG.shuffle(spans)
            batch=[];hosts=set()
            for start,length in spans:
                payload,record_offset,record_length=next(members(raw[start-offset:start-offset+length],start))
                try:
                    record=next(iter(ArchiveIterator(io.BytesIO(payload))))
                    if record.rec_type!='response':continue
                    # Avoid a second unbounded decompression of encoded HTTP bodies.
                    if record.http_headers and record.http_headers.get_header('Content-Encoding','identity').lower() not in ('identity',''):continue
                    doc=process_record(record)
                    if not doc or len(doc['text'])>500000:continue
                    parts=urlsplit(doc['url'])
                    if parts.scheme not in ('http','https') or not parts.hostname or parts.username or parts.hostname in hosts:continue
                    source,_,_=text_nodes(doc['text'])
                    if not source or len(source)>250000:continue
                    selected=select_fragment(source)
                    if not selected:continue
                    # Literal selection and source offsets are checked before publication.
                    assert source[selected['source_start']:selected['source_end']]==selected['text']
                    batch.append({**selected,'url':doc['url'],'display':parts.hostname,
                           'snapshot_date':doc.get('date'),'warc_id':doc.get('id'),'crawl':crawl,
                           'warc_file':path,'warc_offset':record_offset,'warc_length':record_length,
                           'source_method':'HTML_text_nodes_pre_C4','selection':'existing_preference_rules_automatic',
                           'fineweb_membership':'not_assessed','training':False,
                           'text_sha256':hashlib.sha256(selected['text'].encode()).hexdigest()})
                    hosts.add(parts.hostname)
                    if len(batch)>=32:break
                except (ValueError,KeyError,StopIteration,UnicodeError,zlib.error,etree.ParserError):continue
            if batch:yield batch

def mix_batches(batches,lanes=3):
    """At most 3 x 32 selected fragments; refill only a depleted lane."""
    pools=[]
    exhausted=False
    for _ in range(lanes):
        batch=next(batches,None)
        if batch is None:exhausted=True;break
        if batch:pools.append(list(batch))
    while pools:
        lane=RNG.randrange(len(pools));pool=pools[lane]
        row=pool.pop(RNG.randrange(len(pool)))
        yield row
        if not pool:
            replacement=None if exhausted else next(batches,None)
            if replacement: pools[lane]=list(replacement)
            else:exhausted=True;pools.pop(lane)

def candidates():
    yield from mix_batches(candidate_batches())

def main():
    try:os.nice(10)
    except PermissionError:pass  # Sandboxed tests may forbid changing scheduling priority.
    stream=candidates()
    for line in sys.stdin:
        if json.loads(line).get('op')!='next':continue
        emit({'candidate':next(stream)})

if __name__=='__main__':
    try:main()
    except BrokenPipeError:pass
    except Exception as error:
        emit({'error':type(error).__name__+': '+str(error)[:200]});sys.exit(1)
