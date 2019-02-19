/* jshint bitwise: false */
/* global MediaSource, console */

'use strict';

(function(window) {
    window.initGaplessAudio = function(audio, segmentUrls) {
        var SECONDS_PER_SAMPLE = 1 / 44100.0;

        var currIndex = 0;
        var audioOffset = 0;
        var mediaSource;
        var sourceBuffer;

        function timeRangeToString(r) {
          var str = "TimeRanges: ";
          for (var i = 0; i < r.length; i++) {
            str += "[" + r.start(i) + ", " + r.end(i) + ")";
          }
          return str;
        }

        function readInt(buffer) {
            var result = buffer.charCodeAt(0);

            for (var i = 1; i < buffer.length; ++i) {
                result <<= 8;
                result += buffer.charCodeAt(i);
            }

            return result;
        }

        function parseGaplessData(arrayBuffer) {
            // Gapless data is generally within the first 4096 bytes, so limit parsing.
            var byteStr = String.fromCharCode.apply(null, new Uint8Array(arrayBuffer.slice(0, 4096)));

            var frontPadding = 0;
            var endPadding = 0;
            var realSamples = 0;

            // iTunes encodes the gapless data as hex strings like so:
            //
            //    'iTunSMPB[ 26 bytes ]0000000 00000840 000001C0 0000000000046E00'
            //    'iTunSMPB[ 26 bytes ]####### frontpad  endpad    real samples'
            //
            // The approach here elides the complexity of actually parsing MP4 atoms. It
            // may not work for all files without some tweaks.
            var iTunesDataIndex = byteStr.indexOf('iTunSMPB');
            if (iTunesDataIndex !== -1) {
                var frontPaddingIndex = iTunesDataIndex + 34;
                frontPadding = parseInt(byteStr.substr(frontPaddingIndex, 8), 16);

                var endPaddingIndex = frontPaddingIndex + 9;
                endPadding = parseInt(byteStr.substr(endPaddingIndex, 8), 16);

                var sampleCountIndex = endPaddingIndex + 9;
                realSamples = parseInt(byteStr.substr(sampleCountIndex, 16), 16);
            }

            // Xing padding is encoded as 24bits within the header.  Note: This code will
            // only work for Layer3 Version 1 and Layer2 MP3 files with XING frame counts
            // and gapless information.  See the following documents for more details:
            // http://www.codeproject.com/Articles/8295/MPEG-Audio-Frame-Header (2.3.1)
            // http://gingko.homeip.net/docs/file_formats/dxhead.html (FRAMES_FLAG)
            var xingDataIndex = byteStr.indexOf('Xing');
            if (xingDataIndex === -1) {
                xingDataIndex = byteStr.indexOf('Info');
            }
            if (xingDataIndex !== -1) {
                var frameCountIndex = xingDataIndex + 8;
                var frameCount = readInt(byteStr.substr(frameCountIndex, 4));

                // For Layer3 Version 1 and Layer2 there are 1152 samples per frame.
                realSamples = frameCount * 1152;

                xingDataIndex = byteStr.indexOf('LAME');
                if (xingDataIndex === -1) {
                    xingDataIndex = byteStr.indexOf('Lavf');
                }
                if (xingDataIndex !== -1) {
                    var gaplessDataIndex = xingDataIndex + 21;
                    var gaplessBits = readInt(byteStr.substr(gaplessDataIndex, 3));

                    // Upper 12 bits are the front padding, lower are the end padding.
                    frontPadding = gaplessBits >> 12;
                    endPadding = gaplessBits & 0xFFF;
                }

                realSamples -= frontPadding + endPadding;
            }

            console.log(realSamples + ' -- ' + frontPadding + ' -- ' + endPadding);

            return {
                audioDuration: realSamples * SECONDS_PER_SAMPLE,
                frontPaddingDuration: frontPadding * SECONDS_PER_SAMPLE,
                endPaddingDuration: endPadding * SECONDS_PER_SAMPLE
            };
        }

        function onAudioLoaded(data) {
            // Parsing gapless metadata is unfortunately non trivial and a bit messy, so
            // we'll glaze over it here; see the appendix for details.
            // ParseGaplessData() will return a dictionary with two elements:
            //
            //    audioDuration: Duration in seconds of all non-padding audio.
            //    frontPaddingDuration: Duration in seconds of the front padding.
            //
            var gaplessMetadata = parseGaplessData(data);

            // Each appended segment must be appended relative to the next.  To avoid any
            // overlaps, we'll use the ending timestamp of the last append as the starting
            // point for our next append or zero if we haven't appended anything yet.
            var appendTime = audioOffset;
            audioOffset += gaplessMetadata.audioDuration;

            // Simply put, an append window allows you to trim off audio (or video) frames
            // which fall outside of a specified time range.  Here, we'll use the end of
            // our last append as the start of our append window and the end of the real
            // audio data for this segment as the end of our append window.
            sourceBuffer.appendWindowEnd = appendTime + gaplessMetadata.audioDuration;
            sourceBuffer.appendWindowStart = appendTime;

            // The timestampOffset field essentially tells MediaSource where in the media
            // timeline the data given to appendBuffer() should be placed.  I.e., if the
            // timestampOffset is 1 second, the appended data will start 1 second into
            // playback.
            //
            // MediaSource requires that the media timeline starts from time zero, so we
            // need to ensure that the data left after filtering by the append window
            // starts at time zero.  We'll do this by shifting all of the padding we want
            // to discard before our append time (and thus, before our append window).
            sourceBuffer.timestampOffset = appendTime - gaplessMetadata.frontPaddingDuration;

            // When appendBuffer() completes, it will fire an updateend event signaling
            // that it's okay to append another segment of media.  Here, we'll chain the
            // append for the next segment to the completion of our current append.
            if (currIndex === 0) {
                sourceBuffer.addEventListener('updateend', function() {
                    console.log("buffered=" + timeRangeToString(sourceBuffer.buffered));
                    if (++currIndex < segmentUrls.length) {
                        loadAudio(segmentUrls[currIndex]);
                    } else {
                        // We've loaded all available segments, so tell MediaSource there are no
                        // more buffers which will be appended.
                        audioOffset = 0;
                        mediaSource.endOfStream();
                    }
                });
            }

            // appendBuffer() will now use the timestamp offset and append window settings
            // to filter and timestamp the data we're appending.
            //
            // Note: While this demo uses very little memory, more complex use cases need
            // to be careful about memory usage or garbage collection may remove ranges of
            // media in unexpected places.
            sourceBuffer.appendBuffer(data);
        }

        function loadAudio(url) {
            var xhr = new XMLHttpRequest();
            xhr.onload = function() {
                if (xhr.status === 200) {
                    onAudioLoaded(xhr.response);
                } else {
                    console.error('Cannot load audio...');
                }
            };
            xhr.open('GET', url, true);
            xhr.responseType = 'arraybuffer';
            xhr.send(null);
        }

        function initMediaSource() {
            mediaSource = new MediaSource();

            if (!mediaSource) {
                console.error('MSE is not available');
                return;
            }

            audio.src = window.URL.createObjectURL(mediaSource);
            mediaSource.addEventListener('sourceopen', function() {
                sourceBuffer = mediaSource.addSourceBuffer('audio/mp4; codecs="mp4a.40.2"');
                loadAudio(segmentUrls[0]);
            }, false);
        }

        initMediaSource();
    };
}(window));
