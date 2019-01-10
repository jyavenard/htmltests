const BREAK_PLAYBACK = true;
const AUDIO_CODEC_STRING = 'audio/webm; codecs="opus"';
const VIDEO_CODEC_STRING = 'video/webm; codecs="vp09.00.51.08.01.01.01.01"';
const logError = (error) => {
  console.error(error, error.message);
};

const delay = async (timeout) => {
  return new Promise((resolve, reject) => {
    setTimeout(resolve, timeout);
  });
};

const CACHE = {};

class Player {
  constructor() {
    this.videoTag = document.getElementById("main-video");
    this.mediaSource = null;
    this.audioSourceBuffer = null;
    this.videoSourceBuffer = null;
  }

  /**
   * Sets up media source, returns a promise after media source has opened
   * and attached.
   */
  setUpMediaSource() {
    let promiseResolver;
    let promise = new Promise((resolve, reject) => { promiseResolver = resolve; });
    this.mediaSource = new MediaSource();
    this.mediaSource.addEventListener('sourceopen', () => {
        this.audioSourceBuffer = this.mediaSource.addSourceBuffer(AUDIO_CODEC_STRING);
        this.videoSourceBuffer = this.mediaSource.addSourceBuffer(VIDEO_CODEC_STRING);
        this.audioSourceBuffer.addEventListener('error', logError);
        this.videoSourceBuffer.addEventListener('error', logError);
        promiseResolver();
    });
    this.videoTag.src = window.URL.createObjectURL(this.mediaSource);
    return promise;
  }

  /** Does a (potentially partial) fetch. */
  async doFetch(mediaUrl, offset, length) {
    let data;
    if (mediaUrl in CACHE) {
      data = CACHE[mediaUrl];
    } else {
      const response = await fetch(mediaUrl);
      data = await response.arrayBuffer();
      CACHE[mediaUrl] = data;
    }

    const sliced = data.slice(offset, length + offset);
    return sliced;
  }

  /** Fetches and appends some media. */
  async fetchAndAppend(mediaUrl, isAudio, offset=0, length=Infinity) {
    const bytes = await this.doFetch(mediaUrl, offset, length);
    const buffer = isAudio ? this.audioSourceBuffer : this.videoSourceBuffer;
    while (true) {
      if (!buffer.updating) {
        buffer.appendBuffer(bytes);
        return;
      }
      await delay(100);
    }
  }

  /** Starts the player. */
  async initialize() {
    await this.setUpMediaSource();
    this.videoTag.play().catch(logError);
    await this.fetchAndAppend('audio.webm', true, 0, 189964);
    await this.fetchAndAppend('video.webm', false, 0, 87355 + (BREAK_PLAYBACK ? 3000 : 0));

    // Now we do the special bits: abort the video append,
    this.videoTag.currentTime = 11;
    this.videoSourceBuffer.abort();
    await this.fetchAndAppend('video.webm', false, 0, 3150); // Init segment
    await this.fetchAndAppend('video.webm', false, 159968, 72931); // 10 - 15
    await this.fetchAndAppend('audio.webm', true, 189964, 176153); // 10 - 20
    
    await delay(500); // Give things some time to settle.

    console.log(this.videoSourceBuffer.buffered);
    console.log(this.videoSourceBuffer.updating);
    for (let i = 0; i < this.videoSourceBuffer.buffered.length; i++) {
      console.log(`${this.videoSourceBuffer.buffered.start(i)}-${this.videoSourceBuffer.buffered.end(i)}`);
    }
  }
}

const player = new Player();
player.initialize();
