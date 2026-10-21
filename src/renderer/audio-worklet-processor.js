/* global AudioWorkletProcessor, registerProcessor, sampleRate */

/**
 * Audio before the hotkey press to include in each recording. While the
 * mic is kept open between dictations the processor keeps the most
 * recent PREROLL_S of audio, so a first syllable spoken at the same
 * moment as the key press isn't clipped.
 */
const PREROLL_S = 0.3;

class RecorderProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._recording = false;
    this._ring = new Float32Array(Math.round(sampleRate * PREROLL_S));
    this._ringPos = 0;
    this._ringFilled = 0;
    this.port.onmessage = (e) => {
      if (e.data === "start") {
        this._flushPreroll();
        this._recording = true;
      } else if (e.data === "stop") {
        this._recording = false;
      }
    };
  }

  /** Send buffered pre-press audio (oldest first), then clear it. */
  _flushPreroll() {
    if (this._ringFilled === 0) return;
    const size = this._ring.length;
    const out = new Float32Array(this._ringFilled);
    const start = (this._ringPos - this._ringFilled + size) % size;
    for (let i = 0; i < this._ringFilled; i++) {
      out[i] = this._ring[(start + i) % size];
    }
    this._ringFilled = 0;
    this.port.postMessage(out);
  }

  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (!channel) return true;
    if (this._recording) {
      this.port.postMessage(new Float32Array(channel));
      return true;
    }
    const size = this._ring.length;
    for (let i = 0; i < channel.length; i++) {
      this._ring[this._ringPos] = channel[i];
      this._ringPos = (this._ringPos + 1) % size;
    }
    this._ringFilled = Math.min(size, this._ringFilled + channel.length);
    return true;
  }
}

registerProcessor("recorder-processor", RecorderProcessor);
