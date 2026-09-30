class ChordzCapture extends AudioWorkletProcessor {
  constructor(){super();this.active=false;this.startFrame=0;this.endFrame=Infinity;this.cursor=0;this.buffer=new Float32Array(8192);this.port.onmessage=event=>{if(event.data.type==='start'){this.active=true;this.startFrame=event.data.frame;}if(event.data.type==='stop'){this.endFrame=event.data.frame??currentFrame;this.active=false;this.flush();this.port.postMessage({type:'stopped'});}};}
  flush(){if(!this.cursor)return;const data=this.cursor===this.buffer.length?this.buffer:this.buffer.slice(0,this.cursor);this.port.postMessage({type:'chunk',buffer:data.buffer},[data.buffer]);this.buffer=new Float32Array(8192);this.cursor=0;}
  process(inputs){const input=inputs[0];if(this.active&&input?.[0]){for(let i=0;i<input[0].length;i++){if(currentFrame+i<this.startFrame||currentFrame+i>=this.endFrame)continue;let value=0;for(const channel of input)value+=channel[i]??0;this.buffer[this.cursor++]=value/input.length;if(this.cursor===this.buffer.length)this.flush();}}return true;}
}
registerProcessor('chordz-capture',ChordzCapture);
