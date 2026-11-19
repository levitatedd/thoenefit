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
        'cardio' => 'Cardio machine',
        'stretch' => 'Stretch',
    ];

    /**
     * Kinds logged as time instead of weight and reps: cardio (with optional
     * distance and level) and stretches (seconds per hold, #138). They never
     * count toward lifting volume, recovery or weight progression.
     */
    public const TIMED_KINDS = ['cardio', 'stretch'];

    /** Stretch patterns (#138): dynamic ones warm up before lifting, static ones cool down after. */
    public const STRETCH_PATTERNS = ['dynamic_stretch', 'static_stretch'];

    /** Seconds per hold for a planned stretch. */
    public const STRETCH_SECONDS = 30;

    /** Built-in stretches done once on each side: planned as two holds, left then right. */
    public const PER_SIDE = [
        'leg-swings', 'worlds-greatest-stretch', 'walking-knee-hug',
        'cross-body-shoulder-stretch', 'overhead-triceps-stretch', 'wall-biceps-stretch', 'standing-quad-stretch',
        'kneeling-hip-flexor-stretch', 'seated-hamstring-stretch', 'figure-four-glute-stretch', 'wall-calf-stretch', 'doorway-chest-stretch',
    ];

    public static function isTimed(string $kind): bool
    {
        return in_array($kind, self::TIMED_KINDS, true);
    }

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
        'cardio' => 'Cardio warm-up',
        'dynamic_stretch' => 'Dynamic stretch',
        'static_stretch' => 'Static stretch',
        'other' => 'Other (never suggested automatically)',
    ];

    /** Equipment a gym profile can tick, grouped for the settings screen. */
    public static function equipment(): array
    {
        return [
            ['group' => 'Free weights', 'items' => [
                'barbell' => 'Barbell and plates',
                'ez_bar' => 'EZ curl bar',
                'single_dumbbell' => 'Single dumbbell',
                'dumbbells' => 'Dumbbell pair',
                'kettlebells' => 'Kettlebells',
                'medicine_ball' => 'Medicine ball',
                'stability_ball' => 'Stability ball',
            ]],
            ['group' => 'Benches and bars', 'items' => [
                'bench' => 'Flat bench',
                'incline_bench' => 'Adjustable / incline bench',
                'rack' => 'Squat rack or stands',
                'pullup_bar' => 'Pull-up bar',
                'decline_bench' => 'Decline bench',
                'preacher_bench' => 'Preacher bench',
                'dip_bars' => "Dip bars / captain's chair",
                'step_box' => 'Exercise step or box',
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
                'back_extension_machine' => 'Seated back extension',
                'biceps_machine' => 'Biceps curl',
                'triceps_machine' => 'Triceps extension / dip',
                'ab_crunch' => 'Ab crunch',
                'rotary_torso' => 'Rotary torso',
                'hip_abduction' => 'Hip abductor / adductor',
                'glute_kickback' => 'Glute kickback',
            ]],
            ['group' => 'Cardio', 'items' => [
                'stationary_bike' => 'Stationary bike',
                'treadmill' => 'Treadmill',
                'rowing_machine' => 'Rowing machine',
                'elliptical' => 'Elliptical',
                'stair_climber' => 'Stair climber',
            ]],
        ];
    }

    // A pair supplies one dumbbell. A suitable bench can still be used for a step-up.
    public const EQUIPMENT_ALTERNATIVES = [
        'single_dumbbell' => ['dumbbells'],
        'step_box' => ['bench'],
    ];

    public static function supports(array $exercise, array $equipment, bool $bodyweightOnly = false): bool
    {
        if ($bodyweightOnly) {
            return in_array($exercise['kind'], ['bodyweight', 'stretch'], true) && $exercise['equipment'] === [];
        }
        foreach ($exercise['equipment'] as $required) {
            if (!in_array($required, $equipment, true) && !array_intersect(self::EQUIPMENT_ALTERNATIVES[$required] ?? [], $equipment)) {
                return false;
            }
        }
        return true;
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
            ? ['barbell' => 2.5, 'dumbbell' => 2, 'kettlebell' => 4, 'cable' => 2.5, 'machine' => 5, 'band' => 0, 'bodyweight' => 2.5, 'cardio' => 0, 'stretch' => 0]
            : ['barbell' => 5, 'dumbbell' => 5, 'kettlebell' => 5, 'cable' => 5, 'machine' => 10, 'band' => 0, 'bodyweight' => 5, 'cardio' => 0, 'stretch' => 0];
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
            ['dumbbell-bench-press', 'Dumbbell Bench Press', 'dumbbell', ['dumbbells', 'bench'], 'horizontal_push', ['chest'], ['triceps', 'shoulders'], 2, 'Lie on a flat bench with feet planted and dumbbells above your chest. Lower beside your chest with wrists above elbows and upper arms angled away from your ribs, then press back up without bouncing.'],
            ['one-arm-dumbbell-floor-press', 'One-Arm Dumbbell Floor Press', 'dumbbell', ['single_dumbbell'], 'horizontal_push', ['chest'], ['triceps', 'shoulders'], 4, 'Lie on the floor with knees bent. Press one dumbbell over your shoulder, then lower until your upper arm touches the floor. Count reps per side.'],
            ['machine-chest-press', 'Machine Chest Press', 'machine', ['chest_press'], 'horizontal_push', ['chest'], ['triceps', 'shoulders'], 3, 'Set the seat so the handles line up with mid-chest. Keep your back on the pad, press until your arms are almost straight, and return slowly without letting the stack touch down.'],
            ['smith-bench-press', 'Smith Machine Bench Press', 'machine', ['smith', 'bench'], 'horizontal_push', ['chest'], ['triceps', 'shoulders'], 4, 'Slide the bench so the bar tracks to mid-chest. Unhook, lower under control until the bar grazes your shirt, and press up without flaring your elbows wide.'],
            ['chest-dip', 'Chest Dip', 'bodyweight', ['dip_bars'], 'horizontal_push', ['chest'], ['triceps', 'shoulders'], 5, 'Support yourself on the dip bars with arms straight and lean forward slightly. Bend your elbows to lower until your upper arms are about parallel to the floor, or stop sooner if your shoulders feel strained, then press up.'],
            ['push-up', 'Push-Up', 'bodyweight', [], 'horizontal_push', ['chest'], ['triceps', 'shoulders', 'abs'], 6, 'Hands just outside shoulder width, body in one line from heels to head. Lower your chest to a fist above the floor and push the ground away. Squeeze your glutes so your hips do not sag.'],

            // Incline press
            ['incline-dumbbell-press', 'Incline Dumbbell Press', 'dumbbell', ['dumbbells', 'incline_bench'], 'incline_push', ['chest'], ['shoulders', 'triceps'], 1, 'Lie on a bench set around 30 degrees with feet planted and dumbbells above your upper chest. Lower beside your chest with wrists above elbows, then press up without lifting your shoulders off the bench.'],
            ['incline-barbell-press', 'Incline Barbell Press', 'barbell', ['barbell', 'incline_bench', 'rack'], 'incline_push', ['chest'], ['shoulders', 'triceps'], 2, 'With the bench at about 30 degrees, lower the bar to just under your collarbones. Keep your chest lifted and press straight up over your shoulders.'],
            ['smith-incline-press', 'Smith Machine Incline Press', 'machine', ['smith', 'incline_bench'], 'incline_push', ['chest'], ['shoulders', 'triceps'], 3, 'Position the incline bench so the bar meets your upper chest. Lower slowly, pause lightly, and press without locking out hard.'],
            ['feet-elevated-push-up', 'Feet-Elevated Push-Up', 'bodyweight', ['step_box'], 'incline_push', ['chest'], ['shoulders', 'triceps', 'abs'], 5, 'Place your feet on a stable step or bench and hands slightly wider than your shoulders on the floor. Keep your body straight as you bend your elbows to lower your chest toward the floor, then press up.'],

            // Chest fly
            ['cable-fly', 'Cable Fly', 'cable', ['cable'], 'chest_fly', ['chest'], ['shoulders'], 1, 'Set both pulleys at shoulder height and step forward into a split stance. With a soft bend in your elbows, sweep your hands together in front of your chest and let them open slowly.'],
            ['pec-deck', 'Pec Deck Fly', 'machine', ['pec_deck'], 'chest_fly', ['chest'], ['shoulders'], 2, 'Adjust the seat so your hands are level with your chest. Bring the handles together by squeezing your chest, not by rounding your shoulders forward, then open until you feel a stretch.'],
            ['dumbbell-fly', 'Dumbbell Fly', 'dumbbell', ['dumbbells', 'bench'], 'chest_fly', ['chest'], ['shoulders'], 3, 'Lie back with the dumbbells over your chest and elbows slightly bent. Open your arms in a wide arc until your chest stretches, then hug them back up along the same path.'],
            ['band-fly', 'Band Fly', 'band', ['bands'], 'chest_fly', ['chest'], ['shoulders'], 4, 'Secure the band behind you at chest height and step forward until it is taut. Keep a slight bend in your elbows as you bring your hands together in front of your chest, then slowly open your arms again.'],

            // Overhead press
            ['overhead-press', 'Barbell Overhead Press', 'barbell', ['barbell', 'rack'], 'vertical_push', ['shoulders'], ['triceps', 'abs'], 1, 'Hold the bar at your upper chest with hands just outside shoulder width. Tighten your stomach and buttocks, move your head back to let the bar pass, and press overhead without leaning back; lower to your upper chest.'],
            ['seated-dumbbell-press', 'Seated Dumbbell Shoulder Press', 'dumbbell', ['dumbbells', 'incline_bench'], 'vertical_push', ['shoulders'], ['triceps'], 2, 'Sit against a nearly upright bench with feet planted and dumbbells beside your shoulders, palms forward. Press overhead without arching your back, then lower slowly to the starting position.'],
            ['standing-dumbbell-press', 'Standing Dumbbell Press', 'dumbbell', ['dumbbells'], 'vertical_push', ['shoulders'], ['triceps', 'abs'], 3, 'Stand tall with your ribs down. Press both dumbbells overhead without leaning back, and lower them to shoulder height under control.'],
            ['machine-shoulder-press', 'Machine Shoulder Press', 'machine', ['shoulder_press'], 'vertical_push', ['shoulders'], ['triceps'], 4, 'Set the seat so the handles start at about ear height. Press up without arching off the pad and lower until your elbows are just below your shoulders.'],
            ['kettlebell-press', 'Kettlebell Press', 'kettlebell', ['kettlebells'], 'vertical_push', ['shoulders'], ['triceps', 'abs'], 5, 'Stand holding a kettlebell at one shoulder with the bell against your forearm and wrist straight. Press overhead without leaning back, then lower to your shoulder; repeat on the other side.'],
            ['pike-push-up', 'Pike Push-Up', 'bodyweight', [], 'vertical_push', ['shoulders'], ['triceps'], 6, 'Start in a push-up position and walk your feet in until your hips are high. Bend your elbows to lower the top of your head toward the floor ahead of your hands, then press back up.'],

            // Lateral raise
            ['dumbbell-lateral-raise', 'Dumbbell Lateral Raise', 'dumbbell', ['single_dumbbell'], 'lateral_raise', ['shoulders'], [], 1, 'Lean forward slightly and raise the dumbbell out to your side until it reaches shoulder height. Lead with your elbow, lower slowly, and repeat on the other side.'],
            ['cable-lateral-raise', 'Cable Lateral Raise', 'cable', ['cable'], 'lateral_raise', ['shoulders'], [], 2, 'Stand side-on to a low pulley and hold the handle in the hand farther from the machine. With a slight elbow bend, raise that arm sideways to shoulder height, then lower slowly; repeat on the other side.'],
            ['band-lateral-raise', 'Band Lateral Raise', 'band', ['bands'], 'lateral_raise', ['shoulders'], [], 3, 'Stand on the middle of the band and hold an end in each hand. Raise your arms out to shoulder height with a slight elbow bend and lower with control.'],

            // Triceps
            ['cable-pushdown', 'Cable Triceps Pushdown', 'cable', ['cable'], 'triceps', ['triceps'], [], 1, 'Face a high pulley and hold the handle with elbows beside your ribs. Keep your upper arms still as you straighten your elbows to push down, then slowly bend them to return.'],
            ['skull-crusher', 'EZ-Bar Skull Crusher', 'barbell', ['ez_bar', 'bench'], 'triceps', ['triceps'], [], 2, 'Lie on a bench holding the EZ bar above your chest with a close overhand grip. Keep your upper arms steady as you bend your elbows to lower the bar just behind your head, then straighten your arms.'],
            ['overhead-dumbbell-extension', 'Overhead Dumbbell Extension', 'dumbbell', ['single_dumbbell'], 'triceps', ['triceps'], [], 3, 'Hold one dumbbell with both hands overhead. Keep your elbows pointing forward as you lower it behind your head, then straighten your arms fully.'],
            ['close-grip-bench-press', 'Close-Grip Bench Press', 'barbell', ['barbell', 'bench', 'rack'], 'triceps', ['triceps'], ['chest', 'shoulders'], 4, 'Lie on the bench with feet planted and hold the bar above your chest using a shoulder-width overhand grip. Lower to your lower chest with elbows close to your sides, then press up without lifting your shoulders.'],
            ['band-pushdown', 'Band Pushdown', 'band', ['bands'], 'triceps', ['triceps'], [], 5, 'Anchor the band overhead. With elbows fixed at your sides, press your hands down until your arms are straight and pause before letting them rise.'],
            ['bench-dip', 'Bench Dip', 'bodyweight', ['bench'], 'triceps', ['triceps'], ['shoulders', 'chest'], 6, 'Hands on the bench edge beside your hips, legs out in front. Lower until your elbows reach roughly 90 degrees, keeping your back close to the bench, then press up.'],
            ['diamond-push-up', 'Diamond Push-Up', 'bodyweight', [], 'triceps', ['triceps'], ['chest', 'shoulders'], 7, 'Start in a push-up position with hands close together beneath your chest and body straight. Bend your elbows back close to your sides to lower your chest, then press up without letting your hips sag.'],

            // Vertical pull
            ['prone-pulldown', 'Prone Bodyweight Pulldown', 'bodyweight', [], 'vertical_pull', ['lats', 'upper_back'], ['shoulders'], 8, 'Lie face down and reach both arms overhead. Lift your hands slightly and draw your elbows toward your ribs, then reach forward again. Keep your neck relaxed.'],
            ['pull-up', 'Pull-Up', 'bodyweight', ['pullup_bar'], 'vertical_pull', ['lats'], ['biceps', 'upper_back'], 1, 'Hang with an overhand grip a little wider than your shoulders. Pull your elbows down toward your back pockets until your chin clears the bar, then lower all the way.'],
            ['lat-pulldown', 'Lat Pulldown', 'machine', ['lat_pulldown'], 'vertical_pull', ['lats'], ['biceps', 'upper_back'], 2, 'Lock your thighs under the pad and lean back slightly. Pull the bar to your upper chest by driving your elbows down, and let it rise until your arms are long.'],
            ['chin-up', 'Chin-Up', 'bodyweight', ['pullup_bar'], 'vertical_pull', ['lats'], ['biceps'], 3, 'Take a shoulder-width underhand grip. Pull your chest toward the bar while keeping your shoulders away from your ears, and lower to a full hang.'],
            ['assisted-pull-up', 'Assisted Pull-Up', 'machine', ['assisted_pullup'], 'vertical_pull', ['lats'], ['biceps', 'upper_back'], 4, 'Grip the overhead handles and place your knees or feet on the assistance platform as the machine directs. Pull until your chin clears the handles without swinging, then lower slowly until your arms straighten; more assistance makes it easier.'],
            ['band-pulldown', 'Band Pulldown', 'band', ['bands'], 'vertical_pull', ['lats'], ['biceps'], 5, 'Secure the band overhead and kneel facing the anchor with arms reaching up. Pull your hands toward your shoulders with elbows moving down beside your ribs, then slowly extend your arms again.'],

            // Row
            ['barbell-row', 'Barbell Row', 'barbell', ['barbell'], 'horizontal_pull', ['upper_back', 'lats'], ['biceps', 'lower_back'], 1, 'Hinge until your torso is close to parallel with the floor and keep your back flat. Pull the bar to your lower ribs, pause, and lower it without standing up.'],
            ['one-arm-dumbbell-row', 'One-Arm Dumbbell Row', 'dumbbell', ['single_dumbbell', 'bench'], 'horizontal_pull', ['lats', 'upper_back'], ['biceps'], 2, 'Support one hand and knee on a bench, with the other foot on the floor and a dumbbell hanging from your free hand. Pull toward your hip without twisting your torso, then lower until your arm straightens; repeat on the other side.'],
            ['one-arm-unsupported-dumbbell-row', 'One-Arm Dumbbell Row (No Bench)', 'dumbbell', ['single_dumbbell'], 'horizontal_pull', ['lats', 'upper_back'], ['biceps'], 5, 'Stagger your feet, hinge forward, and brace your free hand on your front thigh. Row the dumbbell toward your hip without twisting. Count reps per side.'],
            ['seated-cable-row', 'Seated Cable Row', 'machine', ['seated_row'], 'horizontal_pull', ['upper_back', 'lats'], ['biceps'], 3, 'Sit tall with knees slightly bent. Pull the handle to your navel while squeezing your shoulder blades together, then reach forward without rounding your lower back.'],
            ['chest-supported-row', 'Chest-Supported Dumbbell Row', 'dumbbell', ['dumbbells', 'incline_bench'], 'horizontal_pull', ['upper_back', 'lats'], ['biceps'], 4, 'Lie chest-down on an incline bench. Row both dumbbells toward your hips, hold the squeeze, and lower until your arms hang straight.'],
            ['standing-cable-row', 'Standing Cable Row', 'cable', ['cable'], 'horizontal_pull', ['upper_back', 'lats'], ['biceps'], 5, 'Set a pulley at waist height and face it in a staggered stance, holding the handle in one hand. Pull to your side without twisting or leaning back, then slowly straighten your arm; repeat on the other side.'],
            ['inverted-row', 'Inverted Row', 'bodyweight', ['barbell', 'rack'], 'horizontal_pull', ['upper_back', 'lats'], ['biceps', 'abs'], 6, 'Secure a bar in a rack so it cannot roll or lift out, then lie underneath and grip it slightly wider than your shoulders. With heels on the floor and body straight, pull your chest toward the bar, then lower until your arms straighten.'],
            ['kettlebell-row', 'Kettlebell Row', 'kettlebell', ['kettlebells'], 'horizontal_pull', ['lats', 'upper_back'], ['biceps'], 7, 'Stagger your feet and bend forward at the hips, supporting your free hand on your front thigh. Pull the kettlebell toward your hip without twisting, then lower slowly; repeat on the other side.'],
            ['band-row', 'Band Row', 'band', ['bands'], 'horizontal_pull', ['upper_back', 'lats'], ['biceps'], 8, 'Secure the band at chest height and hold its ends with arms reaching forward. Pull your hands toward your ribs without leaning back, then slowly straighten your arms while keeping tension on the band.'],

            // Rear delts
            ['face-pull', 'Face Pull', 'cable', ['cable'], 'rear_delt', ['upper_back'], ['shoulders'], 1, 'Set a rope at eye level. Pull it toward your forehead while spreading your hands apart, finishing with your elbows high and knuckles pointing back.'],
            ['reverse-pec-deck', 'Reverse Pec Deck', 'machine', ['pec_deck'], 'rear_delt', ['upper_back'], ['shoulders'], 2, 'Face the pad and hold the handles with arms nearly straight. Sweep them back in a wide arc until they line up with your shoulders, then return slowly.'],
            ['bent-over-reverse-fly', 'Bent-Over Reverse Fly', 'dumbbell', ['dumbbells'], 'rear_delt', ['upper_back'], ['shoulders'], 3, 'Bend forward at your hips with knees slightly bent, back steady, and dumbbells hanging below your chest. With elbows slightly bent, raise your arms out to the sides to about shoulder level, then lower slowly.'],
            ['band-pull-apart', 'Band Pull-Apart', 'band', ['bands'], 'rear_delt', ['upper_back'], ['shoulders'], 4, 'Hold the band at chest height with straight arms. Pull it apart until it touches your chest and control it back in.'],

            // Biceps
            ['ez-bar-curl', 'EZ-Bar Curl', 'barbell', ['ez_bar'], 'biceps', ['biceps'], ['forearms'], 1, 'Stand holding the angled parts of the EZ bar with palms facing up and elbows beside your ribs. Curl toward your shoulders without swinging, then slowly straighten your elbows.'],
            ['barbell-curl', 'Barbell Curl', 'barbell', ['barbell'], 'biceps', ['biceps'], ['forearms'], 2, 'Grip the bar at shoulder width with palms up. Keep your elbows still and your torso upright as you curl, and take the lowering slowly.'],
            ['dumbbell-curl', 'Dumbbell Curl', 'dumbbell', ['single_dumbbell'], 'biceps', ['biceps'], ['forearms'], 3, 'Stand with one dumbbell beside your thigh, palm facing inward. Keep your upper arm beside your ribs as you curl toward your shoulder and turn your palm upward, then lower slowly; repeat on the other side.'],
            ['hammer-curl', 'Hammer Curl', 'dumbbell', ['single_dumbbell'], 'biceps', ['biceps', 'forearms'], [], 4, 'Stand with one dumbbell beside your thigh, palm facing inward. Keep that grip and your upper arm still as you curl toward your shoulder, then lower slowly; repeat on the other side.'],
            ['cable-curl', 'Cable Curl', 'cable', ['cable'], 'biceps', ['biceps'], ['forearms'], 4, 'Stand facing a low pulley with a straight bar. Curl to your chest with elbows pinned at your sides and resist the cable on the way down.'],
            ['incline-dumbbell-curl', 'Incline Dumbbell Curl', 'dumbbell', ['single_dumbbell', 'incline_bench'], 'biceps', ['biceps'], ['forearms'], 5, 'Sit back against a bench set to 45–60 degrees with one dumbbell hanging at your side, palm forward. Keep your upper arm still as you curl toward your shoulder, then lower slowly; repeat on the other side.'],
            ['band-curl', 'Band Curl', 'band', ['bands'], 'biceps', ['biceps'], ['forearms'], 6, 'Stand on the band and hold the ends palms-up. Curl to your shoulders and lower slowly against the tension.'],

            // Squat
            ['back-squat', 'Barbell Back Squat', 'barbell', ['barbell', 'rack'], 'squat', ['quads', 'glutes'], ['hamstrings', 'lower_back', 'abs'], 1, 'Set the bar across your upper back, not your neck, and stand with feet about shoulder-width apart. Tighten your stomach and bend your hips and knees to squat as low as you can control with heels down and knees following your toes, then stand.'],
            ['leg-press', 'Leg Press', 'machine', ['leg_press'], 'squat', ['quads', 'glutes'], ['hamstrings'], 2, 'Sit with your back and hips against the pad and feet shoulder-width apart on the platform. Lower only as far as you can keep your heels planted and hips on the pad, then press away without snapping your knees straight.'],
            ['goblet-squat', 'Dumbbell Goblet Squat', 'dumbbell', ['single_dumbbell'], 'squat', ['quads', 'glutes'], ['abs'], 3, 'Stand with feet about shoulder-width apart, holding one dumbbell upright against your chest. Bend your hips and knees to squat as low as you can control with heels down and knees following your toes, then stand.'],
            ['hack-squat', 'Hack Squat', 'machine', ['hack_squat'], 'squat', ['quads'], ['glutes'], 3, 'Set your feet a little forward on the platform and keep your back flat on the pad. Lower as deep as you can control and push up through your whole foot.'],
            ['front-squat', 'Barbell Front Squat', 'barbell', ['barbell', 'rack'], 'squat', ['quads'], ['glutes', 'abs', 'upper_back'], 4, 'Rest the bar across the front of your shoulders with elbows pointing forward and feet about shoulder-width apart. Keep your chest lifted as you bend your hips and knees into a controlled squat, then stand without letting your elbows drop.'],
            ['kettlebell-goblet-squat', 'Kettlebell Goblet Squat', 'kettlebell', ['kettlebells'], 'squat', ['quads', 'glutes'], ['abs'], 4, 'Hold the kettlebell by the horns at your chest. Squat down between your knees with your chest tall, then stand all the way up.'],
            ['smith-squat', 'Smith Machine Squat', 'machine', ['smith'], 'squat', ['quads', 'glutes'], ['hamstrings'], 5, 'Position the bar across your upper back, set the safety stops, and place your feet slightly forward. Unhook the bar and squat to a controlled depth with heels planted, then stand and rehook the bar when finished.'],
            ['bodyweight-squat', 'Bodyweight Squat', 'bodyweight', [], 'squat', ['quads', 'glutes'], ['hamstrings'], 8, 'Stand with feet about shoulder-width apart and arms forward for balance. Bend your hips and knees to squat as low as you can control with heels planted and knees following your toes, then stand tall.'],

            // Hinge
            ['romanian-deadlift', 'Barbell Romanian Deadlift', 'barbell', ['barbell'], 'hinge', ['hamstrings', 'glutes'], ['lower_back', 'forearms'], 1, 'Start standing with the bar at your hips. Push your hips back with soft knees and slide the bar down your thighs until your hamstrings stretch, then stand by squeezing your glutes.'],
            ['deadlift', 'Barbell Deadlift', 'barbell', ['barbell'], 'hinge', ['hamstrings', 'glutes', 'lower_back'], ['quads', 'upper_back', 'forearms'], 2, 'Stand with the bar over the middle of your feet and grip it just outside your legs. Tighten your stomach, keep your back steady, and push through your feet to stand with the bar close to your legs; bend your hips and knees to lower it to the floor.'],
            ['dumbbell-rdl', 'Dumbbell Romanian Deadlift', 'dumbbell', ['dumbbells'], 'hinge', ['hamstrings', 'glutes'], ['lower_back'], 3, 'Stand with dumbbells in front of your thighs and knees slightly bent. Push your hips back, keeping the weights close to your legs, until your hamstrings stretch without rounding your back, then stand tall.'],
            ['kettlebell-swing', 'Kettlebell Swing', 'kettlebell', ['kettlebells'], 'hinge', ['glutes', 'hamstrings'], ['lower_back', 'abs'], 4, 'Start with the kettlebell on the floor just ahead of you, then bend at your hips and pull it back between your legs. Drive your hips forward to swing it to about chest height with relaxed arms, then bend at your hips as it swings back; do not lift it with your shoulders.'],
            ['back-extension', 'Back Extension', 'bodyweight', ['back_extension'], 'hinge', ['lower_back', 'glutes'], ['hamstrings'], 5, 'Set the pad just below your hip crease. Lower your torso with a straight back and rise until your body forms a line, squeezing your glutes at the top.'],
            ['cable-pull-through', 'Cable Pull-Through', 'cable', ['cable'], 'hinge', ['glutes', 'hamstrings'], ['lower_back'], 6, 'Face away from a low pulley with the rope between your legs. Hinge back, then drive your hips forward to stand tall without leaning back.'],
            ['single-leg-rdl', 'Single-Leg Romanian Deadlift', 'bodyweight', [], 'hinge', ['hamstrings', 'glutes'], ['lower_back'], 7, 'Balance on one leg with a soft knee. Tip forward as your free leg reaches behind you, keeping hips level, then return to standing. Count reps per side.'],

            // Single-leg
            ['dumbbell-reverse-lunge', 'Dumbbell Reverse Lunge', 'dumbbell', ['single_dumbbell'], 'lunge', ['quads', 'glutes'], ['hamstrings'], 1, 'Stand holding one dumbbell at your side and step one foot back. Bend both knees to lower your back knee toward the floor, then push through your front foot to stand; repeat on the other side.'],
            ['bulgarian-split-squat', 'Bulgarian Split Squat', 'dumbbell', ['dumbbells', 'bench'], 'lunge', ['quads', 'glutes'], ['hamstrings'], 2, 'Hold a dumbbell in each hand with your back foot resting on a bench and front foot far enough forward to balance. Bend both knees to lower your back knee toward the floor, then push through your whole front foot to rise; repeat on the other side.'],
            ['barbell-lunge', 'Barbell Reverse Lunge', 'barbell', ['barbell', 'rack'], 'lunge', ['quads', 'glutes'], ['hamstrings', 'abs'], 3, 'With the bar on your upper back, step one leg back and lower until the knee hovers above the floor. Drive through the front foot to stand. Count reps per side.'],
            ['dumbbell-step-up', 'Dumbbell Step-Up', 'dumbbell', ['single_dumbbell', 'step_box'], 'lunge', ['quads', 'glutes'], [], 4, 'Hold a dumbbell and plant your whole foot on a stable step, box or bench. Stand up using the top leg only, without pushing off the floor, and lower yourself slowly. Count reps per side.'],
            ['bodyweight-step-up', 'Bodyweight Step-Up', 'bodyweight', ['step_box'], 'lunge', ['quads', 'glutes'], [], 5, 'Plant your whole foot on a stable step, box or bench. Stand up using the top leg and lower slowly. Count reps per side.'],
            ['reverse-lunge', 'Bodyweight Reverse Lunge', 'bodyweight', [], 'lunge', ['quads', 'glutes'], ['hamstrings'], 6, 'Step back and lower until both knees are bent to about 90 degrees. Keep your torso tall and push through the front foot to return. Count reps per side.'],

            // Hip thrust
            ['barbell-hip-thrust', 'Barbell Hip Thrust', 'barbell', ['barbell', 'bench'], 'hip_thrust', ['glutes'], ['hamstrings'], 1, 'Sit on the floor with your upper back against a stable bench, knees bent, and a padded bar across your hips. Push through your feet to lift your hips until shoulders, hips, and knees line up without arching your lower back, then lower slowly.'],
            ['dumbbell-hip-thrust', 'Dumbbell Hip Thrust', 'dumbbell', ['single_dumbbell', 'bench'], 'hip_thrust', ['glutes'], ['hamstrings'], 2, 'Rest one dumbbell on your hips with your shoulders on the bench. Lift your hips until your thighs are level with your torso and squeeze before lowering.'],
            ['glute-bridge', 'Glute Bridge', 'bodyweight', [], 'hip_thrust', ['glutes'], ['hamstrings'], 3, 'Lie on your back with knees bent and feet flat. Press through your heels to lift your hips into a straight line from knees to shoulders, and hold for a second.'],

            // Leg curl
            ['leg-curl', 'Leg Curl', 'machine', ['leg_curl'], 'knee_flexion', ['hamstrings'], ['calves'], 1, 'Adjust the machine so your knees line up with its pivot and the moving pad sits just above your heels. Bend your knees to curl the pad toward your buttocks without lifting your hips, then slowly straighten your legs.'],
            ['band-leg-curl', 'Band Leg Curl', 'band', ['bands'], 'knee_flexion', ['hamstrings'], [], 3, 'Anchor the band low and loop it around your ankles while lying face down. Curl your heels to your glutes and return slowly.'],

            // Leg extension
            ['leg-extension', 'Leg Extension', 'machine', ['leg_extension'], 'knee_extension', ['quads'], [], 1, 'Set the pad just above your ankles and your knees at the pivot. Straighten your legs fully, hold briefly, and lower with control.'],

            // Calves
            ['machine-calf-raise', 'Machine Calf Raise', 'machine', ['calf_raise'], 'calf', ['calves'], [], 1, 'Position your shoulders under the pads and the balls of your feet on the platform with heels free to move. Rise onto the balls of your feet, then lower your heels into a comfortable stretch without bouncing.'],
            ['dumbbell-calf-raise', 'Dumbbell Calf Raise', 'dumbbell', ['dumbbells'], 'calf', ['calves'], [], 2, 'Hold a dumbbell in each hand and stand on a step or plate if you have one. Rise onto your toes, pause at the top, and lower slowly.'],
            ['leg-press-calf-raise', 'Leg Press Calf Raise', 'machine', ['leg_press'], 'calf', ['calves'], [], 3, 'Use only a leg press designed for calf raises, with its safety stops set. Place the balls of your feet securely on the platform edge and keep your knees nearly straight; raise and lower your heels slowly without letting your feet slip.'],
            ['single-leg-calf-raise', 'Single-Leg Calf Raise', 'bodyweight', ['step_box'], 'calf', ['calves'], [], 4, 'Stand on one foot on a step, holding something for balance. Drop your heel below the step, then rise all the way up. Count reps per side.'],
            ['standing-bodyweight-calf-raise', 'Standing Bodyweight Calf Raise', 'bodyweight', [], 'calf', ['calves'], [], 7, 'Stand on the floor with feet hip-width apart. Rise onto your toes, pause, and slowly lower your heels to the floor.'],

            // Core
            ['hanging-leg-raise', 'Hanging Leg Raise', 'bodyweight', ['pullup_bar'], 'core', ['abs'], ['forearms'], 1, 'Hang from a secure bar with legs straight and body still. Raise your legs in front of you while gently curling your hips upward, then lower without swinging.'],
            ['cable-crunch', 'Cable Crunch', 'cable', ['cable'], 'core', ['abs'], [], 2, 'Kneel below a high pulley holding the rope beside your head. Curl your ribs toward your hips, rounding your back, without sitting back onto your heels.'],
            ['lying-leg-raise', 'Lying Leg Raise', 'bodyweight', [], 'core', ['abs'], [], 3, 'Lie flat and press your lower back into the floor. Raise straight legs to vertical and lower them only as far as your back stays down.'],
            ['crunch', 'Crunch', 'bodyweight', [], 'core', ['abs'], [], 4, 'Lie with knees bent and hands by your temples. Curl your shoulder blades off the floor by bringing your ribs toward your hips, and lower slowly.'],
            ['dead-bug', 'Dead Bug', 'bodyweight', [], 'core', ['abs'], [], 5, 'Lie on your back with arms pointing up, knees bent to 90 degrees, and knees above your hips. Slowly reach one arm overhead and extend the opposite leg while keeping your lower back against the floor, then return and switch sides.'],

            // Cardio warm-ups (#18). Logged as time, with optional distance and level.
            // They list no muscles, so they never count toward volume or recovery,
            // and the "cardio" pattern is only used for the warm-up, never the main workout.
            ['stationary-bike', 'Stationary Bike', 'cardio', ['stationary_bike'], 'cardio', [], [], 1, 'Set the seat so your knee is slightly bent at the bottom of the pedal stroke. Start easy and build to a pace where you can still talk in short sentences.'],
            ['elliptical', 'Elliptical', 'cardio', ['elliptical'], 'cardio', [], [], 2, 'Stand tall with your weight through your whole foot and hold the handles lightly. Start easy and build to a steady, comfortable effort.'],
            ['treadmill', 'Treadmill', 'cardio', ['treadmill'], 'cardio', [], [], 3, 'Start with a brisk walk, then raise the speed or incline until you are breathing harder but can still talk. Avoid holding the rails.'],
            ['rowing-machine', 'Rowing Machine', 'cardio', ['rowing_machine'], 'cardio', [], [], 4, 'Sit with feet secured, knees bent, arms straight, and back steady. Push with your legs, lean back slightly, then pull the handle to your lower ribs; return by straightening your arms, leaning forward, then bending your knees.'],
            ['stair-climber', 'Stair Climber', 'cardio', ['stair_climber'], 'cardio', [], [], 5, 'Step with your whole foot and stand tall without leaning on the rails. Start slow and build to a steady pace.'],

            // Stretches (#138): no equipment, logged as seconds per hold. Dynamic ones
            // follow the cardio warm-up; static ones are the cooldown. Their muscles
            // pick which ones suit the workout; they never count toward recovery.
            ['arm-circles', 'Arm Circles', 'stretch', [], 'dynamic_stretch', ['shoulders'], ['chest', 'upper_back'], 1, 'Stand tall with arms out to the sides. Draw small circles and let them grow bigger, then reverse direction halfway through.'],
            ['leg-swings', 'Leg Swings', 'stretch', [], 'dynamic_stretch', ['hamstrings', 'glutes'], ['quads'], 1, 'Hold a wall or rack for balance and swing one leg forward and back with a slight knee bend. Keep your torso still and use a comfortable range rather than forcing the swing; repeat on the other side.'],
            ['worlds-greatest-stretch', "World's Greatest Stretch", 'stretch', [], 'dynamic_stretch', ['glutes', 'hamstrings', 'upper_back'], ['quads', 'shoulders'], 2, 'Step into a long lunge and put both hands inside your front foot. Drop your back knee if needed, rotate your inside arm toward the ceiling, then return and repeat slowly. Then switch sides.'],
            ['cat-cow', 'Cat-Cow', 'stretch', [], 'dynamic_stretch', ['lower_back', 'upper_back'], ['abs'], 2, 'On hands and knees, round your back toward the ceiling, then let your belly drop and lift your chest. Move slowly with your breath.'],
            ['inchworm', 'Inchworm', 'stretch', [], 'dynamic_stretch', ['hamstrings', 'shoulders'], ['chest', 'abs'], 3, 'From standing, fold forward and walk your hands out to a push-up position, then walk your feet up to your hands. Keep your knees as straight as is comfortable.'],
            ['torso-twists', 'Torso Twists', 'stretch', [], 'dynamic_stretch', ['abs', 'lower_back'], [], 3, 'Stand with feet hip-width apart and arms relaxed. Rotate your shoulders side to side and let your arms swing, keeping your hips mostly still.'],
            ['walking-knee-hug', 'Walking Knee Hug', 'stretch', [], 'dynamic_stretch', ['glutes'], ['hamstrings'], 3, 'Stand tall and bring one knee toward your chest, gently holding it with both hands. Release, step forward, and repeat with the other leg, keeping your balance throughout.'],
            ['doorway-chest-stretch', 'Doorway Chest Stretch', 'stretch', [], 'static_stretch', ['chest'], ['shoulders'], 1, 'Put your forearm on a door frame or upright with your elbow at shoulder height. Step through until you feel a stretch across your chest. Then switch sides.'],
            ['cross-body-shoulder-stretch', 'Cross-Body Shoulder Stretch', 'stretch', [], 'static_stretch', ['shoulders'], ['upper_back'], 1, 'Bring one straight arm across your chest and hug it in with the other arm, keeping the shoulder down. Then switch sides.'],
            ['overhead-triceps-stretch', 'Overhead Triceps Stretch', 'stretch', [], 'static_stretch', ['triceps'], ['lats'], 1, 'Reach one arm overhead and bend its elbow so your hand rests behind your upper back. Use your other hand to gently guide the elbow back until you feel a mild stretch, then hold without bouncing; switch sides.'],
            ['wall-biceps-stretch', 'Wall Biceps Stretch', 'stretch', [], 'static_stretch', ['biceps', 'forearms'], ['chest'], 2, 'Place your palm on a wall behind you at shoulder height, arm straight. Turn your body away until you feel the front of the arm stretch. Then switch sides.'],
            ['childs-pose', "Child's Pose", 'stretch', [], 'static_stretch', ['lats', 'lower_back'], ['upper_back', 'shoulders'], 1, 'Kneel and sit back toward your heels, then walk your hands forward and rest your chest toward the floor. Breathe slowly into your back.'],
            ['standing-quad-stretch', 'Standing Quad Stretch', 'stretch', [], 'static_stretch', ['quads'], [], 1, 'Stand tall, hold something for balance, and pull one heel toward your glutes with your knees together. Then switch legs.'],
            ['kneeling-hip-flexor-stretch', 'Kneeling Hip Flexor Stretch', 'stretch', [], 'static_stretch', ['quads'], ['glutes', 'abs'], 2, 'Kneel on one knee with the other foot in front. Squeeze the back glute and shift your hips forward until the front of the back hip stretches. Then switch sides.'],
            ['seated-hamstring-stretch', 'Seated Hamstring Stretch', 'stretch', [], 'static_stretch', ['hamstrings'], ['lower_back', 'calves'], 1, 'Sit with one leg straight and the other foot against its inner thigh. Hinge forward from your hips toward the straight leg with a long back. Then switch legs.'],
            ['figure-four-glute-stretch', 'Figure-Four Glute Stretch', 'stretch', [], 'static_stretch', ['glutes'], ['lower_back'], 1, 'Lie on your back and cross one ankle over the opposite knee. Pull the bottom thigh toward your chest until you feel it in the crossed hip. Then switch sides.'],
            ['wall-calf-stretch', 'Wall Calf Stretch', 'stretch', [], 'static_stretch', ['calves'], [], 1, 'Hands on a wall, step one foot back with the heel down and the knee straight. Lean in until you feel the calf stretch. Then switch legs.'],
            ['cobra-stretch', 'Cobra Stretch', 'stretch', [], 'static_stretch', ['abs'], ['lower_back'], 2, 'Lie face down with palms beside your chest and elbows close to your sides. Gently lift your chest using your back and only as much hand pressure as needed, keeping hips down and stopping before your lower back feels compressed.'],

            // Added so a first Fitbod import matches most exercises (#65). Priority 9
            // keeps the generator preferring the exercises above; "other" ones are
            // never suggested automatically.
            ['cable-rope-triceps-extension', 'Cable Rope Triceps Extension', 'cable', ['cable'], 'triceps', ['triceps'], [], 9, 'Hold the rope on a high pulley with elbows pinned to your sides. Push down and spread the rope ends apart at the bottom, then let your forearms rise to just past level.'],
            ['dumbbell-front-raise', 'Dumbbell Front Raise', 'dumbbell', ['single_dumbbell'], 'other', ['shoulders'], ['chest'], 9, 'Stand holding one dumbbell in front of your thigh, palm facing you. With a slight elbow bend, raise it forward to shoulder height without leaning back, then lower slowly; repeat on the other side.'],
            ['dumbbell-pullover', 'Dumbbell Pullover', 'dumbbell', ['single_dumbbell', 'bench'], 'other', ['lats'], ['chest'], 9, 'Lie across or along the bench holding one dumbbell over your chest with both hands. Lower it behind your head in an arc with a slight elbow bend until your lats stretch, then pull it back over.'],
            ['dumbbell-side-bend', 'Dumbbell Side Bend', 'dumbbell', ['single_dumbbell'], 'core', ['abs'], [], 9, 'Stand tall holding a dumbbell at your side. Bend sideways toward it without leaning forward, then pull yourself upright using the opposite side. Count reps per side.'],
            ['reverse-grip-barbell-curl', 'Reverse-Grip Barbell Curl', 'barbell', ['barbell'], 'biceps', ['forearms', 'biceps'], [], 9, 'Hold the bar with palms facing down at shoulder width. Curl it up with elbows fixed at your sides and lower slowly. Use less weight than a normal curl.'],
            ['concentration-curl', 'Concentration Curl', 'dumbbell', ['single_dumbbell', 'bench'], 'biceps', ['biceps'], ['forearms'], 9, 'Sit on the bench and brace the back of your upper arm against your inner thigh. Curl the dumbbell toward your shoulder without moving your upper arm, then lower fully. Count reps per side.'],
            ['single-arm-overhead-dumbbell-extension', 'Single-Arm Overhead Dumbbell Extension', 'dumbbell', ['single_dumbbell'], 'triceps', ['triceps'], [], 9, 'Hold a dumbbell overhead in one hand with your elbow pointing up. Lower it behind your head by bending only at the elbow, then straighten your arm. Count reps per side.'],
            ['seated-barbell-shoulder-press', 'Seated Barbell Shoulder Press', 'barbell', ['barbell', 'incline_bench', 'rack'], 'vertical_push', ['shoulders'], ['triceps'], 9, 'Sit upright with the bar at your upper chest. Press it straight overhead, moving your head back as it passes, and lower to your collarbones under control.'],
            ['dumbbell-triceps-kickback', 'Dumbbell Triceps Kickback', 'dumbbell', ['single_dumbbell', 'bench'], 'triceps', ['triceps'], [], 9, 'Brace on the bench with your upper arm parallel to the floor. Straighten your arm back until it is fully extended, pause, and bend only at the elbow to return. Count reps per side.'],
            ['barbell-shrug', 'Barbell Shrug', 'barbell', ['barbell'], 'other', ['upper_back'], ['forearms'], 9, 'Hold the bar at your thighs with straight arms. Lift your shoulders straight up toward your ears, pause, and lower all the way without rolling them.'],
            ['reverse-grip-bench-press', 'Reverse-Grip Bench Press', 'barbell', ['barbell', 'bench', 'rack'], 'horizontal_push', ['chest'], ['triceps', 'shoulders'], 9, 'Take an underhand grip a little wider than shoulder width and use a spotter. Lower the bar to your lower chest with elbows tucked, then press up and slightly back.'],
            ['reverse-grip-barbell-row', 'Reverse-Grip Barbell Row', 'barbell', ['barbell'], 'horizontal_pull', ['upper_back', 'lats'], ['biceps'], 9, 'Hinge forward with a flat back and an underhand grip. Row the bar to your lower stomach, keeping your elbows close, and lower it without standing up.'],
            ['bodyweight-bulgarian-split-squat', 'Bodyweight Bulgarian Split Squat', 'bodyweight', ['bench'], 'lunge', ['quads', 'glutes'], ['hamstrings'], 9, 'Rest your back foot on a bench and place your front foot far enough forward to balance. Bend both knees to lower your back knee toward the floor, then push through your whole front foot to rise; repeat on the other side.'],
            ['alternating-medicine-ball-push-up', 'Alternating Medicine Ball Push-Up', 'bodyweight', ['medicine_ball'], 'other', ['chest'], ['triceps', 'shoulders', 'abs'], 9, 'Do a push-up with one hand on a medicine ball, then roll the ball to the other hand and repeat. Keep your body in one straight line.'],
            ['cross-body-hammer-curl', 'Cross-Body Hammer Curl', 'dumbbell', ['single_dumbbell'], 'biceps', ['biceps', 'forearms'], [], 9, 'With palms facing in, curl the dumbbell across your body toward the opposite shoulder. Keep your upper arm still and lower slowly. Do both sides.'],
            ['dumbbell-shrug', 'Dumbbell Shrug', 'dumbbell', ['dumbbells'], 'other', ['upper_back'], ['forearms'], 9, 'Hold a dumbbell in each hand at your sides. Raise your shoulders straight toward your ears, hold for a second, and lower fully.'],
            ['dumbbell-skull-crusher', 'Dumbbell Skull Crusher', 'dumbbell', ['dumbbells', 'bench'], 'triceps', ['triceps'], [], 9, 'Lie on the bench with the dumbbells over your shoulders, palms facing in. Bend only at the elbows to lower them beside your head, then straighten your arms.'],
            ['incline-dumbbell-fly', 'Incline Dumbbell Fly', 'dumbbell', ['dumbbells', 'incline_bench'], 'chest_fly', ['chest'], ['shoulders'], 9, 'Lie on a bench set around 30 degrees with dumbbells above your upper chest. Keep a slight bend in your elbows as you open your arms to a comfortable chest stretch, then bring the weights back together along the same arc.'],
            ['oblique-crunch', 'Oblique Crunch', 'bodyweight', [], 'core', ['abs'], [], 9, 'Lie on your back with knees bent and drop them to one side. Curl your shoulders up toward your hips, pause, and lower slowly. Count reps per side.'],
            ['zottman-curl', 'Zottman Curl', 'dumbbell', ['single_dumbbell'], 'biceps', ['biceps', 'forearms'], [], 9, 'Stand holding one dumbbell at your side with palm forward and upper arm still. Curl toward your shoulder, turn your palm down at the top, and lower slowly; turn your palm forward again and repeat, then switch sides.'],
            ['stiff-legged-good-morning', 'Stiff-Legged Good Morning', 'barbell', ['barbell', 'rack'], 'hinge', ['hamstrings', 'glutes'], ['lower_back'], 9, 'Rest the bar on your upper back with your knees almost straight. Push your hips back and tip forward with a flat back until your hamstrings stretch, then stand up.'],
            ['barbell-upright-row', 'Barbell Upright Row', 'barbell', ['barbell'], 'other', ['shoulders'], ['upper_back'], 9, 'Hold the bar with a shoulder-width grip. Pull it up along your body to mid-chest, leading with your elbows, and lower slowly. Stop lower if your shoulders pinch.'],
            ['calf-raise', 'Calf Raise', 'machine', ['calf_raise'], 'calf', ['calves'], [], 9, 'Stand with the balls of your feet on the platform and heels hanging off. Lower into a deep stretch, pause, and rise as high as you can.'],
            ['shotgun-row', 'Shotgun Row', 'cable', ['cable'], 'horizontal_pull', ['upper_back', 'lats'], ['biceps'], 9, 'Face a low pulley in a staggered stance with one arm reaching forward, palm down. Pull the handle toward your side while turning your palm upward, then slowly reach forward and reverse the turn; repeat on the other side.'],
            ['cable-upright-row', 'Cable Upright Row', 'cable', ['cable'], 'other', ['shoulders'], ['upper_back'], 9, 'Hold a straight bar on a low pulley. Pull it up to mid-chest with your elbows leading and higher than your hands, then lower with control.'],
            ['cable-rope-overhead-triceps-extension', 'Cable Rope Overhead Triceps Extension', 'cable', ['cable'], 'triceps', ['triceps'], [], 9, 'Attach a rope to a low pulley and face away, holding the ends behind your head with elbows pointing upward. Keep your upper arms still as you straighten your elbows overhead, then slowly bend them to return.'],
            ['dumbbell-bent-over-row', 'Dumbbell Bent-Over Row', 'dumbbell', ['dumbbells'], 'horizontal_pull', ['upper_back', 'lats'], ['biceps'], 9, 'Hinge forward with a flat back, a dumbbell in each hand. Row both to your hips, squeeze your shoulder blades, and lower until your arms are straight.'],
            ['cable-wood-chop', 'Cable Wood Chop', 'cable', ['cable'], 'core', ['abs'], ['shoulders'], 9, 'Stand side-on to a high pulley and hold the handle with both hands. Pull it down and across your body to the opposite hip by turning your torso, then return slowly. Count reps per side.'],
            ['smith-machine-stiff-legged-deadlift', 'Smith Machine Stiff-Legged Deadlift', 'machine', ['smith'], 'hinge', ['hamstrings', 'glutes'], ['lower_back'], 9, 'Stand close to the bar with knees nearly straight. Hinge at your hips and slide the bar down your legs until your hamstrings stretch, then stand by squeezing your glutes.'],
            ['dumbbell-lunge', 'Dumbbell Lunge', 'dumbbell', ['dumbbells'], 'lunge', ['quads', 'glutes'], ['hamstrings'], 9, 'Hold a dumbbell in each hand and step forward. Lower until both knees reach about 90 degrees, then push back to standing. Count reps per side.'],
            ['seated-dumbbell-curl', 'Seated Dumbbell Curl', 'dumbbell', ['dumbbells', 'bench'], 'biceps', ['biceps'], ['forearms'], 9, 'Sit upright at the end of the bench. Curl the dumbbells with palms up and elbows fixed at your sides, then lower all the way.'],
            ['low-to-high-cable-fly', 'Low-to-High Cable Fly', 'cable', ['cable'], 'chest_fly', ['chest'], ['shoulders'], 9, 'Set both pulleys low. With a soft bend in your elbows, sweep your hands up and together in front of your upper chest, then lower them slowly.'],
            ['palms-down-dumbbell-wrist-curl', 'Palms-Down Dumbbell Wrist Curl', 'dumbbell', ['single_dumbbell', 'bench'], 'other', ['forearms'], [], 9, 'Rest your forearm on your thigh or the bench with your palm down and wrist past the edge. Lift the back of your hand up, then lower slowly. Do both sides.'],
            ['machine-triceps-dip', 'Machine Triceps Dip', 'machine', ['triceps_machine'], 'triceps', ['triceps'], [], 9, 'Sit with your back on the pad and hands on the handles beside you. Press down until your arms are straight, then let the handles rise until your elbows reach about 90 degrees.'],
            ['ab-crunch-machine', 'Ab Crunch Machine', 'machine', ['ab_crunch'], 'core', ['abs'], [], 9, 'Set the pads at chest height. Curl your ribs toward your hips to crunch forward, pause, and return slowly without letting the stack touch down.'],
            ['plate-loaded-leg-press', 'Plate-Loaded Leg Press', 'machine', ['leg_press'], 'squat', ['quads', 'glutes'], ['hamstrings'], 9, 'Sit with your back and hips against the pad and feet shoulder-width apart on the platform. Set the safety stops and release the sled, then lower only while your heels and hips stay planted; press up without snapping your knees straight.'],
            ['palms-up-dumbbell-wrist-curl', 'Palms-Up Dumbbell Wrist Curl', 'dumbbell', ['single_dumbbell', 'bench'], 'other', ['forearms'], [], 9, 'Rest your forearm on your thigh or a bench, palm up and wrist just beyond the edge. Keep your forearm still as you bend your wrist to raise the dumbbell, then lower slowly; repeat on the other side.'],
            ['biceps-curl-to-shoulder-press', 'Biceps Curl to Shoulder Press', 'dumbbell', ['dumbbells'], 'other', ['biceps', 'shoulders'], [], 9, 'Stand with dumbbells at your sides, palms forward. Curl to your shoulders, turn your palms forward, and press overhead without leaning back; lower to your shoulders, then straighten your elbows to return to your sides.'],
            ['russian-twist', 'Russian Twist', 'bodyweight', [], 'core', ['abs'], [], 9, 'Sit with knees bent, heels on the floor, and torso leaning back slightly. Turn your chest and hands together from side to side while keeping your hips still; hold a weight only if you can control the movement.'],
            ['pistol-squat', 'Pistol Squat', 'bodyweight', [], 'lunge', ['quads', 'glutes'], ['hamstrings'], 9, 'Stand on one leg with the other held out in front. Squat down as low as you can control on the standing leg, then stand back up. Hold a support for balance if needed. Count reps per side.'],
            ['seated-calf-raise', 'Seated Calf Raise', 'machine', ['calf_raise'], 'calf', ['calves'], [], 9, 'Sit with the pad on your lower thighs and the balls of your feet on the platform. Lower your heels into a stretch, then rise as high as you can.'],
            ['sit-up', 'Sit-Up', 'bodyweight', [], 'core', ['abs'], [], 9, 'Lie with knees bent and feet anchored. Curl up until your chest reaches your thighs, then lower slowly back down.'],
            ['incline-hammer-curl', 'Incline Hammer Curl', 'dumbbell', ['single_dumbbell', 'incline_bench'], 'biceps', ['biceps', 'forearms'], [], 9, 'Sit back against an incline bench with one dumbbell hanging at your side, palm facing inward. Keep your upper arm still as you curl toward your shoulder and lower slowly; repeat on the other side.'],
            ['neutral-grip-pull-up', 'Neutral-Grip Pull-Up', 'bodyweight', ['pullup_bar'], 'vertical_pull', ['lats'], ['biceps', 'upper_back'], 9, 'Hang from parallel handles with palms facing each other. Pull your chest toward the handles by driving your elbows down, then lower to a full hang.'],
            ['hammer-strength-chest-press', 'Hammer Strength Chest Press', 'machine', ['chest_press'], 'horizontal_push', ['chest'], ['triceps', 'shoulders'], 9, 'Set the seat so the handles line up with mid-chest. Press forward until your arms are almost straight and return slowly. You can press one arm at a time.'],
            ['lying-leg-curl', 'Lying Leg Curl', 'machine', ['leg_curl'], 'knee_flexion', ['hamstrings'], ['calves'], 9, 'Lie face down with the pad just above your heels and knees at the pivot. Curl the pad toward your glutes without lifting your hips, then lower slowly.'],
            ['overhead-cable-curl', 'Overhead Cable Curl', 'cable', ['cable'], 'biceps', ['biceps'], ['forearms'], 9, 'Stand between two high pulleys with arms out to the sides at shoulder height. Curl the handles toward your ears without dropping your elbows, then straighten slowly.'],
            ['dumbbell-sumo-squat', 'Dumbbell Sumo Squat', 'dumbbell', ['single_dumbbell'], 'squat', ['quads', 'glutes'], ['hamstrings'], 9, 'Stand with a wide stance and toes turned out, holding one dumbbell between your legs. Squat straight down with your chest up and knees pushed out, then stand.'],
            ['machine-preacher-curl', 'Machine Preacher Curl', 'machine', ['biceps_machine'], 'biceps', ['biceps'], ['forearms'], 9, 'Set the seat so your upper arms rest flat on the pad. Curl the handles toward your shoulders and lower until your arms are almost straight.'],
            ['glute-kickback-machine', 'Glute Kickback Machine', 'machine', ['glute_kickback'], 'other', ['glutes'], ['hamstrings'], 9, 'Brace on the machine with one foot on the platform. Push it back and up by squeezing your glute without arching your lower back, then return slowly. Count reps per side.'],
            ['barbell-drag-curl', 'Barbell Drag Curl', 'barbell', ['barbell'], 'biceps', ['biceps'], ['forearms'], 9, 'Hold the bar at your thighs. Curl it up while dragging it along your body, letting your elbows move back, and lower the same way.'],
            ['arnold-press', 'Arnold Press', 'dumbbell', ['dumbbells'], 'vertical_push', ['shoulders'], ['triceps'], 9, 'Start with the dumbbells at your shoulders, palms facing you. Press up while turning your palms forward, finishing overhead, and reverse the turn on the way down.'],
            ['smith-machine-close-grip-bench-press', 'Smith Machine Close-Grip Bench Press', 'machine', ['smith', 'bench'], 'triceps', ['triceps'], ['chest', 'shoulders'], 9, 'Grip the bar at shoulder width. Lower it to your lower chest with elbows tucked, then press up by straightening your arms.'],
            ['alternating-single-arm-kettlebell-swing', 'Alternating Single-Arm Kettlebell Swing', 'kettlebell', ['kettlebells'], 'hinge', ['hamstrings', 'glutes'], ['lower_back'], 9, 'Swing the kettlebell with one hand by snapping your hips forward, and switch hands at the top of each swing. Let your hips drive it, not your arm.'],
            ['smith-machine-bent-over-row', 'Smith Machine Bent-Over Row', 'machine', ['smith'], 'horizontal_pull', ['upper_back', 'lats'], ['biceps'], 9, 'Hinge forward with a flat back under the bar. Row it to your lower ribs, squeeze, and lower without standing up.'],
            ['machine-triceps-extension', 'Machine Triceps Extension', 'machine', ['triceps_machine'], 'triceps', ['triceps'], [], 9, 'Set the seat so your elbows line up with the pivot. Straighten your arms fully against the pads, then return slowly.'],
            ['single-leg-kickback', 'Single-Leg Kickback', 'bodyweight', [], 'other', ['glutes'], ['hamstrings'], 9, 'On hands and knees, push one heel back and up until your thigh is level with your body. Squeeze at the top and lower without arching your back. Count reps per side.'],
            ['dumbbell-squat-to-shoulder-press', 'Dumbbell Squat to Shoulder Press', 'dumbbell', ['dumbbells'], 'other', ['quads', 'shoulders'], ['glutes'], 9, 'Hold the dumbbells at your shoulders and squat down. As you stand, press them overhead in one motion, then lower them back to your shoulders.'],
            ['close-grip-v-bar-pulldown', 'Close-Grip V-Bar Pulldown', 'machine', ['lat_pulldown'], 'vertical_pull', ['lats'], ['biceps', 'upper_back'], 9, 'Attach the V-handle and lean back slightly. Pull it to your upper chest by driving your elbows down along your sides, then let your arms extend fully.'],
            ['wide-grip-lat-pulldown', 'Wide-Grip Lat Pulldown', 'machine', ['lat_pulldown'], 'vertical_pull', ['lats'], ['biceps', 'upper_back'], 9, 'Grip the bar well outside your shoulders. Pull it to your upper chest with your chest lifted, and let it rise until your arms are long.'],
            ['home-gym-leg-extension', 'Home Gym Leg Extension', 'machine', ['leg_extension'], 'knee_extension', ['quads'], [], 9, 'Set the pad just above your ankles. Straighten your legs fully, hold briefly, and lower with control.'],
            ['dumbbell-squat', 'Dumbbell Squat', 'dumbbell', ['dumbbells'], 'squat', ['quads', 'glutes'], ['hamstrings'], 9, 'Hold a dumbbell at each side. Squat down with your chest up until your thighs reach parallel, then stand by pushing through your whole foot.'],
            ['hip-abductor-machine', 'Hip Abductor Machine', 'machine', ['hip_abduction'], 'other', ['glutes'], [], 9, 'Sit against the backrest with pads against the outside of your knees. Move your knees apart through a comfortable range without rocking your torso, then bring them back slowly.'],
            ['ez-bar-preacher-curl', 'EZ-Bar Preacher Curl', 'barbell', ['ez_bar', 'preacher_bench'], 'biceps', ['biceps'], ['forearms'], 9, 'Rest your upper arms flat on the preacher pad. Curl the bar toward your shoulders and lower until your arms are almost straight, without bouncing at the bottom.'],
            ['machine-biceps-curl', 'Machine Biceps Curl', 'machine', ['biceps_machine'], 'biceps', ['biceps'], ['forearms'], 9, 'Set the seat so your elbows line up with the pivot. Curl the handles toward your shoulders and lower slowly to a full stretch.'],
            ['waiter-curl', 'Waiter Curl', 'dumbbell', ['single_dumbbell'], 'biceps', ['biceps'], ['forearms'], 9, 'Hold one dumbbell upright by its top plate with both palms under it. Curl it toward your chin, keeping it level like a tray, and lower slowly.'],
            ['seated-back-extension-machine', 'Seated Back Extension Machine', 'machine', ['back_extension_machine'], 'other', ['lower_back'], ['glutes'], 9, 'Adjust the machine so the back pad supports your upper back and secure your feet. Keeping your hips against the seat, push back to a comfortable upright position, then return slowly without forcing your lower back into an arch.'],
            ['cable-external-rotation', 'Cable External Rotation', 'cable', ['cable'], 'other', ['shoulders'], [], 9, 'Stand side-on to a pulley at elbow height, holding the handle in your far hand with your elbow tucked at 90 degrees. Rotate your forearm outward, then return slowly. Count reps per side.'],
            ['barbell-front-raise', 'Barbell Front Raise', 'barbell', ['barbell'], 'other', ['shoulders'], ['chest'], 9, 'Hold the bar at your thighs with an overhand grip. Raise it with straight arms to shoulder height and lower slowly without swinging.'],
            ['single-arm-lat-pulldown', 'Single-Arm Lat Pulldown', 'machine', ['lat_pulldown'], 'vertical_pull', ['lats'], ['biceps', 'upper_back'], 9, 'Sit with thighs secured under the pad and hold a single overhead handle. Pull toward your shoulder with your elbow moving down beside your ribs, then slowly extend your arm; repeat on the other side.'],
            ['dumbbell-reverse-fly', 'Dumbbell Reverse Fly', 'dumbbell', ['dumbbells'], 'rear_delt', ['upper_back'], ['shoulders'], 9, 'Hinge forward with a flat back and let the dumbbells hang. Raise them out to the sides with a slight elbow bend until level with your shoulders, then lower.'],
            ['hip-adductor-machine', 'Hip Adductor Machine', 'machine', ['hip_abduction'], 'other', ['glutes'], [], 9, 'Sit with the pads on the inside of your knees. Squeeze your knees together, pause, and let them open slowly to a comfortable stretch.'],
            ['machine-row', 'Machine Row', 'machine', ['seated_row'], 'horizontal_pull', ['upper_back', 'lats'], ['biceps'], 9, 'Set the chest pad so you can just reach the handles. Pull them to your ribs while squeezing your shoulder blades, then extend your arms fully.'],
            ['cable-rear-delt-fly', 'Cable Rear Delt Fly', 'cable', ['cable'], 'rear_delt', ['upper_back'], ['shoulders'], 9, 'Set two pulleys at shoulder height and cross the cables, holding the opposite handles. Pull your arms out and back until they line up with your shoulders, then return slowly.'],
            ['close-grip-ez-bar-curl', 'Close-Grip EZ-Bar Curl', 'barbell', ['ez_bar'], 'biceps', ['biceps'], ['forearms'], 9, 'Hold the EZ bar on the inner bends. Curl it to your chest with elbows fixed at your sides and lower until your arms are straight.'],
            ['cable-straight-arm-pulldown', 'Cable Straight-Arm Pulldown', 'cable', ['cable'], 'other', ['lats'], ['chest'], 9, 'Face a high pulley holding a bar with straight arms. Sweep it down to your thighs by pulling with your lats, then let it rise to eye level.'],
            ['no-money-curl', 'No-Money Curl', 'dumbbell', ['dumbbells'], 'other', ['shoulders'], ['upper_back'], 9, 'Stand holding light dumbbells with palms up, elbows bent to 90 degrees and tucked beside your ribs. Keep your upper arms still as you rotate your forearms outward, then return; this is a rotation, not an elbow curl.'],
            ['dumbbell-squeeze-press', 'Dumbbell Squeeze Press', 'dumbbell', ['dumbbells', 'bench'], 'horizontal_push', ['chest'], ['triceps'], 9, 'Lie on the bench and press the dumbbells together over your chest. Keep squeezing them against each other as you lower to your chest and press back up.'],
            ['mini-band-lateral-walk', 'Mini Band Lateral Walk', 'band', ['bands'], 'other', ['glutes'], [], 9, 'Place a loop band around your legs and sit into a quarter squat. Step sideways, keeping tension on the band, for the set number of steps each way.'],
            ['bicycle-crunch', 'Bicycle Crunch', 'bodyweight', [], 'core', ['abs'], [], 9, 'Lie with hands by your head and legs raised. Bring one elbow toward the opposite knee while extending the other leg, then switch sides in a pedaling motion.'],
            ['captain-s-chair-knee-raise', 'Captain\'s Chair Knee Raise', 'bodyweight', ['dip_bars'], 'core', ['abs'], [], 9, 'Support yourself on your forearms with your back against the pad. Raise your knees toward your chest by curling your pelvis up, then lower slowly.'],
            ['alternating-dumbbell-bench-press', 'Alternating Dumbbell Bench Press', 'dumbbell', ['dumbbells', 'bench'], 'horizontal_push', ['chest'], ['triceps', 'shoulders'], 9, 'Lie on a flat bench with feet planted and both dumbbells above your chest. Lower and press one dumbbell while the other stays overhead, then alternate arms without twisting your torso.'],
            ['single-arm-cable-curl', 'Single-Arm Cable Curl', 'cable', ['cable'], 'biceps', ['biceps'], ['forearms'], 9, 'Hold a low pulley handle in one hand. Curl it toward your shoulder with your elbow fixed, and lower slowly against the cable. Count reps per side.'],
            ['reverse-grip-cable-pushdown', 'Reverse-Grip Cable Pushdown', 'cable', ['cable'], 'triceps', ['triceps'], [], 9, 'Hold a straight bar with palms facing up and elbows pinned to your sides. Push down until your arms are straight, then let it rise slowly.'],
            ['lateral-to-front-raise', 'Lateral to Front Raise', 'dumbbell', ['dumbbells'], 'other', ['shoulders'], [], 9, 'Stand with dumbbells at your sides and elbows slightly bent. Raise them sideways to shoulder height, move them together in front of you, and lower; on the next rep raise forward, move sideways, and lower.'],
            ['cable-internal-rotation', 'Cable Internal Rotation', 'cable', ['cable'], 'other', ['shoulders'], [], 9, 'Stand side-on to a pulley at elbow height, holding the handle in your near hand with your elbow tucked at 90 degrees. Rotate your forearm across your stomach, then return slowly. Count reps per side.'],
            ['hip-thrust', 'Hip Thrust', 'barbell', ['barbell', 'bench'], 'hip_thrust', ['glutes'], ['hamstrings'], 9, 'Rest your upper back on the bench with weight across your hips. Drive through your heels until your torso is level, pause with your chin tucked, and lower.'],
            ['scissor-kick', 'Scissor Kick', 'bodyweight', [], 'core', ['abs'], [], 9, 'Lie on your back with your lower back pressed down and legs raised slightly. Cross your legs over and under each other in a steady rhythm.'],
            ['reverse-crunch', 'Reverse Crunch', 'bodyweight', [], 'core', ['abs'], [], 9, 'Lie on your back with knees bent at 90 degrees. Curl your hips off the floor toward your chest, then lower them slowly without swinging.'],
            ['seated-leg-pull-in', 'Seated Leg Pull-In', 'bodyweight', [], 'core', ['abs'], [], 9, 'Sit on the edge of a bench or the floor, leaning back on your hands. Pull your knees toward your chest, then extend your legs without letting your feet touch down.'],
            ['side-lunge', 'Side Lunge', 'bodyweight', [], 'lunge', ['quads', 'glutes'], ['hamstrings'], 9, 'Step wide to one side and sit your hips back over that foot, keeping the other leg straight. Push back to the start. Count reps per side.'],
            ['home-gym-rope-pushdown', 'Home Gym Rope Pushdown', 'cable', ['cable'], 'triceps', ['triceps'], [], 9, 'Face the high pulley holding the rope with elbows beside your ribs. Keep your upper arms still as you straighten your elbows and separate the rope ends, then slowly bend your elbows to return.'],
            ['hammer-strength-incline-press', 'Hammer Strength Incline Press', 'machine', ['chest_press'], 'incline_push', ['chest'], ['shoulders', 'triceps'], 9, 'Set the seat so the handles start at your upper chest. Press up and forward until your arms are almost straight, then return slowly.'],
            ['feet-elevated-glute-bridge', 'Feet-Elevated Glute Bridge', 'bodyweight', ['bench'], 'hip_thrust', ['glutes'], ['hamstrings'], 9, 'Lie on your back with your heels on a bench. Press through your heels to lift your hips until your body forms a line from knees to shoulders, then lower.'],
            ['triceps-push-up', 'Triceps Push-Up', 'bodyweight', [], 'triceps', ['triceps'], ['chest', 'shoulders'], 9, 'Place your hands under your shoulders. Keep your elbows brushing your sides as you lower your chest, then press back up.'],
            ['seated-dumbbell-calf-raise', 'Seated Dumbbell Calf Raise', 'dumbbell', ['dumbbells', 'bench'], 'calf', ['calves'], [], 9, 'Sit on the bench with the balls of your feet on a plate or step and dumbbells resting on your knees. Raise your heels as high as you can, then lower into a stretch.'],
            ['single-leg-glute-bridge', 'Single-Leg Glute Bridge', 'bodyweight', [], 'hip_thrust', ['glutes'], ['hamstrings'], 9, 'Lie with one knee bent and the other leg straight. Drive through the planted heel to lift your hips level, pause, and lower. Count reps per side.'],
            ['wide-grip-pull-up', 'Wide-Grip Pull-Up', 'bodyweight', ['pullup_bar'], 'vertical_pull', ['lats'], ['biceps', 'upper_back'], 9, 'Hang with an overhand grip well outside your shoulders. Pull your chest toward the bar, then lower all the way down.'],
            ['kneeling-squat', 'Kneeling Squat', 'bodyweight', [], 'squat', ['glutes'], ['quads', 'hamstrings'], 9, 'Kneel on a padded surface with your torso upright. Bend at your hips to sit back toward your heels, then squeeze your buttocks to return to tall kneeling without arching your lower back.'],
            ['hammer-strength-decline-press', 'Hammer Strength Decline Press', 'machine', ['chest_press'], 'horizontal_push', ['chest'], ['triceps', 'shoulders'], 9, 'Set the seat so the handles line up with your lower chest. Press down and forward until your arms are almost straight, then return slowly.'],
            ['superman', 'Superman', 'bodyweight', [], 'other', ['lower_back'], ['glutes'], 9, 'Lie face down with arms reaching overhead and neck in line with your spine. Gently lift your arms, chest, and legs a small distance without throwing your head back, then lower slowly.'],
            ['archer-pull-up', 'Archer Pull-Up', 'bodyweight', ['pullup_bar'], 'vertical_pull', ['lats'], ['biceps', 'upper_back'], 9, 'Take a wide grip. Pull yourself toward one hand while the other arm straightens along the bar, then lower and switch sides.'],
            ['single-arm-dumbbell-press', 'Single-Arm Dumbbell Press', 'dumbbell', ['single_dumbbell'], 'vertical_push', ['shoulders'], ['triceps'], 9, 'Hold one dumbbell at your shoulder. Press it straight overhead without leaning away, then lower it under control. Count reps per side.'],
            ['smith-machine-shoulder-press', 'Smith Machine Shoulder Press', 'machine', ['smith', 'incline_bench'], 'vertical_push', ['shoulders'], ['triceps'], 9, 'Place a nearly upright bench under the Smith bar, set the safety stops, and grip the bar slightly wider than your shoulders. Unhook and press from your upper chest to overhead without arching off the backrest, then lower slowly.'],
            ['reverse-grip-pulldown', 'Reverse-Grip Pulldown', 'machine', ['lat_pulldown'], 'vertical_pull', ['lats'], ['biceps', 'upper_back'], 9, 'Hold the bar with an underhand grip at shoulder width. Pull it to your upper chest, driving your elbows down, and let it rise until your arms are straight.'],
            ['wide-grip-barbell-curl', 'Wide-Grip Barbell Curl', 'barbell', ['barbell'], 'biceps', ['biceps'], ['forearms'], 9, 'Grip the bar wider than your shoulders with palms up. Curl it to your chest with elbows still, then lower all the way.'],
            ['kettlebell-suitcase-deadlift', 'Kettlebell Suitcase Deadlift', 'kettlebell', ['kettlebells'], 'hinge', ['hamstrings', 'glutes'], ['abs', 'lower_back'], 9, 'Stand beside the kettlebell. Hinge down and grab it in one hand, then stand up tall without leaning to that side. Count reps per side.'],
            ['bird-dog-row', 'Bird Dog Row', 'dumbbell', ['single_dumbbell'], 'other', ['upper_back', 'abs'], ['lower_back', 'glutes'], 9, 'On hands and knees with a dumbbell under one hand, extend the opposite leg behind you. Row the dumbbell to your hip while keeping your hips level. Count reps per side.'],
            ['pendlay-row', 'Pendlay Row', 'barbell', ['barbell'], 'horizontal_pull', ['upper_back', 'lats'], ['biceps'], 9, 'Hinge until your back is about parallel with the floor. Row the bar from the floor to your lower chest in one quick pull, and set it down fully between reps.'],
            ['barbell-good-morning', 'Barbell Good Morning', 'barbell', ['barbell', 'rack'], 'hinge', ['hamstrings', 'glutes'], ['lower_back'], 9, 'Rest the bar on your upper back with soft knees. Push your hips back and lower your chest with a flat back until your hamstrings stretch, then stand up.'],
            ['scissor-crossover-kick', 'Scissor Crossover Kick', 'bodyweight', [], 'core', ['abs'], [], 9, 'Lie on your back with legs raised a few inches. Cross one leg over the other, open them wide, and cross the other way, keeping your lower back down.'],
            ['around-the-world', 'Around the World', 'dumbbell', ['dumbbells'], 'other', ['shoulders'], ['chest'], 9, 'Lie on a bench with light dumbbells at your hips. Sweep them out and around in a wide arc until they meet over your head, then reverse the path.'],
            ['flutter-kick', 'Flutter Kick', 'bodyweight', [], 'core', ['abs'], [], 9, 'Lie on your back with legs straight and lifted a few inches. Kick them up and down in small, quick movements while your lower back stays pressed down.'],
            ['hammer-strength-shoulder-press', 'Hammer Strength Shoulder Press', 'machine', ['shoulder_press'], 'vertical_push', ['shoulders'], ['triceps'], 9, 'Set the seat so the handles start at about ear height. Press up until your arms are almost straight and lower under control.'],
            ['seated-rear-delt-raise', 'Seated Rear Delt Raise', 'dumbbell', ['dumbbells', 'bench'], 'rear_delt', ['upper_back'], ['shoulders'], 9, 'Sit on the end of the bench and lean your chest toward your knees. Raise the dumbbells out to the sides with a slight elbow bend, then lower.'],
            ['cuban-rotation', 'Cuban Rotation', 'dumbbell', ['dumbbells'], 'other', ['shoulders'], [], 9, 'Stand with light dumbbells, upper arms out at shoulder height, elbows bent to 90 degrees, and forearms pointing down. Keep your upper arms still while rotating your forearms upward, then lower slowly through a comfortable range.'],
            ['barbell-glute-bridge', 'Barbell Glute Bridge', 'barbell', ['barbell'], 'hip_thrust', ['glutes'], ['hamstrings'], 9, 'Lie on the floor with the bar across your hips and knees bent. Drive through your heels to lift your hips, pause at the top, and lower.'],
            ['cable-standing-twist', 'Cable Standing Twist', 'cable', ['cable'], 'core', ['abs'], [], 9, 'Stand side-on to a pulley at chest height and hold the handle with straight arms. Turn your torso away from the machine, then return slowly. Count reps per side.'],
            ['single-arm-cable-side-extension', 'Single-Arm Cable Side Extension', 'cable', ['cable'], 'triceps', ['triceps'], [], 9, 'Hold a high pulley handle with the opposite hand so the cable crosses in front of you. Straighten your arm out and down to your side, then return. Count reps per side.'],
            ['standing-overhead-dumbbell-extension', 'Standing Overhead Dumbbell Extension', 'dumbbell', ['single_dumbbell'], 'triceps', ['triceps'], [], 9, 'Stand holding one dumbbell overhead with both hands. Lower it behind your head with elbows pointing up, then straighten your arms.'],
            ['barbell-pause-curl', 'Barbell Pause Curl', 'barbell', ['barbell'], 'biceps', ['biceps'], ['forearms'], 9, 'Stand holding the bar with a shoulder-width palms-up grip and elbows beside your ribs. Curl halfway and pause for two seconds before finishing toward your shoulders, then lower slowly without swinging.'],
            ['ez-bar-overhead-triceps-extension', 'EZ-Bar Overhead Triceps Extension', 'barbell', ['ez_bar'], 'triceps', ['triceps'], [], 9, 'Hold the EZ bar overhead with a close grip. Lower it behind your head by bending only at the elbows, then straighten your arms.'],
            ['band-straight-arm-pulldown', 'Band Straight-Arm Pulldown', 'band', ['bands'], 'other', ['lats'], ['chest'], 9, 'Anchor the band overhead. With straight arms, sweep your hands down to your thighs using your lats, then let them rise slowly.'],
            ['reverse-dumbbell-curl', 'Reverse Dumbbell Curl', 'dumbbell', ['single_dumbbell'], 'biceps', ['forearms', 'biceps'], [], 9, 'Hold the dumbbell with your palm facing down. Curl it up with your elbow fixed and lower slowly. Do both sides.'],
            ['cable-crossover-pulldown', 'Cable Crossover Pulldown', 'cable', ['cable'], 'vertical_pull', ['lats'], ['biceps', 'upper_back'], 9, 'Kneel between two high pulleys and hold the left handle in your right hand and the right handle in your left. Pull your elbows down beside your ribs, then slowly reach upward along the crossed cable paths.'],
            ['lunge-with-twist', 'Lunge with Twist', 'bodyweight', [], 'lunge', ['quads', 'glutes'], ['hamstrings', 'abs'], 9, 'Step forward into a lunge and turn your torso toward your front leg. Turn back to center and push back to standing. Count reps per side.'],
            ['dumbbell-floor-press', 'Dumbbell Floor Press', 'dumbbell', ['dumbbells'], 'horizontal_push', ['chest'], ['triceps', 'shoulders'], 9, 'Lie on the floor with knees bent and dumbbells over your chest. Lower until your upper arms touch the floor, then press back up.'],
            ['rotation-push-up', 'Rotation Push-Up', 'bodyweight', [], 'horizontal_push', ['chest'], ['triceps', 'shoulders', 'abs'], 9, 'Do a push-up, then turn your body to one side and reach that arm to the ceiling. Return and alternate sides each rep.'],
            ['smith-machine-decline-press', 'Smith Machine Decline Press', 'machine', ['smith', 'decline_bench'], 'horizontal_push', ['chest'], ['triceps', 'shoulders'], 9, 'Set a decline bench under the bar. Lower it to your lower chest and press it back up without locking out hard.'],
            ['smith-machine-split-squat', 'Smith Machine Split Squat', 'machine', ['smith'], 'lunge', ['quads', 'glutes'], ['hamstrings'], 9, 'Stand in a split stance under the bar. Lower your back knee straight down and drive up through your front foot. Count reps per side.'],
            ['decline-crunch', 'Decline Crunch', 'bodyweight', ['decline_bench'], 'core', ['abs'], [], 9, 'Hook your feet on a decline bench. Curl your shoulders toward your hips and lower slowly, without pulling on your neck.'],
            ['decline-oblique-crunch', 'Decline Oblique Crunch', 'bodyweight', ['decline_bench'], 'core', ['abs'], [], 9, 'Hook your feet on a decline bench. Curl up and turn one shoulder toward the opposite knee, then lower and alternate sides.'],
            ['partner-medicine-ball-twist', 'Partner Medicine Ball Twist', 'bodyweight', ['medicine_ball'], 'other', ['abs'], [], 9, 'Stand back to back with a partner. Turn to hand them the medicine ball on one side, then turn the other way to receive it.'],
            ['stability-ball-pike', 'Stability Ball Pike', 'bodyweight', ['stability_ball'], 'core', ['abs'], ['shoulders'], 9, 'Start in a push-up position with your shins on the ball. Lift your hips high, rolling the ball toward your hands, then lower back to a plank.'],
            ['rotary-torso-machine', 'Rotary Torso Machine', 'machine', ['rotary_torso'], 'core', ['abs'], [], 9, 'Adjust the seat, pads, and foot supports to the machine instructions. Keep the supported part of your body still as you rotate the moving section through a comfortable range, then return slowly; repeat on the other side.'],
            ['side-plank-leg-lift', 'Side Plank Leg Lift', 'bodyweight', [], 'core', ['abs'], ['glutes'], 9, 'Hold a side plank on your forearm. Raise your top leg, lower it, and keep your hips from sagging. Count reps per side.'],
            ['barbell-forward-lunge', 'Barbell Forward Lunge', 'barbell', ['barbell', 'rack'], 'lunge', ['quads', 'glutes'], ['hamstrings'], 9, 'With the bar on your upper back, step forward and lower until both knees reach about 90 degrees. Push back to standing. Count reps per side.'],
            ['iron-cross', 'Iron Cross', 'bodyweight', [], 'other', ['abs'], ['lower_back'], 9, 'Lie on your back with arms out to the sides. Lower your raised legs to one side without lifting your shoulders, then bring them back up and go the other way.'],
            ['ez-bar-pjr-pullover', 'EZ-Bar PJR Pullover', 'barbell', ['ez_bar', 'bench'], 'other', ['triceps'], ['lats'], 9, 'Lie on a bench holding the EZ bar above your chest with a close grip. Bend your elbows and let your upper arms move back to lower the bar behind your head, then reverse the motion to return above your chest.'],
            ['band-side-step', 'Band Side Step', 'band', ['bands'], 'other', ['glutes'], [], 9, 'With a loop band around your ankles, step sideways keeping tension on the band and your toes forward. Count steps each way.'],
            ['ez-bar-pullover', 'EZ-Bar Pullover', 'barbell', ['ez_bar', 'bench'], 'other', ['lats'], ['chest'], 9, 'Lie on the bench holding the EZ bar over your chest with a slight elbow bend. Lower it behind your head in an arc until your lats stretch, then pull it back over.'],
            ['seated-single-leg-calf-raise', 'Seated Single-Leg Calf Raise', 'dumbbell', ['single_dumbbell', 'bench'], 'calf', ['calves'], [], 9, 'Sit with one foot on a step and a dumbbell on that knee. Lower your heel into a stretch and rise as high as you can. Count reps per side.'],
            ['incline-ez-bar-curl', 'Incline EZ-Bar Curl', 'barbell', ['ez_bar', 'incline_bench'], 'biceps', ['biceps'], ['forearms'], 9, 'Sit back against an incline bench holding the EZ bar with palms up and arms hanging beside your torso. Curl toward your shoulders without moving your upper arms, then lower slowly; use a bench position that leaves the bar clear of your thighs.'],
            ['single-arm-dumbbell-floor-press', 'Single-Arm Dumbbell Floor Press', 'dumbbell', ['single_dumbbell'], 'horizontal_push', ['chest'], ['triceps', 'shoulders'], 9, 'Lie on the floor with one dumbbell over your shoulder. Lower until your upper arm touches the floor and press back up. Count reps per side.'],
            ['cable-internal-rotation-at-90', 'Cable Internal Rotation at 90°', 'cable', ['cable'], 'other', ['shoulders'], [], 9, 'Face away from a pulley at shoulder height with your upper arm out to the side and elbow bent at 90 degrees. Rotate your forearm forward and down, then return. Count reps per side.'],
            ['plank-surrender', 'Plank Surrender', 'bodyweight', [], 'core', ['abs'], ['shoulders', 'triceps'], 9, 'From a high plank, lower to one forearm and then the other, then press back up one hand at a time. Keep your hips steady.'],
            ['tate-press', 'Tate Press', 'dumbbell', ['dumbbells', 'bench'], 'triceps', ['triceps'], [], 9, 'Lie on the bench with dumbbells over your chest, palms facing your feet. Bend your elbows out to touch the dumbbells to your chest, then press back up.'],
            ['stability-ball-knee-tuck', 'Stability Ball Knee Tuck', 'bodyweight', ['stability_ball'], 'core', ['abs'], [], 9, 'Start in a push-up position with your shins on the ball. Pull your knees toward your chest, rolling the ball in, then extend back out.'],
            ['cable-lateral-triceps-extension', 'Cable Lateral Triceps Extension', 'cable', ['cable'], 'triceps', ['triceps'], [], 9, 'Stand side-on to a high pulley and hold the handle with your far hand, elbow bent. Extend your arm out and down to your side, then return. Count reps per side.'],
            ['hanging-knee-raise', 'Hanging Knee Raise', 'bodyweight', ['pullup_bar'], 'core', ['abs'], [], 9, 'Hang from the bar without swinging. Raise your knees toward your chest by curling your pelvis up, then lower slowly.'],
            ['single-arm-overhead-kettlebell-squat', 'Single-Arm Overhead Kettlebell Squat', 'kettlebell', ['kettlebells'], 'squat', ['quads', 'glutes'], ['shoulders', 'abs'], 9, 'Lock the kettlebell overhead in one hand. Squat down while keeping your arm vertical and chest up, then stand. Count reps per side.'],
            ['mountain-climber', 'Mountain Climber', 'bodyweight', [], 'core', ['abs'], ['shoulders'], 9, 'From a high plank, drive one knee toward your chest and switch legs quickly, keeping your hips level.'],
            ['bodyweight-forward-lunge', 'Bodyweight Forward Lunge', 'bodyweight', [], 'lunge', ['quads', 'glutes'], ['hamstrings'], 9, 'Step forward and lower until both knees are bent to about 90 degrees. Push back to standing. Count reps per side.'],
            ['assisted-dip', 'Assisted Dip', 'machine', ['assisted_pullup'], 'triceps', ['triceps'], ['chest', 'shoulders'], 9, 'Kneel or stand on the assist pad and hold the dip handles. Lower until your elbows reach about 90 degrees, then press up. Less assistance is harder.'],
            ['stability-ball-crunch', 'Stability Ball Crunch', 'bodyweight', ['stability_ball'], 'core', ['abs'], [], 9, 'Lie back on the ball with it under your lower back. Curl your ribs toward your hips, then lower back over the ball.'],
            ['hammer-strength-iso-row', 'Hammer Strength Iso Row', 'machine', ['seated_row'], 'horizontal_pull', ['upper_back', 'lats'], ['biceps'], 9, 'Brace your chest on the pad. Row the handles back to your ribs, one or both arms at a time, then reach forward fully.'],
            ['smith-machine-behind-the-back-shrug', 'Smith Machine Behind-the-Back Shrug', 'machine', ['smith'], 'other', ['upper_back'], [], 9, 'Stand just in front of the Smith bar and hold it behind your thighs with straight arms. Unhook and lift your shoulders straight upward without rolling them, then lower slowly and rehook after the set.'],
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

    /**
     * Moves one account's own exercises into the default library. The rows are
     * changed in place and keep their ids, so workouts that used them, and the
     * history built on those workouts, are not touched. An exercise whose name
     * the default library already has is left alone, to avoid two with one name.
     *
     * @return array{promoted: int, skipped: string[]}
     */
    public static function promote(Db $db, int $userId): array
    {
        return $db->tx(static function (Db $db) use ($userId) {
            $taken = [];
            foreach ($db->all('SELECT name FROM exercises WHERE user_id IS NULL') as $r) {
                $taken[mb_strtolower($r['name'])] = true;
            }
            $promoted = 0;
            $skipped = [];
            foreach ($db->all('SELECT id, name FROM exercises WHERE user_id=? ORDER BY id', [$userId]) as $r) {
                $key = mb_strtolower($r['name']);
                if (isset($taken[$key])) {
                    $skipped[] = $r['name'];
                    continue;
                }
                $db->run('UPDATE exercises SET user_id=NULL, promoted_from=? WHERE id=?', [$userId, $r['id']]);
                $taken[$key] = true;
                $promoted++;
            }
            return ['promoted' => $promoted, 'skipped' => $skipped];
        });
    }

    /** Whether this account may edit or archive the exercise: its own, or (for the admin) one moved into the default library. */
    public static function canEdit(array $row, array $user): bool
    {
        if ($row['user_id'] !== null) {
            return (int) $row['user_id'] === (int) $user['id'];
        }
        return ($row['promoted_from'] ?? null) !== null && Auth::isAdmin($user);
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
            'slug' => $r['slug'] ?? null,
            'custom' => $r['user_id'] !== null,
            // In the default library because the admin's own exercise was moved there, not from the built-in catalog.
            'shared' => $r['user_id'] === null && ($r['promoted_from'] ?? null) !== null,
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
            // A built-in stretch done on each side (#138).
            'per_side' => $r['user_id'] === null && in_array($r['slug'] ?? '', self::PER_SIDE, true),
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
