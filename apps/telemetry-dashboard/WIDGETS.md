# Writing Telemetry Dashboard widgets

User widgets run in iframes and talk to the dashboard through a small protocol. It is the same as
in the original ArduPilot WebTools dashboard, so existing widgets, layouts and the examples keep
working. Types for both sides live in `src/sandbox/protocol.ts` and `src/mavlink/legacy-message.ts`.

## Widget kinds

| Widget      | Document                            | Gets options | Gets MAVLink                   |
| ----------- | ----------------------------------- | ------------ | ------------------------------ |
| Sandbox     | `sandbox.html`, running your script | yes          | yes, through `handle_msg`      |
| Custom HTML | your HTML, as the iframe's `srcdoc` | yes          | listen to the BroadcastChannel |

Both iframes use `sandbox="allow-scripts allow-same-origin"`: scripts run, and the frame shares the
dashboard's origin so it can join the BroadcastChannel below.

## Options: `postMessage` from the dashboard

The dashboard posts plain objects to the iframe with `contentWindow.postMessage(data, '*')`:

| When                                                  | Data                  |
| ----------------------------------------------------- | --------------------- |
| Sandbox iframe loaded, or its script edited           | `{ script, options }` |
| Custom HTML iframe loaded, or its HTML edited         | `{ options }`         |
| The widget's options form changed (valid values only) | `{ options }`         |

`options` is the Formio form's submission data: one entry per form component, keyed by the
component's API key (for example `{ "label": "Voltage (v)", "message": 1, "field": "voltage_battery" }`).
Receivers should test the keys, options first:

```js
window.addEventListener('message', (e) => {
  if ('options' in e.data) {
    /* new options */
  }
  if ('script' in e.data) {
    /* sandbox only: (re)start the script */
  }
})
```

## MAVLink: the `MAVLinkMSG` BroadcastChannel

Every decoded message is posted on `new BroadcastChannel('MAVLinkMSG')` as `{ MAVLink: message }`.
Any same-origin document can listen, including other tabs:

```js
const broadcast = new BroadcastChannel('MAVLinkMSG')
broadcast.onmessage = (e) => {
  if (e?.data?.MAVLink) handle(e.data.MAVLink)
}
```

The message has the shape upstream's pymavlink-generated `mavlink.js` produced (after structured
cloning, so no methods):

| Property                                                                                               | Meaning                                                                                                                  |
| ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| fields by their XML names (`current_battery`, `Vcc`, `ICAO_address`, ...)                              | the decoded values (see below)                                                                                           |
| `_id`, `_name`                                                                                         | message id and name (`30`, `"ATTITUDE"`)                                                                                 |
| `fieldnames`                                                                                           | field names in XML order                                                                                                 |
| `_header`                                                                                              | `{ mlen, seq, srcSystem, srcComponent, msgId, incompat_flags, compat_flags }`                                            |
| `_timeStamp`                                                                                           | `Date.now()` when the dashboard decoded it                                                                               |
| `_signed`, `_link_id`                                                                                  | true for a signed frame whose signature verified; `_link_id` only then                                                   |
| `_msgbuf`, `_payload`, `crc`                                                                           | the whole frame, the payload zero-extended to full length, the frame checksum (a field named `crc` is overwritten by it) |
| `_format`, `order_map`, `len_map`, `array_len_map`, `crc_extra`, `_instance_field`, `_instance_offset` | layout metadata, as in `mavlink.js`                                                                                      |

Field values:

- integers and floats: numbers;
- `char[n]` strings, and `uint8_t[n]` / `int8_t[n]` arrays: strings with one character per byte,
  NUL padding included (`msg.text.replace(/\0.*$/g, '')` gives the text);
- other arrays: arrays of numbers;
- 64-bit integers: `[low, high, unsigned]` (two unsigned 32-bit words and a flag).

## Sandbox scripts

A sandbox widget's script is the body of a function called as `f(div, options)`, with `this` the
iframe's `window` (sloppy mode). `div` is the widget's area (cleared on every restart), `options` the
form data. Assign handlers as globals:

```js
const text = document.createTextNode('No data')
div.appendChild(text)

handle_msg = function (msg) {
  // every MAVLink message
  if (msg._id != options.message) return
  text.nodeValue = msg[options.field] * options.scaleFactor
}

handle_options = function (new_options) {
  // optional: options changed
  options = new_options
}
```

- An exception at start-up or in a handler replaces the widget with the error and the offending
  line, and stops the script. New options or an edited script start it again.
- Restarting clears interval ids 0 to 99 to stop the previous script's timers.
- `mavlink20` is available as in `mavlink.js`: every enum entry (`mavlink20.MAV_COMP_ID_AUTOPILOT1`),
  `MAVLINK_MSG_ID_*`, and `mavlink20.map[id].type` (construct it for `_name`, `_id` and
  `fieldnames`). Packing and parsing (`MAVLink20Processor`) are not provided.

## Saving widgets

A widget file is `{ "header": { "version": 1 }, "widget": { x, y, w, h, type, options } }`, where
`type` is `WidgetSandBox` or `WidgetCustomHTML` and `options` holds `form` (the Formio definition),
`form_content` (its data), `about` (`{ name, info }`, shown in the palette) and the code: `sandbox`
(script) or `custom_HTML` (document). See `src/assets/SandBoxWidgets/` and `examples/`.
