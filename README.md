# react-native-elsel

A dev-only element selector for React Native and Expo. Tap the floating inspect button, then tap anything in your running app to see:

- the component that rendered it and **the exact `file:line:column`** in your code
- its component path (`Screen › Card › PrimaryButton › Text`): tap any level, or step with **↑ Parent** / **↓ Child**
- props, flattened style and on-screen layout

From the panel you can **Open** the source in your editor, **Copy** a summary to your computer's clipboard, or **Send to AI**: elsel saves the selection, a code snippet and a simulator screenshot where Claude Code (or any agent) can read it.

It needs no Babel plugin and no native code. Source locations come from React's own dev metadata, mapped back through Metro's `/symbolicate`. In production builds it renders your children and nothing else.

## Setup

From your app's directory:

```sh
npx react-native-elsel init
```

Then restart Metro with `--clear`. **No app code changes.** `init`:

1. installs `react-native-elsel` as a dev dependency (detects yarn / npm / pnpm / bun)
2. wraps the export in your `metro.config.js` (or creates one), printing the two lines it added:
   ```js
   const { withElementSelector } = require('react-native-elsel/metro')
   module.exports = withElementSelector(/* your existing config, untouched */)
   ```
3. offers to add the elsel MCP server to `.mcp.json` so Claude Code picks it up (`--mcp` / `--no-mcp` to skip the prompt)

It is safe to re-run. Flags: `--skip-install`, `--from <tarball|path|version>`.

### How the zero-code wrap works

In **development bundles only**, `withElementSelector` adds `import "react-native-elsel/auto"` at the start of line 1 of your app's entry file (`main` in package.json, so Expo Router's `expo-router/entry` works too). That module wraps every root with `AppRegistry.setWrapperComponentProvider`. It hands everything else to your existing babel transformer (SVG, NativeWind, Sentry, …). Production bundles contain no elsel code at all.

Want options or a specific placement? Wrap manually; a manual `<ElementSelector>` takes over from the automatic one:

```tsx
import { ElementSelector } from 'react-native-elsel'

<ElementSelector longPress={{ touches: 2 }} button={false}>
  <RootNavigator />
</ElementSelector>
```

To turn auto-wrap off: `withElementSelector(config, { autoWrap: false })`.

### Manual MCP setup

```sh
claude mcp add elsel -- npx elsel mcp
```

The MCP server provides:

| Tool | What it does |
| --- | --- |
| `get_selected_element` | Latest selection as Markdown (source, code snippet, props, style, ancestors) plus the screenshot |
| `wait_for_selection` | Blocks until you pick something in the app and tap **Send to AI**. Lets the agent ask you to "point at it" |
| `list_recent_selections` | Recent picks with source locations |

You can skip MCP entirely. Every Send to AI also writes plain files, so you can tell any agent to "look at `.elsel/selection.md`":

```
.elsel/
  selection.md     # human/agent readable
  selection.json   # the same data, structured
  selection.png    # simulator/emulator screenshot, element outlined
  history.jsonl    # last 50 picks
```

`.elsel/` contains its own `.gitignore`, so none of it gets committed. `npx elsel show` prints the latest selection.

## Selecting elements

| How | Where it works |
| --- | --- |
| **Floating inspect button** | Everywhere, including simulators and physical devices. Tap it, then tap an element. Drag it anywhere out of the way; it remembers where you put it. |
| **Pick** button in the panel | Everywhere. Hop to another element without closing the panel. |
| **Right-click** | Web (hold Shift for the browser's menu), Android with a mouse, iPad with a pointer. Uses pointer events (`button === 2`). |
| **Dev Menu → "Inspect Element (elsel)"** | Bare React Native. Expo Go / dev-client menus don't list custom items; use the floating button there. |
| **Long-press** (opt-in) | Everywhere, once enabled with `longPress`. See below. |

While picking, a layer covers your app, so the tap that selects an element never reaches it: no buttons fire, no navigation happens.

**iOS Simulator:** the Simulator turns Mac mouse clicks into touches, so a right-click never reaches the app. Use the floating button.

**Long-press and your own buttons:** long-press is off by default. elsel only observes touches, and React Native only lets one view take a touch from another when a finger lands or moves. So once a long-press fires, elsel takes over the touch on the next move and the app's press is cancelled. A hold that never moves at all (typical of click-and-hold in a simulator) still reaches your `Pressable`, which fires `onPress` on release. `longPress={{ touches: 2 }}` has no such gap: elsel takes over the moment the second finger lands.

## Options

```tsx
<ElementSelector
  enabled={__DEV__}                        // default: __DEV__
  button                                   // floating inspect button, default: true
  rightClick                               // default: true
  longPress={{ duration: 600, touches: 2 }} // or true for one finger; default: false
  devMenu                                  // default: true
  devServerUrl="http://192.168.1.4:8081"   // default: read from the bundle URL
  onSelect={(selection) => {}}             // every pick, as JSON
/>
```

A ref exposes `inspectAt(x, y)`, `pick()` and `close()`. The active selector also sets `globalThis.__ELSEL__` to the same handle in dev, for Maestro or e2e scripts.

```js
withElementSelector(config, {
  autoWrap: true,     // inject <ElementSelector> in dev bundles
  screenshot: true,   // capture via `xcrun simctl` / `adb` on Send to AI
  editor: 'cursor',   // else LAUNCH_EDITOR / EDITOR / auto-detected
  log: true,          // print picks in the Metro terminal
});
```

## How it works

1. **Hit testing.** It asks React Native's renderer for the deepest view under the point. This is the same hook the built-in element inspector uses, and it goes through Fabric's `findNodeAtPoint`.
2. **Component path.** It walks the React fiber tree upward from that view.
3. **Source locations.**
   - React 19 (RN ≥ 0.78) records a stack for every JSX element. elsel sends those frames to Metro's `/symbolicate` in one batch and keeps the first frame outside React.
   - React 18 provides `_debugSource` directly.
   - Frames in `node_modules` are marked as library code. The panel selects the nearest component *from your code* by default; toggle **libs** to see everything.
4. **Server side.** The Metro middleware adds `/__elsel/{ping,open,copy,select}`. Open uses [`launch-editor`](https://github.com/yyx990803/launch-editor); without the middleware, Open falls back to Metro's built-in `/open-stack-frame`.

## Limitations

- Content in a React Native `<Modal>` renders in a separate native root and can't be hit-tested from the app's root view.
- Built on React internals (`__internalInstanceHandle`, fibers, `_debugStack`) that work in dev builds. They have been stable for years, but a future React or React Native release could change them.
- Screenshots work for iOS simulators and adb-connected Android devices. Physical iOS devices get no screenshot. With several Android devices connected, set `ANDROID_SERIAL`.
- Like Metro's own endpoints, `/__elsel/*` is reachable by anything that can reach your dev server. It only opens existing files, writes inside `.elsel/`, and sets your clipboard.

## Development

```sh
npm install
npm run typecheck
npm test          # middleware, MCP, init patching, transformer injection
```
