import {instrumentFor} from "../audio/catalog";
import {bounceRenderPlan,type ExportRange} from "../audio/export-range";
import {DEFAULT_SOUND} from "./project";
import {assetSchema,projectSchema} from "./schema";
import {PPQ,uid,type AssetReference,type ProjectDocument,type Track} from "./types";

const SAMPLE_RATE=48000,MAX_WAV_BYTES=100*1024*1024,MAX_TICK=1_000_000_000;
const wavBytes=(frames:number)=>44+frames*2*3;

export type TrackBounceOptions={includeTails?:boolean;muteSource?:boolean};
export type TrackBouncePlan={
  projectId:string;sourceTrackId:string;sourceSignature:string;
  operationId:string;assetId:string;audioTrackId:string;clipId:string;
  renderProject:ProjectDocument;range:ExportRange;includeTails:boolean;muteSource:boolean;
  renderFrames:number;outputFrames:number;expectedWavBytes:number;
};

function sourceTrack(document:ProjectDocument,trackId:string){
  const track=document.tracks.find(t=>t.id===trackId);
  if(!track||track.kind!=="instrument")throw new Error("Choose an existing instrument track to bounce.");
  return track;
}
function sourceAssets(document:ProjectDocument,track:Track){
  const ids=new Set(instrumentFor(document,track).zones.flatMap(zone=>zone.assetId?[zone.assetId]:[]));
  for(const clip of track.clips)if(clip.audio)ids.add(clip.audio.assetId);
  return document.assets.filter(asset=>ids.has(asset.id));
}

/** Dependencies of one rendered track; song master gain/limiter are applied later. */
export function trackBounceSourceSignature(document:ProjectDocument,trackId:string):string{
  const track=document.tracks.find(t=>t.id===trackId);
  if(!track)return "";
  return JSON.stringify([track,instrumentFor(document,track),sourceAssets(document,track),
    document.tempo,document.timeSignature,document.seed,document.master.reverbDecay]);
}
function insertionCapacity(document:ProjectDocument){
  if(document.tracks.length>=64)throw new Error("A bounce copy needs a free track within the 64-track limit.");
  if(document.assets.length>=1000)throw new Error("A bounce copy needs room within the 1000-audio-asset limit.");
}
function regionLength(duration:number,tempo:number,startTick:number){
  const ticks=Math.ceil(duration*tempo*PPQ/60);
  if(!Number.isSafeInteger(ticks)||ticks<1||ticks>MAX_TICK||startTick+ticks>MAX_TICK)
    throw new Error("The bounced audio region exceeds the supported tick range.");
  return ticks;
}
function projectIdentities(document:ProjectDocument){
  return new Set([document.id,...document.tracks.map(t=>t.id),...document.sections.map(s=>s.id),
    ...document.assets.map(a=>a.id),...document.userInstruments.map(i=>i.id),
    ...document.tracks.flatMap(t=>t.clips.flatMap(c=>[c.id,...c.notes.map(n=>n.id)]))]);
}

/** Capture once before any await. Absolute source identities keep seeded performance intact. */
export function planTrackBounce(document:ProjectDocument,sourceTrackId:string,options:TrackBounceOptions={}):TrackBouncePlan{
  if(!projectSchema.safeParse(document).success)throw new Error("The source song is outside the supported project limits.");
  insertionCapacity(document);
  const source=sourceTrack(document,sourceTrackId);
  if(!source.clips.length)throw new Error("Add a phrase to this instrument track before bouncing it.");
  const range={startTick:Math.min(...source.clips.map(c=>c.startTick)),endTick:Math.max(...source.clips.map(c=>c.startTick+c.lengthTick))};
  if(range.endTick>MAX_TICK)throw new Error("The source track exceeds the supported tick range.");
  const renderProject=structuredClone(document);
  renderProject.tracks=[{...structuredClone(source),mute:false,solo:false}];
  renderProject.assets=structuredClone(sourceAssets(document,source));
  renderProject.userInstruments=structuredClone(document.userInstruments.filter(instrument=>instrument.id===instrumentFor(document,source).id));
  const includeTails=options.includeTails??true,frames=bounceRenderPlan(renderProject,range,includeTails),expectedWavBytes=wavBytes(frames.outputFrames);
  if(frames.outputFrames<1||expectedWavBytes>MAX_WAV_BYTES)
    throw new Error("This bounce exceeds the 100 MB audio limit. Shorten the source track or turn off tails.");
  // Offline rendering includes absolute preroll. Bound its allocation as well as the cropped WAV.
  if(wavBytes(frames.renderFrames)>MAX_WAV_BYTES)
    throw new Error("This track's absolute preroll exceeds the supported render limit. Move a copy earlier before bouncing.");
  regionLength(frames.outputFrames/SAMPLE_RATE,document.tempo,range.startTick);
  const identities=projectIdentities(document),fresh=()=>{let id=uid();while(identities.has(id))id=uid();identities.add(id);return id;};
  return {projectId:document.id,sourceTrackId,sourceSignature:trackBounceSourceSignature(document,sourceTrackId),
    operationId:fresh(),assetId:fresh(),audioTrackId:fresh(),clipId:fresh(),renderProject,range,
    includeTails,muteSource:options.muteSource??false,renderFrames:frames.renderFrames,outputFrames:frames.outputFrames,expectedWavBytes};
}

/** Rebuild against the latest committed song after staged bytes and the last revision check. */
export function applyTrackBounce(document:ProjectDocument,plan:TrackBouncePlan,asset:AssetReference):{document:ProjectDocument;trackId:string;clipId:string}{
  if(document.id!==plan.projectId||trackBounceSourceSignature(document,plan.sourceTrackId)!==plan.sourceSignature)
    throw new Error("The bounce source or project changed. Render this track again.");
  const source=sourceTrack(document,plan.sourceTrackId);
  insertionCapacity(document);
  const ids=projectIdentities(document);
  if([plan.assetId,plan.audioTrackId,plan.clipId].some(id=>ids.has(id)))throw new Error("This bounce identity has already been inserted.");
  const frames=Math.round(asset.duration*SAMPLE_RATE);
  if(!assetSchema.safeParse(asset).success||asset.id!==plan.assetId||asset.mime!=="audio/wav"||asset.sampleRate!==SAMPLE_RATE||asset.channels!==2||asset.duration<=0||
    Math.abs(frames-plan.outputFrames)>1||asset.byteLength!==wavBytes(frames))
    throw new Error("The rendered audio asset is outside the supported stereo WAV limits.");
  const lengthTick=regionLength(asset.duration,document.tempo,plan.range.startTick),name=(source.name+" · audio").slice(0,120);
  const track:Track={id:plan.audioTrackId,name,kind:"audio",instrumentId:"piano",color:source.color,
    volume:0,pan:0,mute:false,solo:source.solo,reverb:0,delay:0,low:0,mid:0,high:0,drive:0,
    sound:{...DEFAULT_SOUND,cutoff:20000,resonance:0,lfoDepth:0,detune:0,filterEnvelope:0},automation:[],
    clips:[{id:plan.clipId,name:(source.name+" · bounce").slice(0,120),startTick:plan.range.startTick,lengthTick,sourceLengthTick:lengthTick,
      loop:false,transpose:0,notes:[],events:[],audio:{assetId:plan.assetId,offsetSec:0,gain:1,fadeInSec:0,fadeOutSec:0}}]};
  const next=structuredClone(document);
  if(plan.muteSource)next.tracks.find(t=>t.id===source.id)!.mute=true;
  next.tracks.push(track);next.assets.push(structuredClone(asset));
  if(!projectSchema.safeParse(next).success)throw new Error("The bounce copy exceeds the supported project limits.");
  return {document:next,trackId:track.id,clipId:plan.clipId};
}
