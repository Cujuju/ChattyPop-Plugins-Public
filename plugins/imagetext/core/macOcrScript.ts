// macOS OCR worker: the Vision framework, scripted through osascript's JavaScript (no compiler or install needed).
// Reads JSON {id,path} lines; emits readiness, then {id,text} or {id,error} per image.
export const MAC_OCR_SCRIPT = String.raw`
ObjC.import('Foundation');
ObjC.import('Vision');
const out = $.NSFileHandle.fileHandleWithStandardOutput;
function say(o) { out.writeData($(JSON.stringify(o) + '\n').dataUsingEncoding($.NSUTF8StringEncoding)); }
function read(path) {
  // Checked here: Vision's own errors come back through a pointer this bridge can't read safely.
  if (!$.NSFileManager.defaultManager.fileExistsAtPath(path)) throw new Error('The image file is missing.');
  const handler = $.VNImageRequestHandler.alloc.initWithURLOptions($.NSURL.fileURLWithPath(path), $({}));
  const request = $.VNRecognizeTextRequest.alloc.init;
  // 0 = accurate (the slower, better recognizer).
  request.recognitionLevel = 0;
  request.usesLanguageCorrection = true;
  if (!handler.performRequestsError($([request]), null)) throw new Error('macOS could not read this image.');
  const results = request.results;
  const lines = [];
  for (let i = 0; i < results.count; i++) lines.push(results.objectAtIndex(i).topCandidates(1).objectAtIndex(0).string.js);
  return lines.join('\n');
}
function run() {
  let language = 'en-US';
  try {
    const languages = $.VNRecognizeTextRequest.alloc.init.supportedRecognitionLanguagesAndReturnError(null);
    if (languages && languages.count) language = languages.objectAtIndex(0).js;
  } catch (e) {
    say({ ready: false, error: String(e.message || e) });
    return;
  }
  say({ ready: true, language: language });
  const input = $.NSFileHandle.fileHandleWithStandardInput;
  let buffered = '';
  for (;;) {
    const data = input.availableData;
    // Empty at end of input: the app closed the pipe, or is gone.
    if (!(Number(data.length) > 0)) break;
    buffered += $.NSString.alloc.initWithDataEncoding(data, $.NSUTF8StringEncoding).js;
    let at;
    while ((at = buffered.indexOf('\n')) >= 0) {
      const line = buffered.slice(0, at);
      buffered = buffered.slice(at + 1);
      if (!line.trim()) continue;
      let req;
      try { req = JSON.parse(line); } catch (e) { continue; }
      try { say({ id: req.id, text: read(req.path) }); } catch (e) { say({ id: req.id, error: String(e.message || e) }); }
    }
  }
}
`;
