# Built-in form cue review (#265)

Reviewed all **272** built-in exercise slugs from staging: **75 revised, 197 retained, 0 unreviewed**. This is an editorial/technique review, not professional certification of each exercise or animation. No player assets or JavaScript were changed.

Cues should explain setup, movement, and the key control point in 1–3 short sentences. Retain understandable instructions instead of rewriting for uniformity. Use exercise-specific equipment and grip, describe unilateral sides, and avoid mandatory depths that exceed a user's controlled range. Written cues remain usable without external videos.

## Technique references checked

These sources were consulted for the indicated movement principles; they do not independently validate every catalog variation. Wording is original rather than copied instructions.

- [ACE chest press](https://www.acefitness.org/resources/everyone/exercise-library/19/chest-press/): stable bench contact, wrist/elbow alignment, controlled lowering and pressing.
- [ACE seated leg press](https://www.acefitness.org/resources/everyone/exercise-library/154/seated-leg-press/): keep pelvis/back supported, heels planted, avoid forced depth and knee hyperextension.
- [ACE Romanian deadlift](https://www.acefitness.org/resources/everyone/exercise-library/317/romanian-deadlift/): slight knee bend and hip-led lowering rather than a mandatory mid-shin endpoint.
- [ACE upper-body movements for beginners](https://www.acefitness.org/resources/everyone/blog/5241/4-upper-body-movements-for-beginners/): curl setup, elbow position, and lifting direction.
- [Concept2 rowing technique](https://www.concept2.com/training/rowing-technique): drive legs/body/arms, recovery arms/body/legs.
- [Mayo Clinic basic stretches](https://www.mayoclinic.org/healthy-lifestyle/fitness/in-depth/stretching/art-20546848): gentle controlled stretching and clear setup.

Machine dimensions and pad arrangements differ. Instructions describe common setups; rotary torso guidance explicitly defers pad/support setup to the machine rather than assuming one design. Rare named variants (e.g. PJR pullover, incline EZ-bar curl, Shotgun Row) have less standardized naming; the text describes the chosen movement, and future illustration work must verify that exact variant. No new equipment requirements, exercise identities, or programming rules were introduced.

## Existing installations

Migration 034 changes only `cues` for global (`user_id IS NULL`) rows whose text exactly matches the previous default. It preserves stable exercise IDs, all other fields, customized cues, personal exercises (even with a matching slug), setup notes, and workout history. Fresh installations receive the new catalog text immediately. Already-edited built-in rows are deliberately left alone. Future full catalog syncs retain their existing behavior; this migration does not change that policy.

## Representative changes

| Exercise | Before | After |
| --- | --- | --- |
| Dumbbell Curl | Start with your palm facing your thigh and turn it up as you curl. Do both sides. Keep your upper arms still and lower all the way down. | Stand with one dumbbell beside your thigh, palm facing inward. Keep your upper arm beside your ribs as you curl toward your shoulder and turn your palm upward, then lower slowly; repeat on the other side. |
| Dumbbell Romanian Deadlift | Hold the dumbbells in front of your thighs. Hinge back with a flat spine until they reach mid-shin, then drive your hips forward to stand. | Stand with dumbbells in front of your thighs and knees slightly bent. Push your hips back, keeping the weights close to your legs, until your hamstrings stretch without rounding your back, then stand tall. |
| Bulgarian Split Squat | Hold a dumbbell in each hand. Rest your back foot on the bench and hop your front foot forward. Drop your back knee straight down, lean slightly forward, and stand through your front heel. Count reps per side. | Hold a dumbbell in each hand with your back foot resting on a bench and front foot far enough forward to balance. Bend both knees to lower your back knee toward the floor, then push through your whole front foot to rise; repeat on the other side. |
| Rowing Machine | Push with your legs first, then lean back slightly and pull the handle to your lower ribs. Return in the reverse order: arms, body, then legs. | Sit with feet secured, knees bent, arms straight, and back steady. Push with your legs, lean back slightly, then pull the handle to your lower ribs; return by straightening your arms, leaning forward, then bending your knees. |
| Leg Press | Place your feet shoulder-width in the middle of the platform. Lower until your knees pass 90 degrees while your lower back stays on the pad, then press without locking your knees hard. | Sit with your back and hips against the pad and feet shoulder-width apart on the platform. Lower only as far as you can keep your heels planted and hips on the pad, then press away without snapping your knees straight. |

## Complete coverage

“Retained” means reviewed and sufficiently clear for this pass, not skipped. Stable identifiers below are catalog slugs; numeric database IDs vary per installation.

| Slug | Exercise | Outcome |
| --- | --- | --- |
| `barbell-bench-press` | Barbell Bench Press | Retained |
| `dumbbell-bench-press` | Dumbbell Bench Press | Revised |
| `one-arm-dumbbell-floor-press` | One-Arm Dumbbell Floor Press | Retained |
| `machine-chest-press` | Machine Chest Press | Retained |
| `smith-bench-press` | Smith Machine Bench Press | Retained |
| `chest-dip` | Chest Dip | Revised |
| `push-up` | Push-Up | Retained |
| `incline-dumbbell-press` | Incline Dumbbell Press | Revised |
| `incline-barbell-press` | Incline Barbell Press | Retained |
| `smith-incline-press` | Smith Machine Incline Press | Retained |
| `feet-elevated-push-up` | Feet-Elevated Push-Up | Revised |
| `cable-fly` | Cable Fly | Retained |
| `pec-deck` | Pec Deck Fly | Retained |
| `dumbbell-fly` | Dumbbell Fly | Retained |
| `band-fly` | Band Fly | Revised |
| `overhead-press` | Barbell Overhead Press | Revised |
| `seated-dumbbell-press` | Seated Dumbbell Shoulder Press | Revised |
| `standing-dumbbell-press` | Standing Dumbbell Press | Retained |
| `machine-shoulder-press` | Machine Shoulder Press | Retained |
| `kettlebell-press` | Kettlebell Press | Revised |
| `pike-push-up` | Pike Push-Up | Retained |
| `dumbbell-lateral-raise` | Dumbbell Lateral Raise | Retained |
| `cable-lateral-raise` | Cable Lateral Raise | Revised |
| `band-lateral-raise` | Band Lateral Raise | Retained |
| `cable-pushdown` | Cable Triceps Pushdown | Revised |
| `skull-crusher` | EZ-Bar Skull Crusher | Revised |
| `overhead-dumbbell-extension` | Overhead Dumbbell Extension | Retained |
| `close-grip-bench-press` | Close-Grip Bench Press | Revised |
| `band-pushdown` | Band Pushdown | Retained |
| `bench-dip` | Bench Dip | Retained |
| `diamond-push-up` | Diamond Push-Up | Revised |
| `prone-pulldown` | Prone Bodyweight Pulldown | Retained |
| `pull-up` | Pull-Up | Retained |
| `lat-pulldown` | Lat Pulldown | Retained |
| `chin-up` | Chin-Up | Retained |
| `assisted-pull-up` | Assisted Pull-Up | Revised |
| `band-pulldown` | Band Pulldown | Revised |
| `barbell-row` | Barbell Row | Retained |
| `one-arm-dumbbell-row` | One-Arm Dumbbell Row | Revised |
| `one-arm-unsupported-dumbbell-row` | One-Arm Dumbbell Row (No Bench) | Retained |
| `seated-cable-row` | Seated Cable Row | Retained |
| `chest-supported-row` | Chest-Supported Dumbbell Row | Retained |
| `standing-cable-row` | Standing Cable Row | Revised |
| `inverted-row` | Inverted Row | Revised |
| `kettlebell-row` | Kettlebell Row | Revised |
| `band-row` | Band Row | Revised |
| `face-pull` | Face Pull | Retained |
| `reverse-pec-deck` | Reverse Pec Deck | Retained |
| `bent-over-reverse-fly` | Bent-Over Reverse Fly | Revised |
| `band-pull-apart` | Band Pull-Apart | Retained |
| `ez-bar-curl` | EZ-Bar Curl | Revised |
| `barbell-curl` | Barbell Curl | Retained |
| `dumbbell-curl` | Dumbbell Curl | Revised |
| `hammer-curl` | Hammer Curl | Revised |
| `cable-curl` | Cable Curl | Retained |
| `incline-dumbbell-curl` | Incline Dumbbell Curl | Revised |
| `band-curl` | Band Curl | Retained |
| `back-squat` | Barbell Back Squat | Revised |
| `leg-press` | Leg Press | Revised |
| `goblet-squat` | Dumbbell Goblet Squat | Revised |
| `hack-squat` | Hack Squat | Retained |
| `front-squat` | Barbell Front Squat | Revised |
| `kettlebell-goblet-squat` | Kettlebell Goblet Squat | Retained |
| `smith-squat` | Smith Machine Squat | Revised |
| `bodyweight-squat` | Bodyweight Squat | Revised |
| `romanian-deadlift` | Barbell Romanian Deadlift | Retained |
| `deadlift` | Barbell Deadlift | Revised |
| `dumbbell-rdl` | Dumbbell Romanian Deadlift | Revised |
| `kettlebell-swing` | Kettlebell Swing | Revised |
| `back-extension` | Back Extension | Retained |
| `cable-pull-through` | Cable Pull-Through | Retained |
| `single-leg-rdl` | Single-Leg Romanian Deadlift | Retained |
| `dumbbell-reverse-lunge` | Dumbbell Reverse Lunge | Revised |
| `bulgarian-split-squat` | Bulgarian Split Squat | Revised |
| `barbell-lunge` | Barbell Reverse Lunge | Retained |
| `dumbbell-step-up` | Dumbbell Step-Up | Retained |
| `bodyweight-step-up` | Bodyweight Step-Up | Retained |
| `reverse-lunge` | Bodyweight Reverse Lunge | Retained |
| `barbell-hip-thrust` | Barbell Hip Thrust | Revised |
| `dumbbell-hip-thrust` | Dumbbell Hip Thrust | Retained |
| `glute-bridge` | Glute Bridge | Retained |
| `leg-curl` | Leg Curl | Revised |
| `band-leg-curl` | Band Leg Curl | Retained |
| `leg-extension` | Leg Extension | Retained |
| `machine-calf-raise` | Machine Calf Raise | Revised |
| `dumbbell-calf-raise` | Dumbbell Calf Raise | Retained |
| `leg-press-calf-raise` | Leg Press Calf Raise | Revised |
| `single-leg-calf-raise` | Single-Leg Calf Raise | Retained |
| `standing-bodyweight-calf-raise` | Standing Bodyweight Calf Raise | Retained |
| `hanging-leg-raise` | Hanging Leg Raise | Revised |
| `cable-crunch` | Cable Crunch | Retained |
| `lying-leg-raise` | Lying Leg Raise | Retained |
| `crunch` | Crunch | Retained |
| `dead-bug` | Dead Bug | Revised |
| `stationary-bike` | Stationary Bike | Retained |
| `elliptical` | Elliptical | Retained |
| `treadmill` | Treadmill | Retained |
| `rowing-machine` | Rowing Machine | Revised |
| `stair-climber` | Stair Climber | Retained |
| `arm-circles` | Arm Circles | Retained |
| `leg-swings` | Leg Swings | Revised |
| `cat-cow` | Cat-Cow | Retained |
| `inchworm` | Inchworm | Retained |
| `torso-twists` | Torso Twists | Retained |
| `walking-knee-hug` | Walking Knee Hug | Revised |
| `doorway-chest-stretch` | Doorway Chest Stretch | Retained |
| `cross-body-shoulder-stretch` | Cross-Body Shoulder Stretch | Retained |
| `overhead-triceps-stretch` | Overhead Triceps Stretch | Revised |
| `wall-biceps-stretch` | Wall Biceps Stretch | Retained |
| `standing-quad-stretch` | Standing Quad Stretch | Retained |
| `kneeling-hip-flexor-stretch` | Kneeling Hip Flexor Stretch | Retained |
| `seated-hamstring-stretch` | Seated Hamstring Stretch | Retained |
| `figure-four-glute-stretch` | Figure-Four Glute Stretch | Retained |
| `wall-calf-stretch` | Wall Calf Stretch | Retained |
| `cobra-stretch` | Cobra Stretch | Revised |
| `cable-rope-triceps-extension` | Cable Rope Triceps Extension | Retained |
| `dumbbell-front-raise` | Dumbbell Front Raise | Revised |
| `dumbbell-pullover` | Dumbbell Pullover | Retained |
| `dumbbell-side-bend` | Dumbbell Side Bend | Retained |
| `reverse-grip-barbell-curl` | Reverse-Grip Barbell Curl | Retained |
| `concentration-curl` | Concentration Curl | Retained |
| `single-arm-overhead-dumbbell-extension` | Single-Arm Overhead Dumbbell Extension | Retained |
| `seated-barbell-shoulder-press` | Seated Barbell Shoulder Press | Retained |
| `dumbbell-triceps-kickback` | Dumbbell Triceps Kickback | Retained |
| `barbell-shrug` | Barbell Shrug | Retained |
| `reverse-grip-bench-press` | Reverse-Grip Bench Press | Retained |
| `reverse-grip-barbell-row` | Reverse-Grip Barbell Row | Retained |
| `bodyweight-bulgarian-split-squat` | Bodyweight Bulgarian Split Squat | Revised |
| `alternating-medicine-ball-push-up` | Alternating Medicine Ball Push-Up | Retained |
| `cross-body-hammer-curl` | Cross-Body Hammer Curl | Retained |
| `dumbbell-shrug` | Dumbbell Shrug | Retained |
| `dumbbell-skull-crusher` | Dumbbell Skull Crusher | Retained |
| `incline-dumbbell-fly` | Incline Dumbbell Fly | Revised |
| `oblique-crunch` | Oblique Crunch | Retained |
| `zottman-curl` | Zottman Curl | Revised |
| `stiff-legged-good-morning` | Stiff-Legged Good Morning | Retained |
| `barbell-upright-row` | Barbell Upright Row | Retained |
| `calf-raise` | Calf Raise | Retained |
| `shotgun-row` | Shotgun Row | Revised |
| `cable-upright-row` | Cable Upright Row | Retained |
| `cable-rope-overhead-triceps-extension` | Cable Rope Overhead Triceps Extension | Revised |
| `dumbbell-bent-over-row` | Dumbbell Bent-Over Row | Retained |
| `cable-wood-chop` | Cable Wood Chop | Retained |
| `smith-machine-stiff-legged-deadlift` | Smith Machine Stiff-Legged Deadlift | Retained |
| `dumbbell-lunge` | Dumbbell Lunge | Retained |
| `seated-dumbbell-curl` | Seated Dumbbell Curl | Retained |
| `low-to-high-cable-fly` | Low-to-High Cable Fly | Retained |
| `palms-down-dumbbell-wrist-curl` | Palms-Down Dumbbell Wrist Curl | Retained |
| `machine-triceps-dip` | Machine Triceps Dip | Retained |
| `ab-crunch-machine` | Ab Crunch Machine | Retained |
| `plate-loaded-leg-press` | Plate-Loaded Leg Press | Revised |
| `palms-up-dumbbell-wrist-curl` | Palms-Up Dumbbell Wrist Curl | Revised |
| `biceps-curl-to-shoulder-press` | Biceps Curl to Shoulder Press | Revised |
| `russian-twist` | Russian Twist | Revised |
| `pistol-squat` | Pistol Squat | Retained |
| `seated-calf-raise` | Seated Calf Raise | Retained |
| `sit-up` | Sit-Up | Retained |
| `incline-hammer-curl` | Incline Hammer Curl | Revised |
| `neutral-grip-pull-up` | Neutral-Grip Pull-Up | Retained |
| `hammer-strength-chest-press` | Hammer Strength Chest Press | Retained |
| `lying-leg-curl` | Lying Leg Curl | Retained |
| `overhead-cable-curl` | Overhead Cable Curl | Retained |
| `dumbbell-sumo-squat` | Dumbbell Sumo Squat | Retained |
| `machine-preacher-curl` | Machine Preacher Curl | Retained |
| `glute-kickback-machine` | Glute Kickback Machine | Retained |
| `barbell-drag-curl` | Barbell Drag Curl | Retained |
| `arnold-press` | Arnold Press | Retained |
| `smith-machine-close-grip-bench-press` | Smith Machine Close-Grip Bench Press | Retained |
| `alternating-single-arm-kettlebell-swing` | Alternating Single-Arm Kettlebell Swing | Retained |
| `smith-machine-bent-over-row` | Smith Machine Bent-Over Row | Retained |
| `machine-triceps-extension` | Machine Triceps Extension | Retained |
| `single-leg-kickback` | Single-Leg Kickback | Retained |
| `dumbbell-squat-to-shoulder-press` | Dumbbell Squat to Shoulder Press | Retained |
| `close-grip-v-bar-pulldown` | Close-Grip V-Bar Pulldown | Retained |
| `wide-grip-lat-pulldown` | Wide-Grip Lat Pulldown | Retained |
| `home-gym-leg-extension` | Home Gym Leg Extension | Retained |
| `dumbbell-squat` | Dumbbell Squat | Retained |
| `hip-abductor-machine` | Hip Abductor Machine | Revised |
| `ez-bar-preacher-curl` | EZ-Bar Preacher Curl | Retained |
| `machine-biceps-curl` | Machine Biceps Curl | Retained |
| `waiter-curl` | Waiter Curl | Retained |
| `seated-back-extension-machine` | Seated Back Extension Machine | Revised |
| `cable-external-rotation` | Cable External Rotation | Retained |
| `barbell-front-raise` | Barbell Front Raise | Retained |
| `single-arm-lat-pulldown` | Single-Arm Lat Pulldown | Revised |
| `dumbbell-reverse-fly` | Dumbbell Reverse Fly | Retained |
| `hip-adductor-machine` | Hip Adductor Machine | Retained |
| `machine-row` | Machine Row | Retained |
| `cable-rear-delt-fly` | Cable Rear Delt Fly | Retained |
| `close-grip-ez-bar-curl` | Close-Grip EZ-Bar Curl | Retained |
| `cable-straight-arm-pulldown` | Cable Straight-Arm Pulldown | Retained |
| `no-money-curl` | No-Money Curl | Revised |
| `dumbbell-squeeze-press` | Dumbbell Squeeze Press | Retained |
| `mini-band-lateral-walk` | Mini Band Lateral Walk | Retained |
| `bicycle-crunch` | Bicycle Crunch | Retained |
| `captain-s-chair-knee-raise` | Captain\ | Retained |
| `alternating-dumbbell-bench-press` | Alternating Dumbbell Bench Press | Revised |
| `single-arm-cable-curl` | Single-Arm Cable Curl | Retained |
| `reverse-grip-cable-pushdown` | Reverse-Grip Cable Pushdown | Retained |
| `lateral-to-front-raise` | Lateral to Front Raise | Revised |
| `cable-internal-rotation` | Cable Internal Rotation | Retained |
| `hip-thrust` | Hip Thrust | Retained |
| `scissor-kick` | Scissor Kick | Retained |
| `reverse-crunch` | Reverse Crunch | Retained |
| `seated-leg-pull-in` | Seated Leg Pull-In | Retained |
| `side-lunge` | Side Lunge | Retained |
| `home-gym-rope-pushdown` | Home Gym Rope Pushdown | Revised |
| `hammer-strength-incline-press` | Hammer Strength Incline Press | Retained |
| `feet-elevated-glute-bridge` | Feet-Elevated Glute Bridge | Retained |
| `triceps-push-up` | Triceps Push-Up | Retained |
| `seated-dumbbell-calf-raise` | Seated Dumbbell Calf Raise | Retained |
| `single-leg-glute-bridge` | Single-Leg Glute Bridge | Retained |
| `wide-grip-pull-up` | Wide-Grip Pull-Up | Retained |
| `kneeling-squat` | Kneeling Squat | Revised |
| `hammer-strength-decline-press` | Hammer Strength Decline Press | Retained |
| `superman` | Superman | Revised |
| `archer-pull-up` | Archer Pull-Up | Retained |
| `single-arm-dumbbell-press` | Single-Arm Dumbbell Press | Retained |
| `smith-machine-shoulder-press` | Smith Machine Shoulder Press | Revised |
| `reverse-grip-pulldown` | Reverse-Grip Pulldown | Retained |
| `wide-grip-barbell-curl` | Wide-Grip Barbell Curl | Retained |
| `kettlebell-suitcase-deadlift` | Kettlebell Suitcase Deadlift | Retained |
| `bird-dog-row` | Bird Dog Row | Retained |
| `pendlay-row` | Pendlay Row | Retained |
| `barbell-good-morning` | Barbell Good Morning | Retained |
| `scissor-crossover-kick` | Scissor Crossover Kick | Retained |
| `around-the-world` | Around the World | Retained |
| `flutter-kick` | Flutter Kick | Retained |
| `hammer-strength-shoulder-press` | Hammer Strength Shoulder Press | Retained |
| `seated-rear-delt-raise` | Seated Rear Delt Raise | Retained |
| `cuban-rotation` | Cuban Rotation | Revised |
| `barbell-glute-bridge` | Barbell Glute Bridge | Retained |
| `cable-standing-twist` | Cable Standing Twist | Retained |
| `single-arm-cable-side-extension` | Single-Arm Cable Side Extension | Retained |
| `standing-overhead-dumbbell-extension` | Standing Overhead Dumbbell Extension | Retained |
| `barbell-pause-curl` | Barbell Pause Curl | Revised |
| `ez-bar-overhead-triceps-extension` | EZ-Bar Overhead Triceps Extension | Retained |
| `band-straight-arm-pulldown` | Band Straight-Arm Pulldown | Retained |
| `reverse-dumbbell-curl` | Reverse Dumbbell Curl | Retained |
| `cable-crossover-pulldown` | Cable Crossover Pulldown | Revised |
| `lunge-with-twist` | Lunge with Twist | Retained |
| `dumbbell-floor-press` | Dumbbell Floor Press | Retained |
| `rotation-push-up` | Rotation Push-Up | Retained |
| `smith-machine-decline-press` | Smith Machine Decline Press | Retained |
| `smith-machine-split-squat` | Smith Machine Split Squat | Retained |
| `decline-crunch` | Decline Crunch | Retained |
| `decline-oblique-crunch` | Decline Oblique Crunch | Retained |
| `partner-medicine-ball-twist` | Partner Medicine Ball Twist | Retained |
| `stability-ball-pike` | Stability Ball Pike | Retained |
| `rotary-torso-machine` | Rotary Torso Machine | Revised |
| `side-plank-leg-lift` | Side Plank Leg Lift | Retained |
| `barbell-forward-lunge` | Barbell Forward Lunge | Retained |
| `iron-cross` | Iron Cross | Retained |
| `ez-bar-pjr-pullover` | EZ-Bar PJR Pullover | Revised |
| `band-side-step` | Band Side Step | Retained |
| `ez-bar-pullover` | EZ-Bar Pullover | Retained |
| `seated-single-leg-calf-raise` | Seated Single-Leg Calf Raise | Retained |
| `incline-ez-bar-curl` | Incline EZ-Bar Curl | Revised |
| `single-arm-dumbbell-floor-press` | Single-Arm Dumbbell Floor Press | Retained |
| `cable-internal-rotation-at-90` | Cable Internal Rotation at 90° | Retained |
| `plank-surrender` | Plank Surrender | Retained |
| `tate-press` | Tate Press | Retained |
| `stability-ball-knee-tuck` | Stability Ball Knee Tuck | Retained |
| `cable-lateral-triceps-extension` | Cable Lateral Triceps Extension | Retained |
| `hanging-knee-raise` | Hanging Knee Raise | Retained |
| `single-arm-overhead-kettlebell-squat` | Single-Arm Overhead Kettlebell Squat | Retained |
| `mountain-climber` | Mountain Climber | Retained |
| `bodyweight-forward-lunge` | Bodyweight Forward Lunge | Retained |
| `assisted-dip` | Assisted Dip | Retained |
| `stability-ball-crunch` | Stability Ball Crunch | Retained |
| `hammer-strength-iso-row` | Hammer Strength Iso Row | Retained |
| `smith-machine-behind-the-back-shrug` | Smith Machine Behind-the-Back Shrug | Revised |
