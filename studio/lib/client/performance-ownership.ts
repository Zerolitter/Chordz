import type {PerformanceEvent} from "../music/types";

export type OwnedPerformance={trackId:string;event:PerformanceEvent;source?:string};

/** Capture the same aggregate pedal ownership used by live note release. */
export function effectiveSustain(states:Iterable<OwnedPerformance>,trackId:string):0|1{
  for(const state of states)if(state.trackId===trackId&&state.event.type==="sustain"&&state.event.value>=.5)return 1;
  return 0;
}

export function capturedExpression(event:PerformanceEvent,tick:number,sustainBefore:0|1,sustainAfter:0|1):PerformanceEvent|null{
  if(event.type!=="sustain")return {...event,tick};
  return sustainBefore===sustainAfter?null:{...event,tick,value:sustainAfter};
}

/** Surface closure freezes performance; device/input release still records its cleanup. */
export function captureReleaseReset(source:string){
  return !/^(pointer|button|sound|knob|performance)(:|$)/.test(source);
}
