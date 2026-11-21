# Bodyweight, stretch and cardio renderer handoff

Part of #263 and #256. This handoff covers 81 inventory entries across seven batches. The issue checklists are the source of truth for exact membership and completion. The current app index has no guides for these batches.

| Batch | Count |
| --- | ---: |
| [Push-ups, dips and prone upper body](https://github.com/levitatedd/thoenefit/issues/345) | 11 |
| [Hanging, inverted and supported pulls](https://github.com/levitatedd/thoenefit/issues/344) | 9 |
| [Lower-body, balance and bench support](https://github.com/levitatedd/thoenefit/issues/346) | 15 |
| [Floor, decline-bench and ball core](https://github.com/levitatedd/thoenefit/issues/347) | 15 |
| [Dynamic mobility and floor transitions](https://github.com/levitatedd/thoenefit/issues/349) | 15 |
| [Static stretch illustrations](https://github.com/levitatedd/thoenefit/issues/348) | 11 |
| [Cardio equipment setup and rowing](https://github.com/levitatedd/thoenefit/issues/350) | 5 |

## Representative renderer fixtures

| Fixture | Required poses or support | Check before copying the rig |
| --- | --- | --- |
| [Bodyweight Squat](samples/bodyweight-squat/sheet.svg) | Upright → lower → bottom → stand, with unloaded arms forward | The existing grounded rig works for this sample. Both feet stay planted through the full loop, the knees track with the toes, and no equipment is drawn. |
| Push-Up and Bench Dip | High plank → lower → press, and bench-supported top → lower → press | Keep hands fixed. In the push-up preserve a head-to-heel line and toe support. In the dip keep the bench behind the torso, with hands and feet supported and the hips clear of the edge. |
| Pull-Up and Captain’s Chair Knee Raise | Hang → pull → hang, and supported legs down → knees up → down | Check that the hands stay on the bar for the first guide. The chair needs forearm, hand and back-pad supports from the corresponding catalog cue. Keep the legs free of the equipment through the lift. |
| Bodyweight Step-Up | Floor stance → lead foot on box → supported rise → controlled step down | Transfer support to the lead foot without letting it slide through the box. Show the working side and verify the transfer in both directions. |
| Dead Bug and Stability Ball Pike | Supine arms up/knees up → opposite arm and leg extend → switch, and long plank → hips up → return | Keep the dead bug’s lower back at the floor and verify the opposite limb pair. Track the ball contact as it rolls under the legs, with hands planted. |
| Cat-Cow | Neutral tabletop → rounded back → extended back → neutral | Maintain hand and knee contacts as the spine shape changes. Use a side view that makes the difference between the two positions readable. |
| Doorway Chest Stretch and Kneeling Hip Flexor Stretch | One held pose each, with distinct braced side | Draw the doorway contact for the chest stretch, and front foot and back knee support for the hip flexor stretch. Label the stretched side and prompt users to switch. |
| Stationary Bike and Rowing Machine | One bike setup frame, and rowing catch → legs → body/arms → finish → arms/body/legs recovery | Show bike seat, pedal and foot setup without autoplay. On the rower, keep feet strapped, the seat on its rail, and the handle on its cable path. Use separate recovery phases so the handle clears the knees before they bend. |

## Suggested implementation order

1. Review the [bodyweight squat sample](samples/bodyweight-squat.json) against the catalog and check the no-equipment path in the player.
2. Implement the floor and raised-contact rigs. Start with push-up and step-up, then add independent limbs for dead bug and spinal articulation for Cat-Cow. Reuse shared floor geometry for holds once the contact fixtures pass.
3. Add bar, chair, and rolling-ball supports after the fixed supports pass. Make grip style and active side visible in the reference camera.
4. Check the static one-pose presentation contract before integrating the 11 holds or four setup cards. Verify there is no timed replay or redundant pose navigation, that the full pose and supporting prop are visible, and that side and cue text remain readable.
5. Add the rower as its own moving equipment fixture. Reuse only the parts of the renderer that support the real seat and handle paths.

## Validation

- Use the exact catalog cue and exact-variant source before approving pose data. For reference, start with the [ACE squat](https://www.acefitness.org/resources/everyone/exercise-library/135/bodyweight-squat/), [Mayo Clinic stretch examples](https://www.mayoclinic.org/healthy-lifestyle/fitness/in-depth/stretching/art-20546848), and [Concept2 rowing technique](https://www.concept2.com/training/rowing-technique).
- Run the guide checks and inspect the full loop and wraparound for support, clipping, framing, and limb consistency. Add renderer regression assertions for each new fixture when integrating its rig.
- Once indexed, verify playback or static presentation on fit-test at phone widths and with reduced motion. Check cached offline playback, uncached written-cue fallback, screen-reader labels and the pending admin review entry.
