<?php
declare(strict_types=1);

namespace TF;

final class StravaStrength
{
    // ThoeneFit catalog slugs mapped to Strava's documented exercise identifiers.
    // Exercises without a matching movement go in the activity description.
    private const EXERCISES = [
        'barbell-bench-press' => 'BARBELL_BENCH_PRESS',
        'dumbbell-bench-press' => 'DUMBBELL_BENCH_PRESS',
        'machine-chest-press' => 'MACHINE_CHEST_PRESS',
        'smith-bench-press' => 'BENCH_PRESS_GENERIC',
        'chest-dip' => 'CHEST_DIP',
        'push-up' => 'PUSH_UP_GENERIC',
        'incline-dumbbell-press' => 'INCLINE_DUMBBELL_BENCH_PRESS',
        'incline-barbell-press' => 'INCLINE_BARBELL_BENCH_PRESS',
        'smith-incline-press' => 'SMITH_MACHINE_INCLINE_BENCH_PRESS',
        'feet-elevated-push-up' => 'DECLINE_PUSH_UP',
        'cable-fly' => 'CABLE_CROSSOVER',
        'pec-deck' => 'PEC_DECK_BUTTERFLY',
        'dumbbell-fly' => 'DUMBBELL_CHEST_FLY',
        'band-fly' => 'BAND_CHEST_FLY',
        'overhead-press' => 'OVERHEAD_BARBELL_PRESS',
        'seated-dumbbell-press' => 'SEATED_DUMBBELL_SHOULDER_PRESS',
        'standing-dumbbell-press' => 'OVERHEAD_DUMBBELL_PRESS',
        'machine-shoulder-press' => 'MACHINE_SEATED_SHOULDER_PRESS',
        'kettlebell-press' => 'SHOULDER_PRESS_GENERIC',
        'pike-push-up' => 'PIKE_PUSH_UP',
        'dumbbell-lateral-raise' => 'LATERAL_RAISE_GENERIC',
        'cable-lateral-raise' => 'CABLE_LATERAL_RAISE',
        'band-lateral-raise' => 'LATERAL_RAISE_GENERIC',
        'cable-pushdown' => 'CABLE_TRICEPS_PUSHDOWN',
        'skull-crusher' => 'SKULL_CRUSHER',
        'overhead-dumbbell-extension' => 'OVERHEAD_DUMBBELL_TRICEPS_EXTENSION',
        'close-grip-bench-press' => 'CLOSE_GRIP_BARBELL_BENCH_PRESS',
        'band-pushdown' => 'TRICEPS_PRESSDOWN',
        'bench-dip' => 'BENCH_DIP',
        'diamond-push-up' => 'DIAMOND_PUSH_UP',
        'pull-up' => 'PULL_UP_GENERIC',
        'lat-pulldown' => 'LAT_PULLDOWN',
        'chin-up' => 'CLOSE_GRIP_CHIN_UP',
        'assisted-pull-up' => 'MACHINE_ASSISTED_PULL_UP',
        'barbell-row' => 'BENT_OVER_BARBELL_ROW',
        'one-arm-dumbbell-row' => 'DUMBBELL_ROW',
        'seated-cable-row' => 'SEATED_CABLE_ROW',
        'chest-supported-row' => 'CHEST_SUPPORTED_ROW',
        'standing-cable-row' => 'ROW_GENERIC',
        'inverted-row' => 'INVERTED_ROW',
        'kettlebell-row' => 'KETTLEBELL_ROW',
        'band-row' => 'ROW_GENERIC',
        'face-pull' => 'FACE_PULL',
        'reverse-pec-deck' => 'MACHINE_REAR_DELT_REVERSE_FLY',
        'bent-over-reverse-fly' => 'DUMBBELL_REAR_DELT_FLY',
        'band-pull-apart' => 'BAND_PULLAPARTS',
        'ez-bar-curl' => 'STANDING_EZ_BAR_BICEPS_CURL',
        'barbell-curl' => 'BARBELL_BICEPS_CURL',
        'dumbbell-curl' => 'STANDING_DUMBBELL_BICEPS_CURL',
        'hammer-curl' => 'DUMBBELL_HAMMER_CURL',
        'cable-curl' => 'CABLE_BICEPS_CURL',
        'incline-dumbbell-curl' => 'INCLINE_DUMBBELL_BICEPS_CURL',
        'band-curl' => 'CURL_GENERIC',
        'back-squat' => 'BARBELL_BACK_SQUAT',
        'leg-press' => 'MACHINE_LEG_PRESS',
        'goblet-squat' => 'DUMBBELL_GOBLET_SQUATS',
        'hack-squat' => 'MACHINE_HACK_SQUAT',
        'front-squat' => 'BARBELL_FRONT_SQUAT',
        'kettlebell-goblet-squat' => 'GOBLET_SQUAT',
        'smith-squat' => 'SMITH_MACHINE_SQUAT',
        'bodyweight-squat' => 'AIR_SQUAT',
        'romanian-deadlift' => 'BARBELL_ROMANIAN_DEADLIFT',
        'deadlift' => 'BARBELL_DEADLIFT',
        'dumbbell-rdl' => 'DUMBBELL_ROMANIAN_DEADLIFTS',
        'kettlebell-swing' => 'KETTLEBELL_SWING',
        'back-extension' => 'BACK_EXTENSION',
        'single-leg-rdl' => 'SINGLE_LEG_ROMANIAN_DEADLIFTS',
        'dumbbell-reverse-lunge' => 'DUMBBELL_REVERSE_LUNGE',
        'bulgarian-split-squat' => 'REAR_LEG_RAISED_LUNGE',
        'barbell-lunge' => 'BARBELL_REVERSE_LUNGE',
        'dumbbell-step-up' => 'STEP_UP',
        'reverse-lunge' => 'REVERSE_LUNGE',
        'barbell-hip-thrust' => 'BARBELL_HIP_THRUST',
        'dumbbell-hip-thrust' => 'DUMBBELL_HIP_THRUST',
        'glute-bridge' => 'GLUTE_BRIDGE',
        'leg-curl' => 'LEG_CURL_GENERIC',
        'band-leg-curl' => 'BANDED_HAMSTRING_CURL',
        'leg-extension' => 'MACHINE_LEG_EXTENSION',
        'machine-calf-raise' => 'CALF_RAISE_GENERIC',
        'dumbbell-calf-raise' => 'STANDING_CALF_RAISE',
        'leg-press-calf-raise' => 'MACHINE_CALF_PRESS',
        'single-leg-calf-raise' => 'SINGLE_LEG_STANDING_CALF_RAISE',
        'hanging-leg-raise' => 'HANGING_LEG_RAISE',
        'cable-crunch' => 'CABLE_CRUNCH',
        'lying-leg-raise' => 'LYING_STRAIGHT_LEG_RAISE',
        'crunch' => 'CRUNCH',
        'dead-bug' => 'DEADBUG',
    ];

    public static function details(array $workout): array
    {
        $sets = [];
        $lines = [];
        $kilograms = $workout['unit'] === 'kg';
        foreach ($workout['exercises'] as $exercise) {
            $type = self::EXERCISES[$exercise['slug']] ?? null;
            $unmapped = [];
            foreach ($exercise['sets'] as $set) {
                if (!$set['done'] || $set['reps'] === null || $set['reps'] <= 0) {
                    continue;
                }
                if ($type === null) {
                    $weight = $set['weight'] > 0 ? " × {$set['weight']} {$workout['unit']}" : '';
                    $unmapped[] = $set['reps'] . ' reps' . $weight . ($set['warmup'] ? ' (warm-up)' : '');
                    continue;
                }
                $entry = ['exercise_type' => $type, 'repetitions' => $set['reps']];
                if ($set['weight'] > 0) {
                    $entry['weight'] = $kilograms ? $set['weight'] : round($set['weight'] * 0.45359237, 3);
                }
                $sets[] = $entry;
            }
            if ($unmapped) {
                $lines[] = $exercise['name'] . ': ' . implode(', ', $unmapped);
            }
        }
        $summary = implode("\n", $lines);
        return [
            'sets' => $sets,
            'description' => mb_strlen($summary) > 3000 ? mb_substr($summary, 0, 2999) . '…' : $summary,
        ];
    }
}
