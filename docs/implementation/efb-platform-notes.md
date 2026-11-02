# MSFS 2024 EFB platform notes

Sources: the official SDK pages (class lists only; article bodies did not load in our fetch), two open-source EFB apps (an iframe app and a descent calculator), and a DevSupport forum thread. Confidence is stated per item. **Nothing here has been run in the sim.**

## Two ways to write an EFB app

| | SDK template (TypeScript) | Plain JS, no build |
|---|---|---|
| Source | The MSFS SDK EFB sample's `TemplateApp` folder | One `.js` file |
| Dependencies | `@efb/efb-api` and `@microsoft/msfs-sdk`, both resolved by `file:` paths inside the SDK sample tree (`../efb_api/dist/`, `../vendor/microsoft-msfs-sdk-*.tgz`). Not on npm | None |
| Build | esbuild via `build.js`, scss, typecheck plugin; output `dist/` | None |
| Needs the SDK installed | Yes (Windows) | No |
| Evidence | [Descent calculator repo](https://github.com/Arun-N/msfs24-efb-descent-calculator-app) | [Iframe app repo](https://github.com/RCCSilva/msfs-efb-iframe) |

**This project uses plain JS** so it can be built and tested without the SDK. The pattern comes from the iframe app and is plausible but is a third-party sample, not official guidance.

## Globals the EFB provides (plain JS pattern)

- `window.EFB_API`: the EFB container. `EFB_API.use(AppClass)` registers an app. It **throws until the EFB has handed over its event bus**, so retry (the sample retries every 100 ms for up to 150 attempts).
- `window.msfssdk`: `@microsoft/msfs-sdk`. Used for `DisplayComponent`, `FSComponent` (`buildComponent`, `createRef`), `Subject`.
- `BASE_URL`: `coui://html_ui/efb_ui/efb_apps/<InternalName>`; used to load assets such as the icon.

## App class shape (as used by the iframe sample)

The app is a plain class with: `name`, `internalName`, `icon` (a URL), `isReady`, `favoriteIndex` (get/set), `compatibleAircraftModels` (return `undefined` for all aircraft), `getIsSearchable()`, `getIsFavoritable()`, `getVersion()`, `available` (a `Subject<boolean>`), `BootMode` (0 = COLD), `SuspendMode` (0 = SLEEP), `async install()`, `async _install(props)` and `render()`.

`_install(props)` receives, among others: `props.bus`, `props.unitsSettingManager`, `props.notificationManager`, `props.efbSettingsManager`, `props.options`. After install the sample triggers `Coherent.trigger('EFB_APP_INSTALLED', name, internalName, apiVersion, version)`. The sample's `EFB_API_VERSION` is `1.0.3`.

`render()` returns `FSComponent.buildComponent(ViewClass, { bus })`.

## View class (AppView)

The sample extends `msfssdk.DisplayComponent`. Lifecycle hooks the EFB calls: `onOpen`, `onClose`, `onResume`, `onPause`, `onUpdate` (called per frame with delta time, per a forum post, **unverified**), `routeGamepadInteractionEvent`, `handlePageKeyAction`, and a `pageKeyActions` map. `destroy()` must call `super.destroy()`.

`AppSuspendMode.SLEEP` (default) only hides and sleeps the app when another app is selected. `TERMINATE` removes it from the DOM. **Whether timers and `onUpdate` keep running while the app is hidden is unknown; spike 1 measures it.** An auto push cannot rely on the tablet being open until this is known.

## Packaging

Layout (from the iframe sample):

```
<Project>.xml                           package project (OutputDirectory ., TemporaryOutputDirectory _PackageInt)
PackageDefinitions/<pkg>.xml            AssetPackage definition (ContentType MISC, VisibleInStore false)
PackageSources/<InternalName>/<InternalName>.js
PackageSources/<InternalName>/Assets/app-icon.svg
```

The package definition has two asset groups: `ContentInfo` and a `Copy` group whose `AssetDir` is `PackageSources\<InternalName>\` and whose `OutputDir` is `.\html_ui\efb_ui\efb_apps\<InternalName>\`.

**Four names must match exactly or the sim silently ignores the app:** the internal name in the JS, the JS file name, the `PackageSources` folder name and the `OutputDir` segment.

Building the package uses the SDK's package tool (Windows). The built package goes in the Community folder. **Unverified by us:** the exact build command and whether the project XML needs anything the iframe sample omits.

## Sim browser limits

The sample warns the sim browser is old: avoid `calc()`, CSS variables and grid. It uses `window.setInterval` and `XMLHttpRequest` happily. Prefer `var`, plain functions and DOM calls; `class` and `async` do work (the sample uses them). Iframes to `http://127.0.0.1:<port>` work in the sample (use `127.0.0.1`, not `localhost`, which may resolve to IPv6).

## Reading and writing sim data from JS

- Read: `SimVar.GetSimVarValue(name, unit)`. L vars are read with an `L:` prefix and unit `number`. Strings use unit `string`.
- Write: `SimVar.SetSimVarValue(name, unit, value)`. Only some variables are writable from JS; **writing a read-only A var fails silently** ([avionics docs](https://microsoft.github.io/msfs-avionics-mirror/docs/interacting-with-msfs/simvars)). It returns a promise in the sim.
- Key events: `SimVar.SetSimVarValue('K:NAME', 'number', value)` or `Coherent.call('TRIGGER_KEY_EVENT', 'NAME', value)`. A forum thread reports the latter working in EFB apps (about two years old, unofficial). Both are tested on the tug spike page.
- `SimVar` and `Coherent` may be script-scope globals rather than `window` properties; access them by bare name behind a `typeof` check.

## Not confirmed for EFB apps

The SDK sidebar lists `JS_LISTENER_FACILITY`, `JS_LISTENER_DATASTORAGE`, `JS_LISTENER_MAPS`, `JS_LISTENER_VFRMAP`, `JS_LISTENER_AIRPORT_INFOS`, plus SimConnect Facilities and AI Object sections. We do not know which an EFB app may use. Facility data exposed to JS likely covers runways and frequencies but probably **not taxi paths** (the original app reads those through SimConnect facility data definitions); the taxiway spike checks. AI traffic from JS is likewise unknown.

If JS cannot reach taxi paths, AI traffic, or a steady tick, the fallback is a WASM module in the same package using full SimConnect, talking to the EFB UI through the sim's JS-to-WASM channel (CommBus). Unverified.

## EFB notifications

The SDK has an "EFB Notifications" page; its body did not load. `props.notificationManager` is handed to the app at install. Its method names and whether notifications carry action buttons are unknown. The notifications spike lists the manager's methods at runtime and offers buttons to try candidate calls.

## Gotchas

- Do not name the app `TemplateApp`.
- A name mismatch fails silently; check the four-name rule first when the app does not appear.
- Scoped CSS: the TS template prefixes selectors with `.efb-view.<folder name>`. The plain-JS sample injects a `<style>` element with its own class prefixes. Prefix all our classes with `ps-`.
