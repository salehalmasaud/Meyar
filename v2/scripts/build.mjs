import { build } from 'esbuild';
import { mkdir, copyFile, writeFile } from 'node:fs/promises';
await mkdir('dist',{recursive:true});
await build({entryPoints:['src/app.ts'],outfile:'dist/app.js',bundle:true,format:'esm',target:['chrome100','safari15.4'],minify:true,sourcemap:false,legalComments:'none'});
for(const [from,to] of [['index.html','index.html'],['src/app.css','app.css'],['relay.svg','relay.svg']])await copyFile(from,'dist/'+to);
await writeFile('dist/robots.txt','User-agent: *\nDisallow: /\n');
console.log('Self-contained frontend built. No runtime CDN dependencies.');
