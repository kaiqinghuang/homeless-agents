"""Offline checks for archive ordering and bounded, lossless mixing."""
import ast,gzip,random,unittest,zlib
from pathlib import Path
from collections import Counter

# Load the pure archive/mixing functions without loading the language models.
module=ast.parse(Path(__file__).with_name('live_collection_worker.py').read_text())
pure=ast.Module(body=[n for n in module.body if isinstance(n,ast.FunctionDef) and n.name in ('members','mix_batches')],type_ignores=[])

class RandomCollectionTests(unittest.TestCase):
    def setUp(self):
        self.env={'RNG':random.Random(71),'zlib':zlib}
        exec(compile(pure,'live_collection_worker.py','exec'),self.env)

    def test_mix_crosses_archive_ranges_without_loss_or_duplicates(self):
        batches=[[f'{prefix}{i}.example' for i in range(32)] for prefix in 'amz']
        result=list(self.env['mix_batches'](iter(batches)))
        self.assertEqual(Counter(result),Counter(sum(batches,[])))
        self.assertEqual({s[0] for s in result[:12]},set('amz'))
        self.assertNotEqual(result,sorted(result))

    def test_bounded_prefetch_and_backpressure(self):
        loaded=[]
        def batches():
            for i in range(100):
                loaded.append(i)
                yield [f'{i}-{j}' for j in range(32)]
        stream=self.env['mix_batches'](batches())
        next(stream)
        self.assertEqual(len(loaded),3)
        for _ in range(15):next(stream)
        self.assertEqual(len(loaded),3,'do not download more archives while buffered rows remain')
        stream.close()
        self.assertEqual(len(loaded),3)

    def test_single_batch_and_empty_stream(self):
        self.assertEqual(list(self.env['mix_batches'](iter([]))),[])
        self.assertCountEqual(list(self.env['mix_batches'](iter([[1,2,3]]))),[1,2,3])

    def test_shuffled_byte_spans_preserve_exact_payload_and_offsets(self):
        payloads=[b'WARC/1.0\r\n'+str(i).encode()+b'x'*100 for i in range(10)]
        raw=b'partial previous record'+b''.join(gzip.compress(p) for p in payloads)+b'\x1f\x8b\x08incomplete'
        base=12345;members=self.env['members']
        original=list(members(raw,base));spans=[(start,size) for _,start,size in original]
        self.env['RNG'].shuffle(spans)
        recovered=[next(members(raw[start-base:start-base+size],start)) for start,size in spans]
        self.assertCountEqual(recovered,original)
        self.assertEqual(len(recovered),10)

if __name__=='__main__':unittest.main()
