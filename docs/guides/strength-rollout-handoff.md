# Strength guide rollout handoff

Part of #262. This is the renderer and pose worklist for all **178 exercises in 13 strength batches**. The GitHub batch issues remain the tracking checklists. The draft samples in this branch are outside the app index until integration and fit-test review.

## Suggested renderer sequence

1. Review the ten sample guides. The curl and hinge sample review notes are in [their handoff](strength-curls-hinges-handoff.md).
2. Extend free-weight grips and add seated, floor, and incline supports. This helps multiple push, curl, pull and triceps batches without changing existing indexed guides.
3. Add independent arm and leg control and the shared kettlebell, cable and band attachments. Validate contacts and paths over interpolated frames before authoring affected guides.
4. Add machine and Smith constraints in focused changes. Use an actual equipment reference for each setup and check the exact cable, sled or lever path.

## batch 01 — Bench and floor free-weight presses (#315)

### Floor support and independent arms

Maintain upper-arm contact at the bottom and distinguish single-arm and paired-dumbbell loading. Compare both single-arm catalog slugs before sharing pose data.

- One-Arm Dumbbell Floor Press (`one-arm-dumbbell-floor-press`)
- Single-Arm Dumbbell Floor Press (`single-arm-dumbbell-floor-press`)
- Dumbbell Floor Press (`dumbbell-floor-press`)

### Incline bench contacts

Preserve back and foot contact. Show a rack and bar clearance for the barbell setup.

- Incline Dumbbell Press (`incline-dumbbell-press`)
- Incline Barbell Press (`incline-barbell-press`)

### Flat bench grip and arm paths

Show narrow versus supinated bar grips, touching dumbbells on the squeeze, one arm held in place on the alternating press, and elbow flare for Tate presses.

- Close-Grip Bench Press (`close-grip-bench-press`)
- Reverse-Grip Bench Press (`reverse-grip-bench-press`)
- Dumbbell Squeeze Press (`dumbbell-squeeze-press`)
- Alternating Dumbbell Bench Press (`alternating-dumbbell-bench-press`)
- Tate Press (`tate-press`)

### Standing unilateral press

Check the exact catalog setup. Show the loaded arm and a stable unweighted side with no unwanted lean.

- Single-Arm Dumbbell Press (`single-arm-dumbbell-press`)

## batch 02 — Machine and Smith presses (#318)

### Selectorized and plate-loaded press machines

Match the seat, press angle, and handle arc to each machine. Keep the torso supported and show independent lever travel where applicable.

- Machine Chest Press (`machine-chest-press`)
- Machine Shoulder Press (`machine-shoulder-press`)
- Hammer Strength Chest Press (`hammer-strength-chest-press`)
- Hammer Strength Incline Press (`hammer-strength-incline-press`)
- Hammer Strength Decline Press (`hammer-strength-decline-press`)
- Hammer Strength Shoulder Press (`hammer-strength-shoulder-press`)

### Smith rails and supports

Keep the bar on its rail line, with a distinct support angle for each bench and the correct hand spacing.

- Smith Machine Bench Press (`smith-bench-press`)
- Smith Machine Incline Press (`smith-incline-press`)
- Smith Machine Close-Grip Bench Press (`smith-machine-close-grip-bench-press`)
- Smith Machine Shoulder Press (`smith-machine-shoulder-press`)
- Smith Machine Decline Press (`smith-machine-decline-press`)

### Dip assist and triceps machines

Distinguish the assist platform from seated presses and maintain hand and pad contact on the extension machine.

- Assisted Dip (`assisted-dip`)
- Machine Triceps Dip (`machine-triceps-dip`)
- Machine Triceps Extension (`machine-triceps-extension`)

## batch 03 — Free-weight overhead presses and raises (#316)

### Side-view pose drafts

Verify overhead clearance and shoulder-height raise in the player. Both have sample JSON and sheets.

- Standing Dumbbell Press (`standing-dumbbell-press`) · [pose sheet](samples/standing-dumbbell-press/sheet.svg)
- Dumbbell Front Raise (`dumbbell-front-raise`) · [pose sheet](samples/dumbbell-front-raise/sheet.svg)

### Seated shoulder support

Add adjustable back support and a rack where called for. Verify overhead load alignment and feet on the floor.

- Seated Dumbbell Shoulder Press (`seated-dumbbell-press`)
- Seated Barbell Shoulder Press (`seated-barbell-shoulder-press`)

### Standing load path and grip

Validate kettlebell forearm contact, the upright row’s elbow-leading path, and the straight-arm overhand front raise. Trial the last with the existing bar and verify orientation before indexing.

- Kettlebell Press (`kettlebell-press`)
- Barbell Upright Row (`barbell-upright-row`)
- Barbell Front Raise (`barbell-front-raise`)

### Out-of-plane shoulder paths

Show visible abduction, the change in arm plane, and prescribed wrist or shoulder rotation.

- Dumbbell Lateral Raise (`dumbbell-lateral-raise`)
- Arnold Press (`arnold-press`)
- Lateral to Front Raise (`lateral-to-front-raise`)
- Around the World (`around-the-world`)
- Cuban Rotation (`cuban-rotation`)

### Compound motion sequencing

Review the transition from curl rack or squat drive into press, including clearance and planted feet.

- Biceps Curl to Shoulder Press (`biceps-curl-to-shoulder-press`)
- Dumbbell Squat to Shoulder Press (`dumbbell-squat-to-shoulder-press`)

## batch 04 — Fly, rear-delt and shoulder isolation (#317)

### Anchored cable and band paths

Show the correct anchor height, line of resistance, and both working endpoints. A pull-apart uses the opposite hand as the band endpoint.

- Cable Fly (`cable-fly`)
- Band Fly (`band-fly`)
- Cable Lateral Raise (`cable-lateral-raise`)
- Band Lateral Raise (`band-lateral-raise`)
- Face Pull (`face-pull`)
- Band Pull-Apart (`band-pull-apart`)
- Low-to-High Cable Fly (`low-to-high-cable-fly`)
- Cable Rear Delt Fly (`cable-rear-delt-fly`)

### Machine fly and rear-delt geometry

Maintain chest or back support as appropriate and follow the handles or pads through the machine arc.

- Pec Deck Fly (`pec-deck`)
- Reverse Pec Deck (`reverse-pec-deck`)

### Free-weight fly and rear delt poses

Show the horizontal or incline setup, external arm travel, and the correct seat or hinge. Avoid passing loads through the bench.

- Dumbbell Fly (`dumbbell-fly`)
- Bent-Over Reverse Fly (`bent-over-reverse-fly`)
- Incline Dumbbell Fly (`incline-dumbbell-fly`)
- Dumbbell Reverse Fly (`dumbbell-reverse-fly`)
- Seated Rear Delt Raise (`seated-rear-delt-raise`)

## batch 05 — Free-weight rows, pullovers and shrugs (#319)

### Fixed-hinge pose drafts

Both have sample JSON and sheets. The current grounded rig limits backward upper-arm travel, so the bar and dumbbells stop in front of their targets. Extend the upper-arm path with a supported row configuration, then validate bar-to-ribs and dumbbell-to-hips paths before indexing.

- Barbell Row (`barbell-row`) · [pose sheet](samples/barbell-row/sheet.svg)
- Dumbbell Bent-Over Row (`dumbbell-bent-over-row`) · [pose sheet](samples/dumbbell-bent-over-row/sheet.svg)

### Additional rows and supports

Make the grip, support and implement distinct. Pendlay resets on the floor. Smith follows the rails. Bird dog needs opposite-limb support and reliable reach during the loop.

- One-Arm Dumbbell Row (No Bench) (`one-arm-unsupported-dumbbell-row`)
- Chest-Supported Dumbbell Row (`chest-supported-row`)
- Kettlebell Row (`kettlebell-row`)
- Reverse-Grip Barbell Row (`reverse-grip-barbell-row`)
- Smith Machine Bent-Over Row (`smith-machine-bent-over-row`)
- Bird Dog Row (`bird-dog-row`)
- Pendlay Row (`pendlay-row`)

### Supine pullover reach

Show two-handed grip, bar shape, overhead clearance and the PJR bend and extension sequence.

- Dumbbell Pullover (`dumbbell-pullover`)
- EZ-Bar PJR Pullover (`ez-bar-pjr-pullover`)
- EZ-Bar Pullover (`ez-bar-pullover`)

### Scapular elevation

The shoulders and implement should rise with elbows long. Add a behind-the-body rail line for the Smith variation.

- Barbell Shrug (`barbell-shrug`)
- Dumbbell Shrug (`dumbbell-shrug`)
- Smith Machine Behind-the-Back Shrug (`smith-machine-behind-the-back-shrug`)

## batch 06 — Pulldowns and machine, cable and band rows (#321)

### Assistance and pulldown handles

Show the assistance platform or the correct thigh pad. Validate handle width, orientation, and unilateral attachment against the cue.

- Assisted Pull-Up (`assisted-pull-up`)
- Close-Grip V-Bar Pulldown (`close-grip-v-bar-pulldown`)
- Wide-Grip Lat Pulldown (`wide-grip-lat-pulldown`)
- Single-Arm Lat Pulldown (`single-arm-lat-pulldown`)
- Reverse-Grip Pulldown (`reverse-grip-pulldown`)

### Standing and kneeling resistance

Show each anchor and line of pull. Keep elbows long on straight-arm variants and show the crossover’s separate attachments.

- Band Pulldown (`band-pulldown`)
- Standing Cable Row (`standing-cable-row`)
- Band Row (`band-row`)
- Shotgun Row (`shotgun-row`)
- Cable Straight-Arm Pulldown (`cable-straight-arm-pulldown`)
- Band Straight-Arm Pulldown (`band-straight-arm-pulldown`)
- Cable Crossover Pulldown (`cable-crossover-pulldown`)

### Machine rows

Confirm whether the selected machine uses chest support, footplates or independent levers before adapting the seated cable row.

- Machine Row (`machine-row`)
- Hammer Strength Iso Row (`hammer-strength-iso-row`)

## batch 07 — Biceps curls with free weights (#320)

The [curl and hinge handoff](strength-curls-hinges-handoff.md) lists all 15 exercises, including the existing pose drafts.

## batch 08 — Cable, band and supported arm isolation (#322)

### Anchors and attachments

Keep the line attached at the specified height and demonstrate the handle and hand count for each variant.

- Band Curl (`band-curl`)
- Cable Curl (`cable-curl`)
- Overhead Cable Curl (`overhead-cable-curl`)
- Single-Arm Cable Curl (`single-arm-cable-curl`)

### Wrist isolation and reverse grip

Brace the forearm on wrist curls and articulate the wrist rather than the elbow. Show the reverse dumbbell curl’s pronated grip.

- Palms-Down Dumbbell Wrist Curl (`palms-down-dumbbell-wrist-curl`)
- Palms-Up Dumbbell Wrist Curl (`palms-up-dumbbell-wrist-curl`)
- Reverse Dumbbell Curl (`reverse-dumbbell-curl`)

### Preacher and incline supports

Verify seat, elbow support, handle path and the distinct incline EZ-bar setup.

- Machine Preacher Curl (`machine-preacher-curl`)
- Machine Biceps Curl (`machine-biceps-curl`)
- Incline EZ-Bar Curl (`incline-ez-bar-curl`)

## batch 09 — Triceps extensions and pushdowns (#323)

### Cable and band elbows

Match anchor height, attachment, palm orientation, stance and extension direction. Keep the cable path clear of the body.

- Cable Triceps Pushdown (`cable-pushdown`)
- Band Pushdown (`band-pushdown`)
- Cable Rope Triceps Extension (`cable-rope-triceps-extension`)
- Cable Rope Overhead Triceps Extension (`cable-rope-overhead-triceps-extension`)
- Reverse-Grip Cable Pushdown (`reverse-grip-cable-pushdown`)
- Home Gym Rope Pushdown (`home-gym-rope-pushdown`)
- Single-Arm Cable Side Extension (`single-arm-cable-side-extension`)
- Cable Lateral Triceps Extension (`cable-lateral-triceps-extension`)

### Overhead free-weight grips

Resolve two-hand cup versus single-arm and EZ-bar contacts, seated versus standing support, and head clearance.

- Overhead Dumbbell Extension (`overhead-dumbbell-extension`)
- Single-Arm Overhead Dumbbell Extension (`single-arm-overhead-dumbbell-extension`)
- Standing Overhead Dumbbell Extension (`standing-overhead-dumbbell-extension`)
- EZ-Bar Overhead Triceps Extension (`ez-bar-overhead-triceps-extension`)

### Bench and elbow isolation

Keep the upper arm and bench contacts appropriate to the exercise and show the implement clearing the head or torso.

- EZ-Bar Skull Crusher (`skull-crusher`)
- Dumbbell Triceps Kickback (`dumbbell-triceps-kickback`)
- Dumbbell Skull Crusher (`dumbbell-skull-crusher`)

## batch 10 — Squats, lunges and step-ups (#324)

### Dumbbell squat pose draft

Verify the two weights remain at the sides and the feet stay planted. Sample JSON and sheet are present.

- Dumbbell Squat (`dumbbell-squat`) · [pose sheet](samples/dumbbell-squat/sheet.svg)

### Squat props and stance

Show front rack, kettlebell grip, Smith rails, wide stance or asymmetric overhead load as applicable.

- Barbell Front Squat (`front-squat`)
- Kettlebell Goblet Squat (`kettlebell-goblet-squat`)
- Smith Machine Squat (`smith-squat`)
- Dumbbell Sumo Squat (`dumbbell-sumo-squat`)
- Single-Arm Overhead Kettlebell Squat (`single-arm-overhead-kettlebell-squat`)

### Split stance, step and support

Distinguish forward and reverse steps from stationary split stance. Keep the rear foot on the bench or the working foot on the box when required.

- Dumbbell Reverse Lunge (`dumbbell-reverse-lunge`)
- Bulgarian Split Squat (`bulgarian-split-squat`)
- Barbell Reverse Lunge (`barbell-lunge`)
- Dumbbell Step-Up (`dumbbell-step-up`)
- Dumbbell Lunge (`dumbbell-lunge`)
- Smith Machine Split Squat (`smith-machine-split-squat`)
- Barbell Forward Lunge (`barbell-forward-lunge`)

## batch 11 — Hip hinges, swings, thrusts and bridges (#326)

The [curl and hinge handoff](strength-curls-hinges-handoff.md) lists all 13 exercises, including the existing pose drafts.

## batch 12 — Leg press, knee isolation and calf raises (#325)

### Press sled and squat machine

Constrain the sled to its track, keep feet on the plate, and differentiate the hack-squat shoulder pads and torso support.

- Leg Press (`leg-press`)
- Hack Squat (`hack-squat`)
- Plate-Loaded Leg Press (`plate-loaded-leg-press`)

### Knee isolation equipment

Match seat or prone support, align the knee to the lever pivot, and keep the pad or band attached across the loop.

- Leg Curl (`leg-curl`)
- Band Leg Curl (`band-leg-curl`)
- Leg Extension (`leg-extension`)
- Lying Leg Curl (`lying-leg-curl`)
- Home Gym Leg Extension (`home-gym-leg-extension`)

### Calf variants

Show a fixed forefoot with visible heel travel, then differentiate seated pads, one-leg loading and leg-press foot contact.

- Machine Calf Raise (`machine-calf-raise`)
- Dumbbell Calf Raise (`dumbbell-calf-raise`)
- Leg Press Calf Raise (`leg-press-calf-raise`)
- Calf Raise (`calf-raise`)
- Seated Calf Raise (`seated-calf-raise`)
- Seated Dumbbell Calf Raise (`seated-dumbbell-calf-raise`)
- Seated Single-Leg Calf Raise (`seated-single-leg-calf-raise`)

## batch 13 — Core, hip and shoulder rotation accessories (#327)

### Cable trunk and shoulder work

Show pulley height, line of pull and which joint rotates. Distinguish elbow-at-side work from the 90-degree shoulder position.

- Cable Crunch (`cable-crunch`)
- Cable Upright Row (`cable-upright-row`)
- Cable Wood Chop (`cable-wood-chop`)
- Cable External Rotation (`cable-external-rotation`)
- Cable Internal Rotation (`cable-internal-rotation`)
- Cable Standing Twist (`cable-standing-twist`)
- Cable Internal Rotation at 90° (`cable-internal-rotation-at-90`)

### Machine pads and resistance

Keep body and pad contact through the lever path and distinguish the opposite directions of hip abduction and adduction.

- Ab Crunch Machine (`ab-crunch-machine`)
- Glute Kickback Machine (`glute-kickback-machine`)
- Hip Abductor Machine (`hip-abductor-machine`)
- Hip Adductor Machine (`hip-adductor-machine`)

### Side bend and band step

Show lateral trunk flexion or actual lateral footwork. Preserve the catalog-specific band placement and visible tension.

- Dumbbell Side Bend (`dumbbell-side-bend`)
- Mini Band Lateral Walk (`mini-band-lateral-walk`)
- Band Side Step (`band-side-step`)

## Integration checks

Use the exact catalog slug, cue and movement reference. Index only guides with compatible attachments and supports. Generate previews and render fingerprints, run the guide checks, and verify the live guide on fit-test at phone widths, in reduced motion, and offline. Keep review history unchanged and let the app assign the current revision to Pending.
