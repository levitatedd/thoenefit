# Strength guide handoff for curls and hinges

Part of #320 and #326 under #262. The unindexed JSON drafts and generated SVGs in [samples](samples/) are available for renderer review. Each sample uses its exact catalog slug. All 28 exercises remain on the two issue checklists for release tracking.

## Drafts ready for review

| Guide | Existing renderer setup | What to verify before indexing |
| --- | --- | --- |
| [Barbell Pause Curl](samples/barbell-pause-curl/sheet.svg) | Grounded side with a straight bar | The player holds two seconds halfway up, per the ThoeneFit cue. |
| [Barbell Drag Curl](samples/barbell-drag-curl/sheet.svg) | Grounded side with a straight bar | Elbows travel back and the bar stays close without passing through the torso. |
| [Barbell Romanian Deadlift](samples/romanian-deadlift/sheet.svg) | Grounded side with a straight bar | The bar tracks close to the legs, starting and ending at the hips. |
| [Barbell Good Morning](samples/barbell-good-morning/sheet.svg) | Grounded side with a shoulder-mounted bar | The bar stays on the upper back and the knees stay soft during the hinge. |
| [Stiff-Legged Good Morning](samples/stiff-legged-good-morning/sheet.svg) | Same shoulder-mounted bar | The knees remain visibly straighter than in the standard good morning. |

## Renderer work for Claude

| Shared work | Exercise slugs | Acceptance check |
| --- | --- | --- |
| Straight-bar grip width and palm orientation | `reverse-grip-barbell-curl`, `wide-grip-barbell-curl` | Show the overhand grip and the wider hand spacing respectively. Both hands must stay on the bar during playback. |
| EZ-bar geometry and grip points | `ez-bar-curl`, `close-grip-ez-bar-curl`, `ez-bar-preacher-curl` | Hands stay on the intended angled segments. The close-grip setup must read differently from the regular setup. The preacher variant also needs an upper-arm pad contact. |
| Seated and incline curl supports | `incline-dumbbell-curl`, `incline-hammer-curl`, `concentration-curl`, `seated-dumbbell-curl` | Show incline back support, seated feet and hips, and the concentration curl's elbow-to-inner-thigh brace. Preserve the neutral grip through the incline hammer curl. |
| Dumbbell paths and grip changes | `cross-body-hammer-curl`, `zottman-curl`, `waiter-curl`, `no-money-curl` | Show cross-torso travel, the Zottman turn before descent, both hands supporting one dumbbell head, and the no-money curl's outward rotation. Confirm whether the current standing rig can cover the Zottman turn without changes before adding new joints. |
| Kettlebell prop and attachments | `kettlebell-swing`, `alternating-single-arm-kettlebell-swing`, `kettlebell-suitcase-deadlift` | Keep the handle in the active grip, distinguish the side carry from the swing path, and verify the hand switch between frames without the bell jumping or clipping the body. |
| Cable and rail constraints | `cable-pull-through`, `smith-machine-stiff-legged-deadlift` | Keep the pull-through cable anchored behind the lifter and routed between the legs. Keep the Smith bar on the guide rails throughout the hinge. |
| Bench and floor hip extension | `barbell-hip-thrust`, `dumbbell-hip-thrust`, `hip-thrust`, `barbell-glute-bridge` | Maintain upper-back contact on the bench for thrusts and shoulder contact on the floor for the bridge. Keep the load over the hips and feet planted. Verify both barbell thrust catalog mappings against their cues before sharing poses. |
| Seated back-extension machine | `seated-back-extension-machine` | Keep the hips at the seat and the back pad in contact along the machine's travel. |

Start with straight-bar grip support and seated curl contact for a small renderer PR. The kettlebell prop can land before the hand-switch variant. Keep shared rig changes and guide asset updates easy to review in separate commits.

To integrate a draft, move its JSON to `web/guides/<slug>.json`, add its exact mapping, regenerate previews and fingerprints with `node docs/guides/render-previews.mjs`, and rerun `node tests/guides.test.mjs`. Check the recent guide on fit-test at phone widths, in reduced motion, and offline after it has been opened.
