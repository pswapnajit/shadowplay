// Extracts IWER's captured Quest "relaxed" hand pose (MIT, Meta) into a
// canonical RIGHT-hand palm frame: +x ulnar (pinky side), +y distal, +z dorsal.
import { relaxedHandPose } from 'iwer/lib/device/configs/hand/relaxed.js';
const J = relaxedHandPose.jointTransforms;
const names = Object.keys(J);
const pos = Object.fromEntries(names.map(n => { const m = J[n].offsetMatrix; return [n, [m[12], m[13], m[14]]]; }));
const sub=(a,b)=>a.map((v,i)=>v-b[i]), dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0);
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const norm=a=>{const l=Math.hypot(...a);return a.map(v=>v/l)};
const w=pos['wrist'];
const y=norm(sub(pos['middle-finger-phalanx-proximal'],w));
const across=norm(sub(pos['pinky-finger-phalanx-proximal'],pos['index-finger-phalanx-proximal']));
// IWER data is a LEFT hand. For a left hand, radial(thumb)->ulnar direction is index->pinky.
let z=norm(cross(across,y));            // candidate dorsal/palmar normal
let x=norm(cross(y,z));
// determine dorsal: fingertips of relaxed hand curl palmar → tip z should be negative
const tipz = dot(sub(pos['middle-finger-tip'],w),z);
if (tipz>0){ z=z.map(v=>-v); x=norm(cross(y,z)); }
const out={};
for(const n of names){const d=sub(pos[n],w); out[n]=[dot(d,x),dot(d,y),dot(d,z)];}
// x currently: y×z. check pinky side sign
console.log('pinky x', out['pinky-finger-phalanx-proximal'][0].toFixed(4),'index x',out['index-finger-phalanx-proximal'][0].toFixed(4),'thumb tip x',out['thumb-tip'][0].toFixed(4));
// We want RIGHT hand with +x ulnar. Left-hand data in a right-handed frame has ulnar on one side; mirror if needed.
const mirror = out['pinky-finger-phalanx-proximal'][0] < 0;
console.log('mirror needed?', mirror);
const res={};
for(const n of names){const p=out[n]; res[n]={p:[(mirror?-1:1)*p[0],p[1],p[2]].map(v=>+v.toFixed(5)), r:+J[n].radius.toFixed(5)};}
console.log(JSON.stringify(res,null,0).replace(/\},"/g,'},\n"'));
