#!/usr/bin/env python3
"""Verify the pinned original and regenerate the exact adapted-base diff."""
from pathlib import Path
import argparse,difflib,hashlib,json,sys
ROOT=Path(__file__).resolve().parents[1]
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def patch(left,right):
 out=[]
 for name in sorted(left.keys()|right.keys()):
  a=left.get(name,'');b=right.get(name,'')
  if a==b:continue
  out.extend(difflib.unified_diff(a.splitlines(True),b.splitlines(True),fromfile='a/'+name if name in left else '/dev/null',tofile='b/'+name if name in right else '/dev/null'))
 return ''.join(out)
def sources(folder):return {str(p.relative_to(folder)):p.read_text() for p in folder.rglob('*') if p.is_file() and p.suffix in ['.js','.mjs','.css','.json']}
def main():
 parser=argparse.ArgumentParser();parser.add_argument('--check',action='store_true');args=parser.parse_args()
 pin=json.loads((ROOT/'UPSTREAM.json').read_text());snapshot=ROOT/'zentral/upstream/1.1.0'
 for name,expected in pin['reference_sha256'].items():
  if sha(snapshot/name)!=expected:raise SystemExit('Original reference changed: '+name)
 original=sources(snapshot)
 adapted={str(p.relative_to(ROOT)):p.read_text() for p in (ROOT/'zentral').rglob('*') if p.is_file() and 'upstream' not in p.relative_to(ROOT).parts and 'compatibility' not in p.relative_to(ROOT).parts and p.suffix in ['.js','.mjs','.css','.json']}
 adapted['loader/ZentralShared.js']=(ROOT/'loader/ZentralShared.js').read_text()
 # Only base-related original source paths participate in this artifact.
 original={k:v for k,v in original.items() if k in ['JS/Zentral.uc.js','JS/zentral_panel_geometry.uc.js','chrome.css','preferences.json','theme.json']}
 target=ROOT/'patches/1.1.0-to-adapted-base.patch';text=patch(original,adapted)
 if args.check:
  if not target.exists() or target.read_text()!=text:raise SystemExit('Base diff is stale; regenerate with tools/update-provenance.py')
 else:target.write_text(text)
 print('Pinned Zentral 1.1.0 hashes and adapted-base diff verified' if args.check else 'Regenerated adapted-base diff; original reference hashes verified')
if __name__=='__main__':main()
