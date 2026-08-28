/*
 * Runs on the audio thread and does nothing but hand each block of samples to
 * the page, which encodes it. Encoding here would be the wrong place: the
 * audio thread must never be made to wait, and a game in the foreground is
 * exactly when it would be.
 *
 * Plain JavaScript on purpose — it is loaded by URL as an asset rather than
 * bundled, because `audioWorklet.addModule` fetches a real file.
 */
class Mp3TapProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const input = inputs[0]
    if (!input || input.length === 0) return true
    // A copy per channel: the buffers handed in are reused for the next block.
    this.port.postMessage(input.map((channel) => new Float32Array(channel)))
    return true
  }
}

registerProcessor('mp3-tap', Mp3TapProcessor)
