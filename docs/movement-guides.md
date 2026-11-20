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

## Rigs at a glance

| rig | for | camera | equipment | sample to start from |
| --- | --- | --- | --- | --- |
| `standing-side-v1` | standing, arms only | free text | `dumbbell-v1` | `web/guides/dumbbell-curl.json` |
| `grounded-side-v1` | standing, both feet planted (squats, standing holds) | `side` | `dumbbell-goblet-v1` or `dumbbell-v1` | `docs/guides/samples/goblet-squat.json` |
| `supine-bench-v1` | lying face up on a flat bench, feet on the floor | `front-three-quarter` | `flat-bench-v1`, `dumbbell-pair-v1` | `docs/guides/samples/dumbbell-bench-press.json` |
| `hinge-bench-side-v1` | hinged over a bench, braced on one hand and knee | `side-three-quarter` | `flat-bench-v1`, `dumbbell-v1` | `docs/guides/samples/one-arm-dumbbell-row.json` |
| `grounded-side-v1` with a barbell | curls, deadlifts, presses (`barbell-v1`), back squats (`barbell-back-v1`) | `side` | `barbell-v1` or `barbell-back-v1` | `barbell-curl`, `deadlift`, `overhead-press`, `back-squat` in `docs/guides/samples/` |
| `grounded-side-v1` with two dumbbells | RDLs, carries, any standing lift with a dumbbell in each hand | `side` | `dumbbell-pair-v1` | `docs/guides/samples/dumbbell-rdl.json` |
| `supine-barbell-v1` | lying face up on a flat bench with a barbell | `front-three-quarter` | `flat-bench-v1`, `barbell-v1` | `docs/guides/samples/barbell-bench-press.json` |
| `seated-side-v1` | seated at a cable machine | `side` | `lat-pulldown-v1` or `seated-row-v1` | `lat-pulldown`, `seated-cable-row` in `docs/guides/samples/` |

All four draw the same mint mannequin with the same limb lengths. The sample
files are **rig samples, not final poses**: they prove contacts, grips and fit.
Copy the one for your setup, then write the real poses against the references.

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

## Shared-figure rigs (#261)

The three newer rigs pose the figure in 3D and draw it through a fixed camera.
Things that touch the floor or a bench are **contacts**: fixed points that the
legs or arms are solved to reach, so they stay put while everything else moves,
at every pose and every frame between poses. The checks fail a guide whose
contact drifts more than 0.05 units or whose figure or equipment leaves the
picture at any point in the loop.

World units: x forward (the figure faces +x, or its head is at −x when lying
down), y up from the floor (y = 0), z towards the camera. Lengths are the same as
the pilot: torso 54, neck 9, upper arm 34, forearm 30, thigh 44, shin 44, foot 20;
shoulders 26 apart, hips 14 apart.

### Cameras

A point (x, y, z) is drawn at screen (origin x + x + z·kx, origin y − y + z·ky).
The camera is fixed per rig; `camera` in the guide must be its id.

| id | kx | ky | what it shows |
| --- | --- | --- | --- |
| `side` | 0.35 | 0.22 | Right side, a touch from above so a goblet dumbbell's plates show |
| `front-three-quarter` | 0.36 | 0.26 | From the feet end and above, so both arms of a lying figure show |
| `side-three-quarter` | −0.32 | 0.38 | From the near side and above, so the bench and both braced limbs show |

### `grounded-side-v1`

Standing, facing right. Built up from the ankles at (0, 4, ±7), which never move.
viewBox `44 40 168 196`, origin (118, 224). Arrows sit 24 units behind the hips.

| joint | meaning | allowed | default |
| --- | --- | --- | --- |
| `shin` | shin lean from straight up; positive brings the knees forward | -10 to 45 | 0 |
| `knee` | bend; 0 is a straight leg. The thigh's angle is `shin − knee`, so bending sends the hips back and down | 0 to 150 | 0 |
| `torso` | lean from straight up; positive leans forward | -10 to 75 | 0 |
| `shoulder` | upper arm from the line of the torso; positive forward, 180 straight overhead. For arms hanging straight down while hinged, use minus the torso angle | -90 to 180 | 0 |
| `elbow` | bend; 0 is a straight arm | 0 to 160 | 0 |
| `supination` | `dumbbell-v1` grip turn: 0 palm facing the thigh, 1 palm up | 0 to 1 | 0 |

Arm angles follow the torso, so a hold at the chest stays at the chest as the
torso leans. Contacts: near and far foot on the floor.

With `barbell-v1` the bar runs through both hands (shoulder width apart). With
`barbell-back-v1` the bar sits across the upper back below the neck and the arms
are solved to hold it with a wide grip, so `shoulder` and `elbow` are not used;
contacts add each hand on the bar. Barbell plates are bumper size (radius 20): the
checks report plates that sink into the floor, and a deadlift setup has the bar
centre about 20 units up. Barbell and dumbbell-pair guides are framed to fit their
own whole loop (see `viewBoxOf`), so an overhead press gets a taller picture than a
curl; the frame never changes while the guide plays.

### `supine-barbell-v1`

The bench, back, hips and feet of `supine-bench-v1`, with both hands on one bar
26 units either side of the middle (a grip just outside the shoulders). The bar
moves on a fixed path from the lower chest to over the shoulders; the arms follow it.

| joint | meaning | allowed | default |
| --- | --- | --- | --- |
| `press` | where the bar is on its path: 0 touching the chest, 1 straight arms over the shoulders | 0 to 1 | 1 |
| `tuck` | how far the elbows point out from the body: 20 close to the ribs, 80 flared wide | 20 to 80 | 50 |

Contacts: back and hips on the bench, both feet on the floor, both hands on the bar.

### `seated-side-v1`

Seated on a machine seat facing right, hips at (0, 52, 0) on the seat; the legs
are solved to the machine's foot position and the arms to its handle. The handle
moves along the machine's own path, so the cable and pulley line up at every frame.

| joint | meaning | allowed | default |
| --- | --- | --- | --- |
| `torso` | lean from straight up; positive forward, negative back | -25 to 30 | 0 |
| `pull` | where the handle is on its path: 0 arms long, 1 the end of the pull | 0 to 1 | 0 |

| equipment | feet | handle path | grip |
| --- | --- | --- | --- |
| `lat-pulldown-v1` | floor at (42, 4), thighs under the pad | from overhead (8, 160) to the upper chest (16, 98) | wide bar, hands 32 either side |
| `seated-row-v1` | footplate at (64, 22) | from arms long (64, 82) to the stomach (18, 72) | close V handle, hands 4 either side |

Contacts: hips on the seat, both feet on the floor or footplate, both hands on the
handle. Leaning back too far at full reach puts the handle out of reach, and the
checks say so.

### `supine-bench-v1`

Lying face up on a flat bench, head to the left, feet planted. Hips at (0, 49, 0),
shoulders 54 to the left; legs are solved to the feet at (44, 4, ±9). Each arm is
posed on its own with a `near_` or `far_` joint. viewBox `18 70 240 166`, origin
(150, 222). Arrows sit beside the near hand.

| joint | meaning | allowed | default |
| --- | --- | --- | --- |
| `near_shoulder`, `far_shoulder` | upper arm from pointing straight up (0) out to the side (90 is level with the bench) | 0 to 95 | 0 |
| `near_elbow`, `far_elbow` | bend; 0 is a straight arm. With elbow equal to shoulder the forearm is vertical | 0 to 130 | 0 |
| `near_tuck`, `far_tuck` | upper arm swung from square to the body towards the hips | 0 to 70 | 0 |

Contacts: back and hips on the bench, near and far foot on the floor.

### `hinge-bench-side-v1`

Braced on a flat bench, facing right: far knee on the bench at (−4, 47.5, −9),
far hand on the bench at (52, 47, −14), near foot on the floor at (−4, 4, 13). The
near leg and the far arm are solved to reach them; the near arm works. viewBox
`14 80 184 156`, origin (104, 222). Arrows sit beside the near hand.

| joint | meaning | allowed | default |
| --- | --- | --- | --- |
| `torso` | lean from straight up; 90 would be flat | 60 to 88 | 75 |
| `shoulder` | near upper arm from straight down (not from the torso); positive towards the head, negative back towards the hip | -90 to 60 | 0 |
| `elbow` | bend; 0 is a straight arm | 0 to 150 | 0 |

Below a torso of about 68 the far hand can't reach the bench, and the checks say
so. Contacts: far knee and far hand on the bench, near foot on the floor.

### Equipment and anchors

| id | rigs | where it sits |
| --- | --- | --- |
| `dumbbell-v1` | `standing-side-v1`, `grounded-side-v1`, `hinge-bench-side-v1` | Centred on the near hand. Standing: handle square to the forearm and turned by `supination`. Hinge rig: neutral grip, handle along x (front to back). |
| `dumbbell-goblet-v1` | `grounded-side-v1` | One dumbbell held upright at the chest by both hands: the forearms angle in so the hands meet, and the dumbbell's centre is the middle of the hands + (3, −10, 0). |
| `dumbbell-pair-v1` | `supine-bench-v1` | One dumbbell in each hand, handle along z (across the body), each moving only with its own arm. |
| `dumbbell-pair-v1` on `grounded-side-v1` | `grounded-side-v1` | One dumbbell in each hand, handle across the body (palms facing the thighs). |
| `barbell-v1` | `grounded-side-v1`, `supine-barbell-v1` | Bar along z through the middle of the hands; bumper plates at 34 to 44 either side. |
| `barbell-back-v1` | `grounded-side-v1` | Bar on the upper back, 7 behind and 3 below the shoulder line; hands solved to it. |
| `lat-pulldown-v1`, `seated-row-v1` | `seated-side-v1` | The machine: frame, seat, pad or footplate, pulley, cable and handle, all fixed. |
| `flat-bench-v1` | `supine-bench-v1`, `hinge-bench-side-v1`, `supine-barbell-v1` | Fixed. Supine: x −118 to 16, z −13 to 13, pad top 39. Hinge: x −62 to 64, z −27 to 3, pad top 44. 7-unit pad on two legs. |

The weights are always placed from the hand in the same frame, so they can't lag
or float; the checks confirm the gap is 0.

## The guide file

Copy the sample for your rig (see **Rigs at a glance**), or
`docs/guides/template.json` and delete its `_help` block, which lists every rig,
camera, equipment id and joint range (the checks report a guide that still has
it). Fields:

- `format`: always `"thoenefit-movement-guide"`. `version`: 1.
- `exercise`: the built-in slug from `web/private/src/Catalog.php`, for example `dumbbell-curl`.
- `title`: the exercise name in sentence case, shown under "Show movement".
- `rig`, `camera`, `equipment`: as above. On the shared-figure rigs `camera` must
  be the rig's camera id and `equipment` lists only ids that rig supports.
- `timing`: `move_ms` (time to move between poses, 300 to 3000) and `hold_ms`
  (pause on each pose, 200 to 3000). A pose can set its own `hold_ms`.
- `poses`: 1 to 6, in order. The player loops back from the last to the first,
  so the last pose should lead naturally into the first. Each has:
  - `id`: lower case, unique in the file.
  - `label`: one or two words, at most 12 characters (it sits under a thumbnail).
  - `description`: one sentence, at most 160 characters, agreeing with the
    exercise's written cue. Screen readers read it, and it shows under the figure.
  - `joints`: the angles above.
  - `arrow`: `"up"`, `"down"` or `null`, showing the direction of the next
    movement: curved at the hand on `standing-side-v1`, straight beside the
    rig's arrow point on the others.
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
   (the site's security policy blocks them). On the shared-figure rigs it also
   checks contacts, that weights stay in the hands, and that everything fits the
   picture, at each pose and 9 frames between each pair. Files in
   `docs/guides/samples/` are checked the same way.
2. Run `node docs/guides/render-previews.mjs` and look at
   `docs/guides/<exercise>/sheet.svg`: every pose side by side. Samples go to
   `docs/guides/samples/<exercise>/`. To preview only some files, pass them:
   `node docs/guides/render-previews.mjs docs/guides/samples/goblet-squat.json`.
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
| Guides | 5 (`dumbbell-curl` pilot; `goblet-squat`, `dumbbell-bench-press`, `one-arm-dumbbell-row`, `hammer-curl`) |
| Rig samples (not shown in the app) | 11, one per setup, in `docs/guides/samples/` |
| Built-in exercises | see `node tests/guides.test.mjs` (it counts them) |

The full inventory and batches come next (#260). Don't call the library complete
while exercises remain without a guide or a documented exclusion.
