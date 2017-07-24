    function Logger(id) {
        this.el = document.getElementById('log');
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
