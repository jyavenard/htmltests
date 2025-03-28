    var _logger;

    function Logger(id) {
        this.el = document.getElementById('log');
        _logger = this;
    }
    var log_start = Date.now();
    Logger.prototype.log = function(msg) {
        var fragment = document.createDocumentFragment();
        fragment.appendChild(document.createTextNode((Date.now() - log_start) + ': ' + msg));
        fragment.appendChild(document.createElement('br'));
        this.el.appendChild(fragment);
    };

    Logger.prototype.clear = function() {
        this.el.textContent = '';
    };

function info(message) {
  logger.log(message);	
}

function Log(token, message) {
   logger.log("" + token + ":" + message);
}
    
function TimeStamp(token) {
    return "" + token;
}

function printDuration(logger, sb, ms) {
      logger.log('sourceBuffer.buffered.length = ' + sb.buffered.length);
      if (sb.buffered.length) {
        var dur = sb.buffered.end(0) - sb.buffered.start(0);
        logger.log('sourceBuffer.duration = ' + dur.toString());
	logger.log('sourceBuffer.buffered.start(0) = ' + sb.buffered.start(0));
	logger.log('sourceBuffer.buffered.end(0) = ' + sb.buffered.end(0));
      } else {
        logger.log('sourceBuffer.duration = 0');
      }
      logger.log('mediaSource.duration = ' + ms.duration);
      logger.log('video.duration = ' + video.duration);
    }

function printTimeRange(arg) {
    var res = "{";
    for (i = 0; i < arg.length; i++) {
	res += "{ " + arg.start(i) + "," + arg.end(i) + " }";
    }
    res += "}";
    return res;
}

function parseSearch(search) {
    var params = {};
    if (search.length > 1 && search[0] == '?') {
        search = search.substring(1);
        params = JSON.parse(
                '{"' + search.replace(/&/g, '","').replace(/=/g, '":"') + '"}',
                function (key, value) {
                    return key === "" ? value : decodeURIComponent(value)
                }
        );
    }
    return params;
}

function SetDuration(mediaSource, duration) {
    _logger.log('setting mediaSource.duration = ' + duration);
  try {
    mediaSource.duration = duration;
  } catch(e) {
    _logger.log('Exception: ' + e);
    return false;
  }
  _logger.log('mediaSource.duration = ' + mediaSource.duration);
  return true;
}

function addLoadEvent(func) {
  var oldonload = window.onload;
  if (typeof window.onload != 'function') {
    window.onload = func;
  } else {
    window.onload = function() {
      if (oldonload) {
        oldonload();
      }
      func();
    }
  }
}

function runWithMSE(testFunction) {
  function bootstrapTest() {
    var ms = new MediaSource();

    var el = document.createElement("video");
    el.src = URL.createObjectURL(ms);
    el.preload = "auto";

    document.body.appendChild(el);

    testFunction(ms, el);
  }

  addLoadEvent(function () {
     bootstrapTest();
  });
}

function fetchWithXHR(uri, onLoadFunction) {
  var p = new Promise(function(resolve, reject) {
    var xhr = new XMLHttpRequest();
    xhr.open("GET", uri, true);
    xhr.responseType = "arraybuffer";
    xhr.addEventListener("load", function () {
      info("fetchWithXHR load uri='" + uri + "' status=" + xhr.status);
      resolve(xhr.response);
    });
    xhr.send();
  });

  if (onLoadFunction) {
    p.then(onLoadFunction);
  }

  return p;
};

function range(start, end) {
  var rv = [];
  for (var i = start; i < end; ++i) {
    rv.push(i);
  }
  return rv;
}

function once(target, name, cb) {
  var p = new Promise(function(resolve, reject) {
    target.addEventListener(name, function() {
      target.removeEventListener(name, arguments.callee);
      resolve();
    });
  });
  if (cb) {
    p.then(cb);
  }
  return p;
}

function timeRangeToString(r) {
  var str = "TimeRanges: ";
  for (var i = 0; i < r.length; i++) {
    str += "[" + r.start(i) + ", " + r.end(i) + ")";
  }
  return str;
}

function loadSegment(sb, typedArrayOrArrayBuffer) {
  var typedArray = (typedArrayOrArrayBuffer instanceof ArrayBuffer) ? new Uint8Array(typedArrayOrArrayBuffer)
                                                                    : typedArrayOrArrayBuffer;
  // info(`Loading buffer: [${typedArray.byteOffset}, ${typedArray.byteOffset + typedArray.byteLength})`);
  var beforeBuffered = timeRangeToString(sb.buffered);
  return new Promise(function(resolve, reject) {
    once(sb, 'update').then(function() {
      var afterBuffered = timeRangeToString(sb.buffered);
      info("SourceBuffer buffered ranges grew from " + beforeBuffered + " to " + afterBuffered);
      resolve();
    });
    sb.appendBuffer(typedArray);
  });
}

function fetchAndLoad(sb, prefix, chunks, suffix) {

  // Fetch the buffers in parallel.
  var buffers = {};
  var fetches = [];
  for (var chunk of chunks) {
    (function(chunk) {
      fetches.push(fetchWithXHR(prefix + chunk + suffix).then(function(x) { buffers[chunk] = x; }));
    })(chunk);
  }


  // Load them in series, as required per spec.
  return Promise.all(fetches).then(function() {
    var rv = Promise.resolve();
    for (var chunk of chunks) {
      rv = rv.then(loadSegment.bind(null, sb, buffers[chunk]));
    }
    return rv;
  });
}

function info(message) {
  _logger.log(message);	
}

function ok(value, message) {
  _logger.log("ok" + (value ? "(true) " : "(false) ") + message);	
}

function is(value1, value2, message) {
  var result = value1 == value2;
  _logger.log("is(" + value1 + " == " + value2 + "): " + result + " (" + message + ")");	
}

function isfuzzy(value1, value2, fuzz, message) {
  var result = (value1 >= value2 - fuzz && value1 <= value2 + fuzz);
  _logger.log("" + value1 + " == " + value2 + " ~" + fuzz + ": " + result + " (" + message + ")");	
}

var SimpleTest = {};

SimpleTest.waitForExplicitFinish = function() {
  _logger.log("SimpleTest.waitForExplicitFinish()");
};

SimpleTest.finish = function() {
  _logger.log("SimpleTest.finish()");
};
