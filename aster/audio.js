// An original generative bell-and-string score. No recordings or external samples.
let context, master, timer, step=0, enabled=true, scene=0, battle=false;
const chords=[[146.83,220,293.66,349.23],[130.81,196,261.63,329.63],[116.54,174.61,233.08,293.66],[130.81,196,261.63,349.23]];
function note(freq,at,duration=2.8,volume=.15,type='sine'){
 if(!context||!enabled)return;
 const osc=context.createOscillator(),gain=context.createGain();osc.type=type;osc.frequency.value=freq;
 gain.gain.setValueAtTime(0,at);gain.gain.linearRampToValueAtTime(volume,at+.015);gain.gain.exponentialRampToValueAtTime(.0001,at+duration);
 osc.connect(gain);gain.connect(master);osc.start(at);osc.stop(at+duration+.1);
}
function schedule(){if(!context||!enabled||document.hidden)return;const t=context.currentTime,c=chords[(Math.floor(step/8)+scene)%4];note(c[step%4]*2,t,3,.12);if(step%4===0){c.slice(0,3).forEach((f,i)=>note(f/2,t+i*.02,5,.07,'sine'));}if(battle&&step%2===0)note(c[0]/2,t,.5,.1,'triangle');if(step%8===6)note(c[2]*4,t+.35,2.5,.04);step++;}
export function startAudio(value=true){enabled=value;if(!context){try{context=new(window.AudioContext||window.webkitAudioContext)();master=context.createGain();master.gain.value=.44;master.connect(context.destination);timer=setInterval(schedule,950);}catch{return;}}if(enabled)context.resume().catch(()=>{});master.gain.setTargetAtTime(enabled?.44:0,context.currentTime,.15);if(step===0)schedule();}
export function setAudio(value){startAudio(value)}
export function setScene(chapter,fighting=false){scene=chapter;battle=fighting}
export function sound(kind){if(!context||!enabled)return;const t=context.currentTime;if(kind==='strike'){note(220,t,.2,.3,'triangle');note(110,t+.06,.3,.2);}else if(kind==='guard'){note(174.6,t,.8,.2);note(261.6,t+.05,1,.13);}else if(kind==='chime'||kind==='harmony'||kind==='win'){[293.66,440,587.33,698.46,880].slice(0,kind==='chime'?3:5).forEach((f,i)=>note(f,t+i*.1,2.4,.18));}else if(kind==='mend'){[349.23,440,523.25].forEach((f,i)=>note(f,t+i*.17,1.5,.16));}else note(587.33,t,.5,.06);}
document.addEventListener('visibilitychange',()=>{if(context){if(document.hidden)context.suspend().catch(()=>{});else if(enabled)context.resume().catch(()=>{});}});
