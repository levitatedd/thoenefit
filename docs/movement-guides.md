# Movement guides

The illustrated movement guides under an exercise's **Form cues** (#256). The
dumbbell curl is the pilot (#259) and the reference for every guide after it.

## How it works

- One **rig** (a jointed figure with fixed limb lengths, camera and style) is
  drawn in code by `web/js/guides.js`. Every guide uses it, so bodies,
  proportions and the mint style never drift between exercises.
- A **guide** is a small JSON file in `web/guides/` that lists **poses** as joint
  angles. The app draws each pose from the rig and animates by moving every joint
  angle evenly from one pose to the next. Limbs never stretch, and equipment
  moves with the hand, because positions are always worked out from the angles.
- `web/guides/index.json` maps a built-in exercise **slug** to its guide file.
  Only exercises listed there get a guide. Custom exercises never do; everyone
  keeps the written cues.
- Guides are fetched when someone opens an exercise that has one. The service
  worker keeps every file the app fetches, so a guide seen once works offline
  until the next deploy clears the saved copies. Nothing is preloaded, so the
  size of the library never slows the app down.

Asset creators write **JSON only**: no SVG drawing, no images. New equipment or a
new rig (for example lying on a bench) is added to `web/js/guides.js` by Claude
first, then becomes available to guides.

## The rig: `standing-side-v1`

Standing figure seen from its right side, facing right (towards +x). It is
drawn as a mint mannequin: tapered limbs with a slight muscle curve, ball joints
at the shoulder, elbow, knee and ankle, a chest, waist and hip block that lean
together with `torso`, an egg-shaped head on a short neck, shaped feet, and a
closed fist on whatever is held. The far leg is drawn a little behind and darker.
All of it is worked out from the joint positions, so poses never need to know
about the drawing.

| | |
| --- | --- |
| viewBox | `44 30 168 202` (x, y, width, height) |
| ground | y = 224 |
| hip (root of the figure) | (118, 132) |
| lengths | torso 54, neck 9, upper arm 34, forearm 30, thigh 44, shin 44, foot 20 |

Joint angles, in degrees:

| joint | meaning | allowed |
| --- | --- | --- |
| `torso` | lean from straight up; positive leans forward | -15 to 45 |
| `shoulder` | upper arm from straight down; positive swings forward | -40 to 100 |
| `elbow` | bend; 0 is a straight arm | 0 to 150 |
| `wrist` | tilt of what is held; 0 is in line with the forearm | -30 to 30 |
| `hip` | thigh from straight down; positive forward | -30 to 100 |
| `knee` | bend; 0 is a straight leg | 0 to 140 |
| `supination` | grip turn: 0 palm facing the thigh, 1 palm up | 0 to 1 |

A joint left out of a pose is 0. The near arm (the one shown working) holds the
equipment.

### Equipment

| id | drawn as |
| --- | --- |
| `dumbbell-v1` | A dumbbell in the near hand, handle square to the forearm. At `supination` 0 the handle is side on (a plate at each end); at 1 it is end on (one round plate); it turns smoothly between. |

## The guide file

Copy `docs/guides/template.json`. Fields:

- `format`: always `"thoenefit-movement-guide"`. `version`: 1.
- `exercise`: the built-in slug from `web/private/src/Catalog.php`, for example `dumbbell-curl`.
- `title`: the exercise name in sentence case, shown under "Show movement".
- `rig`, `camera`, `equipment`: as above.
- `timing`: `move_ms` (time to move between poses, 300 to 3000) and `hold_ms`
  (pause on each pose, 200 to 3000). A pose can set its own `hold_ms`.
- `poses`: 1 to 6, in order. The player loops back from the last to the first,
  so the last pose should lead naturally into the first. Each has:
  - `id`: lower case, unique in the file.
  - `label`: one or two words, at most 12 characters (it sits under a thumbnail).
  - `description`: one sentence, at most 160 characters, agreeing with the
    exercise's written cue. Screen readers read it, and it shows under the figure.
  - `joints`: the angles above.
  - `arrow`: `"up"`, `"down"` or `null`, a curved arrow at the hand showing the
    direction of the next movement.
- `review`: `status` (`draft`, then `pilot-checked` or `reviewed`), `checked`
  (date), `checked_by`, `checks` (what was compared), `references` (at least one
  reputable source), `limitations`.
- `source.artwork`: where the drawing comes from. For guides made this way it is
  always the shared rig.

Then add the exercise to `web/guides/index.json`.

## Checking a guide

1. Run `node tests/guides.test.mjs`. It checks the format, that the slug exists,
   joint limits, labels and descriptions, the review record, that limbs keep
   their length through the whole loop, and that the SVG has no inline styles
   (the site's security policy blocks them).
2. Run `node docs/guides/render-previews.mjs` and look at
   `docs/guides/<exercise>/sheet.svg`: every pose side by side.
3. Compare each pose with the references: setup and stance, grip, which joints
   move and which stay fixed, range at the top and bottom, and the path of the
   weight. Write what you checked in `review.checks`.
4. Open the exercise on fit-test: it plays, steps, and fits a 320px phone.

A guide is complete only after both the asset review and the in-app check pass.
Generated pictures are never the authority on form; the references are.

## Review checklist

- [ ] Slug is the exact built-in exercise; never a merely similar movement.
- [ ] Setup position and stance match the written cue.
- [ ] Grip and hand position are right, including any turn during the lift.
- [ ] Joints that should stay fixed do (for example the upper arm in a curl).
- [ ] Range of motion at both ends matches the references.
- [ ] No swinging or momentum shown unless the exercise calls for it.
- [ ] Descriptions agree with the written cue and are one sentence each.
- [ ] `node tests/guides.test.mjs` passes; previews regenerated.
- [ ] Checked in the app at 320px and 402px.

## The player

- Sits under the written **Form cues** on the exercise page, and in an
  exercise's ••• sheet during a workout.
- Plays on its own while at least 40% of it is on screen; pauses when scrolled
  away, when the app is hidden, and stops for good when the page or sheet closes.
- People who ask for reduced motion see a still pose; Play steps through poses
  without movement.
- Previous, Next and the pose thumbnails pause it on the chosen pose. Thumbnails
  use the same mint selected style as Pick muscle groups (#194).
- The status line ("2 / 4 · Lift") is announced by screen readers when someone
  steps through poses, not on every turn of the loop.
- If a guide can't load (offline and never opened, or a broken file), nothing is
  shown and the written cues stand alone.

## Coverage

| | |
| --- | --- |
| Guides | 1 (`dumbbell-curl`, pilot) |
| Built-in exercises | see `node tests/guides.test.mjs` (it counts them) |

The full inventory and batches come next (#260). Don't call the library complete
while exercises remain without a guide or a documented exclusion.
