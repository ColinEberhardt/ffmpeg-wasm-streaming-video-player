const { Observable, fromEvent, partition, combineLatest, zip } = rxjs;
const { map, flatMap, take, skip } = rxjs.operators;

const bufferStream = filename =>
  new Observable(async subscriber => {
    const ffmpeg = FFmpeg.createFFmpeg({
      corePath: "thirdparty/ffmpeg-core.js",
      log: false
    });

    const fileExists = file => ffmpeg.FS("readdir", "/").includes(file);
    const readFile = file => ffmpeg.FS("readFile", file);

    await ffmpeg.load();
    const sourceBuffer = await fetch(filename).then(r => r.arrayBuffer());
    ffmpeg.FS(
      "writeFile",
      "input.mp4",
      new Uint8Array(sourceBuffer, 0, sourceBuffer.byteLength)
    );

    let index = 0;

    ffmpeg
      .run(
        "-i",
        "input.mp4",
        "-g",
        "1",
        // Encode for MediaStream
        "-segment_format_options",
        "movflags=frag_keyframe+empty_moov+default_base_moof",
        // encode 5 second segments
        "-segment_time",
        "5",
        // write to files by index
        "-f",
        "segment",
        "%d.mp4"
      )
      .then(() => {
        // send out the remaining files
        while (fileExists(`${index}.mp4`)) {
          subscriber.next(readFile(`${index}.mp4`));
          index++;
        }
        subscriber.complete();
      });

    setInterval(() => {
      // periodically check for files that have been written
      if (fileExists(`${index + 1}.mp4`)) {
        subscriber.next(readFile(`${index}.mp4`));
        index++;
      }
    }, 200);
  });

const mediaSource = new MediaSource();
videoPlayer.src = URL.createObjectURL(mediaSource);
videoPlayer.play();

const mediaSourceOpen = fromEvent(mediaSource, "sourceopen");

const bufferStreamReady = combineLatest(
  mediaSourceOpen,
  bufferStream("tests/4club-JTV-i63.mp4")
).pipe(map(([, a]) => a));

const sourceBufferUpdateEnd = bufferStreamReady.pipe(
  take(1),
  map(buffer => {
    // create a buffer using the correct mime type
    const mime = `video/mp4; codecs="${muxjs.mp4.probe
      .tracks(buffer)
      .map(t => t.codec)
      .join(",")}"`;
    const sourceBuf = mediaSource.addSourceBuffer(mime);

    // append the buffer
    mediaSource.duration = 5;
    sourceBuf.timestampOffset = 0;
    sourceBuf.appendBuffer(buffer);

    // create a new event stream 
    return fromEvent(sourceBuf, "updateend").pipe(map(() => sourceBuf));
  }),
  flatMap(value => value)
);

zip(sourceBufferUpdateEnd, bufferStreamReady.pipe(skip(1)))
  .pipe(
    map(([sourceBuf, buffer]) => {
      mediaSource.duration += 5;
      sourceBuf.timestampOffset += 5;
      sourceBuf.appendBuffer(buffer.buffer);
    })
  )
  .subscribe();
