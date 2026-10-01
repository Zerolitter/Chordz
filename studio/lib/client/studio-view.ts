import type {ProjectDocument} from "../music/types";

export type StudioMode = "arrange" | "write" | "sound" | "mix";
export type DetailTool = "notes" | "sound" | "automation" | "writing" | "movement" | "reference" | "keyboard" | "lyrics";
export type StudioView = {
  version: 2;
  mode: StudioMode;
  detailTool: DetailTool;
  track: string;
  section: string;
  chord: string;
  clip: string;
  clips: Record<string,string>;
};

export function studioViewKey(owner:string,projectId:string){
  return `chordz-view-v2:${encodeURIComponent(owner)}:${encodeURIComponent(projectId)}`;
}

export function defaultStudioView(project:ProjectDocument):StudioView{
  return {version:2,mode:"arrange",detailTool:"notes",track:project.tracks[0]?.id??"",section:project.sections[1]?.id??project.sections[0]?.id??"",chord:"",clip:"",clips:{}};
}

export function detailToolForMode(mode:StudioMode,current:DetailTool):DetailTool{
  return mode==="mix" ? current : mode==="write" ? "writing" : mode==="sound" ? "sound" : "notes";
}

export function reconcileStudioView(project:ProjectDocument,view:StudioView):StudioView{
  const defaults=defaultStudioView(project);
  const track=project.tracks.find(t=>t.id===view.track)??project.tracks[0];
  const section=project.sections.some(s=>s.id===view.section)?view.section:defaults.section;
  const clips=Object.fromEntries(project.tracks.flatMap(t=>{
    const clip=view.clips[t.id];
    return t.clips.some(c=>c.id===clip)?[[t.id,clip]]:[];
  }));
  return {...view,track:track?.id??"",section,
    chord:project.chords.some(c=>c.id===view.chord&&c.sectionId===section)?view.chord:"",
    clip:track?.clips.some(c=>c.id===view.clip)?view.clip:"",clips};
}

function record(value:unknown):value is Record<string,unknown>{return !!value&&typeof value==="object"&&!Array.isArray(value);}

export function readStudioView(raw:string|null,project:ProjectDocument):StudioView{
  const defaults=defaultStudioView(project);
  try{
    const value:unknown=JSON.parse(raw??"null");
    if(!record(value)||value.version!==2)return defaults;
    const modes:StudioMode[]=["arrange","write","sound","mix"];
    const tools:DetailTool[]=["notes","sound","automation","writing","movement","reference","keyboard","lyrics"];
    const strings=Object.fromEntries(["track","section","chord","clip"].map(key=>[key,typeof value[key]==="string"?value[key]:defaults[key as "track"|"section"|"chord"|"clip"]]));
    const clips=record(value.clips)?Object.fromEntries(Object.entries(value.clips).filter((entry):entry is [string,string]=>typeof entry[1]==="string")):{};
    return reconcileStudioView(project,{...defaults,...strings,
      mode:modes.includes(value.mode as StudioMode)?value.mode as StudioMode:defaults.mode,
      detailTool:tools.includes(value.detailTool as DetailTool)?value.detailTool as DetailTool:defaults.detailTool,clips});
  }catch{return defaults;}
}

export function selectStudioTrack(project:ProjectDocument,view:StudioView,trackId:string):StudioView|null{
  if(!project.tracks.some(t=>t.id===trackId))return null;
  const current=reconcileStudioView(project,view);
  const clips=current.clip?{...current.clips,[current.track]:current.clip}:current.clips;
  return {...current,track:trackId,clip:trackId===current.track?current.clip:clips[trackId]??"",clips};
}

export function selectStudioClip(project:ProjectDocument,view:StudioView,trackId:string,clipId:string):StudioView|null{
  if(!project.tracks.find(t=>t.id===trackId)?.clips.some(c=>c.id===clipId))return null;
  const current=reconcileStudioView(project,view);
  return {...current,track:trackId,clip:clipId,detailTool:"notes",clips:{...current.clips,[trackId]:clipId}};
}
