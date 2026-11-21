# Strength renderer test pack

Use this with the [rollout handoff](strength-rollout-handoff.md). Start with the grip and support cases, then use the row fixtures to verify that a renderer change fixes the path in motion. The catalog cues determine the exact ThoeneFit variant when a visual reference shows another variation.

## Grip fixtures

| Catalog exercise | Visual reference | Expected pose and motion |
| --- | --- | --- |
| `barbell-curl` | [Current pose sheet](barbell-curl/sheet.svg) | Baseline. Shoulder-width, palms-up grip from Setup through Top. Existing art and guide fingerprint must stay stable. |
| `reverse-grip-barbell-curl` | [Overhand curl demo](https://www.strengthlog.com/reverse-barbell-curl/) | Use the baseline shoulder-width spacing. At Setup and Top, the backs of both hands should read as overhand. Keep the upper arms beside the torso. |
| `wide-grip-barbell-curl` | [Grip comparison and visual reference](https://www.majorfitness.com/blogs/training-tips/barbell-curl) | Both hands are visibly outside the baseline grip, with palms up. The bar stays level as the elbows flex. |
| `close-grip-bench-press` | [Close-grip demo in bench variations](https://www.strengthlog.com/bench-press-variations/), [standard press baseline](barbell-bench-press/sheet.svg) | Use the catalog's shoulder-width overhand grip, narrower than the existing bench setup, with elbows near the ribs and the bar reaching the lower chest. Keep both shoulders supported. |

Use the same camera for each A/B comparison. At each keyframe and between poses, project each hand onto the straight bar axis and check that both hands stay on their assigned grip locations. Check hand spacing against the baseline, left/right symmetry, and that the fingertips and thumb remain visibly on the intended side of the bar. A caption alone does not establish visible grip orientation. Keep limb lengths and existing contact/frame assertions from `tests/guides.test.mjs`.

## Support fixtures

| Catalog exercise | Visual reference | Required contacts and distinguishing frame |
| --- | --- | --- |
| `seated-dumbbell-curl` | [Incline-versus-seated curl comparison](https://www.majorfitness.com/blogs/training-tips/dumbbell-curls) | Hips on the flat bench, feet planted, torso upright at the bench end. No back pad. Both upper arms remain beside the torso as the dumbbells curl. |
| `incline-dumbbell-curl` | [Incline curl demo](https://www.strengthlog.com/incline-dumbbell-curl/) | Hips and back supported on a 45–60° incline, feet planted, working arm hanging beside the bench at Setup. The catalog calls for one dumbbell. At Top the upper arm is still in place. |
| `concentration-curl` | [Concentration curl demo](https://www.strengthlog.com/concentration-curl/) | Working upper arm remains braced against the inner thigh from Hang to Top and back. Hips stay on the seat and both feet stay on the floor. |
| `dumbbell-floor-press` | [Floor press demo in bench variations](https://www.strengthlog.com/bench-press-variations/) | Upper back and hips remain supported on the floor, with knees bent and feet planted. At Bottom, both upper arms reach the floor without sinking through it. At Top the dumbbells are over the chest. |

For each new rig, add the support surfaces and named contact points to the test fixture before authoring other exercises against it. Verify planted contacts through the entire loop and intermittent contact at the intended phase. Check implement clearance against the bench and body in the target camera.

## Row regression fixtures

Run `node docs/guides/inspect-strength-rows.mjs`. It prints model-space offsets at five frames on Pull → Top, using the existing pose solver. Positive forward offset means the load center is farther forward than the approximate body landmark. These are diagnostic baselines based on torso-center landmarks, with room still needed for torso thickness and equipment clearance.

| Existing draft | Frame to inspect | Baseline forward offset | Target after renderer work |
| --- | --- | ---: | --- |
| [Barbell Row](samples/barbell-row/top.svg) | Top, then scrub Pull → Top | 44.8 rig units ahead of lower-rib landmark | Bar approaches the front of the lower ribs with the elbows behind the torso and no bar or arm clipping. |
| [Dumbbell Bent-Over Row](samples/dumbbell-bent-over-row/top.svg) | Top, then scrub Pull → Top | 63.4 rig units ahead of hip landmark per dumbbell | Dumbbells finish beside the hips, with a stable hinge and a controlled return. |

Use the [barbell row reference](https://www.strengthlog.com/barbell-row/) and [bent-over dumbbell row reference](https://www.muscleandstrength.com/exercises/bent-over-dumbbell-row.html) to compare the visible paths. Once the corrected paths have been reviewed, use their measured positions to set regression tolerances in `tests/guides.test.mjs`.

## Integration checklist

- [ ] Add the reviewed JSON to `web/guides` and map its exact catalog slug once in `web/guides/index.json`.
- [ ] Regenerate previews and fingerprints with `node docs/guides/render-previews.mjs`. Preserve the legacy fingerprint baseline and review changes to unrelated fingerprints.
- [ ] Run `node tests/guides.test.mjs` and the normal PR Checks. Review keyframes and interpolated frames for support, grip, clearance and return to Setup.
- [ ] On fit-test, open the exercise on 320px and 402px screens. Check playback, pose selection, readable captions and no sideways scroll.
- [ ] With reduced motion enabled, verify the guide starts still and the controls step without animating. After opening the guide online, verify the cached guide plays offline and an uncached guide still leaves its written cues accessible.
- [ ] For a new or revised guide, verify the current revision appears as Pending in the admin queue and older review history remains visible.
