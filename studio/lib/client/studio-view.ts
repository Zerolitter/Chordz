import type {ProjectDocument} from "../music/types";
import {projectEnd} from "../music/project";

export type StudioMode = "arrange" | "write" | "sound" | "mix";
export type DetailTool = "notes" | "sound" | "automation" | "writing" | "movement" | "reference" | "keyboard" | "lyrics";
export type SongViewport = {zoom:number;leftTick:number;scrollTop:number;follow:boolean};
export type SongViewportUpdate = Partial<SongViewport> | ((current:SongViewport)=>Partial<SongViewport>);
export type StudioView = {
  version: 2;
  mode: StudioMode;
  detailTool: DetailTool;
  track: string;
  section: string;
  chord: string;
  clip: string;
  clips: Record<string,string>;
  songViewport: SongViewport;
};

export function studioViewKey(owner:string,projectId:string){
  return `chordz-view-v2:${encodeURIComponent(owner)}:${encodeURIComponent(projectId)}`;
}

export function defaultStudioView(project:ProjectDocument):StudioView{
  return {version:2,mode:"arrange",detailTool:"notes",track:project.tracks[0]?.id??"",section:project.sections[1]?.id??project.sections[0]?.id??"",chord:"",clip:"",clips:{},songViewport:{zoom:38,leftTick:0,scrollTop:0,follow:false}};
}

export function reconcileSongViewport(project:ProjectDocument,value:unknown):SongViewport{
  const view=record(value)?value:{};
  const finite=(value:unknown,fallback:number)=>typeof value==="number"&&Number.isFinite(value)?value:fallback;
  return {zoom:Math.min(100,Math.max(.001,finite(view.zoom,38))),
    leftTick:Math.min(Math.floor(projectEnd(project)),Math.max(0,Math.round(finite(view.leftTick,0)))),
    scrollTop:Math.min(Number.MAX_SAFE_INTEGER,Math.max(0,finite(view.scrollTop,0))),follow:view.follow===true};
}

export function sameSongViewport(a:SongViewport,b:SongViewport){
  return a.zoom===b.zoom&&a.leftTick===b.leftTick&&a.scrollTop===b.scrollTop&&a.follow===b.follow;
}

export function detailToolForMode(mode:StudioMode,current:DetailTool):DetailTool{
  return mode==="mix" ? current : mode==="write" ? "writing" : mode==="sound" ? "sound" : "notes";
}

export function reconcileStudioView(project:ProjectDocument,view:StudioView,viewportProject:ProjectDocument=project):StudioView{
  const defaults=defaultStudioView(project);
  const track=project.tracks.find(t=>t.id===view.track)??project.tracks[0];
  const section=project.sections.some(s=>s.id===view.section)?view.section:defaults.section;
  const clips=Object.fromEntries(project.tracks.flatMap(t=>{
    const clip=view.clips[t.id];
    return t.clips.some(c=>c.id===clip)?[[t.id,clip]]:[];
  }));
  return {...view,track:track?.id??"",section,
    chord:project.chords.some(c=>c.id===view.chord&&c.sectionId===section)?view.chord:"",
    clip:track?.clips.some(c=>c.id===view.clip)?view.clip:"",clips,songViewport:reconcileSongViewport(viewportProject,view.songViewport)};
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
      detailTool:tools.includes(value.detailTool as DetailTool)?value.detailTool as DetailTool:defaults.detailTool,clips,
      songViewport:reconcileSongViewport(project,value.songViewport)});
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

export function selectStudioSection(project:ProjectDocument,view:StudioView,sectionId:string):StudioView|null{
  if(!project.sections.some(section=>section.id===sectionId))return null;
  return reconcileStudioView(project,{...view,section:sectionId});
}

export type StudioViewPreferenceFailure={message:string;kind:"read"|"write"|null};
type ViewStorage=Pick<Storage,"getItem"|"setItem">;
const noPreferenceFailure:StudioViewPreferenceFailure={message:"",kind:null};

/** The session copy survives blocked storage and is isolated by the same owner/project key. */
export class StudioViewPreferences{
  private views=new Map<string,StudioView>();
  private failures=new Map<string,StudioViewPreferenceFailure>();
  load(key:string,project:ProjectDocument,storage:()=>ViewStorage){
    let view=this.views.get(key),failure=this.failures.get(key)??noPreferenceFailure;
    if(!view){
      try{view=readStudioView(storage().getItem(key),project);}catch{
        view=defaultStudioView(project);failure={message:"View preferences could not be read. This session still works.",kind:"read"};
      }
    }
    view=reconcileStudioView(project,view);this.views.set(key,view);this.failures.set(key,failure);
    return {view,failure};
  }
  save(key:string,view:StudioView,storage:()=>ViewStorage):StudioViewPreferenceFailure{
    this.views.set(key,view);
    let failure=this.failures.get(key)??noPreferenceFailure;
    try{
      storage().setItem(key,JSON.stringify(view));
      if(failure.kind==="write")failure=noPreferenceFailure;
    }catch{failure={message:"View preferences could not be saved. Your view is kept for this session.",kind:"write"};}
    this.failures.set(key,failure);return failure;
  }
}
