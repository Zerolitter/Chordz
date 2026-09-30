import { AudioProcessor } from "./worker-client";
export class MicrophoneRecorder {
  private stream: MediaStream | null = null;
  private input: MediaStreamAudioSourceNode | null = null;
  private worklet: AudioWorkletNode | null = null;
  private silent: GainNode | null = null;
  private monitor: GainNode | null = null;
  private analyser: AnalyserNode | null = null;
  private chunks: Float32Array[] = [];
  private sealed = false;
  private armed = false;
  private disposed = false;
  private context: AudioContext | null = null;
  private startFrame = 0;
  private stopFrame = 0;
  private stopJob: Promise<{blob: Blob; duration: number; sampleRate: number; peaks: number[]}> | null = null;
  private finish: (() => void) | null = null;
  readonly processor = new AudioProcessor();
  async prepare(context: AudioContext, deviceId?: string, destination: AudioNode = context.destination) {
    if (!navigator.mediaDevices?.getUserMedia)
      throw new Error(
        "Microphone recording needs a supported browser on HTTPS.",
      );
    this.context = context;
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        channelCount: 1,
      },
    });
    if (this.disposed) { stream.getTracks().forEach(t => t.stop()); return; }
    this.stream = stream;
    try {
      await context.audioWorklet.addModule("/audio/capture.worklet.js");
      if (this.disposed) return;
      this.input = context.createMediaStreamSource(this.stream);
      this.worklet = new AudioWorkletNode(context, "chordz-capture");
      this.silent = context.createGain();
      this.silent.gain.value = 0;
      this.monitor = context.createGain();
      this.monitor.gain.value = 0;
      this.analyser = context.createAnalyser();
      this.analyser.fftSize = 512;
      this.input.connect(this.worklet);
      this.worklet.connect(this.silent);
      this.silent.connect(context.destination);
      this.input.connect(this.analyser);
      this.input.connect(this.monitor);
      this.monitor.connect(destination);
      this.processor.send({
        type: "record-start",
        sampleRate: context.sampleRate,
      });
      this.worklet.port.onmessage = (event) => {
        if (event.data.type === "chunk") {
          this.chunks.push(new Float32Array(event.data.buffer).slice());
          this.processor.send(
            { type: "record-chunk", buffer: event.data.buffer },
            [event.data.buffer],
          );
        }
        if (event.data.type === "stopped") this.finish?.();
      };
    } catch (error) {
      this.cleanup();
      throw error;
    }
  }
  start(at: number, context: AudioContext) {
    if (!this.worklet) throw new Error("Choose and enable a microphone first.");
    this.armed = true;
    this.startFrame = Math.round(at * context.sampleRate);
    this.worklet.port.postMessage({
      type: "start",
      frame: Math.round(at * context.sampleRate),
    });
  }
  setMonitoring(enabled: boolean) {
    if (this.monitor)
      this.monitor.gain.setTargetAtTime(
        enabled ? 0.3 : 0,
        this.monitor.context.currentTime,
        0.02,
      );
  }
  meter() {
    if (!this.analyser) return 0;
    const values = new Float32Array(this.analyser.fftSize);
    this.analyser.getFloatTimeDomainData(values);
    let peak = 0;
    for (const value of values) peak = Math.max(peak, Math.abs(value));
    return peak;
  }
  muteMonitoring() {
    if (!this.monitor) return;
    const at = this.monitor.context.currentTime;
    this.monitor.gain.cancelAndHoldAtTime(at);
    this.monitor.gain.linearRampToValueAtTime(0, at + 0.02);
  }
  stop(at = this.context?.currentTime ?? 0) {
    if (this.stopJob) return this.stopJob.catch(()=>this.encodeSealed());
    this.stopFrame = Math.round(at * (this.context?.sampleRate ?? 48000));
    this.muteMonitoring();
    this.stopJob = this.finishCapture();
    return this.stopJob;
  }
  private async finishCapture() {
    if (!this.worklet || !this.armed) throw new Error("There is no microphone take to finish.");
    this.armed = false;
    try {
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error("The microphone stopped responding.")),5000);
        this.finish = () => { clearTimeout(timeout); resolve(); };
        this.worklet!.port.postMessage({ type: "stop", frame: this.stopFrame });
      });
    } finally { this.sealed=true; this.cleanup(); }
    return this.encodeSealed();
  }
  async encodeSealed() {
    if(!this.sealed) throw new Error("The recording has not finished capture yet.");
    this.processor.send({type:"record-start",sampleRate:this.context!.sampleRate});
    for(const chunk of this.chunks) { const buffer=chunk.slice().buffer; this.processor.send({type:"record-chunk",buffer},[buffer]); }
    const result = await this.processor.run({ type: "record-stop", length: Math.max(0,this.stopFrame-this.startFrame) });
    return { blob: new Blob([result.wav as ArrayBuffer], {type:"audio/wav"}), duration: result.duration as number,
      sampleRate: result.sampleRate as number, peaks: result.peaks as number[] };
  }
  acknowledge() { this.chunks=[]; this.processor.send({ type: "record-clear" }); }
  private cleanup() {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    for (const node of [
      this.input,
      this.worklet,
      this.silent,
      this.monitor,
      this.analyser,
    ])
      node?.disconnect();
    this.input = null;
    this.worklet = null;
    this.silent = null;
    this.monitor = null;
    this.analyser = null;
  }
  dispose() {
    this.disposed = true;
    this.cleanup();
    this.processor.dispose();
  }
}
