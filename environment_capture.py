"""Native Mac microphone -> bounded 8-second PCM clips; stdout is a local pipe only."""
import argparse,base64,io,json,sys,wave

def emit(value):
    print(json.dumps(value,ensure_ascii=False),flush=True)

def inputs(sd):
    return [{'id':str(i),'name':d['name'],'rate':int(d['default_samplerate'])}
            for i,d in enumerate(sd.query_devices()) if d['max_input_channels']>0]

def main():
    import re,math
    import numpy as np
    import sounddevice as sd
    from scipy.signal import resample_poly
    parser=argparse.ArgumentParser();parser.add_argument('--devices',action='store_true');parser.add_argument('--device',default='builtin');args=parser.parse_args()
    available=inputs(sd)
    if args.devices:emit({'devices':available});return
    if args.device=='builtin':
        chosen=next((d for d in available if re.search(r'macbook|imac|built[ -]?in|internal microphone|内置|內建',d['name'],re.I) and not re.search(r'iphone|ipad|continuity|airpods',d['name'],re.I)),None)
    else:chosen=next((d for d in available if d['name']==args.device),None)
    if not chosen:raise RuntimeError('Selected microphone unavailable. Choose an input in the Microphone menu.')
    rate=chosen['rate'];divisor=math.gcd(rate,16000)
    with sd.InputStream(device=int(chosen['id']),samplerate=rate,channels=1,dtype='float32') as stream:
        emit({'ready':True,'device':chosen['name'],'sample_rate':rate})
        while True:
            samples,overflow=stream.read(rate*8)
            pcm=resample_poly(samples[:,0],16000//divisor,rate//divisor)
            pcm=(np.clip(pcm,-1,1)*32767).astype('<i2')
            out=io.BytesIO()
            with wave.open(out,'wb') as f:
                f.setnchannels(1);f.setsampwidth(2);f.setframerate(16000);f.writeframes(pcm.tobytes())
            emit({'audio':base64.b64encode(out.getvalue()).decode(),'overflow':bool(overflow)})
if __name__=='__main__':
    try:main()
    except (BrokenPipeError,KeyboardInterrupt):pass
    except Exception as e:emit({'error':str(e)});sys.exit(1)
