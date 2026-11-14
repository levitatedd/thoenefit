<?php
declare(strict_types=1);

namespace TF;

/** Equipment, muscle and movement vocabularies plus the built-in exercise catalog. */
final class Catalog
{
    /** Movement patterns that count as compound lifts (more sets, longer rest, lower reps). */
    public const COMPOUND = ['horizontal_push', 'incline_push', 'vertical_push', 'vertical_pull', 'horizontal_pull', 'squat', 'hinge', 'lunge', 'hip_thrust'];

    /** Kinds whose loading differs from one gym's unit to the next, so history is kept per gym. */
    public const GYM_SPECIFIC_KINDS = ['machine', 'cable'];

    public const KINDS = [
        'barbell' => 'Barbell',
        'dumbbell' => 'Dumbbell',
        'kettlebell' => 'Kettlebell',
        'cable' => 'Cable',
        'machine' => 'Machine',
        'band' => 'Band',
        'bodyweight' => 'Bodyweight',
    ];

    public const MUSCLES = [
        'chest' => 'Chest',
        'shoulders' => 'Shoulders',
        'triceps' => 'Triceps',
        'biceps' => 'Biceps',
        'forearms' => 'Forearms',
        'lats' => 'Lats',
        'upper_back' => 'Upper back',
        'lower_back' => 'Lower back',
        'abs' => 'Abs',
        'glutes' => 'Glutes',
        'quads' => 'Quads',
        'hamstrings' => 'Hamstrings',
        'calves' => 'Calves',
    ];

    public const PATTERNS = [
        'horizontal_push' => 'Horizontal press',
        'incline_push' => 'Incline press',
        'vertical_push' => 'Overhead press',
        'chest_fly' => 'Chest fly',
        'lateral_raise' => 'Lateral raise',
        'triceps' => 'Triceps',
        'vertical_pull' => 'Pull-down / pull-up',
        'horizontal_pull' => 'Row',
        'rear_delt' => 'Rear delts',
        'biceps' => 'Biceps curl',
        'squat' => 'Squat',
        'hinge' => 'Hip hinge',
        'lunge' => 'Single-leg',
        'hip_thrust' => 'Hip thrust',
        'knee_flexion' => 'Leg curl',
        'knee_extension' => 'Leg extension',
        'calf' => 'Calf raise',
        'core' => 'Core',
        'other' => 'Other (never suggested automatically)',
    ];

    /** Equipment a gym profile can tick, grouped for the settings screen. */
    public static function equipment(): array
    {
        return [
            ['group' => 'Free weights', 'items' => [
                'barbell' => 'Barbell and plates',
                'ez_bar' => 'EZ curl bar',
                'dumbbells' => 'Dumbbells',
                'kettlebells' => 'Kettlebells',
            ]],
            ['group' => 'Benches and bars', 'items' => [
                'bench' => 'Flat bench',
                'incline_bench' => 'Adjustable / incline bench',
                'rack' => 'Squat rack or stands',
                'pullup_bar' => 'Pull-up bar',
                'dip_bars' => 'Dip bars',
            ]],
            ['group' => 'Cables and bands', 'items' => [
                'cable' => 'Cable station',
                'bands' => 'Resistance bands',
            ]],
            ['group' => 'Machines', 'items' => [
                'lat_pulldown' => 'Lat pulldown',
                'seated_row' => 'Seated row',
                'chest_press' => 'Chest press',
                'shoulder_press' => 'Shoulder press',
                'pec_deck' => 'Pec deck / reverse fly',
                'smith' => 'Smith machine',
                'leg_press' => 'Leg press',
                'hack_squat' => 'Hack squat',
                'leg_curl' => 'Leg curl',
                'leg_extension' => 'Leg extension',
                'calf_raise' => 'Calf raise',
                'assisted_pullup' => 'Assisted pull-up',
                'back_extension' => 'Back extension bench',
            ]],
        ];
    }

    public static function equipmentKeys(): array
    {
        $keys = [];
        foreach (self::equipment() as $g) {
            $keys = array_merge($keys, array_keys($g['items']));
        }
        return $keys;
    }

    public static function presets(): array
    {
        return [
            ['name' => 'Commercial gym', 'equipment' => self::equipmentKeys()],
            ['name' => 'Garage barbell setup', 'equipment' => ['barbell', 'rack', 'bench', 'incline_bench', 'pullup_bar', 'dumbbells']],
            ['name' => 'Dumbbells and a bench', 'equipment' => ['dumbbells', 'bench', 'incline_bench']],
            ['name' => 'Bodyweight only', 'equipment' => []],
        ];
    }

    /** Smallest weight jump per equipment kind, in the given unit. A gym profile can override these. */
    public static function defaultIncrements(string $unit): array
    {
        return $unit === 'kg'
            ? ['barbell' => 2.5, 'dumbbell' => 2, 'kettlebell' => 4, 'cable' => 2.5, 'machine' => 5, 'band' => 0, 'bodyweight' => 2.5]
            : ['barbell' => 5, 'dumbbell' => 5, 'kettlebell' => 5, 'cable' => 5, 'machine' => 10, 'band' => 0, 'bodyweight' => 5];
    }

    /**
     * Built-in exercises: [slug, name, kind, required equipment, pattern,
     * primary muscles, secondary muscles, priority (1 = first pick), form cues].
     */
    public static function exercises(): array
    {
        return [
            // Horizontal press
            ['barbell-bench-press', 'Barbell Bench Press', 'barbell', ['barbell', 'bench', 'rack'], 'horizontal_push', ['chest'], ['triceps', 'shoulders'], 1, 'Pin your shoulder blades back and down before you unrack. Lower the bar to mid-chest with forearms vertical, then press up and slightly back toward the rack. Keep both feet planted the whole time.'],
            ['dumbbell-bench-press', 'Dumbbell Bench Press', 'dumbbell', ['dumbbells', 'bench'], 'horizontal_push', ['chest'], ['triceps', 'shoulders'], 2, 'Start with the dumbbells stacked over your shoulders. Lower until your elbows dip just below the bench, about 45 degrees from your ribs, then press back together without clanking the bells.'],
            ['machine-chest-press', 'Machine Chest Press', 'machine', ['chest_press'], 'horizontal_push', ['chest'], ['triceps', 'shoulders'], 3, 'Set the seat so the handles line up with mid-chest. Keep your back on the pad, press until your arms are almost straight, and return slowly without letting the stack touch down.'],
            ['smith-bench-press', 'Smith Machine Bench Press', 'machine', ['smith', 'bench'], 'horizontal_push', ['chest'], ['triceps', 'shoulders'], 4, 'Slide the bench so the bar tracks to mid-chest. Unhook, lower under control until the bar grazes your shirt, and press up without flaring your elbows wide.'],
            ['chest-dip', 'Chest Dip', 'bodyweight', ['dip_bars'], 'horizontal_push', ['chest'], ['triceps', 'shoulders'], 5, 'Lean your torso forward and let your elbows drift out a little. Lower until your upper arms are about level with the bars, then drive up without shrugging.'],
            ['push-up', 'Push-Up', 'bodyweight', [], 'horizontal_push', ['chest'], ['triceps', 'shoulders', 'abs'], 6, 'Hands just outside shoulder width, body in one line from heels to head. Lower your chest to a fist above the floor and push the ground away. Squeeze your glutes so your hips do not sag.'],

            // Incline press
            ['incline-dumbbell-press', 'Incline Dumbbell Press', 'dumbbell', ['dumbbells', 'incline_bench'], 'incline_push', ['chest'], ['shoulders', 'triceps'], 1, 'Set the bench around 30 degrees. Press the dumbbells up over your collarbones, then lower them wide and deep while keeping your wrists stacked over your elbows.'],
            ['incline-barbell-press', 'Incline Barbell Press', 'barbell', ['barbell', 'incline_bench', 'rack'], 'incline_push', ['chest'], ['shoulders', 'triceps'], 2, 'With the bench at about 30 degrees, lower the bar to just under your collarbones. Keep your chest lifted and press straight up over your shoulders.'],
            ['smith-incline-press', 'Smith Machine Incline Press', 'machine', ['smith', 'incline_bench'], 'incline_push', ['chest'], ['shoulders', 'triceps'], 3, 'Position the incline bench so the bar meets your upper chest. Lower slowly, pause lightly, and press without locking out hard.'],
            ['feet-elevated-push-up', 'Feet-Elevated Push-Up', 'bodyweight', [], 'incline_push', ['chest'], ['shoulders', 'triceps', 'abs'], 5, 'Put your feet on a chair or step and your hands on the floor. Keep your body rigid, lower your face toward the floor between your hands, and press back up.'],

            // Chest fly
            ['cable-fly', 'Cable Fly', 'cable', ['cable'], 'chest_fly', ['chest'], ['shoulders'], 1, 'Set both pulleys at shoulder height and step forward into a split stance. With a soft bend in your elbows, sweep your hands together in front of your chest and let them open slowly.'],
            ['pec-deck', 'Pec Deck Fly', 'machine', ['pec_deck'], 'chest_fly', ['chest'], ['shoulders'], 2, 'Adjust the seat so your hands are level with your chest. Bring the handles together by squeezing your chest, not by rounding your shoulders forward, then open until you feel a stretch.'],
            ['dumbbell-fly', 'Dumbbell Fly', 'dumbbell', ['dumbbells', 'bench'], 'chest_fly', ['chest'], ['shoulders'], 3, 'Lie back with the dumbbells over your chest and elbows slightly bent. Open your arms in a wide arc until your chest stretches, then hug them back up along the same path.'],
            ['band-fly', 'Band Fly', 'band', ['bands'], 'chest_fly', ['chest'], ['shoulders'], 4, 'Anchor the band behind you at chest height. Step forward until there is tension and bring your hands together in front of you, holding the squeeze for a beat.'],

            // Overhead press
            ['overhead-press', 'Barbell Overhead Press', 'barbell', ['barbell', 'rack'], 'vertical_push', ['shoulders'], ['triceps', 'abs'], 1, 'Grip just outside your shoulders with the bar resting on your upper chest. Brace your abs and glutes, press straight up, and move your head through once the bar clears it.'],
            ['seated-dumbbell-press', 'Seated Dumbbell Shoulder Press', 'dumbbell', ['dumbbells', 'incline_bench'], 'vertical_push', ['shoulders'], ['triceps'], 2, 'Set the bench nearly upright. Start with the dumbbells at ear height, elbows slightly in front of your body, and press until your arms are straight overhead.'],
            ['standing-dumbbell-press', 'Standing Dumbbell Press', 'dumbbell', ['dumbbells'], 'vertical_push', ['shoulders'], ['triceps', 'abs'], 3, 'Stand tall with your ribs down. Press both dumbbells overhead without leaning back, and lower them to shoulder height under control.'],
            ['machine-shoulder-press', 'Machine Shoulder Press', 'machine', ['shoulder_press'], 'vertical_push', ['shoulders'], ['triceps'], 4, 'Set the seat so the handles start at about ear height. Press up without arching off the pad and lower until your elbows are just below your shoulders.'],
            ['kettlebell-press', 'Kettlebell Press', 'kettlebell', ['kettlebells'], 'vertical_push', ['shoulders'], ['triceps', 'abs'], 5, 'Rack the kettlebell against your forearm with your wrist straight. Press up while rotating your palm forward, finishing with your arm beside your ear.'],
            ['pike-push-up', 'Pike Push-Up', 'bodyweight', [], 'vertical_push', ['shoulders'], ['triceps'], 6, 'Start in a push-up position and walk your feet in until your hips are high. Bend your elbows to lower the top of your head toward the floor ahead of your hands, then press back up.'],

            // Lateral raise
            ['dumbbell-lateral-raise', 'Dumbbell Lateral Raise', 'dumbbell', ['dumbbells'], 'lateral_raise', ['shoulders'], [], 1, 'Lean forward a touch and raise the dumbbells out to your sides until your hands reach shoulder height. Lead with your elbows and lower more slowly than you lifted.'],
            ['cable-lateral-raise', 'Cable Lateral Raise', 'cable', ['cable'], 'lateral_raise', ['shoulders'], [], 2, 'Stand side-on to a low pulley and hold the handle in your far hand. Raise your arm out to the side to shoulder height and resist the cable on the way down.'],
            ['band-lateral-raise', 'Band Lateral Raise', 'band', ['bands'], 'lateral_raise', ['shoulders'], [], 3, 'Stand on the middle of the band and hold an end in each hand. Raise your arms out to shoulder height with a slight elbow bend and lower with control.'],

            // Triceps
            ['cable-pushdown', 'Cable Triceps Pushdown', 'cable', ['cable'], 'triceps', ['triceps'], [], 1, 'Pin your elbows to your sides and hinge forward slightly. Push the handle down until your arms are straight, then let your forearms rise to just past level.'],
            ['skull-crusher', 'EZ-Bar Skull Crusher', 'barbell', ['ez_bar', 'bench'], 'triceps', ['triceps'], [], 2, 'Lie back holding the bar over your forehead with your upper arms tilted slightly toward your head. Bend only at the elbows to lower the bar behind your hairline, then extend.'],
            ['overhead-dumbbell-extension', 'Overhead Dumbbell Extension', 'dumbbell', ['dumbbells'], 'triceps', ['triceps'], [], 3, 'Hold one dumbbell with both hands overhead. Keep your elbows pointing forward as you lower it behind your head, then straighten your arms fully.'],
            ['close-grip-bench-press', 'Close-Grip Bench Press', 'barbell', ['barbell', 'bench', 'rack'], 'triceps', ['triceps'], ['chest', 'shoulders'], 4, 'Grip the bar at shoulder width. Tuck your elbows close as you lower to your lower chest, and press up by straightening your arms.'],
            ['band-pushdown', 'Band Pushdown', 'band', ['bands'], 'triceps', ['triceps'], [], 5, 'Anchor the band overhead. With elbows fixed at your sides, press your hands down until your arms are straight and pause before letting them rise.'],
            ['bench-dip', 'Bench Dip', 'bodyweight', ['bench'], 'triceps', ['triceps'], ['shoulders', 'chest'], 6, 'Hands on the bench edge beside your hips, legs out in front. Lower until your elbows reach roughly 90 degrees, keeping your back close to the bench, then press up.'],
            ['diamond-push-up', 'Diamond Push-Up', 'bodyweight', [], 'triceps', ['triceps'], ['chest', 'shoulders'], 7, 'Place your hands close together under your chest. Keep your elbows brushing your ribs as you lower, then press up to full lockout.'],

            // Vertical pull
            ['pull-up', 'Pull-Up', 'bodyweight', ['pullup_bar'], 'vertical_pull', ['lats'], ['biceps', 'upper_back'], 1, 'Hang with an overhand grip a little wider than your shoulders. Pull your elbows down toward your back pockets until your chin clears the bar, then lower all the way.'],
            ['lat-pulldown', 'Lat Pulldown', 'machine', ['lat_pulldown'], 'vertical_pull', ['lats'], ['biceps', 'upper_back'], 2, 'Lock your thighs under the pad and lean back slightly. Pull the bar to your upper chest by driving your elbows down, and let it rise until your arms are long.'],
            ['chin-up', 'Chin-Up', 'bodyweight', ['pullup_bar'], 'vertical_pull', ['lats'], ['biceps'], 3, 'Take a shoulder-width underhand grip. Pull your chest toward the bar while keeping your shoulders away from your ears, and lower to a full hang.'],
            ['assisted-pull-up', 'Assisted Pull-Up', 'machine', ['assisted_pullup'], 'vertical_pull', ['lats'], ['biceps', 'upper_back'], 4, 'Pick enough assistance to reach your rep target. Pull your elbows down and back, pause with your chin over the handles, and lower slowly. Less assistance is harder.'],
            ['band-pulldown', 'Band Pulldown', 'band', ['bands'], 'vertical_pull', ['lats'], ['biceps'], 5, 'Anchor the band overhead and kneel under it. Pull your hands down to your shoulders by driving your elbows toward your hips.'],

            // Row
            ['barbell-row', 'Barbell Row', 'barbell', ['barbell'], 'horizontal_pull', ['upper_back', 'lats'], ['biceps', 'lower_back'], 1, 'Hinge until your torso is close to parallel with the floor and keep your back flat. Pull the bar to your lower ribs, pause, and lower it without standing up.'],
            ['one-arm-dumbbell-row', 'One-Arm Dumbbell Row', 'dumbbell', ['dumbbells', 'bench'], 'horizontal_pull', ['lats', 'upper_back'], ['biceps'], 2, 'Brace one hand and knee on the bench. Pull the dumbbell toward your hip, keeping your shoulders square to the floor, and stretch your arm fully at the bottom.'],
            ['seated-cable-row', 'Seated Cable Row', 'machine', ['seated_row'], 'horizontal_pull', ['upper_back', 'lats'], ['biceps'], 3, 'Sit tall with knees slightly bent. Pull the handle to your navel while squeezing your shoulder blades together, then reach forward without rounding your lower back.'],
            ['chest-supported-row', 'Chest-Supported Dumbbell Row', 'dumbbell', ['dumbbells', 'incline_bench'], 'horizontal_pull', ['upper_back', 'lats'], ['biceps'], 4, 'Lie chest-down on an incline bench. Row both dumbbells toward your hips, hold the squeeze, and lower until your arms hang straight.'],
            ['standing-cable-row', 'Standing Cable Row', 'cable', ['cable'], 'horizontal_pull', ['upper_back', 'lats'], ['biceps'], 5, 'Set the pulley at waist height and stand in a staggered stance. Pull the handle to your side, elbow close to your body, without twisting your torso.'],
            ['inverted-row', 'Inverted Row', 'bodyweight', ['barbell', 'rack'], 'horizontal_pull', ['upper_back', 'lats'], ['biceps', 'abs'], 6, 'Set a bar at hip height in the rack and hang underneath it with heels on the floor. Keep your body straight and pull your chest to the bar.'],
            ['kettlebell-row', 'Kettlebell Row', 'kettlebell', ['kettlebells'], 'horizontal_pull', ['lats', 'upper_back'], ['biceps'], 7, 'Hinge forward with a flat back and one hand braced on your thigh. Row the kettlebell to your hip and lower it with control.'],
            ['band-row', 'Band Row', 'band', ['bands'], 'horizontal_pull', ['upper_back', 'lats'], ['biceps'], 8, 'Anchor the band at chest height. Step back into tension and pull your hands to your ribs, squeezing your shoulder blades together.'],

            // Rear delts
            ['face-pull', 'Face Pull', 'cable', ['cable'], 'rear_delt', ['upper_back'], ['shoulders'], 1, 'Set a rope at eye level. Pull it toward your forehead while spreading your hands apart, finishing with your elbows high and knuckles pointing back.'],
            ['reverse-pec-deck', 'Reverse Pec Deck', 'machine', ['pec_deck'], 'rear_delt', ['upper_back'], ['shoulders'], 2, 'Face the pad and hold the handles with arms nearly straight. Sweep them back in a wide arc until they line up with your shoulders, then return slowly.'],
            ['bent-over-reverse-fly', 'Bent-Over Reverse Fly', 'dumbbell', ['dumbbells'], 'rear_delt', ['upper_back'], ['shoulders'], 3, 'Hinge forward with a flat back and let the dumbbells hang. Raise them out to the sides with a slight elbow bend, leading with your pinkies.'],
            ['band-pull-apart', 'Band Pull-Apart', 'band', ['bands'], 'rear_delt', ['upper_back'], ['shoulders'], 4, 'Hold the band at chest height with straight arms. Pull it apart until it touches your chest and control it back in.'],

            // Biceps
            ['ez-bar-curl', 'EZ-Bar Curl', 'barbell', ['ez_bar'], 'biceps', ['biceps'], ['forearms'], 1, 'Stand tall with elbows at your sides. Curl the bar to shoulder height without swinging, then lower until your arms are fully straight.'],
            ['barbell-curl', 'Barbell Curl', 'barbell', ['barbell'], 'biceps', ['biceps'], ['forearms'], 2, 'Grip the bar at shoulder width with palms up. Keep your elbows still and your torso upright as you curl, and take the lowering slowly.'],
            ['dumbbell-curl', 'Dumbbell Curl', 'dumbbell', ['dumbbells'], 'biceps', ['biceps'], ['forearms'], 3, 'Start with palms facing your thighs and turn them up as you curl. Keep your upper arms still and lower all the way down.'],
            ['hammer-curl', 'Hammer Curl', 'dumbbell', ['dumbbells'], 'biceps', ['biceps', 'forearms'], [], 4, 'Hold the dumbbells with palms facing each other the whole way. Curl to shoulder height with elbows fixed and lower under control.'],
            ['cable-curl', 'Cable Curl', 'cable', ['cable'], 'biceps', ['biceps'], ['forearms'], 4, 'Stand facing a low pulley with a straight bar. Curl to your chest with elbows pinned at your sides and resist the cable on the way down.'],
            ['incline-dumbbell-curl', 'Incline Dumbbell Curl', 'dumbbell', ['dumbbells', 'incline_bench'], 'biceps', ['biceps'], ['forearms'], 5, 'Lie back on a 45 to 60 degree incline and let your arms hang behind your body. Curl without letting your elbows drift forward.'],
            ['band-curl', 'Band Curl', 'band', ['bands'], 'biceps', ['biceps'], ['forearms'], 6, 'Stand on the band and hold the ends palms-up. Curl to your shoulders and lower slowly against the tension.'],

            // Squat
            ['back-squat', 'Barbell Back Squat', 'barbell', ['barbell', 'rack'], 'squat', ['quads', 'glutes'], ['hamstrings', 'lower_back', 'abs'], 1, 'Rest the bar on your upper back and take a breath into your belly. Sit down between your hips with knees tracking over your toes until your thighs reach parallel, then stand by driving the floor away.'],
            ['leg-press', 'Leg Press', 'machine', ['leg_press'], 'squat', ['quads', 'glutes'], ['hamstrings'], 2, 'Place your feet shoulder-width in the middle of the platform. Lower until your knees pass 90 degrees while your lower back stays on the pad, then press without locking your knees hard.'],
            ['goblet-squat', 'Dumbbell Goblet Squat', 'dumbbell', ['dumbbells'], 'squat', ['quads', 'glutes'], ['abs'], 3, 'Hold one dumbbell against your chest. Keep your torso upright and squat between your knees until your elbows reach the inside of your thighs.'],
            ['hack-squat', 'Hack Squat', 'machine', ['hack_squat'], 'squat', ['quads'], ['glutes'], 3, 'Set your feet a little forward on the platform and keep your back flat on the pad. Lower as deep as you can control and push up through your whole foot.'],
            ['front-squat', 'Barbell Front Squat', 'barbell', ['barbell', 'rack'], 'squat', ['quads'], ['glutes', 'abs', 'upper_back'], 4, 'Rack the bar on the front of your shoulders with elbows high. Stay upright as you squat to depth and drive your elbows up as you stand.'],
            ['kettlebell-goblet-squat', 'Kettlebell Goblet Squat', 'kettlebell', ['kettlebells'], 'squat', ['quads', 'glutes'], ['abs'], 4, 'Hold the kettlebell by the horns at your chest. Squat down between your knees with your chest tall, then stand all the way up.'],
            ['smith-squat', 'Smith Machine Squat', 'machine', ['smith'], 'squat', ['quads', 'glutes'], ['hamstrings'], 5, 'Stand with your feet slightly ahead of the bar. Unhook, squat until your thighs are parallel, and stand up without bouncing off the bottom.'],
            ['bodyweight-squat', 'Bodyweight Squat', 'bodyweight', [], 'squat', ['quads', 'glutes'], ['hamstrings'], 8, 'Feet shoulder-width, arms out front for balance. Sit down and back until your thighs are at least parallel and stand up tall. Slow the lowering to make it harder.'],

            // Hinge
            ['romanian-deadlift', 'Barbell Romanian Deadlift', 'barbell', ['barbell'], 'hinge', ['hamstrings', 'glutes'], ['lower_back', 'forearms'], 1, 'Start standing with the bar at your hips. Push your hips back with soft knees and slide the bar down your thighs until your hamstrings stretch, then stand by squeezing your glutes.'],
            ['deadlift', 'Barbell Deadlift', 'barbell', ['barbell'], 'hinge', ['hamstrings', 'glutes', 'lower_back'], ['quads', 'upper_back', 'forearms'], 2, 'Set the bar over mid-foot, grip it, and bring your shins in. Flatten your back, pull the slack out of the bar, and stand up by pushing the floor away. Lower it along your legs.'],
            ['dumbbell-rdl', 'Dumbbell Romanian Deadlift', 'dumbbell', ['dumbbells'], 'hinge', ['hamstrings', 'glutes'], ['lower_back'], 3, 'Hold the dumbbells in front of your thighs. Hinge back with a flat spine until they reach mid-shin, then drive your hips forward to stand.'],
            ['kettlebell-swing', 'Kettlebell Swing', 'kettlebell', ['kettlebells'], 'hinge', ['glutes', 'hamstrings'], ['lower_back', 'abs'], 4, 'Hike the bell back between your legs and snap your hips forward so it floats to chest height. Your arms guide it; your hips do the work.'],
            ['back-extension', 'Back Extension', 'bodyweight', ['back_extension'], 'hinge', ['lower_back', 'glutes'], ['hamstrings'], 5, 'Set the pad just below your hip crease. Lower your torso with a straight back and rise until your body forms a line, squeezing your glutes at the top.'],
            ['cable-pull-through', 'Cable Pull-Through', 'cable', ['cable'], 'hinge', ['glutes', 'hamstrings'], ['lower_back'], 6, 'Face away from a low pulley with the rope between your legs. Hinge back, then drive your hips forward to stand tall without leaning back.'],
            ['single-leg-rdl', 'Single-Leg Romanian Deadlift', 'bodyweight', [], 'hinge', ['hamstrings', 'glutes'], ['lower_back'], 7, 'Balance on one leg with a soft knee. Tip forward as your free leg reaches behind you, keeping hips level, then return to standing. Count reps per side.'],

            // Single-leg
            ['dumbbell-reverse-lunge', 'Dumbbell Reverse Lunge', 'dumbbell', ['dumbbells'], 'lunge', ['quads', 'glutes'], ['hamstrings'], 1, 'Step back far enough that both knees reach about 90 degrees. Keep your weight on the front foot and push through it to return. Count reps per side.'],
            ['bulgarian-split-squat', 'Bulgarian Split Squat', 'dumbbell', ['dumbbells', 'bench'], 'lunge', ['quads', 'glutes'], ['hamstrings'], 2, 'Rest your back foot on the bench and hop your front foot forward. Drop your back knee straight down, lean slightly forward, and stand through your front heel. Count reps per side.'],
            ['barbell-lunge', 'Barbell Reverse Lunge', 'barbell', ['barbell', 'rack'], 'lunge', ['quads', 'glutes'], ['hamstrings', 'abs'], 3, 'With the bar on your upper back, step one leg back and lower until the knee hovers above the floor. Drive through the front foot to stand. Count reps per side.'],
            ['dumbbell-step-up', 'Dumbbell Step-Up', 'dumbbell', ['dumbbells', 'bench'], 'lunge', ['quads', 'glutes'], [], 4, 'Plant your whole foot on the bench. Stand up using the top leg only, without pushing off the floor, and lower yourself slowly. Count reps per side.'],
            ['reverse-lunge', 'Bodyweight Reverse Lunge', 'bodyweight', [], 'lunge', ['quads', 'glutes'], ['hamstrings'], 6, 'Step back and lower until both knees are bent to about 90 degrees. Keep your torso tall and push through the front foot to return. Count reps per side.'],

            // Hip thrust
            ['barbell-hip-thrust', 'Barbell Hip Thrust', 'barbell', ['barbell', 'bench'], 'hip_thrust', ['glutes'], ['hamstrings'], 1, 'Sit with your upper back against the bench and the bar over your hip crease. Drive through your heels until your torso is level, tuck your chin, and pause at the top.'],
            ['dumbbell-hip-thrust', 'Dumbbell Hip Thrust', 'dumbbell', ['dumbbells', 'bench'], 'hip_thrust', ['glutes'], ['hamstrings'], 2, 'Rest one dumbbell on your hips with your shoulders on the bench. Lift your hips until your thighs are level with your torso and squeeze before lowering.'],
            ['glute-bridge', 'Glute Bridge', 'bodyweight', [], 'hip_thrust', ['glutes'], ['hamstrings'], 3, 'Lie on your back with knees bent and feet flat. Press through your heels to lift your hips into a straight line from knees to shoulders, and hold for a second.'],

            // Leg curl
            ['leg-curl', 'Leg Curl', 'machine', ['leg_curl'], 'knee_flexion', ['hamstrings'], ['calves'], 1, 'Line your knees up with the machine pivot. Curl the pad as far as it goes without lifting your hips, then let it back out over two to three seconds.'],
            ['band-leg-curl', 'Band Leg Curl', 'band', ['bands'], 'knee_flexion', ['hamstrings'], [], 3, 'Anchor the band low and loop it around your ankles while lying face down. Curl your heels to your glutes and return slowly.'],

            // Leg extension
            ['leg-extension', 'Leg Extension', 'machine', ['leg_extension'], 'knee_extension', ['quads'], [], 1, 'Set the pad just above your ankles and your knees at the pivot. Straighten your legs fully, hold briefly, and lower with control.'],

            // Calves
            ['machine-calf-raise', 'Machine Calf Raise', 'machine', ['calf_raise'], 'calf', ['calves'], [], 1, 'Stand on the balls of your feet with heels hanging off. Lower into a deep stretch, pause, and rise as high as you can.'],
            ['dumbbell-calf-raise', 'Dumbbell Calf Raise', 'dumbbell', ['dumbbells'], 'calf', ['calves'], [], 2, 'Hold a dumbbell in each hand and stand on a step or plate if you have one. Rise onto your toes, pause at the top, and lower slowly.'],
            ['leg-press-calf-raise', 'Leg Press Calf Raise', 'machine', ['leg_press'], 'calf', ['calves'], [], 3, 'Put the balls of your feet on the bottom edge of the platform with legs nearly straight. Push through your toes and let your heels drop under control. Keep the safeties engaged.'],
            ['single-leg-calf-raise', 'Single-Leg Calf Raise', 'bodyweight', [], 'calf', ['calves'], [], 4, 'Stand on one foot on a step, holding something for balance. Drop your heel below the step, then rise all the way up. Count reps per side.'],

            // Core
            ['hanging-leg-raise', 'Hanging Leg Raise', 'bodyweight', ['pullup_bar'], 'core', ['abs'], ['forearms'], 1, 'Hang from the bar without swinging. Curl your pelvis up as you raise your knees or straight legs, and lower them slowly.'],
            ['cable-crunch', 'Cable Crunch', 'cable', ['cable'], 'core', ['abs'], [], 2, 'Kneel below a high pulley holding the rope beside your head. Curl your ribs toward your hips, rounding your back, without sitting back onto your heels.'],
            ['lying-leg-raise', 'Lying Leg Raise', 'bodyweight', [], 'core', ['abs'], [], 3, 'Lie flat and press your lower back into the floor. Raise straight legs to vertical and lower them only as far as your back stays down.'],
            ['crunch', 'Crunch', 'bodyweight', [], 'core', ['abs'], [], 4, 'Lie with knees bent and hands by your temples. Curl your shoulder blades off the floor by bringing your ribs toward your hips, and lower slowly.'],
            ['dead-bug', 'Dead Bug', 'bodyweight', [], 'core', ['abs'], [], 5, 'Lie on your back with arms up and knees over hips. Reach one arm and the opposite leg toward the floor while your lower back stays flat. Count reps per side.'],
        ];
    }

    /** Inserts or updates built-in exercises by slug. Never touches user-created ones. */
    public static function sync(Db $db): void
    {
        $existing = [];
        foreach ($db->all('SELECT id, slug FROM exercises WHERE user_id IS NULL') as $r) {
            $existing[$r['slug']] = (int) $r['id'];
        }
        foreach (self::exercises() as $e) {
            [$slug, $name, $kind, $equip, $pattern, $main, $assist, $priority, $cues] = $e;
            $row = [
                'name' => $name,
                'kind' => $kind,
                'equipment' => json_encode($equip),
                'pattern' => $pattern,
                'muscles_main' => json_encode($main),
                'muscles_assist' => json_encode($assist),
                'cues' => $cues,
                'priority' => $priority,
            ];
            if (isset($existing[$slug])) {
                $db->update('exercises', $row, 'id=?', [$existing[$slug]]);
            } else {
                $db->insert('exercises', $row + ['slug' => $slug]);
            }
        }
    }

    /** Exercises a user can see: built-ins plus their own. */
    public static function forUser(Db $db, int $userId, bool $includeArchived = false): array
    {
        $rows = $db->all('SELECT * FROM exercises WHERE (user_id IS NULL OR user_id=?) ORDER BY name', [$userId]);
        $out = [];
        foreach ($rows as $r) {
            if (!$includeArchived && (int) $r['archived'] === 1) {
                continue;
            }
            $out[] = self::shape($r);
        }
        return $out;
    }

    public static function shape(array $r): array
    {
        return [
            'id' => (int) $r['id'],
            'custom' => $r['user_id'] !== null,
            'name' => $r['name'],
            'kind' => $r['kind'],
            'equipment' => json_decode($r['equipment'], true) ?: [],
            'pattern' => $r['pattern'],
            'muscles_main' => json_decode($r['muscles_main'], true) ?: [],
            'muscles_assist' => json_decode($r['muscles_assist'], true) ?: [],
            'cues' => $r['cues'],
            'priority' => (int) $r['priority'],
            'compound' => in_array($r['pattern'], self::COMPOUND, true),
            'archived' => (int) $r['archived'] === 1,
        ];
    }

    /** History key: machines and cables are tracked per gym, everything else per exercise. */
    public static function variantKey(int $exerciseId, string $kind, ?int $gymId): string
    {
        if ($gymId && in_array($kind, self::GYM_SPECIFIC_KINDS, true)) {
            return $exerciseId . '@' . $gymId;
        }
        return (string) $exerciseId;
    }
}
