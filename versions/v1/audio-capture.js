// Local AudioWorklet. Captures mono PCM while keeping the output silent.
class AfterimageCapture extends AudioWorkletProcessor {
  constructor(){super();this.buffer=new Float32Array(2048);this.offset=0;}
  process(inputs,outputs){
    for(const output of outputs)for(const channel of output)channel.fill(0);
    const input=inputs[0];
    if(!input||!input.length)return true;
    for(let i=0;i<input[0].length;i++){
      let sample=0;for(const channel of input)sample+=channel[i]/input.length;
      this.buffer[this.offset++]=sample;
      if(this.offset===this.buffer.length){
        this.port.postMessage(this.buffer,[this.buffer.buffer]);
        this.buffer=new Float32Array(2048);this.offset=0;
      }
    }
    return true;
  }
}
registerProcessor('afterimage-capture',AfterimageCapture);
