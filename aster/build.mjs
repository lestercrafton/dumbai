import {cpSync,mkdirSync,rmSync} from 'node:fs';
const out=new URL('./dist/',import.meta.url);
rmSync(out,{recursive:true,force:true});mkdirSync(out,{recursive:true});
for(const file of ['index.html','style.css','app.js','engine.js','story.js','art.js','audio.js','assets'])cpSync(new URL(file,import.meta.url),new URL(file,out),{recursive:true});
console.log('Built complete static game into dist/');
