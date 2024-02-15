// Customize the demo media here:
const MEDIA_URL = 'test-10seconds.mp4';
const MEDIA_TYPE = 'video/mp4; codecs="avc1.640028,mp4a.40.2"';
// const MEDIA_URL = 'test-10seconds.webm';
// const MEDIA_TYPE = 'video/webm; codecs="vp9,opus"';

const DEFAULT_APPEND_SIZE_CLASS_SELECTOR = '.append-512';
const DEFAULT_BUSYWAIT_DURATION_CLASS_SELECTOR = '.busywait-800';
// End of demo customization.

// See onload() for initialization of these element references.
let button;
let main_div;
let worker_div;
let wait_div;

let wait_counter = 0;
let wait_handle;
let pending_ended_count_before_stopping_busywait = 0;
let worker;
let main_video_tag;
let worker_video_tag;

// Render timing for log messages
let initial_time = null;

// Radio buttons update these parameters for the next demo start. Their default
// selections are set in onload()'s call to populateParametersTable(). Their
// current values are fetched and used at the beginning of
// startBothDemoPlayers() for that instance of the demo run.
let configured_append_size;
function updateConfiguredAppendSize() {
  configured_append_size = parseInt(
      document.querySelector('input[name=append-size]:checked').value, 10);
}
let configured_busywait_duration_milliseconds;
function updateConfiguredBusywaitDuration() {
  configured_busywait_duration_milliseconds = parseInt(
      document.querySelector('input[name=busywait-duration]:checked').value, 10);
}

function startBusyWaiting() {
  let wait_start = performance.now();
  wait_counter++;
  wait_div.innerText = 'Iteration #' + wait_counter + ' of busy-waiting ' +
      configured_busywait_duration_milliseconds + ' milliseconds on main thread...';

  while (performance.now() - wait_start < configured_busywait_duration_milliseconds) {
    /* busy-wait */
  }

  wait_div.innerText += 'done';
  wait_handle = setTimeout(startBusyWaiting, 0);
}

function stopBusyWaiting() {
  if (wait_handle != undefined) {
    clearTimeout(wait_handle);
    wait_handle = undefined;
    wait_counter = 0;
    wait_div.innerText =
        'All players have ended or errored. Stopped busy-waiting on main thread.';
  }
}

function log(log_div, entry) {
  let time_millis = null;
  if (initial_time !== null) {
    time_millis = Date.now() - initial_time;
  } else {
    time_millis = 0;
    initial_time = Date.now();
  }

  let span = document.createElement('span');
  span.innerHTML = `${time_millis}ms : ${entry}<br>`;
  log_div.appendChild(span);
}

function incrementPendingEnded() {
  if (pending_ended_count_before_stopping_busywait == 0)
    startBusyWaiting();

  pending_ended_count_before_stopping_busywait++;
}

function decrementPendingEnded() {
  if (pending_ended_count_before_stopping_busywait > 0) {
    pending_ended_count_before_stopping_busywait--;
    if (pending_ended_count_before_stopping_busywait <= 0)
      stopBusyWaiting();
  }
}

function startMseBufferingInWorker(log_div, video) {
  return new Promise((resolve, reject) => {
    log(log_div, 'Starting worker');
    let handled_error = false;
    worker = new Worker('demo-worker.js');
    worker.onerror = (e) => {
      log(log_div,
          'Error event from worker: message=\'' + e.message +
              '\', filename=' + e.filename + ', lineno=' + e.lineno);
      if (!handled_error) {
        handled_error = true;
        decrementPendingEnded();
      }
      log(log_div, 'Terminating worker due to error');
      worker.terminate();
      worker.onerror = undefined;
      worker.onmessage = undefined;
      worker = undefined;
      reject(e);
      return;
    };

    // Note, we could just have the worker initiate fetch immediately
    // when started (though still await sourceopen to begin buffering),
    // but to help make this demo more reusable without having to hardcode
    // MEDIA_URL and MEDIA_TYPE in the worker code, we provide it with
    // that info via an initial message.
    worker.postMessage({
      media_url: MEDIA_URL,
      media_type: MEDIA_TYPE,
      append_size: configured_append_size
    });

    worker.onmessage = msg => {
      // For debugging:
      // log(log_div, "Received msg from worker: topic=" + msg.data.topic + ",
      // arg=" + msg.data.arg);
      switch (msg.data.topic) {
        case 'handle':
          log(log_div,
              'received handle message: ' + msg.data.arg +
                  ', setting video srcObject attr');
          video.srcObject = msg.data.arg;
          video.play().then(resolve).catch(e => reject(e));
          break;
        case 'info':
          log(log_div, 'info message from worker: ' + msg.data.arg);
          break;
        default:
          log(log_div, 'error: Unrecognized topic in message from worker');
          break;
      }
      return;
    };

    return;
  });
}

function startMseBufferingInMain(log_div, video) {
  let media_source = new MediaSource();
  let object_url = URL.createObjectURL(media_source);
  video.src = object_url;
  return Promise.all([
    // Let playback start when ready.
    video.play(),

    // Meanwhile, begin fetching and appending.
    whenSourceOpenedThenFetchAndAppendInChunks(
        media_source, MEDIA_URL, MEDIA_TYPE, configured_append_size,
        object_url /* sourceopen handler in utility script will revoke this url
                    */
        ,
        logmsg => {
          log(log_div, logmsg);
        })
  ]);
}

function startDemoPlayer(div, use_worker) {
  div.innerText = '';
  div.appendChild(document.createElement('hr'));
  const video = document.createElement('video');
  video.style.width = '100%';
  video.controls = true;
  div.appendChild(video);
  video.load();

  const log_div = document.createElement('div');
  div.appendChild(log_div);
  log(log_div,
      'Starting demo of MSE ' +
          (use_worker ? ' usage from worker' : ' usage from main thread'));

  let handled_decrement = false;
  incrementPendingEnded();
  if (wait_handle != undefined) {
    log(log_div, 'Ensured busy-waiting has started');
  } else {
    // This case should never occur, unless code has changed.
    log(log_div, 'Error: busy-waiting should have started. Aborting.');
    decrementPendingEnded();
    return;
  }

  if (window.MediaSource == undefined) {
    log(log_div,
        'Error: MediaSource API is unavailable from main/Window context.');
    decrementPendingEnded();
    return;
  }

  if (use_worker && (!MediaSource.hasOwnProperty('canConstructInDedicatedWorker') ||
                     MediaSource.canConstructInDedicatedWorker !== true)) {
    log(log_div,
        'Error: MediaSource API is unavailable from DedicatedWorker context.');
    decrementPendingEnded();
    return;
  }

  video.onerror = () => {
    log(log_div,
        'Video Element Error: code=' + video.error.code +
            ', message=' + video.error.message);
    if (!handled_decrement) {
      handled_decrement = true;
      decrementPendingEnded();
    }
    return;
  };

  video.onended = () => {
    log(log_div, 'Video Element \'ended\'');
    if (!handled_decrement) {
      handled_decrement = true;
      decrementPendingEnded();
    }
    return;
  };

  let player_promise;
  if (use_worker) {
    worker_video_tag = video;
    player_promise = startMseBufferingInWorker(log_div, video);
  } else {
    main_video_tag = video;
    player_promise = startMseBufferingInMain(log_div, video);
  }

  player_promise.catch(e => {
    if (!handled_decrement) {
      handled_decrement = true;
      decrementPendingEnded();
    }
    log(log_div, e);
    return;
  });
}

// We use a button's onclick to start the demo to satisfy autoplay user gesture
// requirement.
function startBothDemoPlayers() {
  updateButton('Starting', '', 'gray');
  wait_div.innerText = '';

  // Obtain the current configuration for this lifetime of players.
  updateConfiguredAppendSize();
  updateConfiguredBusywaitDuration();

  startDemoPlayer(main_div, false /* don't use_worker */);
  startDemoPlayer(worker_div, true /* do use_worker */);
  updateButton('Stop', stopDemoPlayers, 'white');
}

function stopDemoPlayers() {
  if (main_video_tag != undefined) {
    main_video_tag.removeAttribute('src');
    main_video_tag.load();
    main_video_tag = undefined;
    log(main_div, 'Stopped MSE usage on main thread demo');
  }
  if (worker != undefined) {
    log(worker_div, 'Terminating the worker context');
    worker.terminate();
    worker.onerror = undefined;
    worker.onmessage = undefined;
    worker = undefined;
  }
  if (worker_video_tag != undefined) {
    worker_video_tag.removeAttribute('src');
    worker_video_tag.load();
    worker_video_tag = undefined;
    log(worker_div, 'Stopped MSE usage in worker thread demo');
  }

  // Play promise rejection handling and MediaSource API usage after being
  // closed can also stop the busy-waiting. decrementPendingEnded() takes
  // care not to over-decrement. This is just a catch-all to ensure busy-waiting
  // stops.
  while (pending_ended_count_before_stopping_busywait > 0)
    decrementPendingEnded();

  updateButton('Start Demo', startBothDemoPlayers, 'white');
}

function updateButton(label, onclick, color) {
  button.innerText = label;
  button.onclick = onclick;
  button.style.backgroundColor = color;
}

function populateParametersTable() {
  document.querySelector('.media-url').innerText = MEDIA_URL;
  document.querySelector('.media-type').innerText = MEDIA_TYPE;

  document.querySelector(DEFAULT_APPEND_SIZE_CLASS_SELECTOR).checked = true;
  document.querySelector(DEFAULT_BUSYWAIT_DURATION_CLASS_SELECTOR).checked = true;
}

function checkIfMseInWorkerSupported() {
  let status_div = document.querySelector("b.supported-status");
  if (MediaSource && MediaSource.canConstructInDedicatedWorker === true && MediaSourceHandle) {
    status_div.innerText = "";
    document.querySelector("div.tldr-if-unsupported").innerText = "";  // Remove the tldr text.
  } else {
    status_div.innerText = "Error: this browser does not appear to support MSE-in-Workers (MediaSource.canConstructInDedicatedWorker !== true or browser is missing either MediaSource or MediaSourceHandle).";
  }
}

window.onload = () => {
  checkIfMseInWorkerSupported();
  button = document.querySelector('.start-stop');
  main_div = document.querySelector('div.main .player');
  worker_div = document.querySelector('div.worker .player');
  wait_div = document.querySelector('.top');
  populateParametersTable();
  updateButton('Start Demo', startBothDemoPlayers, 'white');
  wait_div.innerText = 'Awaiting Start';
  return;
};
