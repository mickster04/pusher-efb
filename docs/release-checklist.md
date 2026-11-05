# Release checklist

Open items before the first release, in the order we agreed. Tick them off here.

- [ ] **Licence** (decision needed, see below). Add `LICENSE`, a short `CONTRIBUTING.md` and a contributor agreement, then update the README's licence section.
- [ ] **Verify in the sim:** the files module 0.2.1 (rebuild with `npm run build:wasm`, rebuild the package, restart the sim, then Settings > Diagnostics shows Files module OK) and the Steam work-folder path (needs a Steam user).
- [ ] **Package metadata (reminder, owner to do):** Creator is "Pusher" and Manufacturer is empty in `PackageDefinitions/push-planner.xml`; choose a name, set a thumbnail, tidy the title, and decide on `VisibleInStore` (false means Community-folder only).
- [x] Airline themes: "not affiliated, colours approximate" is in the app (Settings > Colours) and the README.
- [x] Linter: `npm run lint`, part of `npm test`. CI is not needed: `npm test` is the one command, and build output is no longer committed.
- [ ] **Test across aircraft** (owner): at least a Boeing, an Airbus and a smaller jet, for tug, tiller, brake and ground services. B6 (tiller LVars) is still open.
- [x] Safety note: README "Safety".
- [ ] **Last step:** one version number (all three places), a tag and release notes.

## Deferred features

- F1 AI traffic: ignore or pause, and a "blocked ahead" warning (one piece of work, to build after more testing).
- G1/G2 ground services: verify per aircraft before relying on them.
- D6 save and load plans, B6 tiller LVars.
- Dropped: B7 learned yaw calibration, A2 aircraft info, A4 camera state. E4 (stand display) is done: the Push tab shows "AT GATE <name>".

## Choosing a licence

You want: anyone may read, build and modify it, send pull requests, and share their own builds with attribution, but no commercial use, and you keep the option to sell it yourself.

1. **That is "source-available", not "open source".** The Open Source Definition forbids restricting commercial use, so you cannot call the project open source, and GitHub will not list it as such. That is fine; just say "source-available" in the README.
2. **Pick a licence written for it rather than writing your own.** The usual candidates:
   - **PolyForm Noncommercial 1.0.0**: written for software, plain English, allows personal, hobby, research and charity use, requires the licence notice and a `Required Notice:` line with your copyright (that is the attribution). Our suggestion.
   - **CC BY-NC 4.0 / BY-NC-SA 4.0**: well known and gives attribution, but Creative Commons itself advises against it for software (no patent terms; SA forces derivatives under the same terms).
   - **A custom licence** (for example, MIT-style text plus "not for commercial use"): flexible, but ambiguous words such as "commercial" are exactly what a solicitor should draft. Worth the cost only if the standard ones do not fit.
3. **Keeping the commercial option needs a contributor agreement.** Under any of these, a contributor keeps the copyright in their pull request. Unless they also grant you broad rights (a CLA, or a DCO plus a licence grant to you), you could not later sell or relicense a build containing their code. Decide this before accepting the first pull request, as it is hard to fix afterwards.
4. **Define "commercial" in plain words.** Selling it, bundling it in a paid product, or ads. Is a flight-sim YouTuber with ads, a paid add-on bundle, or a donation page commercial? PolyForm Noncommercial has a definition you can lean on.
5. **Third-party material.** This is a port of the Pusher desktop app: check that app's licence and your right to relicense the ported code (`src/planning/` is a port of its planner and suggester). Also covered separately: the MSFS SDK and Microsoft's terms for add-ons (you may not be able to sell an add-on built with it anyway without Marketplace rules), and the airline names (trademarks, not covered by any code licence).
6. **Warranty and liability.** The app moves an aircraft in a simulator, which is low risk, but keep the standard "as is, no warranty" clause. Every licence above has one.
7. **Not legal advice.** If the commercial option is likely to matter, an hour with a solicitor on the licence and the contributor agreement is cheap insurance.
