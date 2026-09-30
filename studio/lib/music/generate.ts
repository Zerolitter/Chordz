import {
  PPQ,
  uid,
  clamp,
  type GenerationOptions,
  type NoteEvent,
  type ProjectDocument,
  type Section,
} from "./types";
import {resolveHarmony,harmonyAt,tonicHarmony} from "./harmony";
import { scaleNotes, pitchClass } from "./theory";
import { evaluateMovement, MAX_GENERATED_NOTES } from "./chord-movement";

export function randomGenerator(seed: number) {
  let value = seed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let x = value;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}
export function generatePart(
  project: ProjectDocument,
  section: Section,
  options: GenerationOptions,
): NoteEvent[] {
  const random = randomGenerator(options.seed);
  const bar = (PPQ * project.timeSignature[0] * 4) / project.timeSignature[1];
  const step = options.energy > 0.7 ? PPQ / 4 : PPQ / 2;
  const notes: NoteEvent[] = [];
  const scale = scaleNotes(project.key, project.mode);
  const spans=resolveHarmony(project,section),fallback=tonicHarmony(project);
  const octaveBase=(options.register+1)*12;
  if (options.chordMovement?.enabled && ["chords", "strings", "arpeggio"].includes(options.role)) {
    const movement = options.chordMovement;
    const generated: NoteEvent[] = [];
    for (const span of spans) {
      if (!span.notes) continue;
      const voicing = span.notes.map((pitch, index) => octaveBase + (pitch % 12) + (index > 0 && pitch % 12 < span.notes![0] % 12 ? 12 : 0));
      const part = evaluateMovement(voicing, movement, { startTick: span.startTick - section.startTick, lengthTick: span.endTick - span.startTick, velocity: .35 + options.energy * .45, seed: options.seed + movement.seed, maxNotes: MAX_GENERATED_NOTES - generated.length });
      generated.push(...part.map(note => options.role === "strings" ? { ...note, articulation: "sustain" } : note));
    }
    return generated;
  }
  let pitches:number[]=fallback,voicing:number[]=[];
  function setHarmony(tick:number){pitches=[...(harmonyAt(spans,tick)?.notes??fallback)];voicing=pitches.map((p,i)=>octaveBase+(p%12)+(i>0&&p%12<pitches[0]%12?12:0)).sort((a,b)=>a-b); }
  let lastPitch = (options.register + 1) * 12 + pitchClass(project.key);
  function add(
    pitch: number,
    tick: number,
    duration: number,
    velocity: number,
    articulation?: string,
  ) {
    if(options.role!=="drums"){
      const absolute=section.startTick+tick,span=harmonyAt(spans,absolute);if(!span?.notes)return;
      const rest=spans.find(s=>!s.notes&&s.startTick>absolute);if(rest)duration=Math.min(duration,rest.startTick-absolute);
      if(options.role==="bass"){const end=absolute+duration,offset=pitch-(octaveBase+(span.notes[0]%12));for(const part of spans){const a=Math.max(absolute,part.startTick),b=Math.min(end,part.endTick);if(part.notes&&b>a)push(octaveBase+part.notes[0]%12+offset,a-section.startTick,b-a,velocity,articulation);}return;}
    }
    push(pitch,tick,duration,velocity,articulation);
  }
  function push(pitch:number,tick:number,duration:number,velocity:number,articulation?:string){
    notes.push({
      id: uid(),
      pitch: clamp(pitch, 0, 127),
      tick: Math.round(tick),
      duration: Math.max(
        1,
        Math.round(Math.min(duration, section.lengthTick - tick)),
      ),
      velocity: clamp(velocity, 0.12, 1),
      ...(articulation ? { articulation } : {}),
    });
  }
  for (let local = 0; local < section.lengthTick; local += bar) {
    const absolute = section.startTick + local;
    setHarmony(absolute);
    if (options.role === "chords" || options.role === "strings") {
      const pulses =
        options.role === "strings" || options.density < 0.65 ? 1 : 2;
      const starts=[...new Set([...Array.from({length:pulses},(_,pulse)=>local+pulse*bar/pulses),...spans.filter(s=>s.startTick>absolute&&s.startTick<absolute+bar).map(s=>s.startTick-section.startTick)])].sort((a,b)=>a-b);
      for(const [i,onset] of starts.entries()){
        setHarmony(section.startTick+onset);
        const gate=bar/pulses*(options.role==="strings"?.99:.84),next=starts[i+1]??local+bar;
        for(const p of voicing)add(p,onset,Math.min(gate,next-onset),.35+options.energy*.35+random()*.08,options.role==="strings"?"sustain":undefined);
      }
    } else if (options.role === "bass") {
      const root = octaveBase + (pitches[0] % 12);
      add(
        root,
        local,
        options.density < 0.45 ? bar * 0.9 : PPQ * 0.85,
        0.6 + options.energy * 0.2,
      );
      if (options.density > 0.4){
        setHarmony(absolute+bar/2);
        add(
          octaveBase+(pitches[0]%12),
          local + bar / 2,
          Math.min(PPQ * 0.8, bar / 2),
          0.5 + options.energy * 0.2,
        );
      }
      if (options.density > 0.72 && bar >= PPQ * 3){setHarmony(absolute+bar-PPQ);add(octaveBase+(pitches[0]%12)+7,local+bar-PPQ,PPQ*.75,.6);}
    } else if (options.role === "drums") {
      for (let pos = 0; pos < bar; pos += PPQ / 2) {
        if (
          pos === 0 ||
          pos === PPQ * 2 ||
          (options.energy > 0.65 && random() < 0.18)
        )
          add(36, local + pos, PPQ * 0.2, 0.65 + options.energy * 0.25);
        if (pos === PPQ || pos === PPQ * 3)
          add(38, local + pos, PPQ * 0.15, 0.65 + options.energy * 0.2);
        if (random() < 0.4 + options.density * 0.6)
          add(
            pos === bar - PPQ / 2 && options.energy > 0.6 ? 46 : 42,
            local + pos,
            PPQ * 0.12,
            0.25 + random() * 0.2,
          );
      }
      if (local === 0 && options.energy > 0.6) add(49, local, PPQ * 2, 0.6);
    } else if (options.role === "arpeggio") {
      for (let pos = 0, i = 0; pos < bar; pos += step, i++)
        if (random() < 0.3 + options.density * 0.7){
          setHarmony(absolute+pos);
          add(
            voicing[i % voicing.length] + (i % 8 >= 4 ? 12 : 0),
            local + pos,
            step * 0.72,
            0.4 + random() * 0.2 + options.energy * 0.15,
          );
        }
    } else {
      const motif = [0, 2, 1, 3, 2, 1, 4, 2];
      for (let pos = 0, i = 0; pos < bar; pos += PPQ / 2, i++) {
        if (i > 0 && random() > 0.2 + options.density * 0.7) continue;
        setHarmony(absolute+pos);
        const pool =
          i % 4 === 0 || random() > options.tension
            ? voicing
            : scale.map((pc) => octaveBase + pc);
        const sorted = pool
          .flatMap((p) => [p - 12, p, p + 12])
          .sort((a, b) => Math.abs(a - lastPitch) - Math.abs(b - lastPitch));
        const pitch =
          sorted[Math.min(motif[i % motif.length] % 3, sorted.length - 1)];
        lastPitch = clamp(pitch, octaveBase - 5, octaveBase + 19);
        add(
          lastPitch,
          local + pos,
          PPQ * (i % 4 === 0 ? 0.85 : 0.4),
          0.48 + options.energy * 0.25 + random() * 0.08,
        );
      }
    }
  }
  return notes.filter((n) => n.tick < section.lengthTick);
}
