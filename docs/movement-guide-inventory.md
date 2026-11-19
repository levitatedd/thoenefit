# Movement guide rollout inventory

Refs #260, #256. Scope is the staging [built-in catalog](../web/private/src/Catalog.php), blob `bcd2a4392a13cae648512096dadae77be7559cef`. Slugs are stable across installs. Equipment is the exact catalog requirement list; a dash means no tracked equipment. Views and poses are production briefs. Check each against its written cue and an exercise-specific reference before authoring a guide.

| Batch | Exercises | State |
| --- | ---: | --- |
| Curl pilot (#259) | 1 | Integrated pilot |
| Common lifts (#261) | 12 | Planned |
| Remaining strength and equipment variants (#262) | 178 | Planned |
| Bodyweight, stretch and cardio (#263) | 81 | Planned |
| Deferred exclusions | 2 | Written cues |
| **Total** | **274** | **1 mapped, 271 planned, 2 excluded** |

The plan calls for 257 movement loops (including the pilot), 11 static holds and 4 setup illustrations. A hold or setup can use one pose with a clear description. The current guide index maps only `dumbbell-curl`.

## First delivery within #261

Start with `goblet-squat`, `dumbbell-bench-press`, and `one-arm-dumbbell-row`. They cover grounded leg motion, supine bench contact and unilateral support. The current fixed-hip standing-side rig only ships a near-hand dumbbell. Add grounded root/leg handling, appropriate bench contact, and the necessary grips and equipment in the shared renderer before authoring those poses. Check feet, body support and weight paths between keyframes as well as at each pose. The rest of the common batch is explicitly listed below.

## Asset handoff and review

- Use the [pilot contract](movement-guides.md), [JSON template](guides/template.json) and exact catalog slug. Keep the original shared mint SVG renderer. Codex authors compatible JSON and generates SVG previews. Claude owns rig changes, index mapping and app integration. A different support, grip, cable anchor or load path needs its own verified pose data.
- Save production guide data as `web/guides/<slug>.json` and use version 1 while the existing schema remains compatible. Document a schema or rig version change in the guide contract before using it. Keep preview sheets under `docs/guides/<slug>/` and track preview, delivered JSON, and integrated/reviewed as separate milestones.
- Compare setup, stance, support, grip, joint alignment, range, load path and return with an exact-variant reference. Start from the references in the [cue review](FORM-CUE-REVIEW.md), including ACE for strength, Concept2 for rowing and Mayo Clinic for stretching. Use manufacturer instructions when equipment geometry matters. Record the source, date, reviewer, checks, limitations and original/licensed artwork provenance in the JSON. Use a different camera or static setup when it communicates the movement more clearly.
- Run `node tests/guides.test.mjs`, generate previews with `node docs/guides/render-previews.mjs`, and inspect every pose. On fit-test, check exact slug mapping, touch controls and readability at 320px and 402px, reduced motion, and previously opened offline playback. Check written-cue fallback for missing or unavailable assets. Mark guides reviewed after asset and in-app checks.
- Custom and user-promoted exercises are outside this built-in inventory and retain written cues. A future explicit assignment must match the exact movement and equipment. Unmapped built-ins retain their written cues.
- Update this inventory when the catalog changes. Reconcile the slug set against `Catalog::exercises()` and integrated mappings against `web/guides/index.json` before reporting coverage.

## Pilot

| Slug | Exercise | Equipment | Movement family | Format | View and key poses or exclusion reason |
| --- | --- | --- | --- | --- | --- |
| `dumbbell-curl` | Dumbbell Curl | single_dumbbell | biceps | Loop | Side · setup → lift → top → lower |

## Common

| Slug | Exercise | Equipment | Movement family | Format | View and key poses or exclusion reason |
| --- | --- | --- | --- | --- | --- |
| `barbell-bench-press` | Barbell Bench Press | barbell, bench, rack | horizontal push | Loop | Side three-quarter · top → chest → top · bench, rack and bar path |
| `dumbbell-bench-press` | Dumbbell Bench Press | dumbbells, bench | horizontal push | Loop | Front three-quarter · top → bottom → top · supine bench and paired dumbbells |
| `overhead-press` | Barbell Overhead Press | barbell, rack | vertical push | Loop | Side · rack → overhead → rack · overhead reach and barbell |
| `lat-pulldown` | Lat Pulldown | lat_pulldown | vertical pull | Loop | Front three-quarter · reach → pull → reach · thigh pad and overhead cable |
| `one-arm-dumbbell-row` | One-Arm Dumbbell Row | single_dumbbell, bench | horizontal pull | Loop | Side three-quarter · reach → pull → reach · bench support and hinged torso |
| `seated-cable-row` | Seated Cable Row | seated_row | horizontal pull | Loop | Side · reach → pull → reach · seat, footplates and low cable |
| `barbell-curl` | Barbell Curl | barbell | biceps | Loop | Front three-quarter · setup → top → setup · bilateral grip and barbell |
| `hammer-curl` | Hammer Curl | single_dumbbell | biceps | Loop | Side · setup → top → setup · neutral grip throughout |
| `back-squat` | Barbell Back Squat | barbell, rack | squat | Loop | Side three-quarter · upright → bottom → upright · rack, bar position, grounded feet |
| `goblet-squat` | Dumbbell Goblet Squat | single_dumbbell | squat | Loop | Side · upright → bottom → upright · grounded feet, hip translation, two-hand dumbbell |
| `deadlift` | Barbell Deadlift | barbell | hinge | Loop | Side three-quarter · floor setup → stand → floor reset · plates, floor and bar path |
| `dumbbell-rdl` | Dumbbell Romanian Deadlift | dumbbells | hinge | Loop | Side · stand → hinge → stand · hips move back and weights track close |

## Strength

| Slug | Exercise | Equipment | Movement family | Format | View and key poses or exclusion reason |
| --- | --- | --- | --- | --- | --- |
| `one-arm-dumbbell-floor-press` | One-Arm Dumbbell Floor Press | single_dumbbell | horizontal push | Loop | Side · top → lower → top |
| `machine-chest-press` | Machine Chest Press | chest_press | horizontal push | Loop | Side three-quarter · top → lower → top |
| `smith-bench-press` | Smith Machine Bench Press | smith, bench | horizontal push | Loop | Side three-quarter · top → lower → top |
| `incline-dumbbell-press` | Incline Dumbbell Press | dumbbells, incline_bench | incline push | Loop | Side three-quarter · top → lower → top |
| `incline-barbell-press` | Incline Barbell Press | barbell, incline_bench, rack | incline push | Loop | Side three-quarter · top → lower → top |
| `smith-incline-press` | Smith Machine Incline Press | smith, incline_bench | incline push | Loop | Side three-quarter · top → lower → top |
| `cable-fly` | Cable Fly | cable | chest fly | Loop | Front three-quarter · open → bring arms together → open |
| `pec-deck` | Pec Deck Fly | pec_deck | chest fly | Loop | Front three-quarter · open → bring arms together → open |
| `dumbbell-fly` | Dumbbell Fly | dumbbells, bench | chest fly | Loop | Front three-quarter · open → bring arms together → open |
| `band-fly` | Band Fly | bands | chest fly | Loop | Front three-quarter · open → bring arms together → open |
| `seated-dumbbell-press` | Seated Dumbbell Shoulder Press | dumbbells, incline_bench | vertical push | Loop | Side · rack → overhead → rack |
| `standing-dumbbell-press` | Standing Dumbbell Press | dumbbells | vertical push | Loop | Side · rack → overhead → rack |
| `machine-shoulder-press` | Machine Shoulder Press | shoulder_press | vertical push | Loop | Side three-quarter · rack → overhead → rack |
| `kettlebell-press` | Kettlebell Press | kettlebells | vertical push | Loop | Side · rack → overhead → rack |
| `dumbbell-lateral-raise` | Dumbbell Lateral Raise | single_dumbbell | lateral raise | Loop | Front three-quarter · setup → raise → setup |
| `cable-lateral-raise` | Cable Lateral Raise | cable | lateral raise | Loop | Front three-quarter · setup → raise → setup |
| `band-lateral-raise` | Band Lateral Raise | bands | lateral raise | Loop | Front three-quarter · setup → raise → setup |
| `cable-pushdown` | Cable Triceps Pushdown | cable | triceps | Loop | Side three-quarter · setup → extend → return |
| `skull-crusher` | EZ-Bar Skull Crusher | ez_bar, bench | triceps | Loop | Side · setup → extend → return |
| `overhead-dumbbell-extension` | Overhead Dumbbell Extension | single_dumbbell | triceps | Loop | Side · setup → extend → return |
| `close-grip-bench-press` | Close-Grip Bench Press | barbell, bench, rack | triceps | Loop | Side · setup → extend → return |
| `band-pushdown` | Band Pushdown | bands | triceps | Loop | Side · setup → extend → return |
| `assisted-pull-up` | Assisted Pull-Up | assisted_pullup | vertical pull | Loop | Front three-quarter · reach → pull → reach |
| `band-pulldown` | Band Pulldown | bands | vertical pull | Loop | Front three-quarter · reach → pull → reach |
| `barbell-row` | Barbell Row | barbell | horizontal pull | Loop | Side · reach → pull → reach |
| `one-arm-unsupported-dumbbell-row` | One-Arm Dumbbell Row (No Bench) | single_dumbbell | horizontal pull | Loop | Side · reach → pull → reach |
| `chest-supported-row` | Chest-Supported Dumbbell Row | dumbbells, incline_bench | horizontal pull | Loop | Side · reach → pull → reach |
| `standing-cable-row` | Standing Cable Row | cable | horizontal pull | Loop | Side three-quarter · reach → pull → reach |
| `kettlebell-row` | Kettlebell Row | kettlebells | horizontal pull | Loop | Side · reach → pull → reach |
| `band-row` | Band Row | bands | horizontal pull | Loop | Side · reach → pull → reach |
| `face-pull` | Face Pull | cable | rear delt | Loop | Front three-quarter · setup → pull/raise → return |
| `reverse-pec-deck` | Reverse Pec Deck | pec_deck | rear delt | Loop | Front three-quarter · setup → pull/raise → return |
| `bent-over-reverse-fly` | Bent-Over Reverse Fly | dumbbells | rear delt | Loop | Front three-quarter · setup → pull/raise → return |
| `band-pull-apart` | Band Pull-Apart | bands | rear delt | Loop | Front three-quarter · setup → pull/raise → return |
| `ez-bar-curl` | EZ-Bar Curl | ez_bar | biceps | Loop | Side · setup → curl → return |
| `cable-curl` | Cable Curl | cable | biceps | Loop | Side three-quarter · setup → curl → return |
| `incline-dumbbell-curl` | Incline Dumbbell Curl | single_dumbbell, incline_bench | biceps | Loop | Side three-quarter · setup → curl → return |
| `band-curl` | Band Curl | bands | biceps | Loop | Side · setup → curl → return |
| `leg-press` | Leg Press | leg_press | squat | Loop | Side · upright → lower → upright |
| `hack-squat` | Hack Squat | hack_squat | squat | Loop | Side · upright → lower → upright |
| `front-squat` | Barbell Front Squat | barbell, rack | squat | Loop | Side · upright → lower → upright |
| `kettlebell-goblet-squat` | Kettlebell Goblet Squat | kettlebells | squat | Loop | Side · upright → lower → upright |
| `smith-squat` | Smith Machine Squat | smith | squat | Loop | Side three-quarter · upright → lower → upright |
| `romanian-deadlift` | Barbell Romanian Deadlift | barbell | hinge | Loop | Side · setup → hinge → return |
| `kettlebell-swing` | Kettlebell Swing | kettlebells | hinge | Loop | Side · backswing → hip drive → bell floats → rehinge |
| `cable-pull-through` | Cable Pull-Through | cable | hinge | Loop | Side three-quarter · setup → hinge → return |
| `dumbbell-reverse-lunge` | Dumbbell Reverse Lunge | single_dumbbell | lunge | Loop | Side · setup → lower or step → return |
| `bulgarian-split-squat` | Bulgarian Split Squat | dumbbells, bench | lunge | Loop | Side · setup → lower or step → return |
| `barbell-lunge` | Barbell Reverse Lunge | barbell, rack | lunge | Loop | Side · setup → lower or step → return |
| `dumbbell-step-up` | Dumbbell Step-Up | single_dumbbell, step_box | lunge | Loop | Side · setup → lower or step → return |
| `barbell-hip-thrust` | Barbell Hip Thrust | barbell, bench | hip thrust | Loop | Side · bottom → extend → bottom |
| `dumbbell-hip-thrust` | Dumbbell Hip Thrust | single_dumbbell, bench | hip thrust | Loop | Side · bottom → extend → bottom |
| `leg-curl` | Leg Curl | leg_curl | knee flexion | Loop | Side · start → flex → return |
| `band-leg-curl` | Band Leg Curl | bands | knee flexion | Loop | Side · start → flex → return |
| `leg-extension` | Leg Extension | leg_extension | knee extension | Loop | Side · start → extend → return |
| `machine-calf-raise` | Machine Calf Raise | calf_raise | calf | Loop | Side three-quarter · bottom → raise → bottom |
| `dumbbell-calf-raise` | Dumbbell Calf Raise | dumbbells | calf | Loop | Side · bottom → raise → bottom |
| `leg-press-calf-raise` | Leg Press Calf Raise | leg_press | calf | Loop | Side · bottom → raise → bottom |
| `cable-crunch` | Cable Crunch | cable | core | Loop | Side three-quarter · setup → working position → return |
| `cable-rope-triceps-extension` | Cable Rope Triceps Extension | cable | triceps | Loop | Side three-quarter · setup → extend → return |
| `dumbbell-front-raise` | Dumbbell Front Raise | single_dumbbell | Dumbbell Front Raise | Loop | Side · setup → key movement → reset |
| `dumbbell-pullover` | Dumbbell Pullover | single_dumbbell, bench | Dumbbell Pullover | Loop | Side · setup → key movement → reset |
| `dumbbell-side-bend` | Dumbbell Side Bend | single_dumbbell | core | Loop | Front three-quarter · setup → working position → return |
| `reverse-grip-barbell-curl` | Reverse-Grip Barbell Curl | barbell | biceps | Loop | Side · setup → curl → return |
| `concentration-curl` | Concentration Curl | single_dumbbell, bench | biceps | Loop | Side · setup → curl → return |
| `single-arm-overhead-dumbbell-extension` | Single-Arm Overhead Dumbbell Extension | single_dumbbell | triceps | Loop | Side · setup → extend → return |
| `seated-barbell-shoulder-press` | Seated Barbell Shoulder Press | barbell, incline_bench, rack | vertical push | Loop | Side · rack → overhead → rack |
| `dumbbell-triceps-kickback` | Dumbbell Triceps Kickback | single_dumbbell, bench | triceps | Loop | Side · setup → extend → return |
| `barbell-shrug` | Barbell Shrug | barbell | Barbell Shrug | Loop | Side · setup → key movement → reset |
| `reverse-grip-bench-press` | Reverse-Grip Bench Press | barbell, bench, rack | horizontal push | Loop | Side · top → lower → top |
| `reverse-grip-barbell-row` | Reverse-Grip Barbell Row | barbell | horizontal pull | Loop | Side · reach → pull → reach |
| `cross-body-hammer-curl` | Cross-Body Hammer Curl | single_dumbbell | biceps | Loop | Side · setup → curl → return |
| `dumbbell-shrug` | Dumbbell Shrug | dumbbells | Dumbbell Shrug | Loop | Side · setup → key movement → reset |
| `dumbbell-skull-crusher` | Dumbbell Skull Crusher | dumbbells, bench | triceps | Loop | Side · setup → extend → return |
| `incline-dumbbell-fly` | Incline Dumbbell Fly | dumbbells, incline_bench | chest fly | Loop | Front three-quarter · open → bring arms together → open |
| `zottman-curl` | Zottman Curl | single_dumbbell | biceps | Loop | Side · setup → curl → return |
| `stiff-legged-good-morning` | Stiff-Legged Good Morning | barbell, rack | hinge | Loop | Side · setup → hinge → return |
| `barbell-upright-row` | Barbell Upright Row | barbell | Barbell Upright Row | Loop | Side · setup → key movement → reset |
| `calf-raise` | Calf Raise | calf_raise | calf | Loop | Side · bottom → raise → bottom |
| `shotgun-row` | Shotgun Row | cable | horizontal pull | Loop | Side · reach → pull → reach |
| `cable-upright-row` | Cable Upright Row | cable | Cable Upright Row | Loop | Side three-quarter · setup → key movement → reset |
| `cable-rope-overhead-triceps-extension` | Cable Rope Overhead Triceps Extension | cable | triceps | Loop | Side three-quarter · setup → extend → return |
| `dumbbell-bent-over-row` | Dumbbell Bent-Over Row | dumbbells | horizontal pull | Loop | Side · reach → pull → reach |
| `cable-wood-chop` | Cable Wood Chop | cable | core | Loop | Side three-quarter · setup → working position → return |
| `smith-machine-stiff-legged-deadlift` | Smith Machine Stiff-Legged Deadlift | smith | hinge | Loop | Side three-quarter · setup → hinge → return |
| `dumbbell-lunge` | Dumbbell Lunge | dumbbells | lunge | Loop | Side · setup → lower or step → return |
| `seated-dumbbell-curl` | Seated Dumbbell Curl | dumbbells, bench | biceps | Loop | Side · setup → curl → return |
| `low-to-high-cable-fly` | Low-to-High Cable Fly | cable | chest fly | Loop | Front three-quarter · open → bring arms together → open |
| `palms-down-dumbbell-wrist-curl` | Palms-Down Dumbbell Wrist Curl | single_dumbbell, bench | Palms-Down Dumbbell Wrist Curl | Loop | Side · setup → key movement → reset |
| `machine-triceps-dip` | Machine Triceps Dip | triceps_machine | triceps | Loop | Side three-quarter · setup → extend → return |
| `ab-crunch-machine` | Ab Crunch Machine | ab_crunch | core | Loop | Side three-quarter · setup → working position → return |
| `plate-loaded-leg-press` | Plate-Loaded Leg Press | leg_press | squat | Loop | Side · upright → lower → upright |
| `palms-up-dumbbell-wrist-curl` | Palms-Up Dumbbell Wrist Curl | single_dumbbell, bench | Palms-Up Dumbbell Wrist Curl | Loop | Side · setup → key movement → reset |
| `biceps-curl-to-shoulder-press` | Biceps Curl to Shoulder Press | dumbbells | Biceps Curl to Shoulder Press | Loop | Side · setup → key movement → reset |
| `seated-calf-raise` | Seated Calf Raise | calf_raise | calf | Loop | Side · bottom → raise → bottom |
| `incline-hammer-curl` | Incline Hammer Curl | single_dumbbell, incline_bench | biceps | Loop | Side three-quarter · setup → curl → return |
| `hammer-strength-chest-press` | Hammer Strength Chest Press | chest_press | horizontal push | Loop | Side · top → lower → top |
| `lying-leg-curl` | Lying Leg Curl | leg_curl | knee flexion | Loop | Side · start → flex → return |
| `overhead-cable-curl` | Overhead Cable Curl | cable | biceps | Loop | Side three-quarter · setup → curl → return |
| `dumbbell-sumo-squat` | Dumbbell Sumo Squat | single_dumbbell | squat | Loop | Side · upright → lower → upright |
| `machine-preacher-curl` | Machine Preacher Curl | biceps_machine | biceps | Loop | Side three-quarter · setup → curl → return |
| `glute-kickback-machine` | Glute Kickback Machine | glute_kickback | Glute Kickback Machine | Loop | Side three-quarter · setup → key movement → reset |
| `barbell-drag-curl` | Barbell Drag Curl | barbell | biceps | Loop | Side · setup → curl → return |
| `arnold-press` | Arnold Press | dumbbells | vertical push | Loop | Side · rack → overhead → rack |
| `smith-machine-close-grip-bench-press` | Smith Machine Close-Grip Bench Press | smith, bench | triceps | Loop | Side three-quarter · setup → extend → return |
| `alternating-single-arm-kettlebell-swing` | Alternating Single-Arm Kettlebell Swing | kettlebells | hinge | Loop | Side three-quarter · backswing → hip drive → hand switch → rehinge |
| `smith-machine-bent-over-row` | Smith Machine Bent-Over Row | smith | horizontal pull | Loop | Side three-quarter · reach → pull → reach |
| `machine-triceps-extension` | Machine Triceps Extension | triceps_machine | triceps | Loop | Side three-quarter · setup → extend → return |
| `dumbbell-squat-to-shoulder-press` | Dumbbell Squat to Shoulder Press | dumbbells | Dumbbell Squat to Shoulder Press | Loop | Side · setup → key movement → reset |
| `close-grip-v-bar-pulldown` | Close-Grip V-Bar Pulldown | lat_pulldown | vertical pull | Loop | Front three-quarter · reach → pull → reach |
| `wide-grip-lat-pulldown` | Wide-Grip Lat Pulldown | lat_pulldown | vertical pull | Loop | Front three-quarter · reach → pull → reach |
| `home-gym-leg-extension` | Home Gym Leg Extension | leg_extension | knee extension | Loop | Side · start → extend → return |
| `dumbbell-squat` | Dumbbell Squat | dumbbells | squat | Loop | Side · upright → lower → upright |
| `hip-abductor-machine` | Hip Abductor Machine | hip_abduction | Hip Abductor Machine | Loop | Front three-quarter · setup → key movement → reset |
| `ez-bar-preacher-curl` | EZ-Bar Preacher Curl | ez_bar, preacher_bench | biceps | Loop | Side · setup → curl → return |
| `machine-biceps-curl` | Machine Biceps Curl | biceps_machine | biceps | Loop | Side three-quarter · setup → curl → return |
| `waiter-curl` | Waiter Curl | single_dumbbell | biceps | Loop | Side · setup → curl → return |
| `seated-back-extension-machine` | Seated Back Extension Machine | back_extension_machine | Seated Back Extension Machine | Loop | Side three-quarter · setup → key movement → reset |
| `cable-external-rotation` | Cable External Rotation | cable | Cable External Rotation | Loop | Front three-quarter · setup → key movement → reset |
| `barbell-front-raise` | Barbell Front Raise | barbell | Barbell Front Raise | Loop | Side · setup → key movement → reset |
| `single-arm-lat-pulldown` | Single-Arm Lat Pulldown | lat_pulldown | vertical pull | Loop | Front three-quarter · reach → pull → reach |
| `dumbbell-reverse-fly` | Dumbbell Reverse Fly | dumbbells | rear delt | Loop | Front three-quarter · setup → pull/raise → return |
| `hip-adductor-machine` | Hip Adductor Machine | hip_abduction | Hip Adductor Machine | Loop | Front three-quarter · setup → key movement → reset |
| `machine-row` | Machine Row | seated_row | horizontal pull | Loop | Side three-quarter · reach → pull → reach |
| `cable-rear-delt-fly` | Cable Rear Delt Fly | cable | rear delt | Loop | Front three-quarter · setup → pull/raise → return |
| `close-grip-ez-bar-curl` | Close-Grip EZ-Bar Curl | ez_bar | biceps | Loop | Side · setup → curl → return |
| `cable-straight-arm-pulldown` | Cable Straight-Arm Pulldown | cable | Cable Straight-Arm Pulldown | Loop | Side three-quarter · setup → key movement → reset |
| `no-money-curl` | No-Money Curl | dumbbells | No-Money Curl | Loop | Side · setup → key movement → reset |
| `dumbbell-squeeze-press` | Dumbbell Squeeze Press | dumbbells, bench | horizontal push | Loop | Side · top → lower → top |
| `mini-band-lateral-walk` | Mini Band Lateral Walk | bands | Mini Band Lateral Walk | Loop | Front three-quarter · setup → key movement → reset |
| `alternating-dumbbell-bench-press` | Alternating Dumbbell Bench Press | dumbbells, bench | horizontal push | Loop | Side · top → lower → top |
| `single-arm-cable-curl` | Single-Arm Cable Curl | cable | biceps | Loop | Side three-quarter · setup → curl → return |
| `reverse-grip-cable-pushdown` | Reverse-Grip Cable Pushdown | cable | triceps | Loop | Side three-quarter · setup → extend → return |
| `lateral-to-front-raise` | Lateral to Front Raise | dumbbells | Lateral to Front Raise | Loop | Front three-quarter · setup → key movement → reset |
| `cable-internal-rotation` | Cable Internal Rotation | cable | Cable Internal Rotation | Loop | Front three-quarter · setup → key movement → reset |
| `hip-thrust` | Hip Thrust | barbell, bench | hip thrust | Loop | Side · bottom → extend → bottom |
| `home-gym-rope-pushdown` | Home Gym Rope Pushdown | cable | triceps | Loop | Side · setup → extend → return |
| `hammer-strength-incline-press` | Hammer Strength Incline Press | chest_press | incline push | Loop | Side three-quarter · top → lower → top |
| `seated-dumbbell-calf-raise` | Seated Dumbbell Calf Raise | dumbbells, bench | calf | Loop | Side · bottom → raise → bottom |
| `hammer-strength-decline-press` | Hammer Strength Decline Press | chest_press | horizontal push | Loop | Side three-quarter · top → lower → top |
| `single-arm-dumbbell-press` | Single-Arm Dumbbell Press | single_dumbbell | vertical push | Loop | Side · rack → overhead → rack |
| `smith-machine-shoulder-press` | Smith Machine Shoulder Press | smith, incline_bench | vertical push | Loop | Side three-quarter · rack → overhead → rack |
| `reverse-grip-pulldown` | Reverse-Grip Pulldown | lat_pulldown | vertical pull | Loop | Front three-quarter · reach → pull → reach |
| `wide-grip-barbell-curl` | Wide-Grip Barbell Curl | barbell | biceps | Loop | Side · setup → curl → return |
| `kettlebell-suitcase-deadlift` | Kettlebell Suitcase Deadlift | kettlebells | hinge | Loop | Side · setup → hinge → return |
| `bird-dog-row` | Bird Dog Row | single_dumbbell | Bird Dog Row | Loop | Side · setup → key movement → reset |
| `pendlay-row` | Pendlay Row | barbell | horizontal pull | Loop | Side · reach → pull → reach |
| `barbell-good-morning` | Barbell Good Morning | barbell, rack | hinge | Loop | Side · setup → hinge → return |
| `around-the-world` | Around the World | dumbbells | Around the World | Loop | Side · setup → key movement → reset |
| `hammer-strength-shoulder-press` | Hammer Strength Shoulder Press | shoulder_press | vertical push | Loop | Side · rack → overhead → rack |
| `seated-rear-delt-raise` | Seated Rear Delt Raise | dumbbells, bench | rear delt | Loop | Front three-quarter · setup → pull/raise → return |
| `cuban-rotation` | Cuban Rotation | dumbbells | Cuban Rotation | Loop | Front three-quarter · setup → key movement → reset |
| `barbell-glute-bridge` | Barbell Glute Bridge | barbell | hip thrust | Loop | Side · bottom → extend → bottom |
| `cable-standing-twist` | Cable Standing Twist | cable | core | Loop | Front three-quarter · setup → working position → return |
| `single-arm-cable-side-extension` | Single-Arm Cable Side Extension | cable | triceps | Loop | Side three-quarter · setup → extend → return |
| `standing-overhead-dumbbell-extension` | Standing Overhead Dumbbell Extension | single_dumbbell | triceps | Loop | Side · setup → extend → return |
| `barbell-pause-curl` | Barbell Pause Curl | barbell | biceps | Loop | Side · setup → curl → return |
| `ez-bar-overhead-triceps-extension` | EZ-Bar Overhead Triceps Extension | ez_bar | triceps | Loop | Side · setup → extend → return |
| `band-straight-arm-pulldown` | Band Straight-Arm Pulldown | bands | Band Straight-Arm Pulldown | Loop | Side · setup → key movement → reset |
| `reverse-dumbbell-curl` | Reverse Dumbbell Curl | single_dumbbell | biceps | Loop | Side · setup → curl → return |
| `cable-crossover-pulldown` | Cable Crossover Pulldown | cable | vertical pull | Loop | Front three-quarter · reach → pull → reach |
| `dumbbell-floor-press` | Dumbbell Floor Press | dumbbells | horizontal push | Loop | Side · top → lower → top |
| `smith-machine-decline-press` | Smith Machine Decline Press | smith, decline_bench | horizontal push | Loop | Side three-quarter · top → lower → top |
| `smith-machine-split-squat` | Smith Machine Split Squat | smith | lunge | Loop | Side three-quarter · setup → lower or step → return |
| `barbell-forward-lunge` | Barbell Forward Lunge | barbell, rack | lunge | Loop | Side · setup → lower or step → return |
| `ez-bar-pjr-pullover` | EZ-Bar PJR Pullover | ez_bar, bench | EZ-Bar PJR Pullover | Loop | Side · setup → key movement → reset |
| `band-side-step` | Band Side Step | bands | Band Side Step | Loop | Front three-quarter · setup → key movement → reset |
| `ez-bar-pullover` | EZ-Bar Pullover | ez_bar, bench | EZ-Bar Pullover | Loop | Side · setup → key movement → reset |
| `seated-single-leg-calf-raise` | Seated Single-Leg Calf Raise | single_dumbbell, bench | calf | Loop | Side · bottom → raise → bottom |
| `incline-ez-bar-curl` | Incline EZ-Bar Curl | ez_bar, incline_bench | biceps | Loop | Side three-quarter · setup → curl → return |
| `single-arm-dumbbell-floor-press` | Single-Arm Dumbbell Floor Press | single_dumbbell | horizontal push | Loop | Side · top → lower → top |
| `cable-internal-rotation-at-90` | Cable Internal Rotation at 90° | cable | Cable Internal Rotation at 90° | Loop | Front three-quarter · setup → key movement → reset |
| `tate-press` | Tate Press | dumbbells, bench | triceps | Loop | Side · setup → extend → return |
| `cable-lateral-triceps-extension` | Cable Lateral Triceps Extension | cable | triceps | Loop | Front three-quarter · setup → extend → return |
| `single-arm-overhead-kettlebell-squat` | Single-Arm Overhead Kettlebell Squat | kettlebells | squat | Loop | Side · upright → lower → upright |
| `assisted-dip` | Assisted Dip | assisted_pullup | triceps | Loop | Side three-quarter · setup → extend → return |
| `hammer-strength-iso-row` | Hammer Strength Iso Row | seated_row | horizontal pull | Loop | Side · reach → pull → reach |
| `smith-machine-behind-the-back-shrug` | Smith Machine Behind-the-Back Shrug | smith | Smith Machine Behind-the-Back Shrug | Loop | Side three-quarter · setup → key movement → reset |

## Bodyweight / timed

| Slug | Exercise | Equipment | Movement family | Format | View and key poses or exclusion reason |
| --- | --- | --- | --- | --- | --- |
| `chest-dip` | Chest Dip | dip_bars | horizontal push | Loop | Side · top → lower → top |
| `push-up` | Push-Up | — | horizontal push | Loop | Side · plank → chest lowered → plank |
| `feet-elevated-push-up` | Feet-Elevated Push-Up | step_box | incline push | Loop | Side · top → lower → top |
| `pike-push-up` | Pike Push-Up | — | vertical push | Loop | Side · rack → overhead → rack |
| `bench-dip` | Bench Dip | bench | triceps | Loop | Side · setup → extend → return |
| `diamond-push-up` | Diamond Push-Up | — | triceps | Loop | Side · setup → extend → return |
| `prone-pulldown` | Prone Bodyweight Pulldown | — | vertical pull | Loop | Front three-quarter · reach → pull → reach |
| `pull-up` | Pull-Up | pullup_bar | vertical pull | Loop | Front three-quarter · hang → pull → hang |
| `chin-up` | Chin-Up | pullup_bar | vertical pull | Loop | Front three-quarter · underhand hang → pull → hang |
| `inverted-row` | Inverted Row | barbell, rack | horizontal pull | Loop | Side · reach → pull → reach |
| `bodyweight-squat` | Bodyweight Squat | — | squat | Loop | Side · upright → lower → upright |
| `back-extension` | Back Extension | back_extension | hinge | Loop | Side · setup → hinge → return |
| `single-leg-rdl` | Single-Leg Romanian Deadlift | — | hinge | Loop | Side · setup → hinge → return |
| `bodyweight-step-up` | Bodyweight Step-Up | step_box | lunge | Loop | Side · setup → lower or step → return |
| `reverse-lunge` | Bodyweight Reverse Lunge | — | lunge | Loop | Side · setup → lower or step → return |
| `glute-bridge` | Glute Bridge | — | hip thrust | Loop | Side · bottom → extend → bottom |
| `single-leg-calf-raise` | Single-Leg Calf Raise | step_box | calf | Loop | Side · bottom → raise → bottom |
| `standing-bodyweight-calf-raise` | Standing Bodyweight Calf Raise | — | calf | Loop | Side · bottom → raise → bottom |
| `hanging-leg-raise` | Hanging Leg Raise | pullup_bar | core | Loop | Side · setup → working position → return |
| `lying-leg-raise` | Lying Leg Raise | — | core | Loop | Side · setup → working position → return |
| `crunch` | Crunch | — | core | Loop | Side · setup → working position → return |
| `dead-bug` | Dead Bug | — | core | Loop | Side · setup → working position → return |
| `stationary-bike` | Stationary Bike | stationary_bike | cardio | Setup | Side · seat/foot setup + pedal position |
| `elliptical` | Elliptical | elliptical | cardio | Setup | Side · foot/handle setup and starting posture |
| `treadmill` | Treadmill | treadmill | cardio | Setup | Side · belt/stance and console setup |
| `rowing-machine` | Rowing Machine | rowing_machine | cardio | Loop | Side · catch → leg drive → finish → arms/body/legs recovery |
| `stair-climber` | Stair Climber | stair_climber | cardio | Setup | Side · step and upright starting posture |
| `arm-circles` | Arm Circles | — | dynamic stretch | Loop | Side · setup → active range → reset |
| `leg-swings` | Leg Swings | — | dynamic stretch | Loop | Side · setup → active range → reset |
| `worlds-greatest-stretch` | World's Greatest Stretch | — | dynamic stretch | Loop | Side · setup → active range → reset |
| `cat-cow` | Cat-Cow | — | dynamic stretch | Loop | Side · setup → active range → reset |
| `inchworm` | Inchworm | — | dynamic stretch | Loop | Side · setup → active range → reset |
| `torso-twists` | Torso Twists | — | dynamic stretch | Loop | Front three-quarter · setup → active range → reset |
| `walking-knee-hug` | Walking Knee Hug | — | dynamic stretch | Loop | Side · setup → active range → reset |
| `doorway-chest-stretch` | Doorway Chest Stretch | — | static stretch | Hold | Side · setup and held position |
| `cross-body-shoulder-stretch` | Cross-Body Shoulder Stretch | — | static stretch | Hold | Side · setup and held position |
| `overhead-triceps-stretch` | Overhead Triceps Stretch | — | static stretch | Hold | Side · setup and held position |
| `wall-biceps-stretch` | Wall Biceps Stretch | — | static stretch | Hold | Side · setup and held position |
| `childs-pose` | Child's Pose | — | static stretch | Hold | Side · setup and held position |
| `standing-quad-stretch` | Standing Quad Stretch | — | static stretch | Hold | Side · setup and held position |
| `kneeling-hip-flexor-stretch` | Kneeling Hip Flexor Stretch | — | static stretch | Hold | Side · setup and held position |
| `seated-hamstring-stretch` | Seated Hamstring Stretch | — | static stretch | Hold | Side · setup and held position |
| `figure-four-glute-stretch` | Figure-Four Glute Stretch | — | static stretch | Hold | Side · setup and held position |
| `wall-calf-stretch` | Wall Calf Stretch | — | static stretch | Hold | Side · setup and held position |
| `cobra-stretch` | Cobra Stretch | — | static stretch | Hold | Side · setup and held position |
| `bodyweight-bulgarian-split-squat` | Bodyweight Bulgarian Split Squat | bench | lunge | Loop | Side · setup → lower or step → return |
| `alternating-medicine-ball-push-up` | Alternating Medicine Ball Push-Up | medicine_ball | Alternating Medicine Ball Push-Up | Loop | Side · setup → key movement → reset |
| `oblique-crunch` | Oblique Crunch | — | core | Loop | Side · setup → working position → return |
| `russian-twist` | Russian Twist | — | core | Loop | Front three-quarter · setup → working position → return |
| `pistol-squat` | Pistol Squat | — | lunge | Loop | Side · setup → lower or step → return |
| `sit-up` | Sit-Up | — | core | Loop | Side · reclined → sit up → lower |
| `neutral-grip-pull-up` | Neutral-Grip Pull-Up | pullup_bar | vertical pull | Loop | Front three-quarter · reach → pull → reach |
| `single-leg-kickback` | Single-Leg Kickback | — | Single-Leg Kickback | Loop | Side · setup → key movement → reset |
| `bicycle-crunch` | Bicycle Crunch | — | core | Loop | Side · setup → working position → return |
| `captain-s-chair-knee-raise` | Captain's Chair Knee Raise | dip_bars | core | Loop | Side · setup → working position → return |
| `scissor-kick` | Scissor Kick | — | core | Loop | Side · setup → working position → return |
| `reverse-crunch` | Reverse Crunch | — | core | Loop | Side · setup → working position → return |
| `seated-leg-pull-in` | Seated Leg Pull-In | — | core | Loop | Side · setup → working position → return |
| `side-lunge` | Side Lunge | — | lunge | Loop | Side · setup → lower or step → return |
| `feet-elevated-glute-bridge` | Feet-Elevated Glute Bridge | bench | hip thrust | Loop | Side · bottom → extend → bottom |
| `triceps-push-up` | Triceps Push-Up | — | triceps | Loop | Side · setup → extend → return |
| `single-leg-glute-bridge` | Single-Leg Glute Bridge | — | hip thrust | Loop | Side · bottom → extend → bottom |
| `wide-grip-pull-up` | Wide-Grip Pull-Up | pullup_bar | vertical pull | Loop | Front three-quarter · reach → pull → reach |
| `kneeling-squat` | Kneeling Squat | — | squat | Loop | Side · upright → lower → upright |
| `superman` | Superman | — | Superman | Loop | Side · setup → key movement → reset |
| `archer-pull-up` | Archer Pull-Up | pullup_bar | vertical pull | Loop | Front three-quarter · reach → pull → reach |
| `scissor-crossover-kick` | Scissor Crossover Kick | — | core | Loop | Side · setup → working position → return |
| `flutter-kick` | Flutter Kick | — | core | Loop | Side · setup → working position → return |
| `lunge-with-twist` | Lunge with Twist | — | lunge | Loop | Front three-quarter · setup → lower or step → return |
| `rotation-push-up` | Rotation Push-Up | — | horizontal push | Loop | Front three-quarter · top → lower → top |
| `decline-crunch` | Decline Crunch | decline_bench | core | Loop | Side three-quarter · setup → working position → return |
| `decline-oblique-crunch` | Decline Oblique Crunch | decline_bench | core | Loop | Side three-quarter · setup → working position → return |
| `stability-ball-pike` | Stability Ball Pike | stability_ball | core | Loop | Side · setup → working position → return |
| `side-plank-leg-lift` | Side Plank Leg Lift | — | core | Loop | Front three-quarter · stacked legs → lift top leg → lower |
| `iron-cross` | Iron Cross | — | Iron Cross | Loop | Side · setup → key movement → reset |
| `plank-surrender` | Plank Surrender | — | core | Loop | Side three-quarter · forearm plank → rise to hands → return |
| `stability-ball-knee-tuck` | Stability Ball Knee Tuck | stability_ball | core | Loop | Side · setup → working position → return |
| `hanging-knee-raise` | Hanging Knee Raise | pullup_bar | core | Loop | Side · setup → working position → return |
| `mountain-climber` | Mountain Climber | — | core | Loop | Side · setup → working position → return |
| `bodyweight-forward-lunge` | Bodyweight Forward Lunge | — | lunge | Loop | Side · setup → lower or step → return |
| `stability-ball-crunch` | Stability Ball Crunch | stability_ball | core | Loop | Side · setup → working position → return |

## Excluded

| Slug | Exercise | Equipment | Movement family | Format | View and key poses or exclusion reason |
| --- | --- | --- | --- | --- | --- |
| `partner-medicine-ball-twist` | Partner Medicine Ball Twist | medicine_ball | Partner Medicine Ball Twist | Written cues | A single figure cannot show the partner handoff and spacing. Keep written cues until a two-person guide is supported. |
| `rotary-torso-machine` | Rotary Torso Machine | rotary_torso | core | Written cues | Manufacturer-specific start position, pads and restraints. Keep written setup cues until an exact machine or model-neutral portrayal can be validated. |
