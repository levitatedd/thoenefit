<?php
declare(strict_types=1);

namespace TF;

/**
 * Estimated calories for a finished workout (#38), the usual way: MET × body
 * weight in kg × hours. A MET is how many times more energy an activity uses
 * than sitting still. The values are approximate, in the range the Compendium
 * of Physical Activities lists for each activity, so this is an estimate, not
 * a measurement.
 *
 * A cardio warm-up (#18) is counted on its own, for its own minutes, at the
 * value for that machine at an easy pace. The rest of the session counts as
 * lifting at the effort chosen when it was finished. The session length is
 * the same idle-trimmed duration Trends and Strava use (#49).
 */
final class Calories
{
    public const EFFORTS = ['light' => 'Light', 'moderate' => 'Moderate', 'hard' => 'Hard'];

    /** Resistance training, by how hard the session felt. */
    public const LIFTING_MET = ['light' => 3.5, 'moderate' => 5.0, 'hard' => 6.0];

    /** Cardio machines at a warm-up (easy to moderate) pace. */
    public const CARDIO_MET = [
        'stationary-bike' => 4.8,
        'elliptical' => 5.0,
        'treadmill' => 4.3,
        'rowing-machine' => 4.8,
        'stair-climber' => 4.0,
    ];
    public const CARDIO_MET_DEFAULT = 4.5;
    /** Stretching (#138), from the Compendium of Physical Activities. */
    public const STRETCH_MET = 2.3;

    public static function effort(?string $effort): string
    {
        return isset(self::EFFORTS[$effort ?? '']) ? $effort : 'moderate';
    }

    /**
     * @param array $workout as returned by Workouts::get()
     * @return int|null whole calories, or null without a body weight or a usable duration
     */
    public static function estimate(array $workout, ?float $bodyKg): ?int
    {
        if ($bodyKg === null || $bodyKg <= 0 || ($workout['status'] ?? '') !== 'completed') {
            return null;
        }
        $span = Workouts::workoutSpan($workout);
        $seconds = $span ? $span['seconds'] : 0;
        if ($seconds < 60 || $seconds > Workouts::MAX_COUNTED) { // under a minute: nothing worth estimating
            return null;
        }
        $kcal = 0.0;
        $cardioSeconds = 0;
        foreach ($workout['exercises'] as $e) {
            if (!Catalog::isTimed($e['kind'] ?? '')) {
                continue;
            }
            foreach ($e['sets'] as $s) {
                $d = !empty($s['done']) ? (int) ($s['duration_s'] ?? 0) : 0;
                if ($d <= 0) {
                    continue;
                }
                $d = min($d, $seconds - $cardioSeconds); // never more than the whole session
                $cardioSeconds += $d;
                $met = ($e['kind'] ?? '') === 'stretch' ? self::STRETCH_MET : (self::CARDIO_MET[$e['slug'] ?? ''] ?? self::CARDIO_MET_DEFAULT);
                $kcal += $met * $bodyKg * $d / 3600;
            }
        }
        $kcal += self::LIFTING_MET[self::effort($workout['effort'] ?? null)] * $bodyKg * ($seconds - $cardioSeconds) / 3600;
        return (int) round($kcal);
    }
}
