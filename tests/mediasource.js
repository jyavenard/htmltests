// Helpers for Media Source Extensions tests
    var _logger;

    function Logger(id) {
        this.el = document.getElementById(id);
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

function runWithMSE(testFunction, id = 'log') {
  window.onload = function() {
    var ms = new MediaSource();

    var el = document.createElement("video");
    el.src = URL.createObjectURL(ms);
    el.preload = "auto";

    document.body.appendChild(el);

    var log = document.createElement("pre");
    log.setAttribute("id", id);
    document.body.appendChild(log);

    var logger = new Logger(id);

    testFunction(ms, el);
  };
}

function fetchWithXHR(uri, onLoadFunction) {
  var p = new Promise(function(resolve, reject) {
    var xhr = new XMLHttpRequest();
    xhr.open("GET", uri, true);
    xhr.responseType = "arraybuffer";
    xhr.addEventListener("load", function () {
      is(xhr.status, 200, "fetchWithXHR load uri='" + uri + "' status=" + xhr.status);
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
  info(`Loading buffer: [${typedArray.byteOffset}, ${typedArray.byteOffset + typedArray.byteLength})`);
  var beforeBuffered = timeRangeToString(sb.buffered);
  return new Promise(function(resolve, reject) {
    once(sb, 'update').then(function() {
      var afterBuffered = timeRangeToString(sb.buffered);
      info(`SourceBuffer buffered ranges grew from ${beforeBuffered} to ${afterBuffered}`);
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
    fetches.push(fetchWithXHR(prefix + chunk + suffix).then(((c, x) => buffers[c] = x).bind(null, chunk)));
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

var SimpleTest = {};
/**
 * Tells SimpleTest to don't finish the test when the document is loaded,
 * useful for asynchronous tests.
 *
 * When SimpleTest.waitForExplicitFinish is called,
 * explicit SimpleTest.finish() is required.
**/
SimpleTest.waitForExplicitFinish = function () {
    SimpleTest._stopOnLoad = false;
};

/**
 * Finishes the tests. This is automatically called, except when
 * SimpleTest.waitForExplicitFinish() has been invoked.
**/
SimpleTest.finish = function () {
    _logger.log("SimpleTest.finish");
};

/**
 * Shows the report in the browser
**/

SimpleTest.showReport = function() {
    var togglePassed = A({'href': '#'}, "Toggle passed tests");
    var toggleFailed = A({'href': '#'}, "Toggle failed tests");
    togglePassed.onclick = partial(SimpleTest.toggleByClass, 'test_ok');
    toggleFailed.onclick = partial(SimpleTest.toggleByClass, 'test_not_ok');
    var body = document.body;  // Handles HTML documents
    if (!body) {
	// Do the XML thing
	body = document.getElementsByTagNameNS("http://www.w3.org/1999/xhtml",
					       "body")[0]
    }
    var firstChild = body.childNodes[0];
    var addNode;
    if (firstChild) {
        addNode = function (el) {
            body.insertBefore(el, firstChild);
        };
    } else {
        addNode = function (el) {
            body.appendChild(el)
        };
    }
    addNode(togglePassed);
    addNode(SPAN(null, " "));
    addNode(toggleFailed);
    addNode(SimpleTest.report());
};
