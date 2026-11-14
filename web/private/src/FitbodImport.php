<?php
declare(strict_types=1);

namespace TF;

/**
 * Imports a Fitbod "Export Workout Data" CSV.
 *
 * Fitbod writes one row per set: Date, Exercise, Reps, Weight(kg), ...,
 * isWarmup. Every set of a workout carries the same timestamp, so rows are
 * grouped into workouts by Date. Weights are always kilograms (per dumbbell
 * for dumbbell lifts) and are converted to the account's unit.
 *
 * Importing the same file again replaces the earlier import instead of
 * duplicating it, because workout and set ids are derived from the account,
 * the workout timestamp and the set's position.
 */
final class FitbodImport
{
    public const DAY_TYPE = 'fitbod';
    private const LB_PER_KG = 2.20462262;
    private const MAX_BYTES = 8000000;

    /**
     * Fitbod names that are the same lift as a built-in exercise. Each
     * built-in appears at most once, so two different Fitbod exercises are
     * never merged into one history.
     */
    public const MAP = [
        'Barbell Bench Press' => 'barbell-bench-press',
        'Dumbbell Bench Press' => 'dumbbell-bench-press',
        'Machine Bench Press' => 'machine-chest-press',
        'Smith Machine Bench Press' => 'smith-bench-press',
        'Push Up' => 'push-up',
        'Dip' => 'chest-dip',
        'Barbell Incline Bench Press' => 'incline-barbell-press',
        'Dumbbell Incline Bench Press' => 'incline-dumbbell-press',
        'Smith Machine Incline Bench Press' => 'smith-incline-press',
        'Decline Push Up' => 'feet-elevated-push-up',
        'Cable Crossover Fly' => 'cable-fly',
        'Machine Fly' => 'pec-deck',
        'Dumbbell Fly' => 'dumbbell-fly',
        'Handle Band Pec Fly' => 'band-fly',
        'Barbell Shoulder Press' => 'overhead-press',
        'Dumbbell Shoulder Press' => 'seated-dumbbell-press',
        'Standing Dumbbell Shoulder Press' => 'standing-dumbbell-press',
        'Machine Shoulder Press' => 'machine-shoulder-press',
        'Dumbbell Lateral Raise' => 'dumbbell-lateral-raise',
        'Cable Lateral Raise' => 'cable-lateral-raise',
        'Cable Tricep Pushdown' => 'cable-pushdown',
        'Skullcrusher' => 'skull-crusher',
        'Dumbbell Tricep Extension' => 'overhead-dumbbell-extension',
        'Close-Grip Bench Press' => 'close-grip-bench-press',
        'Bench Dip' => 'bench-dip',
        'Diamond Push Up' => 'diamond-push-up',
        'Pull Up' => 'pull-up',
        'Chin Up' => 'chin-up',
        'Lat Pulldown' => 'lat-pulldown',
        'Bent Over Barbell Row' => 'barbell-row',
        'Dumbbell Row' => 'one-arm-dumbbell-row',
        'Cable Row' => 'seated-cable-row',
        'Cable Face Pull' => 'face-pull',
        'Machine Rear Delt Fly' => 'reverse-pec-deck',
        'Dumbbell Rear Delt Raise' => 'bent-over-reverse-fly',
        'EZ-Bar Curl' => 'ez-bar-curl',
        'Barbell Curl' => 'barbell-curl',
        'Dumbbell Bicep Curl' => 'dumbbell-curl',
        'Hammer Curls' => 'hammer-curl',
        'Incline Dumbbell Curl' => 'incline-dumbbell-curl',
        'Cable Bicep Curl' => 'cable-curl',
        'Handle Band Bicep Curl' => 'band-curl',
        'Back Squat' => 'back-squat',
        'Front Squat' => 'front-squat',
        'Goblet Squat' => 'goblet-squat',
        'Machine Leg Press' => 'leg-press',
        'Smith Machine Squat' => 'smith-squat',
        'Air Squats' => 'bodyweight-squat',
        'Romanian Deadlift' => 'romanian-deadlift',
        'Deadlift' => 'deadlift',
        'Dumbbell Romanian Deadlift' => 'dumbbell-rdl',
        'Kettlebell Swing' => 'kettlebell-swing',
        'Back Extensions' => 'back-extension',
        'Single Leg Romanian Deadlift' => 'single-leg-rdl',
        'Dumbbell Bulgarian Split Squat' => 'bulgarian-split-squat',
        'Reverse Lunge' => 'reverse-lunge',
        'Barbell Hip Thrust' => 'barbell-hip-thrust',
        'Dumbbell Hip Thrust' => 'dumbbell-hip-thrust',
        'Seated Leg Curl' => 'leg-curl',
        'Leg Extension' => 'leg-extension',
        'Calf Press' => 'leg-press-calf-raise',
        'Hanging Leg Raise' => 'hanging-leg-raise',
        'Cable Crunch' => 'cable-crunch',
        'Leg Raise' => 'lying-leg-raise',
        'Crunches' => 'crunch',
    ];

    private Db $db;

    public function __construct(Db $db)
    {
        $this->db = $db;
    }

    /**
     * @return array{workouts: array<string, list<array>>, names: array<string, array>, skipped: array<string, int>, rows: int}
     */
    public static function parse(string $csv): array
    {
        if (strlen($csv) > self::MAX_BYTES) {
            throw new HttpError(413, 'That file is too large to be a Fitbod export.');
        }
        if (strncmp($csv, "\xEF\xBB\xBF", 3) === 0) {
            $csv = substr($csv, 3);
        }
        $fh = fopen('php://temp', 'w+');
        fwrite($fh, $csv);
        rewind($fh);
        $head = fgetcsv($fh, 0, ',', '"', '');
        $col = $head ? array_flip(array_map('trim', $head)) : [];
        foreach (['Date', 'Exercise', 'Reps', 'Weight(kg)'] as $need) {
            if (!isset($col[$need])) {
                fclose($fh);
                throw new HttpError(422, 'This does not look like a Fitbod export. It should start with a line containing Date, Exercise, Reps and Weight(kg).');
            }
        }
        $workouts = [];
        $names = [];
        $skipped = [];
        $rows = 0;
        while (($r = fgetcsv($fh, 0, ',', '"', '')) !== false) {
            if ($r === [null] || count($r) < 4) {
                continue;
            }
            $rows++;
            $name = trim((string) ($r[$col['Exercise']] ?? ''));
            $ts = strtotime(trim((string) ($r[$col['Date']] ?? '')));
            if ($name === '' || $ts === false) {
                continue;
            }
            $reps = (int) round((float) trim((string) ($r[$col['Reps']] ?? '0')));
            if ($reps <= 0) {
                // Cardio and timed holds have no reps; there is nothing to progress on.
                $skipped[$name] = ($skipped[$name] ?? 0) + 1;
                continue;
            }
            $kg = max(0.0, (float) trim((string) ($r[$col['Weight(kg)']] ?? '0')));
            $warm = isset($col['isWarmup']) && strtolower(trim((string) ($r[$col['isWarmup']] ?? ''))) === 'true';
            $workouts[now_utc($ts)][] = [$name, min(1000, $reps), $kg, $warm];
            $n = &$names[$name];
            $n['sets'] = ($n['sets'] ?? 0) + 1;
            $n['weighted'] = ($n['weighted'] ?? false) || $kg > 0;
            unset($n);
        }
        fclose($fh);
        ksort($workouts);
        return ['workouts' => $workouts, 'names' => $names, 'skipped' => $skipped, 'rows' => $rows];
    }

    /** Best guess at tags for a Fitbod exercise that has no built-in match. */
    public static function guess(string $name, bool $weighted): array
    {
        $n = strtolower($name);
        $has = static fn(string $re) => preg_match('/' . $re . '/', $n) === 1;

        // What it is loaded with.
        if ($has('\\bband')) {
            $kind = 'band';
        } elseif ($has('cable|shotgun row|straight-arm')) {
            $kind = 'cable';
        } elseif ($has('smith|machine|hammerstrength|home gym|leg press|leg extension|leg curl|hamstrings curl|calf press|rotary torso|stair|pulldown|pull down|assisted|seated back extension')) {
            $kind = 'machine';
        } elseif ($has('kettlebell')) {
            $kind = 'kettlebell';
        } elseif ($has('dumbbell|hammer curl|concentration curl|zottman|arnold|waiter curl|tate press|around the world|side laterals|farmer|biceps curl to|single arm (overhead|floor) press')) {
            $kind = 'dumbbell';
        } elseif ($has('barbell|ez[- ]bar|good morning|pendlay|upright row|preacher curl|reverse grip bench|^hip thrust$')) {
            $kind = 'barbell';
        } else {
            $kind = $weighted && $has('calf raise|shrug') ? 'machine' : 'bodyweight';
        }

        // What a gym needs for it. An empty list means "available anywhere".
        $equipment = [];
        if ($kind === 'machine') {
            foreach ([
                'smith' => 'smith', 'calf' => 'calf_raise', 'leg press' => 'leg_press', 'leg extension' => 'leg_extension',
                'leg curl|hamstrings curl' => 'leg_curl', 'pulldown|pull down' => 'lat_pulldown',
                'chest press|bench press' => 'chest_press', 'shoulder press' => 'shoulder_press',
                'fly' => 'pec_deck', '\\brow' => 'seated_row', 'back extension' => 'back_extension',
            ] as $re => $key) {
                if ($has($re)) {
                    $equipment = [$key];
                    break;
                }
            }
        } elseif ($kind === 'cable') {
            $equipment = ['cable'];
        } elseif ($kind === 'band') {
            $equipment = ['bands'];
        } elseif ($kind === 'kettlebell') {
            $equipment = ['kettlebells'];
        } elseif ($kind === 'dumbbell') {
            $equipment = ['dumbbells'];
            if ($has('incline')) {
                $equipment[] = 'incline_bench';
            } elseif ($has('bench|skullcrusher|pullover|squeeze press|tate press|split squat|hip thrust')) {
                $equipment[] = 'bench';
            }
        } elseif ($kind === 'barbell') {
            $equipment = [$has('ez[- ]bar|preacher') ? 'ez_bar' : 'barbell'];
            if ($has('incline')) {
                $equipment[] = 'incline_bench';
            } elseif ($has('bench|seated|pull ?over|hip thrust')) {
                $equipment[] = 'bench';
            }
        } elseif ($has('pull up|\\bchin|hanging|vertical knee')) {
            $equipment = ['pullup_bar'];
        } elseif ($has('^dip$')) {
            $equipment = ['dip_bars'];
        }

        // Which slot it can fill. "other" is never suggested automatically.
        $rules = [
            ['wrist curl|farmer', 'other', ['forearms'], []],
            ['shrug', 'other', ['upper_back'], []],
            ['curl to shoulder press', 'other', ['biceps', 'shoulders'], []],
            ['squat to shoulder press', 'other', ['quads', 'shoulders'], ['glutes']],
            ['front raise|upright row|shoulder.*rotation|cuban|around the world', 'other', ['shoulders'], []],
            ['pull ?over|straight-arm', 'other', ['lats'], ['chest']],
            ['abductor|adductor|kickback machine|leg kickback|lateral walk|side step', 'other', ['glutes'], []],
            ['jumping jack', 'other', [], []],
            ['superman|bird dog', 'other', ['lower_back'], ['glutes']],
            ['leg curl|hamstrings curl', 'knee_flexion', ['hamstrings'], []],
            ['leg extension', 'knee_extension', ['quads'], []],
            ['calf', 'calf', ['calves'], []],
            ['leg press', 'squat', ['quads', 'glutes'], ['hamstrings']],
            ['split squat|lunge|step[- ]up|pistol', 'lunge', ['quads', 'glutes'], ['hamstrings']],
            ['tricep|skullcrusher|kickback|pushdown|tate press|close-grip.*(bench|press)|\\bdip\\b', 'triceps', ['triceps'], []],
            ['crunch|sit up|leg raise|knee raise|plank|twist|scissor|flutter|pull-in|pull in|pike|wood chop|side bend|oblique|iron cross|side bridge|rotary|mountain climber', 'core', ['abs'], []],
            ['curl', 'biceps', ['biceps'], ['forearms']],
            ['lateral raise|side laterals', 'lateral_raise', ['shoulders'], []],
            ['rear delt|face pull|back fly|reverse fly', 'rear_delt', ['upper_back'], ['shoulders']],
            ['fly|squeeze press', 'chest_fly', ['chest'], ['shoulders']],
            ['incline.*(press|bench)', 'incline_push', ['chest'], ['shoulders', 'triceps']],
            ['shoulder press|overhead press|arnold', 'vertical_push', ['shoulders'], ['triceps']],
            ['bench press|chest press|push up|floor press|decline press', 'horizontal_push', ['chest'], ['triceps', 'shoulders']],
            ['pulldown|pull down|pull up|\\bchin', 'vertical_pull', ['lats'], ['biceps', 'upper_back']],
            ['\\brow', 'horizontal_pull', ['upper_back', 'lats'], ['biceps']],
            ['hip thrust|glute bridge|hip bridge', 'hip_thrust', ['glutes'], ['hamstrings']],
            ['squat', 'squat', ['quads', 'glutes'], ['hamstrings']],
            ['deadlift|good morning|swing|back extension', 'hinge', ['hamstrings', 'glutes'], ['lower_back']],
        ];
        $pattern = 'other';
        $main = [];
        $assist = [];
        foreach ($rules as [$re, $p, $m, $a]) {
            if ($has($re)) {
                [$pattern, $main, $assist] = [$p, $m, $a];
                break;
            }
        }
        // A machine the gym profile has no checkbox for would look "available
        // everywhere", so keep it out of automatic suggestions.
        if ($kind === 'machine' && !$equipment) {
            $pattern = 'other';
        }
        return ['kind' => $kind, 'equipment' => $equipment, 'pattern' => $pattern, 'muscles_main' => $main, 'muscles_assist' => $assist];
    }

    private static function slug(string $name): string
    {
        return 'fitbod-' . substr(sha1(strtolower($name)), 0, 20);
    }

    private static function uuidFrom(string $seed): string
    {
        $h = sha1($seed);
        return sprintf('%s-%s-5%s-%x%s-%s', substr($h, 0, 8), substr($h, 8, 4), substr($h, 13, 3), (hexdec($h[16]) & 0x3) | 0x8, substr($h, 17, 3), substr($h, 20, 12));
    }

    /**
     * Decides what each Fitbod exercise becomes.
     *
     * @param array $choices optional overrides: Fitbod name => 'skip' | 'new' | exercise id
     * @return list<array> one entry per Fitbod exercise, most-used first
     */
    public function plan(int $uid, array $parsed, array $choices = []): array
    {
        $bySlug = [];
        $byId = [];
        foreach ($this->db->all('SELECT id, slug, name, kind, user_id FROM exercises WHERE user_id IS NULL OR user_id=?', [$uid]) as $r) {
            $bySlug[$r['slug']] = $r;
            $byId[(int) $r['id']] = $r;
        }
        $out = [];
        foreach ($parsed['names'] as $name => $info) {
            $choice = $choices[$name] ?? null;
            $entry = ['name' => $name, 'sets' => $info['sets'], 'action' => 'new', 'exercise_id' => null, 'exercise_name' => null];
            $guess = self::guess($name, (bool) $info['weighted']);
            $default = null;
            if (isset(self::MAP[$name], $bySlug[self::MAP[$name]])) {
                $default = $bySlug[self::MAP[$name]];
            } elseif (isset($bySlug[self::slug($name)])) {
                $default = $bySlug[self::slug($name)]; // created by an earlier import
            }
            if ($choice === 'skip') {
                $entry['action'] = 'skip';
            } elseif (is_numeric($choice) && isset($byId[(int) $choice])) {
                $entry = ['action' => 'match', 'exercise_id' => (int) $choice, 'exercise_name' => $byId[(int) $choice]['name']] + $entry;
            } elseif ($choice !== 'new' && $default) {
                $entry = ['action' => 'match', 'exercise_id' => (int) $default['id'], 'exercise_name' => $default['name']] + $entry;
            } elseif ($choice === 'new' && isset($bySlug[self::slug($name)])) {
                $own = $bySlug[self::slug($name)];
                $entry = ['action' => 'match', 'exercise_id' => (int) $own['id'], 'exercise_name' => $own['name']] + $entry;
            }
            $entry['suggested_id'] = $default ? (int) $default['id'] : null;
            $entry['guess'] = $guess;
            $out[] = $entry;
        }
        usort($out, static fn($a, $b) => [$b['sets'], $a['name']] <=> [$a['sets'], $b['name']]);
        return $out;
    }

    public function summary(array $parsed, array $plan): array
    {
        $skipNames = [];
        foreach ($plan as $p) {
            if ($p['action'] === 'skip') {
                $skipNames[$p['name']] = true;
            }
        }
        $workouts = 0;
        $sets = 0;
        foreach ($parsed['workouts'] as $rows) {
            $n = 0;
            foreach ($rows as $r) {
                if (!isset($skipNames[$r[0]])) {
                    $n++;
                }
            }
            if ($n) {
                $workouts++;
                $sets += $n;
            }
        }
        $dates = array_keys($parsed['workouts']);
        return [
            'workouts' => $workouts,
            'sets' => $sets,
            'from' => $dates ? to_iso($dates[0]) : null,
            'to' => $dates ? to_iso($dates[count($dates) - 1]) : null,
            'not_importable' => $parsed['skipped'],
            'not_importable_rows' => array_sum($parsed['skipped']),
        ];
    }

    private function insertMany(string $table, array $cols, array $rows): void
    {
        if (!$rows) {
            return;
        }
        // Stay under SQLite's limit on placeholders per statement.
        $per = max(1, intdiv(900, count($cols)));
        $one = '(' . Db::marks($cols) . ')';
        foreach (array_chunk($rows, $per) as $chunk) {
            $sql = "INSERT INTO $table (" . implode(',', $cols) . ') VALUES ' . implode(',', array_fill(0, count($chunk), $one));
            $this->db->run($sql, array_merge(...$chunk));
        }
    }

    /** Removes every workout a Fitbod import created. Exercises it added are kept. */
    public function purge(int $uid): int
    {
        $n = (int) $this->db->val('SELECT COUNT(*) FROM workouts WHERE user_id=? AND day_type=?', [$uid, self::DAY_TYPE]);
        $this->db->tx(function () use ($uid) {
            $sub = 'SELECT id FROM workouts WHERE user_id=? AND day_type=?';
            $this->db->run("DELETE FROM workout_sets WHERE workout_id IN ($sub)", [$uid, self::DAY_TYPE]);
            $this->db->run("DELETE FROM workout_exercises WHERE workout_id IN ($sub)", [$uid, self::DAY_TYPE]);
            $this->db->run('DELETE FROM workouts WHERE user_id=? AND day_type=?', [$uid, self::DAY_TYPE]);
        });
        return $n;
    }

    /** Writes the workouts. Returns counts. */
    public function run(int $uid, array $gym, string $unit, array $parsed, array $plan): array
    {
        $target = [];   // Fitbod name => [exercise id, kind]
        $created = 0;
        $kinds = [];
        foreach ($this->db->all('SELECT id, kind FROM exercises WHERE user_id IS NULL OR user_id=?', [$uid]) as $r) {
            $kinds[(int) $r['id']] = $r['kind'];
        }
        $rowsW = [];
        $rowsE = [];
        $rowsS = [];
        $ids = [];
        $now = now_utc();

        $this->db->tx(function () use ($uid, $gym, $unit, $parsed, $plan, &$target, &$created, &$kinds, &$rowsW, &$rowsE, &$rowsS, &$ids, $now) {
            foreach ($plan as $p) {
                if ($p['action'] === 'skip') {
                    continue;
                }
                if ($p['action'] === 'match') {
                    $target[$p['name']] = [$p['exercise_id'], $kinds[$p['exercise_id']]];
                    continue;
                }
                $g = $p['guess'];
                $id = $this->db->insert('exercises', [
                    'user_id' => $uid,
                    'slug' => self::slug($p['name']),
                    'name' => mb_substr($p['name'], 0, 120),
                    'kind' => $g['kind'],
                    'equipment' => json_encode($g['equipment']),
                    'pattern' => $g['pattern'],
                    'muscles_main' => json_encode($g['muscles_main']),
                    'muscles_assist' => json_encode($g['muscles_assist']),
                    'cues' => '',
                    'priority' => 4,
                ]);
                $kinds[$id] = $g['kind'];
                $target[$p['name']] = [$id, $g['kind']];
                $created++;
            }

            $step = $unit === 'kg' ? 0.5 : 0.5;
            foreach ($parsed['workouts'] as $date => $sets) {
                $wid = self::uuidFrom("fitbod|$uid|$date");
                $groups = []; // exercise id => sets, in order of first appearance
                foreach ($sets as [$name, $reps, $kg, $warm]) {
                    if (!isset($target[$name])) {
                        continue;
                    }
                    $w = $unit === 'kg' ? $kg : $kg * self::LB_PER_KG;
                    $groups[$target[$name][0]][] = [round($w / $step) * $step, $reps, $warm ? 1 : 0];
                }
                if (!$groups) {
                    continue;
                }
                $ids[] = $wid;
                $rowsW[] = [$wid, $uid, $gym['id'], $gym['name'], self::DAY_TYPE, 'completed', $unit, $date, $date, 'Imported from Fitbod', 1, $now];
                $pos = 0;
                foreach ($groups as $exId => $list) {
                    $weid = self::uuidFrom("$wid|e|$exId");
                    $reps = array_column($list, 1);
                    $rowsE[] = [$weid, $wid, $uid, $exId, Catalog::variantKey((int) $exId, $kinds[$exId], $gym['id']), $pos++, count($list), min($reps), max($reps), 90, null, null];
                    foreach ($list as $i => [$w, $r, $warm]) {
                        $rowsS[] = [self::uuidFrom("$weid|s|$i"), $weid, $wid, $i, $w, $r, $warm, 1, $date];
                    }
                }
            }

            // Replace anything a previous import of the same workouts left behind.
            foreach (array_chunk($ids, 300) as $chunk) {
                $marks = Db::marks($chunk);
                $this->db->run("DELETE FROM workout_sets WHERE workout_id IN ($marks)", $chunk);
                $this->db->run("DELETE FROM workout_exercises WHERE workout_id IN ($marks)", $chunk);
                $this->db->run("DELETE FROM workouts WHERE user_id=? AND id IN ($marks)", array_merge([$uid], $chunk));
            }
            $this->insertMany('workouts', ['id', 'user_id', 'gym_id', 'gym_name', 'day_type', 'status', 'unit', 'started_at', 'completed_at', 'notes', 'rev', 'updated_at'], $rowsW);
            $this->insertMany('workout_exercises', ['id', 'workout_id', 'user_id', 'exercise_id', 'variant_key', 'pos', 'target_sets', 'rep_min', 'rep_max', 'rest_seconds', 'suggested_weight', 'reason'], $rowsE);
            $this->insertMany('workout_sets', ['id', 'workout_exercise_id', 'workout_id', 'pos', 'weight', 'reps', 'warmup', 'done', 'done_at'], $rowsS);
        });

        return ['workouts' => count($rowsW), 'sets' => count($rowsS), 'exercises_created' => $created];
    }
}
