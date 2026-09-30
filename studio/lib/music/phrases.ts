import {projectSchema} from "./schema";
import {uid,type Clip,type ProjectDocument} from "./types";
export function placePhrase(project:ProjectDocument,trackId:string,clip:Clip,action:"insert"|"alternative"|"replace",selectedClipId?:string):{ok:true;document:ProjectDocument;trackId:string;clipId:string}|{ok:false;error:string;overlap?:boolean}{
  const success=(document:ProjectDocument,destination:string)=>projectSchema.safeParse(document).success?{ok:true as const,document,trackId:destination,clipId:clip.id}:{ok:false as const,error:"This proposal exceeds the project clip or note limits. Your existing material is kept."};
  const track=project.tracks.find(t=>t.id===trackId);if(!track||track.kind!=="instrument")return {ok:false,error:"Choose an instrument track for this phrase."};
  const overlap=track.clips.some(c=>c.startTick<clip.startTick+clip.lengthTick&&c.startTick+c.lengthTick>clip.startTick);
  if(action==="insert"&&overlap)return {ok:false,overlap:true,error:"This phrase overlaps existing material. Choose an alternative track, another destination, or explicitly replace a selected phrase."};
  if(action==="alternative"){
    if(project.tracks.length>=64)return {ok:false,overlap:true,error:"The 64-track limit is reached. Keep this proposal and choose an empty destination or a selected phrase to replace."};
    const alternative={...structuredClone(track),id:uid(),name:(track.name+" · alternative").slice(0,120),clips:[clip],automation:[],mute:false,solo:false};
    return success({...project,tracks:[...project.tracks,alternative]},alternative.id);
  }
  if(action==="replace"&&!track.clips.some(c=>c.id===selectedClipId&&!c.audio))return {ok:false,error:"Select an instrumental phrase to replace. Recordings are preserved."};
  return success({...project,tracks:project.tracks.map(t=>t.id===trackId?{...t,clips:[...t.clips.filter(c=>action!=="replace"||c.id!==selectedClipId),clip]}:t)},trackId);
}
