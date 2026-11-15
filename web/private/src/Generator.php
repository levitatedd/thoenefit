<?php
declare(strict_types=1);

namespace TF;

/**
 * Builds a workout from fixed rules. Nothing here is random: the same
 * profile, gym and training history always produce the same session, and
 * every choice comes with a short plain-language reason.
 */
final class Generator
{
    public const SPLIT_DAYS = [
        'full' => ['full'],
        'upper_lower' => ['upper', 'lower'],
        'ppl' => ['push', 'pull', 'legs'],
    ];

    public const DAY_LABELS = [
        'full' => 'Full body', 'upper' => 'Upper body', 'lower' => 'Lower body',
        'push' => 'Push', 'pull' => 'Pull', 'legs' => 'Legs', 'custom' => 'Custom', 'fitbod' => 'Fitbod import',
    ];

    /**
     * Each day is a list of slots: [slot key, acceptable movement patterns in
     * order of preference, muscle the slot is for, required?]. Required slots
     * are filled first, in order. Optional slots fill the remaining time,
     * starting with the muscle that has had the least work this week.
     */
    public const TEMPLATES = [
        'push' => [
            ['press', ['horizontal_push'], 'chest', true],
            ['overhead', ['vertical_push'], 'shoulders', true],
            ['incline', ['incline_push', 'chest_fly'], 'chest', true],
            ['triceps', ['triceps'], 'triceps', true],
            ['raise', ['lateral_raise'], 'shoulders', false],
            ['fly', ['chest_fly', 'horizontal_push'], 'chest', false],
            ['triceps2', ['triceps'], 'triceps', false],
        ],
        'pull' => [
            ['pulldown', ['vertical_pull'], 'lats', true],
            ['row', ['horizontal_pull'], 'upper_back', true],
            ['curl', ['biceps'], 'biceps', true],
            ['reardelt', ['rear_delt'], 'upper_back', false],
            ['row2', ['horizontal_pull', 'vertical_pull'], 'lats', false],
            ['curl2', ['biceps'], 'biceps', false],
            ['core', ['core'], 'abs', false],
        ],
        'legs' => [
            ['squat', ['squat'], 'quads', true],
            ['hinge', ['hinge'], 'hamstrings', true],
            ['single', ['lunge', 'hip_thrust'], 'glutes', true],
            ['legcurl', ['knee_flexion'], 'hamstrings', false],
            ['legext', ['knee_extension'], 'quads', false],
            ['calf', ['calf'], 'calves', false],
            ['core', ['core'], 'abs', false],
        ],
        'upper' => [
            ['press', ['horizontal_push'], 'chest', true],
            ['row', ['horizontal_pull'], 'upper_back', true],
            ['overhead', ['vertical_push'], 'shoulders', true],
            ['pulldown', ['vertical_pull'], 'lats', true],
            ['curl', ['biceps'], 'biceps', false],
            ['triceps', ['triceps'], 'triceps', false],
            ['raise', ['lateral_raise'], 'shoulders', false],
            ['reardelt', ['rear_delt'], 'upper_back', false],
        ],
        'lower' => [
            ['squat', ['squat'], 'quads', true],
            ['hinge', ['hinge'], 'hamstrings', true],
            ['single', ['lunge', 'hip_thrust'], 'glutes', true],
            ['legcurl', ['knee_flexion'], 'hamstrings', false],
            ['calf', ['calf'], 'calves', false],
            ['core', ['core'], 'abs', false],
            ['legext', ['knee_extension'], 'quads', false],
            ['thrust', ['hip_thrust'], 'glutes', false],
        ],
        'full' => [
            ['squat', ['squat'], 'quads', true],
            ['press', ['horizontal_push'], 'chest', true],
            ['row', ['horizontal_pull', 'vertical_pull'], 'upper_back', true],
            ['hinge', ['hinge'], 'hamstrings', false],
            ['overhead', ['vertical_push'], 'shoulders', false],
            ['pulldown', ['vertical_pull'], 'lats', false],
            ['core', ['core'], 'abs', false],
            ['curl', ['biceps'], 'biceps', false],
            ['triceps', ['triceps'], 'triceps', false],
            ['calf', ['calf'], 'calves', false],
        ],
    ];

    /** goal => [compound reps, accessory reps, compound rest s, accessory rest s] */
    public const GOALS = [
        'strength' => [[4, 6], [8, 12], 180, 120],
        'muscle' => [[6, 10], [10, 15], 120, 75],
        'general' => [[8, 12], [12, 15], 90, 60],
        'endurance' => [[12, 15], [15, 20], 60, 45],
    ];

    /** experience => [compound sets, accessory sets] */
    public const EXPERIENCE = [
        'beginner' => [3, 2],
        'intermediate' => [3, 3],
        'advanced' => [4, 3],
    ];

    private const LB_PER_KG = 2.20462262;

    private Db $db;

    public function __construct(Db $db)
    {
        $this->db = $db;
    }

    public static function gymShape(array $row): array
    {
        return [
            'id' => (int) $row['id'],
            'name' => $row['name'],
            'equipment' => json_decode($row['equipment'], true) ?: [],
            'increments' => json_decode($row['increments'], true) ?: [],
        ];
    }

    /** The next day in the user's split after their most recent finished workout. */
    public function nextDayType(int $uid, string $split): string
    {
        $days = self::SPLIT_DAYS[$split] ?? self::SPLIT_DAYS['full'];
        // Look past workouts that are not part of this split (imports, a one-off day of another type).
        $recent = $this->db->all("SELECT day_type FROM workouts WHERE user_id=? AND status='completed' ORDER BY started_at DESC LIMIT 20", [$uid]);
        foreach ($recent as $r) {
            $i = array_search($r['day_type'], $days, true);
            if ($i !== false) {
                return $days[($i + 1) % count($days)];
            }
        }
        return $days[0];
    }

    /**
     * Weekly working sets and an estimated recovery percentage per muscle.
     * A set counts fully toward primary muscles and half toward secondary
     * ones. After a session, a muscle is treated as needing 24 hours plus 6
     * hours per effective set (capped at 96) to return to 100%. This is an
     * estimate from logged training only; it knows nothing about sleep,
     * soreness or anything done outside the app.
     */
    public function muscleStats(int $uid, ?int $now = null): array
    {
        $now = $now ?? time();
        $rows = $this->db->all(
            "SELECT w.id, w.started_at, w.completed_at, e.muscles_main, e.muscles_assist
             FROM workout_sets s
             JOIN workout_exercises we ON we.id=s.workout_exercise_id
             JOIN workouts w ON w.id=s.workout_id
             JOIN exercises e ON e.id=we.exercise_id
             WHERE w.user_id=? AND w.status='completed' AND w.started_at>? AND s.done=1 AND s.warmup=0",
            [$uid, now_utc($now - 7 * 86400)]
        );
        $weekly = array_fill_keys(array_keys(Catalog::MUSCLES), 0.0);
        $perWorkout = [];
        foreach ($rows as $r) {
            $end = strtotime(($r['completed_at'] ?: $r['started_at']) . ' UTC');
            foreach ((json_decode($r['muscles_main'], true) ?: []) as $m) {
                $weekly[$m] = ($weekly[$m] ?? 0) + 1;
                $perWorkout[$r['id']]['end'] = $end;
                $perWorkout[$r['id']]['m'][$m] = ($perWorkout[$r['id']]['m'][$m] ?? 0) + 1;
            }
            foreach ((json_decode($r['muscles_assist'], true) ?: []) as $m) {
                $weekly[$m] = ($weekly[$m] ?? 0) + 0.5;
                $perWorkout[$r['id']]['end'] = $end;
                $perWorkout[$r['id']]['m'][$m] = ($perWorkout[$r['id']]['m'][$m] ?? 0) + 0.5;
            }
        }
        $fresh = array_fill_keys(array_keys(Catalog::MUSCLES), 100);
        foreach ($perWorkout as $w) {
            $hours = max(0, ($now - $w['end']) / 3600);
            foreach ($w['m'] as $m => $sets) {
                $needed = min(96, 24 + 6 * $sets);
                $pct = (int) round(min(1, $hours / $needed) * 100);
                $fresh[$m] = min($fresh[$m] ?? 100, $pct);
            }
        }
        $out = [];
        foreach (Catalog::MUSCLES as $m => $label) {
            $out[$m] = ['label' => $label, 'weekly_sets' => round($weekly[$m], 1), 'recovery' => $fresh[$m]];
        }
        return $out;
    }

    /** exercise id => unix time it was last done (finished workouts in the past 45 days). */
    private function recentUse(int $uid, int $now): array
    {
        $out = [];
        $rows = $this->db->all(
            "SELECT we.exercise_id, w.started_at FROM workout_exercises we JOIN workouts w ON w.id=we.workout_id
             WHERE we.user_id=? AND w.status='completed' AND w.started_at>?",
            [$uid, now_utc($now - 45 * 86400)]
        );
        foreach ($rows as $r) {
            $t = strtotime($r['started_at'] . ' UTC');
            $id = (int) $r['exercise_id'];
            if (!isset($out[$id]) || $t > $out[$id]) {
                $out[$id] = $t;
            }
        }
        return $out;
    }

    /** Working sets from the most recent finished session of this exact variant. */
    public function lastPerformance(int $uid, string $variantKey): ?array
    {
        $cands = $this->db->all(
            "SELECT we.id, w.started_at, w.unit FROM workout_exercises we JOIN workouts w ON w.id=we.workout_id
             WHERE we.user_id=? AND we.variant_key=? AND w.status='completed'
             ORDER BY w.started_at DESC LIMIT 5",
            [$uid, $variantKey]
        );
        foreach ($cands as $c) {
            $sets = $this->db->all('SELECT weight, reps FROM workout_sets WHERE workout_exercise_id=? AND done=1 AND warmup=0 AND reps>0 ORDER BY pos', [$c['id']]);
            if ($sets) {
                return [
                    'date' => to_iso($c['started_at']),
                    'unit' => $c['unit'],
                    'sets' => array_map(static fn($s) => ['weight' => (float) $s['weight'], 'reps' => (int) $s['reps']], $sets),
                ];
            }
        }
        return null;
    }

    public static function fmt(float $w): string
    {
        return rtrim(rtrim(number_format($w, 2, '.', ''), '0'), '.');
    }

    private static function convert(float $w, string $from, string $to, float $inc): float
    {
        if ($from === $to) {
            return $w;
        }
        $w = $from === 'kg' ? $w * self::LB_PER_KG : $w / self::LB_PER_KG;
        $step = $inc > 0 ? $inc : 0.5;
        return round($w / $step) * $step;
    }

    /**
     * Double progression. If every working set last time was at the working
     * weight and reached the top of the rep range, go up one increment and
     * restart at the bottom of the range. Otherwise keep the weight and add
     * reps.
     *
     * @return array{weight: ?float, reps: int, action: string, why: string}
     */
    public static function progress(?array $last, int $repMin, int $repMax, float $inc, string $unit): array
    {
        $mid = (int) ceil(($repMin + $repMax) / 2);
        if (!$last || !$last['sets']) {
            return [
                'weight' => null, 'reps' => $mid, 'action' => 'new',
                'why' => "No history for this exact setup yet. Pick a weight you can lift for $mid clean reps with one or two left in the tank.",
            ];
        }
        $sets = [];
        foreach ($last['sets'] as $s) {
            $sets[] = ['weight' => self::convert($s['weight'], $last['unit'], $unit, $inc), 'reps' => $s['reps']];
        }
        // Working weight = the weight used for the most sets (the heavier one on a tie).
        $counts = [];
        foreach ($sets as $s) {
            $k = self::fmt($s['weight']);
            $counts[$k] = ($counts[$k] ?? 0) + 1;
        }
        $top = 0.0;
        $best = 0;
        foreach ($counts as $k => $n) {
            if ($n > $best || ($n === $best && (float) $k > $top)) {
                $best = $n;
                $top = (float) $k;
            }
        }
        $repsList = implode(', ', array_map(static fn($s) => $s['reps'], $sets));
        $allTop = true;
        $minReps = PHP_INT_MAX;
        foreach ($sets as $s) {
            if ($s['weight'] < $top || $s['reps'] < $repMax) {
                $allTop = false;
            }
            $minReps = min($minReps, $s['reps']);
        }
        $range = "$repMin-$repMax";
        if ($top <= 0 || $inc <= 0) {
            // Bodyweight or bands: progress by reps; the app cannot know what "heavier" is here.
            if ($allTop) {
                return [
                    'weight' => $top > 0 ? $top : null, 'reps' => $repMax, 'action' => 'stay',
                    'why' => "Last time you got $repsList reps, the top of $range on every set. Add load if you can (a heavier band, a weight vest or a slower lowering) or keep matching it.",
                ];
            }
            return [
                'weight' => $top > 0 ? $top : null, 'reps' => max($repMin, min($repMax, $minReps + 1)), 'action' => 'stay',
                'why' => "Last time you got $repsList reps. Add reps until every set reaches $repMax.",
            ];
        }
        $w = self::fmt($top);
        if ($allTop) {
            $next = $top + $inc;
            return [
                'weight' => $next, 'reps' => $repMin, 'action' => 'increase',
                'why' => "Last time you got $repsList reps at $w $unit, the top of $range on every set, so go up " . self::fmt($inc) . " $unit to " . self::fmt($next) . " $unit.",
            ];
        }
        return [
            'weight' => $top, 'reps' => max($repMin, min($repMax, $minReps + 1)), 'action' => 'stay',
            'why' => "Last time you got $repsList reps at $w $unit. Stay at $w $unit and build toward $repMax reps on every set.",
        ];
    }

    public static function increment(array $gym, string $kind, string $unit): float
    {
        $defaults = Catalog::defaultIncrements($unit);
        $v = $gym['increments'][$kind] ?? $defaults[$kind] ?? 5;
        return is_numeric($v) ? max(0.0, (float) $v) : 5.0;
    }

    /** Sets, reps, rest, suggested weight and last performance for one exercise. */
    /**
     * @param array|null $plan when the sets, rep range and rest come from a shared
     *                         workout instead of this person's goal and experience
     */
    public function block(array $user, array $gym, array $ex, bool $reduceSets = false, ?array $plan = null, bool $bodyweightOnly = false): array
    {
        if (Catalog::isTimed($ex['kind'])) {
            return $this->cardioBlock((int) $user['id'], $gym, $ex);
        }
        $goal = self::GOALS[$user['goal']] ?? self::GOALS['muscle'];
        $exp = self::EXPERIENCE[$user['experience']] ?? self::EXPERIENCE['intermediate'];
        $compound = $ex['compound'];
        [$repMin, $repMax] = $compound ? $goal[0] : $goal[1];
        $rest = $compound ? $goal[2] : $goal[3];
        $sets = $compound ? $exp[0] : $exp[1];
        if ($reduceSets) {
            $sets = max(2, $sets - 1);
        }
        if ($plan) {
            $sets = (int) $plan['target_sets'];
            $repMin = (int) $plan['rep_min'];
            $repMax = (int) $plan['rep_max'];
            $rest = (int) $plan['rest_seconds'];
        }
        $unit = $user['unit'];
        $variant = Catalog::variantKey($ex['id'], $ex['kind'], $gym['id']);
        $last = $this->lastPerformance((int) $user['id'], $variant);
        $p = self::progress($last, $repMin, $repMax, self::increment($gym, $ex['kind'], $unit), $unit);
        if ($bodyweightOnly) {
            $p = [
                'weight' => null,
                'reps' => $p['reps'],
                'action' => 'stay',
                'why' => 'Do these sets with bodyweight only.',
            ];
        }
        if (!$last && $variant !== (string) $ex['id']
            && $this->db->val('SELECT COUNT(*) FROM workout_exercises WHERE user_id=? AND exercise_id=?', [$user['id'], $ex['id']])) {
            $p['why'] = 'You have done this at another gym, but machines and cable stacks differ, so numbers start fresh here. ' . substr($p['why'], strpos($p['why'], 'Pick'));
        }
        return [
            'exercise_id' => $ex['id'],
            'name' => $ex['name'],
            'kind' => $ex['kind'],
            'pattern' => $ex['pattern'],
            'variant_key' => $variant,
            'target_sets' => $sets,
            'rep_min' => $repMin,
            'rep_max' => $repMax,
            'rest_seconds' => $rest,
            'suggested_weight' => $p['weight'],
            'suggested_reps' => $p['reps'],
            'action' => $p['action'],
            'reason' => $p['why'],
            'previous' => $last,
            'minutes' => round(($sets * (45 + $rest) + 90) / 60, 1),
        ];
    }

    /** Default length of a warm-up with no history to go on. */
    public const WARM_UP_SECONDS = 600;

    /** The sets from the most recent finished session of a cardio exercise, at any gym. */
    public function lastCardio(int $uid, int $exerciseId): ?array
    {
        $cands = $this->db->all(
            "SELECT we.id, w.started_at, w.unit FROM workout_exercises we JOIN workouts w ON w.id=we.workout_id
             WHERE we.user_id=? AND we.exercise_id=? AND w.status='completed'
             ORDER BY w.started_at DESC LIMIT 5",
            [$uid, $exerciseId]
        );
        foreach ($cands as $c) {
            $sets = $this->db->all('SELECT duration_s, distance_m, level FROM workout_sets WHERE workout_exercise_id=? AND done=1 AND duration_s>0 ORDER BY pos', [$c['id']]);
            if ($sets) {
                return [
                    'date' => to_iso($c['started_at']),
                    'unit' => $c['unit'],
                    'sets' => array_map(static fn($s) => [
                        'duration_s' => (int) $s['duration_s'],
                        'distance_m' => $s['distance_m'] === null ? null : (float) $s['distance_m'],
                        'level' => $s['level'] === null ? null : (float) $s['level'],
                    ], $sets),
                ];
            }
        }
        return null;
    }

    /**
     * A cardio exercise as one timed set. The target is the time you did last
     * time, to the minute, or WARM_UP_SECONDS the first time.
     */
    public function cardioBlock(int $uid, array $gym, array $ex): array
    {
        $last = $this->lastCardio($uid, $ex['id']);
        $seconds = $last ? array_sum(array_column($last['sets'], 'duration_s')) : 0;
        $target = $seconds > 0 ? max(60, (int) round($seconds / 60) * 60) : self::WARM_UP_SECONDS;
        $min = intdiv($target, 60);
        return [
            'exercise_id' => $ex['id'],
            'name' => $ex['name'],
            'kind' => $ex['kind'],
            'pattern' => $ex['pattern'],
            'variant_key' => Catalog::variantKey($ex['id'], $ex['kind'], $gym['id']),
            'target_sets' => 1,
            'rep_min' => 1,
            'rep_max' => 1,
            'rest_seconds' => 0,
            'target_seconds' => $target,
            'suggested_weight' => null,
            'suggested_reps' => null,
            'action' => 'warm_up',
            'reason' => $last ? "$min minutes, the same as last time." : "$min minutes at an easy pace to get warm before lifting.",
            'previous' => $last,
            'minutes' => $min + 1,
        ];
    }

    /**
     * The warm-up for a generated workout: a cardio machine the gym has,
     * preferring the one used most recently for a warm-up. Null when the gym
     * has none.
     */
    private function warmUp(array $user, array $gym, array $by, int $lockedId, array $avoid): ?array
    {
        $cands = $by['cardio'] ?? [];
        if (!$cands) {
            return null;
        }
        $byId = array_column($cands, null, 'id');
        if ($lockedId && isset($byId[$lockedId])) {
            return $this->cardioBlock((int) $user['id'], $gym, $byId[$lockedId]) + ['locked' => true];
        }
        $last = [];
        foreach ($this->db->all(
            "SELECT we.exercise_id, MAX(w.started_at) AS at FROM workout_exercises we JOIN workouts w ON w.id=we.workout_id JOIN exercises e ON e.id=we.exercise_id
             WHERE we.user_id=? AND w.status='completed' AND e.pattern='cardio' GROUP BY we.exercise_id",
            [$user['id']]
        ) as $r) {
            $last[(int) $r['exercise_id']] = $r['at'];
        }
        usort($cands, static fn($a, $b) => [isset($avoid[$a['id']]) ? 1 : 0, isset($last[$a['id']]) ? 0 : 1, $last[$b['id']] ?? '', $a['priority'], $a['name']]
            <=> [isset($avoid[$b['id']]) ? 1 : 0, isset($last[$b['id']]) ? 0 : 1, $last[$a['id']] ?? '', $b['priority'], $b['name']]);
        return $this->cardioBlock((int) $user['id'], $gym, $cands[0]) + ['locked' => false];
    }

    /** Exercises the gym's equipment allows, grouped by movement pattern, best pick first. */
    private function available(int $uid, array $gym, bool $bodyweightOnly): array
    {
        $by = [];
        foreach (Catalog::forUser($this->db, $uid) as $ex) {
            if (Catalog::supports($ex, $gym['equipment'], $bodyweightOnly)) {
                $by[$ex['pattern']][] = $ex;
            }
        }
        return $by;
    }

    /**
     * @param array $opts day_type, minutes, locked (slot key => exercise id),
     *                    avoid (exercise ids to steer away from), bodyweight_only,
     *                    warm_up (start with a cardio warm-up), now (unix time)
     */
    public function generate(array $user, array $gym, array $opts = []): array
    {
        $uid = (int) $user['id'];
        $now = (int) ($opts['now'] ?? time());
        $minutes = max(15, min(180, (int) ($opts['minutes'] ?? $user['minutes'])));
        $dayType = $opts['day_type'] ?? null;
        if (!is_string($dayType) || !isset(self::TEMPLATES[$dayType])) {
            $dayType = $this->nextDayType($uid, $user['split_type']);
        }
        $locked = is_array($opts['locked'] ?? null) ? $opts['locked'] : [];
        $avoid = array_flip(array_map('intval', is_array($opts['avoid'] ?? null) ? $opts['avoid'] : []));
        $stats = $this->muscleStats($uid, $now);
        $recent = $this->recentUse($uid, $now);
        $bodyweightOnly = ($opts['bodyweight_only'] ?? false) === true;
        $by = $this->available($uid, $gym, $bodyweightOnly);
        $equipmentContext = $bodyweightOnly ? 'without equipment' : 'with the equipment at ' . $gym['name'];
        $byId = [];
        foreach ($by as $list) {
            foreach ($list as $ex) {
                $byId[$ex['id']] = $ex;
            }
        }

        // Required slots keep their order. Optional ones go to recovered muscles
        // first, then to whichever muscle has had the fewest sets this week.
        $required = [];
        $optional = [];
        foreach (self::TEMPLATES[$dayType] as $i => $slot) {
            $slot[] = $i;
            if ($slot[3]) {
                $required[] = $slot;
            } else {
                $optional[] = $slot;
            }
        }
        usort($optional, static function ($a, $b) use ($stats) {
            $ta = $stats[$a[2]]['recovery'] < 50 ? 1 : 0;
            $tb = $stats[$b[2]]['recovery'] < 50 ? 1 : 0;
            return [$ta, $stats[$a[2]]['weekly_sets'], $a[4]] <=> [$tb, $stats[$b[2]]['weekly_sets'], $b[4]];
        });

        $chosen = [];
        $blocks = [];
        $skipped = [];
        $total = 0.0;
        $warm = null;
        if (($opts['warm_up'] ?? false) === true && !$bodyweightOnly) {
            // Regenerate is for different lifts, so it does not rotate the warm-up machine.
            $warm = $this->warmUp($user, $gym, $by, isset($locked['warmup']) ? (int) $locked['warmup'] : 0, []);
            if ($warm) {
                $warm['slot'] = 'warmup';
                $blocks[] = $warm;
                $chosen[$warm['exercise_id']] = true;
                $total += $warm['minutes'];
            }
        }
        foreach (array_merge($required, $optional) as $slot) {
            [$key, $patterns, $muscle, $isRequired] = $slot;
            $pick = null;
            $how = 'default';
            $lockId = isset($locked[$key]) ? (int) $locked[$key] : 0;
            if ($lockId && isset($byId[$lockId]) && !isset($chosen[$lockId])) {
                $pick = $byId[$lockId];
                $how = 'locked';
            } else {
                $cands = [];
                foreach ($patterns as $pi => $pattern) {
                    foreach ($by[$pattern] ?? [] as $ex) {
                        if (isset($chosen[$ex['id']])) {
                            continue;
                        }
                        $cands[] = [
                            isset($avoid[$ex['id']]) ? 1 : 0,   // steer away from what "Regenerate" just rejected
                            $pi,                                // preferred movement pattern first
                            isset($recent[$ex['id']]) ? 0 : 1,  // then lifts you have been doing, so progression continues
                            -($recent[$ex['id']] ?? 0),
                            $ex['priority'],
                            $ex['name'],
                            $ex,
                        ];
                    }
                }
                if ($cands) {
                    usort($cands, static fn($a, $b) => array_slice($a, 0, 6) <=> array_slice($b, 0, 6));
                    $pick = $cands[0][6];
                    if (isset($recent[$pick['id']])) {
                        $how = 'recent';
                    } elseif ($avoid && !isset($avoid[$pick['id']])) {
                        $how = 'rotated';
                    }
                }
            }
            if (!$pick) {
                if ($isRequired && !$bodyweightOnly) {
                    $skipped[] = 'No ' . strtolower(Catalog::PATTERNS[$patterns[0]]) . " option $equipmentContext.";
                }
                continue;
            }
            $tired = $stats[$muscle]['recovery'] < 50;
            $block = $this->block($user, $gym, $pick, $tired, bodyweightOnly: $bodyweightOnly);
            if (count($blocks) - ($warm ? 1 : 0) >= 3 && $total + $block['minutes'] > $minutes) {
                if ($how === 'locked') {
                    // Locked exercises always stay, even if they run the session long.
                } else {
                    continue;
                }
            }
            $label = strtolower(Catalog::PATTERNS[$pick['pattern']]);
            $mLabel = Catalog::MUSCLES[$muscle];
            if ($how === 'locked') {
                $why = 'You locked this in.';
            } elseif ($how === 'recent') {
                $days = (int) floor(($now - $recent[$pick['id']]) / 86400);
                $when = $days <= 0 ? 'today' : ($days === 1 ? 'yesterday' : "$days days ago");
                $why = "You did this $when, so repeating it keeps your progression moving.";
            } elseif ($how === 'rotated') {
                $why = "A different $label option, as you asked.";
            } elseif ($isRequired) {
                $why = "First choice for $label $equipmentContext.";
            } else {
                $why = "Added because $mLabel has had little work this week (" . self::fmt((float) $stats[$muscle]['weekly_sets']) . ' sets).';
            }
            if ($tired) {
                $why .= ' Estimated recovery for ' . strtolower($mLabel) . " is {$stats[$muscle]['recovery']}%, so this gets one set fewer.";
            }
            $block['slot'] = $key;
            $block['locked'] = $how === 'locked';
            $block['reason'] = $why . ' ' . $block['reason'];
            $blocks[] = $block;
            $chosen[$pick['id']] = true;
            $total += $block['minutes'];
        }

        return [
            'day_type' => $dayType,
            'day_label' => self::DAY_LABELS[$dayType],
            'gym_id' => $gym['id'],
            'gym_name' => $gym['name'],
            'bodyweight_only' => $bodyweightOnly,
            'warm_up' => $warm !== null,
            'warm_up_available' => !$bodyweightOnly && !empty($by['cardio']),
            'unit' => $user['unit'],
            'minutes' => $minutes,
            'est_minutes' => (int) round($total),
            'exercises' => $blocks,
            'skipped' => $skipped,
            'recovery' => $stats,
        ];
    }

    /** Swap candidates: same movement first, then other lifts for the same main muscle. */
    public function alternatives(int $uid, array $gym, int $exerciseId, array $exclude = [], bool $bodyweightOnly = false): array
    {
        $by = $this->available($uid, $gym, $bodyweightOnly);
        $all = Catalog::forUser($this->db, $uid, true);
        $target = null;
        foreach ($all as $ex) {
            if ($ex['id'] === $exerciseId) {
                $target = $ex;
            }
        }
        if (!$target) {
            throw new HttpError(404, 'Exercise not found.');
        }
        $skip = array_flip(array_map('intval', $exclude));
        $skip[$exerciseId] = true;
        $same = [];
        $related = [];
        foreach ($by as $pattern => $list) {
            foreach ($list as $ex) {
                if (isset($skip[$ex['id']])) {
                    continue;
                }
                if ($pattern === $target['pattern'] && $pattern !== 'other') {
                    $same[] = $ex;
                } elseif ($ex['compound'] === $target['compound'] && array_intersect($ex['muscles_main'], $target['muscles_main'])) {
                    $related[] = $ex;
                }
            }
        }
        $sort = static fn($a, $b) => [$a['priority'], $a['name']] <=> [$b['priority'], $b['name']];
        usort($same, $sort);
        usort($related, $sort);
        $out = [];
        foreach ($same as $ex) {
            $out[] = ['exercise_id' => $ex['id'], 'match' => 'Same movement'];
        }
        foreach ($related as $ex) {
            $out[] = ['exercise_id' => $ex['id'], 'match' => 'Same main muscle'];
        }
        return array_slice($out, 0, 15);
    }
}
