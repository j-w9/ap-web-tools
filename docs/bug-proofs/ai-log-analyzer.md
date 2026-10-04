# AI Log Analyzer: bug proofs

Verdicts for the AI Log Analyzer rows of [`../upstream-bugs.md`](../upstream-bugs.md), under the standard in
[`README.md`](README.md). Every reproduction is in `proofs/ai-log-analyzer/ai-log-analyzer.test.ts` and runs the original
`upstream/AILogAnalyzer/logAnalyzer.js` in `node:vm` with a fake DOM, the upstream JsDataflashParser, the SITL log
`packages/dataflash/test-fixtures/copter-sitl.bin` and an in-process fake of the OpenAI v4 SDK (no network). Line numbers
are in `upstream/AILogAnalyzer/`.

Claims about how the OpenAI API reacts (a rejected message, an expiring run, files still being deleted) cannot be proven
from the repository: neither the tool's code nor its help text states the API's behaviour. Those parts are NOT PROVEN.

| Row | Bug                                                                             | Verdict       |
| --- | ------------------------------------------------------------------------------- | ------------- |
| 132 | `get` returns only the last instance of an instanced message                    | NOT PROVEN    |
| 133 | Numeric columns uploaded as `{"0": …}` objects                                  | NOT PROVEN    |
| 134 | A no-data failure drops the remembered file                                     | NOT PROVEN    |
| 135 | Successful calls in a mixed batch submitted without output                      | NOT PROVEN    |
| 136 | Message posted while the run is still cancelling                                | NOT PROVEN    |
| 137 | `.log` files offered but never read                                             | PROVEN, FIXED |
| 138 | Every `output.json` on the account deleted, without waiting                     | NOT PROVEN    |
| 139 | Only a 401 while connecting asks for a new key                                  | NOT PROVEN    |
| 140 | Errors in the tool handler and in the first connection are unhandled            | PROVEN, FIXED |
| 141 | Input re-enabled while tool data is uploaded                                    | NOT PROVEN    |
| 142 | Assistant text appended across messages; a delta without text shows "undefined" | NOT PROVEN    |

PROVEN 2, NOT PROVEN 9.

## 132. `get` returns only the last instance of an instanced message

**Row:** `logAnalyzer.js` `window.get` (`for … output = log.get_instance(…)`): `get("IMU")` uploads the highest IMU
instance only.

**Verdict:** NOT PROVEN (behaviour reproduced exactly).

**Test:** `#132 get("IMU") uploads only the last instance`. The fixture's IMU has instances `['0', '1']`; the uploaded
text is exactly `JSON.stringify(log.get_instance('IMU', '1'))` and every `I` value in it is `1`.

**Evidence:**

- `logAnalyzer.js:209-211`:
  `for (const inst of Object.keys(log.messageTypes[message].instances)) { output=log.get_instance(message, inst) }`.
  Every iteration but the last is overwritten.
- `assistantTools.json:8`: `"description": "Retrieve information related to the specified message type."`

The loop's dead stores make a bug likely, but nothing in the tool states what the file should hold for several instances
(one object per instance, keyed how, or merged), and the last instance is "information related to the specified message
type". No hard reference fixes the correct output, so the row stays reproduced.

## 133. Numeric columns uploaded as `{"0": …}` objects

**Row:** `window.get` (`JSON.stringify` of typed arrays): `output.json` holds index-keyed objects instead of arrays.

**Verdict:** NOT PROVEN (behaviour reproduced exactly).

**Test:** `#133 numeric columns are uploaded as index-keyed objects`. The upload starts
`{"TimeUS":{"0":2479841,"1":2679761,` (the parser's columns are `Float64Array`s, which `JSON.stringify` writes as
objects).

**Evidence:** `logAnalyzer.js:218`: `const jsonString = JSON.stringify(output);`. The tool tells the assistant the
schema is not fixed: `instructions.txt:28`: `- Read and parse the file (you don't know the schema of the file, so be
careful)`. The data is complete and readable; no reference says it must be arrays.

## 134. A no-data failure drops the remembered file

**Row:** `handleToolCall` (`fileId = await window[toolName](…)` returns `undefined`): later user messages are posted
without `attachments`.

**Verdict:** NOT PROVEN (behaviour reproduced exactly).

**Test:** `#134 a no-data failure drops the remembered file from later messages`. After a successful `get ATT`
(`file_1`) and a failed `get NOPE`, the next user message is posted without `attachments` although `file_1` is still on
the account, and `fileId` is `undefined`.

**Evidence:**

- `logAnalyzer.js:492-496`: `fileId = await window[toolName](toolArguments.message_type); if (fileId===undefined){ failed
= true ...`
- `logAnalyzer.js:662`: `// Add the user message to the thread with file attachments if available` and `:668`:
  `attachments: fileId && [{`
- `instructions.txt:42`: `6. for following queries regarding that same message type you can use the same file.`

Whether the assistant loses the file depends on how the API treats files attached to earlier thread messages, which no
in-repo reference states. "If available" can be read as "if the last tool call produced one". Not proven.

## 135. Successful calls in a mixed batch submitted without output

**Row:** `handleToolCall` (`toolOutput.output` only set on failure): the assistant gets no data for them; the uploaded
file is not mentioned.

**Verdict:** NOT PROVEN (behaviour reproduced exactly).

**Test:** `#135 a successful call in a mixed batch is submitted without output`. `[get ATT, get NOPE]` submits
`[{ tool_call_id: 'call_0' }, { tool_call_id: 'call_1', output: 'failure, requested message type does not exist in message types' }]`;
the uploaded `file_1` appears in no later request.

**Evidence:** `logAnalyzer.js:487` `let toolOutput = {tool_call_id: toolCallId};` with `output` set only at `:495`,
`:500`, `:508`; `:512-526` submits and returns. The instructions describe the success path only when "everything goes
well" (`instructions.txt:22`: `- if everything goes well, the run will then terminate immediately after the tool call.`),
and a mixed batch is not that case (`:21`: `- if anything else goes wrong, ... you will also get a failure output message
with details.`). Whether an output without `output` is accepted is API behaviour. Not proven.

## 136. Message posted while the run is still cancelling

**Row:** `handleToolCall` (`runs.cancel` then `messages.create` at once): the API can reject the message.

**Verdict:** NOT PROVEN (request order reproduced exactly).

**Test:** `#136 the message is posted right after the cancel request, without checking the run`. The request log ends
`GET /files`, `POST /files`, `POST …/runs/run_1/cancel`, `POST …/messages`, `POST …/runs`.

**Evidence:** `logAnalyzer.js:529`: `await openai.beta.threads.runs.cancel(currentThreadId, event.data.id);` then `:534`:
`const newMessage = await openai.beta.threads.messages.create(...)`. That the API rejects a message while a run is
cancelling is not stated anywhere in the repository. Not proven.

## 137. `.log` files offered but never read

**Row:** `index.html` `accept=".bin,.log"`; `handleFileUpload` parses only `.bin`: "Log File Ready" is shown and the
assistant is told no log was uploaded.

**Verdict:** PROVEN (the page never produces the output its own UI offers).

**Tests:**

- `#137 a .log file is reported ready but never read`: choosing `flight.log` sets the label to `Selected: flight.log`,
  adds only `Processing flight.log...` to the chat, shows the summary `Log File Ready`, leaves `log` undefined, and the
  next `get` is answered `failure, user did not upload logs file`.
- `#137 a .log file chosen after a .bin leaves the earlier log in use`: after a `.bin` is loaded, choosing `other.log`
  shows `Selected: other.log` while `get ATT` uploads the earlier `.bin`'s data.

**Evidence:**

- `index.html:29`: `<input type="file" id="fileInput" accept=".bin,.log" />`
- `index.html:31`: `Click to upload .bin/.log files for analysis`
- `logAnalyzer.js:267`: `if (file.name.toLowerCase().endsWith(".bin")) {` (the only branch that reads the file), then
  unconditionally `:276-279`: `updateVisualization({ summary: "Log File Ready", ...`
- `logAnalyzer.js:500`: `toolOutput.output = "failure, user did not upload logs file";`

The label offers `.log` files "for analysis"; a `.log` file is never read, yet the page reports it ready.

**Minimal correct behaviour:** a chosen file that the page does not read must not be reported as loaded or ready, and the
user must be told it was not read. (Reading `.log` text logs would be new analysis the original never had, so it is not
the fix.)

**Smallest port change:** in `apps/ai-log-analyzer/src/App.tsx` `openFile`, for a name not ending in `.bin`, show an error
notice that the file was not read (only `.bin` logs are read) and skip `setChartsAtLogReady`; the picker may keep
`.log` (nothing removed). The earlier log, if any, stays as it was, as now.

**Status: FIXED.** `apps/ai-log-analyzer/src/analysis/log-file.ts` (`readsLogFile`, upstream's
`.bin` test; `logNotReadText`) and the log handler in `apps/ai-log-analyzer/src/App.tsx`. For `flight.log`: before,
`Processing flight.log...` then "Log File Ready" with no log read; after, `Processing flight.log...` then the error notice
`flight.log was not read: only .bin logs can be analysed.`, no "Log File Ready", and the earlier log (if any) stays in
use. `.bin` files and logs handed over by another tool are read exactly as before. Test:
`apps/ai-log-analyzer/src/analysis/log-file.test.ts` (upstream's result is asserted by the proofs tests above).

## 138. Every `output.json` on the account deleted, without waiting

**Row:** `window.get` (`filesList.data.forEach(… && openai.files.del(id))`): files of that name from other tools are
deleted too; a later call in the same batch can list and delete again files still being deleted.

**Verdict:** NOT PROVEN (behaviour reproduced exactly).

**Test:** `#138 every output.json is deleted, without waiting, twice in a batch`. With deletes that never answer, a batch
`[get ATT, get GPS]` issues `DELETE /files/file_other`, uploads, lists again, issues `DELETE /files/file_other` again and
`DELETE /files/file_1`, uploads, and restarts the run.

**Evidence:** `logAnalyzer.js:222`: `//delete the previously uploaded output.json file before uploading the new one` and
`:226`: `filesList.data.forEach( file => file.filename === 'output.json' && openai.files.del(file.id));`. The page keeps
no record of its uploads across sessions, so "the previously uploaded output.json" can reasonably mean any file of that
name; the instructions say only the last file matters (`instructions.txt:43`). What the API does with a repeated delete
is not stated in the repository. Not proven.

## 139. Only a 401 while connecting asks for a new key

**Row:** `handleInvalidApiKey` is called only from `connectIfNeeded`: a key revoked mid-session keeps failing with
"Sorry, there was an error processing your message."

**Verdict:** NOT PROVEN (behaviour reproduced exactly).

**Test:** `#139 a 401 after connecting shows the generic error and asks for no key`. With every message post answered
401, each send shows `Sorry, there was an error processing your message. Please try again.` and the key prompt count
stays 1.

**Evidence:** `logAnalyzer.js:178-180` and `:194-196` (the only `handleInvalidApiKey()` calls, inside `connectIfNeeded`);
`:685-687` `catch (error) { ... addChatMessage('Sorry, there was an error processing your message. Please try again.',
'error'); }`. Checking the key only while connecting is a reasonable design; nothing states that every 401 must prompt.

## 140. Errors in the tool handler and in the first connection are unhandled

**Row:** `handleToolCall` and `connectIfNeeded` are called without `await` or `catch`: nothing is shown and the run waits
for tool outputs until it expires.

**Verdict:** PROVEN (the original throws: the rejections are unhandled and their messages are never shown). The clause
"the run waits for tool outputs until it expires" is API behaviour and is not proven.

**Tests:**

- `#140 an error in the tool handler is an unhandled rejection and nothing is shown`: `GET /files` answering 500 during
  `get ATT` produces the unhandled rejection `500 Server error`; the chat holds only the connect notice and the user
  message, the thinking indicator is gone, and no tool output or cancel is ever sent.
- `#140 a failed first connection is an unhandled rejection and nothing is shown`: `GET /assistants` answering 500 after
  the key is submitted produces the unhandled rejection `Could not initialize assistant`; the chat is empty and the input
  stays enabled.

**Evidence:**

- `logAnalyzer.js:612`: `handleToolCall(event)` (no `await`, no `.catch`), so the `catch` of the same function at
  `:628-629` (`addChatMessage("Error receiving response from assistant: " + error.message, 'error');`) cannot see its
  errors. `handleToolCall` throws messages meant for the user: `:472` `throw new Error ("passed event does not require
action");`, `:523` `throw new Error ("error occurred while submitting tool outputs")`, `:549` `throw new Error("Error
occurred while starting new run");`.
- `logAnalyzer.js:68`: `connectIfNeeded();` (key form submit, no `await`, no `.catch`), while the other caller,
  `initializeApp` at `:35-43`, wraps it: `try { ... await connectIfNeeded(); ... } catch (error) { console.error("Failed
to initialize:", error); showOfflineMessage(); }`. `connectIfNeeded` throws `:182` `throw new Error('Could not initialize
assistant');` and `:198` `throw new Error('Could not create conversation thread');`.

**Minimal correct behaviour:** an error thrown by the tool handler, or by the connection started from the key form, is
caught and its message shown in the chat (as the page's own handlers at `:628-629` and `:40-43` do for the same calls
elsewhere), instead of being dropped.

**Smallest port change:** none in behaviour; the port already shows these errors under the crash clause of
`docs/porting-policy.md` (`apps/ai-log-analyzer/src/chat/session.ts`, and the tool path in `chat/turn.ts`). Record it as
a proven fix rather than a presentation difference.

**Status: FIXED; no port change needed.** Confirmed: `apps/ai-log-analyzer/src/chat/session.ts`
`connectAssistant` catches a failed connection from the key form and shows its text (e.g. `Could not initialize
assistant`); `apps/ai-log-analyzer/src/chat/turn.ts` `runTurn` catches errors from the tool flow
(`assistant/openai-backend.ts` `toolFlowFailure`, e.g. a failed `files.list`) and shows them. Tests:
`apps/ai-log-analyzer/src/chat/upstream-flow.test.ts` "a 401 at send time while creating the thread shows both upstream
lines" (upstream's unhandled rejection side by side with the port's notice), `chat/turn.test.ts` "turns thrown errors
into notices instead of rejecting", `assistant/openai-backend.test.ts` "names failures in the tool flow, and stream
errors with upstream text".

## 141. Input re-enabled while tool data is uploaded

**Row:** `handleRunStream` (`handleToolCall(event)` not awaited; `finally` re-enables): a message sent then is posted to a
thread whose run waits for tool outputs and is rejected.

**Verdict:** NOT PROVEN (behaviour reproduced exactly).

**Test:** `#141 input is re-enabled while the tool data is still being prepared`. While `files.list` is held, `isProcessing`
is `false`, the input is enabled with placeholder `Ask about your flight data...` and the thinking indicator is gone; a
message sent then is posted (`POST …/messages`, `POST …/runs`) before the held tool call uploads, cancels `run_1` and
posts its own message.

**Evidence:** `logAnalyzer.js:612` `handleToolCall(event)`; `:631-632` `finally { setProcessingState(false); }`;
`:688-690` `finally { showThinkingMessage(false); setProcessingState(false); }`. No text states that input stays disabled
while a tool call runs, and the rejection of the message is API behaviour. Not proven.

## 142. Assistant text appended across messages, and a delta without text shows "undefined"

**Row:** `addChatMessage` (`buffer += content`; `buffer = content` with `undefined`): two replies run together without a
space; "undefined" can prefix the next text.

**Verdict:** NOT PROVEN (behaviour reproduced exactly).

**Test:** `#142 two assistant messages run together; a delta without a value shows "undefined"`. A reply `Let me look.`
followed (after the tool call) by `Attitude is fine.` renders one bubble `Let me look.Attitude is fine.`; a first delta
with `text: {}` followed by `Hi` renders `undefinedHi`.

**Evidence:** `logAnalyzer.js:708`:
`messagesContainer.querySelector('.ai-message:last-of-type:not(.image-message)')`, `:713` `buffer += content;`, `:727`
`buffer = content`, `:582` `addChatMessage(item.text.value, 'assistant');`. One bubble per turn is a reasonable reading
of `// For streaming assistant messages` (`:700`). The "undefined" case needs a text delta without `value`, which no
in-repo reference shows the API sends. Not proven.

## Rows found mis-described

- 132: "the highest IMU instance" is the last key of `Object.keys(instances)`; with the parser's integer-like keys that is
  the highest number, so the row is accurate for numbered instances.
- 140: the effect "the run waits for tool outputs until it expires" is a claim about the API and is not shown by the
  original code; the provable effect is the unhandled rejection with nothing shown and no tool output submitted. Also,
  after the failed first connection the input stays enabled (no offline message), which the row does not mention.
- 137: besides "the assistant is told no log was uploaded", a `.log` chosen after a `.bin` silently leaves the earlier
  `.bin` answering `get` while the label names the `.log` file.
