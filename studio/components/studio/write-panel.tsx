"use client";
import {DraftTextarea} from "./draft-field";
import { useEffectEvent, useLayoutEffect, useMemo, useState } from "react";
import { ArrowRight, Play, RefreshCw } from "lucide-react";
import {usePreference,numericPreference} from "./use-preference";
import { useStudio } from "./use-studio";
import { IconButton, PanelHeading, Range } from "./primitives";
import {ChordCanvas} from "./chord-canvas";
import { generatePart } from "../../lib/music/generate";
import {progressionNotes,harmonyIdentity} from "../../lib/music/harmony";
import {placePhrase} from "../../lib/music/phrases";
import {instrumentFor,isDrumInstrument} from "../../lib/audio/catalog";
import { emptyClip } from "../../lib/music/project";
import { type GenerationOptions } from "../../lib/music/types";
import { ChordMovementControls } from "./chord-movement-controls";
import { DEFAULT_CHORD_MOVEMENT } from "../../lib/music/chord-movement";
import { ToolVisibilityProvider, useToolVisibility } from "./tool-visibility";

export function WritePanel({ section = "writing" }: { section?: "writing" | "lyrics" } = {}) {
  const s = useStudio();
  const active = useToolVisibility();
  const writingActive = active && section === "writing";
  const [tension, setTension] = usePreference("tension",.3,numericPreference(0,1)),
    [energy, setEnergy] = usePreference("energy",.55,numericPreference(0,1)),
    [density, setDensity] = usePreference("density",.5,numericPreference(0,1)),
    [register, setRegister] = usePreference("register",4,numericPreference(1,6)),
    [role, setRole] = usePreference<GenerationOptions["role"]>("role","arpeggio",(v):v is GenerationOptions["role"]=>typeof v==="string"&&["arpeggio","melody","bass","chords","strings","drums"].includes(v)),
    [variation, setVariation] = useState(0);
  const [phraseError,setPhraseError]=useState(""),[offerAlternative,setOfferAlternative]=useState(false);
  const instrument=s.selectedTrack?instrumentFor(s.project,s.selectedTrack):null;
  const compatible=s.selectedTrack?.kind==="instrument"&&(role!=="drums"||!!instrument&&isDrumInstrument(instrument));
  const chords = s.project.chords
      .filter((c) => c.sectionId === s.selectedSection.id)
      .sort((a, b) => a.tick - b.tick),
    currentChord = chords.find(c=>c.id===s.selectedChordId);
  const generation = useMemo(
    () => {
      if (!writingActive) return { notes: [], error: "" };
      try { return { notes: generatePart(s.project, s.selectedSection, {
        role,
        energy,
        density,
        register,
        tension,
        seed: s.project.seed + variation,
        chordMovement: s.selectedTrack?.chordMovement,
      }), error: "" }; }
      catch (problem) { if (problem instanceof RangeError) return { notes: [], error: problem.message }; throw problem; }
    },
    [
      writingActive,
      s.project,
      s.selectedSection,
      role,
      energy,
      density,
      register,
      tension,
      variation,
      s.selectedTrack?.chordMovement,
    ],
  );
  const candidate=compatible?generation.notes:[];
  const previewIdentity = JSON.stringify([s.project.id,s.selectedTrack?.id,s.selectedTrack?.instrumentId,s.selectedSection.id,s.selectedSection.startTick,s.selectedSection.lengthTick,s.project.key,s.project.mode,s.project.tempo,s.project.timeSignature,harmonyIdentity(s.project,s.selectedSection),s.project.seed,instrument,role,energy,density,register,tension,variation,s.selectedTrack?.chordMovement]);
  const cancelStalePreview=useEffectEvent(()=>s.cancelPreview());
  useLayoutEffect(()=>{if(!writingActive)return;cancelStalePreview();return()=>cancelStalePreview();},[previewIdentity,writingActive]);
  useLayoutEffect(()=>{if(!writingActive)return;s.registerWritingActions({generated:()=>{if(s.selectedTrack&&compatible&&candidate.length&&!generation.error)void s.previewPhrase(s.selectedTrack.id,candidate,previewIdentity);},chord:()=>{if(currentChord)void s.audition(currentChord.notes);},progression:()=>{if(s.selectedTrack)void s.previewPhrase(s.selectedTrack.id,progressionNotes(s.project,s.selectedSection),"progression:"+previewIdentity);}});return()=>s.registerWritingActions(null);});
  function progression(){if(s.selectedTrack)void s.previewPhrase(s.selectedTrack.id,progressionNotes(s.project,s.selectedSection),"progression:"+previewIdentity);}
  function place(action:"insert"|"alternative"|"replace"){
    if(!s.selectedTrack||!compatible||!candidate.length||generation.error||!s.finishEdit())return;
    const clip={...emptyClip(s.selectedSection.startTick,s.selectedSection.lengthTick,role+" · "+s.selectedSection.name),notes:candidate.map(n=>({...n}))};
    const result=placePhrase(s.committedRef.current,s.selectedTrack.id,clip,action,s.selectedClipId);
    if(!result.ok){setPhraseError(result.error);setOfferAlternative(!!result.overlap);return;}
    if(!s.commit(result.document,action==="replace"?"Replace phrase":"Insert suggestion")){setPhraseError("Finish recording before inserting; your proposal is kept.");return;}s.selectClip(result.trackId,result.clipId);s.setMode("write");setPhraseError("");setOfferAlternative(false);
  }
  return (
    <div className="write-panel">
      <PanelHeading
        eyebrow="A place for your next idea"
        title="Find the feeling."
      >
        <label className="section-picker">
          Writing in
          <select
            aria-label="Writing section"
            value={s.selectedSection.id}
            onChange={(e) => s.setSelectedSectionId(e.target.value)}
          >
            {s.project.sections.map((section) => (
              <option key={section.id} value={section.id}>
                {section.name}
              </option>
            ))}
          </select>
        </label>
      </PanelHeading>
      <ToolVisibilityProvider active={writingActive}><div className="writing-grid" hidden={section !== "writing"}>
        <ChordCanvas tension={tension} setTension={setTension} onProgression={progression}/>
        <aside className="idea-panel">
          <div className="subheading">
            <h3>Develop your idea</h3>
            <span className="tag">Local assistance</span>
          </div>
          <label className="field">
            Part
            <select
              aria-label="Suggested part"
              value={role}
              onChange={(e) =>
                setRole(e.target.value as GenerationOptions["role"])
              }
            >
              <option value="arpeggio">Flowing arpeggio</option>
              <option value="melody">Melody</option>
              <option value="bass">Bass line</option>
              <option value="chords">Chord accompaniment</option>
              <option value="strings">Sustained harmony</option>
              <option value="drums" disabled={!instrument||!isDrumInstrument(instrument)}>Drum pattern</option>
            </select>
          </label>
          <label className="field">Destination<select aria-label="Phrase destination" value={s.selectedTrackId} onChange={e=>s.selectTrack(e.target.value)}>{s.project.tracks.filter(t=>t.kind==="instrument").map(t=><option key={t.id} value={t.id}>{t.name}</option>)}</select></label>
          <p className="helper">{instrument?.name??"Choose an instrument"} · {s.selectedSection.name} · {s.selectedSection.lengthTick/(960*4/s.project.timeSignature[1])} beats</p>
          {!compatible&&<p className="action-error">Choose a drum track for drum patterns, or choose a pitched part.</p>}
          {generation.error&&<p className="action-error" role="alert">{generation.error}</p>}
          <Range label="Energy" value={energy} onChange={setEnergy} />
          <Range label="Density" value={density} onChange={setDensity} />
          <Range
            label="Register"
            min={1}
            max={6}
            step={1}
            value={register}
            onChange={setRegister}
            format={(n) => "Octave " + n}
          />
          <div
            className="phrase-preview"
            aria-label={candidate.length + " suggested notes"}
          >
            {candidate.slice(0, 90).map((n, i) => (
              <span
                key={i}
                style={{
                  left: (n.tick / s.selectedSection.lengthTick) * 100 + "%",
                  width:
                    Math.max(
                      0.8,
                      (n.duration / s.selectedSection.lengthTick) * 100,
                    ) + "%",
                  bottom: ((n.pitch % 36) / 36) * 75 + 8 + "%",
                  opacity: 0.3 + n.velocity * 0.7,
                }}
              />
            ))}
          </div>
          <div className="button-row">
            <button
              className="secondary-button"
              disabled={!compatible||!candidate.length||!!generation.error} onClick={() => { if(s.selectedTrack) void s.previewPhrase(s.selectedTrack.id,candidate,previewIdentity); }}
            >
              <Play size={14} />
              Audition
            </button>
            <IconButton
              label="Try another variation"
              onClick={() => setVariation((v) => v + 1)}
            >
              <RefreshCw size={16} />
            </IconButton>
            <button
              className="primary-button"
              disabled={!compatible||!candidate.length}
              onClick={()=>place("insert")}
            >
              Insert <ArrowRight size={15} />
            </button>
          </div>
          <div className="button-row"><button className="secondary-button" disabled={!compatible||!candidate.length||!!generation.error||!s.selectedClip||!!s.selectedClip.audio} onClick={()=>place("replace")}>Replace selected phrase</button><button data-edit-policy="bypass" className="text-button" disabled={!s.selectedClip} onClick={()=>s.selectClip(s.selectedTrack!.id,s.selectedClip!.id)}>Edit phrase</button></div>
          {phraseError&&<div className="action-error" role="alert">{phraseError}{offerAlternative&&<button className="secondary-button" onClick={()=>place("alternative")}>Insert on alternative track</button>}</div>}
          <p className="helper">
            {candidate.length} editable notes for{" "}
            {s.selectedTrack?.name ?? "your selected track"}. Each variation is
            repeatable.
          </p>
          <details className="movement-inspector"><summary>Voicing, rhythm & movement</summary><ChordMovementControls value={s.selectedTrack?.chordMovement ?? DEFAULT_CHORD_MOVEMENT} disabled={s.recording || !compatible || !["chords", "strings", "arpeggio"].includes(role)} onChange={chordMovement => { if (s.selectedTrack) s.updateTrack(s.selectedTrack.id, { chordMovement }, "Shape chord movement"); }} /></details>
        </aside>
      </div></ToolVisibilityProvider>
      <ToolVisibilityProvider active={active && section === "lyrics"}><div className="notebook" hidden={section !== "lyrics"}>
        <label className="field">
          Lyrics · {s.selectedSection.name}
          <DraftTextarea
            aria-label="Section lyrics"
            placeholder="Let the first line find you…"
            value={s.selectedSection.lyrics}
            onChange={(e) =>
              s.edit(
                (p) => ({
                  ...p,
                  sections: p.sections.map((section) =>
                    section.id === s.selectedSection.id
                      ? { ...section, lyrics: e.target.value }
                      : section,
                  ),
                }),
                "Edit lyrics",
              )
            }
          />
        </label>
        <label className="field">
          Song notes
          <DraftTextarea
            aria-label="Song notes"
            placeholder="A sound, a story, a direction…"
            value={s.project.notes}
            onChange={(e) =>
              s.edit(
                (p) => ({ ...p, notes: e.target.value }),
                "Edit song notes",
              )
            }
          />
        </label>
      </div></ToolVisibilityProvider>
    </div>
  );
}
