"use client";
import type {AutomationParameter} from "../../lib/music/types";
import {inactiveAutomationBindings} from "../../lib/music/automation-bindings";
import {instrumentFor} from "../../lib/audio/catalog";
import {useStudio} from "./use-studio";
import {useToolVisibility} from "./tool-visibility";
import "./control-automation.css";

/** Open an authored lane without creating points or changing its control. */
export function ControlAutomation({parameter,label,trackId,disabled=false}:{parameter:AutomationParameter;label:string;trackId?:string;disabled?:boolean}){
  const s=useStudio(),active=useToolVisibility();
  const track=s.project.tracks.find(track=>track.id===(trackId??s.selectedTrack?.id));
  const automated=!!track?.automation.some(lane=>lane.parameter===parameter&&lane.points.length);
  const reason=automated&&track?inactiveAutomationBindings(track,instrumentFor(s.project,track)).find(binding=>binding.target===parameter)?.reason:undefined;
  return <button type="button" className={`control-automation${automated?" has-automation":""}`} data-edit-policy="bypass"
    aria-label={`Automate ${label}`} disabled={disabled||!active||!track}
    title={`${reason?`Inactive automation: ${reason}. `:automated?"This control has an automation lane. ":""}Open ${label} automation for ${track?.name??"the selected track"}; add or edit points in the detail dock.`}
    onClick={()=>s.openAutomation(parameter,track?.id)}>{reason?"Inactive automation":automated?"Automated":"Automate"}</button>;
}
