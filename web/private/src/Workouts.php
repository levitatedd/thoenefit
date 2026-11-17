<?php
declare(strict_types=1);

namespace TF;

/**
 * Stores and reads workouts. A workout is saved as one whole document with
 * client-generated IDs and a revision number, so sending the same save twice
 * (or after a dropped connection) can never create duplicate sets.
 */
final class Workouts
{
    private Db $db;

    public function __construct(Db $db)
    {
        $this->db = $db;
    }

    public function save(int $uid, array $d): array
    {
        if (!is_uuid($d['id'] ?? null)) {
            throw new HttpError(422, 'Workout id is missing or malformed.');
        }
        $id = strtolower($d['id']);
        $rev = max(1, (int) ($d['rev'] ?? 1));
        $status = ($d['status'] ?? 'active') === 'completed' ? 'completed' : 'active';
        $existing = $this->db->one('SELECT user_id, rev, status FROM workouts WHERE id=?', [$id]);
        if ($existing && (int) $existing['user_id'] !== $uid) {
            throw new HttpError(403, 'That workout belongs to another account.');
        }
        if ($existing && (int) $existing['rev'] > $rev) {
            // A newer edit already arrived (another device or an out-of-order retry).
            return ['ok' => false, 'conflict' => true, 'workout' => $this->get($uid, $id)];
        }

        $gymId = isset($d['gym_id']) ? (int) $d['gym_id'] : null;
        $gymName = 'No gym';
        if ($gymId) {
            $gym = $this->db->one('SELECT id, name FROM gyms WHERE id=? AND user_id=?', [$gymId, $uid]);
            if ($gym) {
                $gymName = $gym['name'];
            } else {
                // The gym was deleted after this workout was logged: keep its history key and old name.
                $gymName = mb_substr((string) ($d['gym_name'] ?? 'Deleted gym'), 0, 100);
            }
        }
        $unit = ($d['unit'] ?? 'lb') === 'kg' ? 'kg' : 'lb';
        $started = norm_time($d['started_at'] ?? null) ?? now_utc();
        $completed = $status === 'completed' ? (norm_time($d['completed_at'] ?? null) ?? now_utc()) : null;
        // Paused time (#111) is left out of the workout's duration. A workout finished
        // while paused counts the pause up to the finish.
        $pausedS = is_numeric($d['paused_s'] ?? null) ? max(0, min(172800, (int) $d['paused_s'])) : 0;
        $pausedAt = norm_time($d['paused_at'] ?? null);
        if ($pausedAt !== null && $completed !== null) {
            $pausedS = min(172800, $pausedS + max(0, (int) (self::ts($completed) - self::ts($pausedAt))));
            $pausedAt = null;
        }

        $kinds = [];
        foreach ($this->db->all('SELECT id, kind FROM exercises WHERE user_id IS NULL OR user_id=?', [$uid]) as $r) {
            $kinds[(int) $r['id']] = $r['kind'];
        }

        $exRows = [];
        $setRows = [];
        $notes = []; // note key => setup note, for entries that carry one (#125)
        $exercises = is_array($d['exercises'] ?? null) ? array_values($d['exercises']) : [];
        if (count($exercises) > 40) {
            throw new HttpError(422, 'A workout can hold at most 40 exercises.');
        }
        $seen = [];
        foreach ($exercises as $pos => $e) {
            $exId = (int) ($e['exercise_id'] ?? 0);
            if (!is_uuid($e['id'] ?? null) || !isset($kinds[$exId])) {
                throw new HttpError(422, 'Exercise entry ' . ($pos + 1) . ' is malformed.');
            }
            $weId = strtolower($e['id']);
            if (isset($seen[$weId])) {
                continue;
            }
            $seen[$weId] = true;
            $repMin = max(1, min(100, (int) ($e['rep_min'] ?? 8)));
            $repMax = max($repMin, min(100, (int) ($e['rep_max'] ?? 12)));
            $sugg = $e['suggested_weight'] ?? null;
            $targetSeconds = $e['target_seconds'] ?? null;
            if (array_key_exists('setup_note', $e)) {
                $notes[self::noteKey($exId, $gymId)] = self::cleanNote((string) $e['setup_note']);
            }
            $exRows[] = [
                'id' => $weId,
                'workout_id' => $id,
                'user_id' => $uid,
                'exercise_id' => $exId,
                'variant_key' => Catalog::variantKey($exId, $kinds[$exId], $gymId),
                'pos' => $pos,
                'target_sets' => max(1, min(20, (int) ($e['target_sets'] ?? 3))),
                'rep_min' => $repMin,
                'rep_max' => $repMax,
                'rest_seconds' => max(0, min(900, (int) ($e['rest_seconds'] ?? 90))),
                'suggested_weight' => is_numeric($sugg) ? round((float) $sugg, 2) : null,
                'reason' => isset($e['reason']) ? mb_substr((string) $e['reason'], 0, 1000) : null,
                'target_seconds' => is_numeric($targetSeconds) ? max(0, min(86400, (int) $targetSeconds)) : null,
                // Difficulty (#170): reps left at the end of a typical working set, 0-4 (4 = 4+).
                'reps_left' => self::repsLeft($e['reps_left'] ?? null),
            ];
            $sets = is_array($e['sets'] ?? null) ? array_values($e['sets']) : [];
            if (count($sets) > 30) {
                throw new HttpError(422, 'An exercise can hold at most 30 sets.');
            }
            foreach ($sets as $spos => $s) {
                if (!is_uuid($s['id'] ?? null)) {
                    throw new HttpError(422, 'A set is missing its id.');
                }
                $sid = strtolower($s['id']);
                if (isset($seen[$sid])) {
                    continue;
                }
                $seen[$sid] = true;
                $w = $s['weight'] ?? null;
                $r = $s['reps'] ?? null;
                $dur = $s['duration_s'] ?? null;
                $dist = $s['distance_m'] ?? null;
                $lvl = $s['level'] ?? null;
                $done = !empty($s['done']);
                $setRows[] = [
                    'id' => $sid,
                    'workout_exercise_id' => $weId,
                    'workout_id' => $id,
                    'pos' => $spos,
                    'weight' => is_numeric($w) ? max(0, min(99999, round((float) $w, 2))) : null,
                    'reps' => is_numeric($r) ? max(0, min(1000, (int) $r)) : null,
                    'warmup' => empty($s['warmup']) ? 0 : 1,
                    'done' => $done ? 1 : 0,
                    'done_at' => $done ? (norm_time($s['done_at'] ?? null) ?? now_utc()) : null,
                    // Cardio (#18): time, and optionally distance in metres and the machine's level.
                    'duration_s' => is_numeric($dur) ? max(0, min(86400, (int) round((float) $dur))) : null,
                    'distance_m' => is_numeric($dist) ? max(0, min(1000000, round((float) $dist, 1))) : null,
                    'level' => is_numeric($lvl) ? max(0, min(1000, round((float) $lvl, 1))) : null,
                ];
            }
        }

        $row = [
            'user_id' => $uid,
            'gym_id' => $gymId,
            'gym_name' => $gymName,
            'day_type' => mb_substr((string) ($d['day_type'] ?? 'custom'), 0, 20),
            'status' => $status,
            'unit' => $unit,
            'started_at' => $started,
            'completed_at' => $completed,
            'notes' => isset($d['notes']) ? mb_substr((string) $d['notes'], 0, 2000) : null,
            // How hard it felt, chosen when finishing (#38). Used for the calorie estimate.
            'effort' => isset(Calories::EFFORTS[$d['effort'] ?? '']) ? $d['effort'] : null,
            // Chosen by the lifter rather than a default kept for calories (#198); only these plan future workouts.
            'effort_rated' => !empty($d['effort_rated']) && isset(Calories::EFFORTS[$d['effort'] ?? '']) ? 1 : 0,
            'paused_s' => $pausedS,
            'paused_at' => $pausedAt,
            'rev' => $rev,
            'updated_at' => now_utc(),
        ];

        $this->db->tx(function (Db $db) use ($id, $uid, $existing, $row, $exRows, $setRows, $status, $notes) {
            // Setup notes ride on the workout so they can be written offline (#125). Empty clears.
            foreach ($notes as $key => $note) {
                self::putNote($db, $uid, (string) $key, $note);
            }
            if ($existing) {
                $db->update('workouts', $row, 'id=?', [$id]);
            } else {
                $db->insert('workouts', ['id' => $id] + $row);
            }
            $db->run('DELETE FROM workout_sets WHERE workout_id=?', [$id]);
            $db->run('DELETE FROM workout_exercises WHERE workout_id=?', [$id]);
            foreach ($exRows as $r) {
                $db->insert('workout_exercises', $r);
            }
            foreach ($setRows as $r) {
                $db->insert('workout_sets', $r);
            }
            if ($status === 'active') {
                // Only one workout can be in progress. Close any other, or drop it if nothing was logged.
                foreach ($db->all("SELECT id FROM workouts WHERE user_id=? AND status='active' AND id<>?", [$uid, $id]) as $o) {
                    $n = (int) $db->val('SELECT COUNT(*) FROM workout_sets WHERE workout_id=? AND done=1', [$o['id']]);
                    if ($n > 0) {
                        $db->run("UPDATE workouts SET status='completed', completed_at=?, updated_at=?, rev=rev+1 WHERE id=?", [now_utc(), now_utc(), $o['id']]);
                    } else {
                        $this->deleteRows($db, $o['id']);
                    }
                }
            }
        });

        // completed_now: this save is the one that finished the workout (#87). A repeated
        // save of an already finished workout, or a later edit, is not.
        return ['ok' => true, 'rev' => $rev, 'completed_now' => $status === 'completed' && (!$existing || $existing['status'] !== 'completed')];
    }

    private function deleteRows(Db $db, string $id): void
    {
        $db->run('DELETE FROM workout_sets WHERE workout_id=?', [$id]);
        $db->run('DELETE FROM workout_exercises WHERE workout_id=?', [$id]);
        $db->run('DELETE FROM workouts WHERE id=?', [$id]);
    }

    public function delete(int $uid, string $id): void
    {
        if (!is_uuid($id)) {
            throw new HttpError(422, 'Workout id is malformed.');
        }
        $id = strtolower($id);
        $w = $this->db->one('SELECT user_id FROM workouts WHERE id=?', [$id]);
        if (!$w) {
            return; // already gone: deleting twice is fine
        }
        if ((int) $w['user_id'] !== $uid) {
            throw new HttpError(403, 'That workout belongs to another account.');
        }
        $this->db->tx(fn(Db $db) => $this->deleteRows($db, $id));
    }

    public function get(int $uid, string $id): ?array
    {
        $w = $this->db->one('SELECT * FROM workouts WHERE id=? AND user_id=?', [strtolower($id), $uid]);
        if (!$w) {
            return null;
        }
        $exs = $this->db->all(
            'SELECT we.*, e.slug, e.name, e.kind, e.pattern FROM workout_exercises we JOIN exercises e ON e.id=we.exercise_id WHERE we.workout_id=? ORDER BY we.pos',
            [$w['id']]
        );
        $sets = [];
        foreach ($this->db->all('SELECT * FROM workout_sets WHERE workout_id=? ORDER BY pos', [$w['id']]) as $s) {
            $sets[$s['workout_exercise_id']][] = [
                'id' => $s['id'],
                'weight' => $s['weight'] === null ? null : (float) $s['weight'],
                'reps' => $s['reps'] === null ? null : (int) $s['reps'],
                'warmup' => (int) $s['warmup'] === 1,
                'done' => (int) $s['done'] === 1,
                'done_at' => to_iso($s['done_at']),
                'duration_s' => $s['duration_s'] === null ? null : (int) $s['duration_s'],
                'distance_m' => $s['distance_m'] === null ? null : (float) $s['distance_m'],
                'level' => $s['level'] === null ? null : (float) $s['level'],
            ];
        }
        $out = [
            'id' => $w['id'],
            'gym_id' => $w['gym_id'] === null ? null : (int) $w['gym_id'],
            'gym_name' => $w['gym_name'],
            'day_type' => $w['day_type'],
            'status' => $w['status'],
            'unit' => $w['unit'],
            'started_at' => to_iso($w['started_at']),
            'completed_at' => to_iso($w['completed_at']),
            'notes' => $w['notes'],
            'effort' => $w['effort'] ?? null,
            'effort_rated' => (int) ($w['effort_rated'] ?? 0) === 1,
            'paused_s' => (int) ($w['paused_s'] ?? 0),
            'paused_at' => to_iso($w['paused_at'] ?? null),
            'rev' => (int) $w['rev'],
            'exercises' => [],
        ];
        foreach ($exs as $e) {
            $out['exercises'][] = [
                'id' => $e['id'],
                'exercise_id' => (int) $e['exercise_id'],
                'slug' => $e['slug'],
                'name' => $e['name'],
                'kind' => $e['kind'],
                'pattern' => $e['pattern'],
                'variant_key' => $e['variant_key'],
                'target_sets' => (int) $e['target_sets'],
                'rep_min' => (int) $e['rep_min'],
                'rep_max' => (int) $e['rep_max'],
                'rest_seconds' => (int) $e['rest_seconds'],
                'suggested_weight' => $e['suggested_weight'] === null ? null : (float) $e['suggested_weight'],
                'reason' => $e['reason'],
                'target_seconds' => $e['target_seconds'] === null ? null : (int) $e['target_seconds'],
                'reps_left' => self::repsLeft($e['reps_left'] ?? null),
                'sets' => $sets[$e['id']] ?? [],
            ];
        }
        return $out;
    }

    /** A difficulty rating (#170): 0-4 reps left (4 = 4 or more), or null for none. */
    public static function repsLeft($v): ?int
    {
        if ($v === null || $v === '' || !is_numeric($v)) {
            return null;
        }
        $n = (int) $v;
        return $n >= 0 && $n <= 4 && (float) $v === (float) $n ? $n : null;
    }

    public function active(int $uid): ?array
    {
        $id = $this->db->val("SELECT id FROM workouts WHERE user_id=? AND status='active' ORDER BY started_at DESC LIMIT 1", [$uid]);
        return $id ? $this->get($uid, (string) $id) : null;
    }

    /** Completed workouts, newest first, with totals for the History list. */
    public function history(int $uid, int $limit = 30, int $offset = 0): array
    {
        $limit = max(1, min(100, $limit));
        $offset = max(0, $offset);
        $ws = $this->db->all(
            "SELECT id, gym_name, day_type, unit, started_at, completed_at FROM workouts WHERE user_id=? AND status='completed' ORDER BY started_at DESC LIMIT $limit OFFSET $offset",
            [$uid]
        );
        if (!$ws) {
            return [];
        }
        $ids = array_column($ws, 'id');
        $marks = Db::marks($ids);
        $names = [];
        foreach ($this->db->all("SELECT we.workout_id, e.name FROM workout_exercises we JOIN exercises e ON e.id=we.exercise_id WHERE we.workout_id IN ($marks) ORDER BY we.pos", $ids) as $r) {
            $names[$r['workout_id']][] = $r['name'];
        }
        $totals = [];
        $timed = Db::marks(Catalog::TIMED_KINDS);
        foreach ($this->db->all(
            "SELECT s.workout_id, s.weight, s.reps FROM workout_sets s JOIN workout_exercises we ON we.id=s.workout_exercise_id JOIN exercises e ON e.id=we.exercise_id
             WHERE s.workout_id IN ($marks) AND s.done=1 AND s.warmup=0 AND e.kind NOT IN ($timed)",
            array_merge($ids, Catalog::TIMED_KINDS)
        ) as $s) {
            $t = &$totals[$s['workout_id']];
            $t['sets'] = ($t['sets'] ?? 0) + 1;
            $t['volume'] = ($t['volume'] ?? 0) + (float) $s['weight'] * (int) $s['reps'];
            unset($t);
        }
        $out = [];
        foreach ($ws as $w) {
            $out[] = [
                'id' => $w['id'],
                'gym_name' => $w['gym_name'],
                'day_type' => $w['day_type'],
                'unit' => $w['unit'],
                'started_at' => to_iso($w['started_at']),
                'completed_at' => to_iso($w['completed_at']),
                'exercises' => $names[$w['id']] ?? [],
                'sets' => $totals[$w['id']]['sets'] ?? 0,
                'volume' => round($totals[$w['id']]['volume'] ?? 0),
            ];
        }
        return $out;
    }

    /** A gap longer than this before the first logged set or after the last counts as idle (#49). */
    public const IDLE_GAP = 30 * 60;
    /** What is kept of an idle gap: room for a warm-up before and a cool-down after. */
    public const IDLE_EDGE = 5 * 60;
    /** Trends leaves out a workout still longer than this after idle time is removed. */
    public const MAX_COUNTED = 4 * 3600;

    private static function ts(?string $value): ?int
    {
        if ($value === null || $value === '') {
            return null;
        }
        // Stored times are UTC without a zone; strtotime would read them as server-local time.
        $t = strtotime(preg_match('/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/', $value) ? $value . ' UTC' : $value);
        return $t === false ? null : $t;
    }

    /**
     * The part of a workout that was actually training: from start to finish,
     * minus idle time. A workout started long before its first logged set, or
     * finished long after its last one (left open overnight, say), keeps only
     * IDLE_EDGE of that gap. Gaps up to IDLE_GAP are left as they are.
     *
     * Time spent paused (#111) is then taken off: `seconds` is the training time,
     * which is what durations, calories and Strava use.
     *
     * @param string|null $firstDone time the earliest completed set was logged
     * @param string|null $lastDone  time the latest completed set was logged
     * @return array{start: int, end: int, seconds: int}|null null when there is no positive duration
     */
    public static function activeSpan(?string $startedAt, ?string $completedAt, ?string $firstDone = null, ?string $lastDone = null, int $pausedS = 0): ?array
    {
        $start = self::ts($startedAt);
        $end = self::ts($completedAt);
        if ($start === null || $end === null || $end <= $start) {
            return null;
        }
        $first = self::ts($firstDone);
        $last = self::ts($lastDone);
        if ($first !== null && $first - $start > self::IDLE_GAP) {
            $start = min($end, $first - self::IDLE_EDGE);
        }
        if ($last !== null && $end - $last > self::IDLE_GAP) {
            $end = max($start, $last + self::IDLE_EDGE);
        }
        $seconds = $end - $start - max(0, $pausedS);
        return $seconds > 0 ? ['start' => $start, 'end' => $end, 'seconds' => $seconds] : null;
    }

    /** activeSpan() for a workout as returned by get(). */
    public static function workoutSpan(array $workout): ?array
    {
        $times = [];
        foreach ($workout['exercises'] ?? [] as $e) {
            foreach ($e['sets'] as $s) {
                if (!empty($s['done']) && !empty($s['done_at']) && ($t = self::ts($s['done_at'])) !== null) {
                    $times[] = $t;
                }
            }
        }
        $iso = static fn(?int $t) => $t === null ? null : gmdate('Y-m-d\TH:i:s\Z', $t);
        return self::activeSpan($workout['started_at'] ?? null, $workout['completed_at'] ?? null, $iso($times ? min($times) : null), $iso($times ? max($times) : null), (int) ($workout['paused_s'] ?? 0));
    }

    /** Eight Monday-start weeks in the user's timezone, grouped by workout start. */
    public function weeklyTrends(int $uid, string $unit, string $timezone, ?int $now = null): array
    {
        try {
            $zone = new \DateTimeZone($timezone);
        } catch (\Exception $e) {
            $zone = new \DateTimeZone('UTC');
        }
        $now ??= time();
        $date = (new \DateTimeImmutable('@' . $now))->setTimezone($zone);
        $first = $date->modify('monday this week')->setTime(0, 0)->modify('-7 weeks');
        $weeks = [];
        for ($i = 0; $i < 8; $i++) {
            $start = $first->modify("+$i weeks")->format('Y-m-d');
            $weeks[$start] = ['start' => $start, 'workouts' => 0, 'volume' => 0.0, 'seconds' => null];
        }
        $workouts = $this->db->all(
            "SELECT w.id, w.started_at, w.completed_at, w.unit, w.paused_s,
                    SUM(CASE WHEN s.warmup=0 THEN s.weight * s.reps ELSE 0 END) AS volume,
                    MIN(s.done_at) AS first_done, MAX(s.done_at) AS last_done
             FROM workouts w
             LEFT JOIN workout_sets s ON s.workout_id=w.id AND s.done=1
             WHERE w.user_id=? AND w.status='completed' AND w.started_at BETWEEN ? AND ?
             GROUP BY w.id, w.started_at, w.completed_at, w.unit, w.paused_s",
            [$uid, now_utc($first->getTimestamp()), now_utc($now)]
        );
        foreach ($workouts as $w) {
            $start = (new \DateTimeImmutable(to_iso($w['started_at'])))->setTimezone($zone);
            $key = $start->modify('monday this week')->format('Y-m-d');
            $volume = (float) $w['volume'];
            if ($w['unit'] !== $unit) {
                $volume = $w['unit'] === 'kg' ? $volume * 2.20462262 : $volume / 2.20462262;
            }
            $weeks[$key]['workouts']++;
            $weeks[$key]['volume'] += $volume;
            // Idle time before the first set or after the last is removed, and a
            // workout still over MAX_COUNTED is left out, like one with no duration.
            $span = self::activeSpan($w['started_at'], $w['completed_at'], $w['first_done'], $w['last_done'], (int) $w['paused_s']);
            $elapsed = $span ? $span['seconds'] : 0;
            if ($elapsed > 0 && $elapsed <= self::MAX_COUNTED) {
                $weeks[$key]['seconds'] = ($weeks[$key]['seconds'] ?? 0) + $elapsed;
            }
        }
        return array_values($weeks);
    }

    /**
     * How many finished workouts include each exercise with at least one logged
     * set, counted once per workout (#174). Keyed by exercise id.
     */
    public function exerciseCounts(int $uid): array
    {
        $out = [];
        foreach ($this->db->all(
            "SELECT we.exercise_id, COUNT(DISTINCT w.id) AS n
             FROM workout_exercises we
             JOIN workouts w ON w.id=we.workout_id
             WHERE w.user_id=? AND w.status='completed'
               AND EXISTS (SELECT 1 FROM workout_sets s WHERE s.workout_exercise_id=we.id AND s.done=1)
             GROUP BY we.exercise_id",
            [$uid]
        ) as $r) {
            $out[(int) $r['exercise_id']] = (int) $r['n'];
        }
        return $out;
    }

    /** Every completed session of one exercise, oldest first, for the trend chart. */
    public function exerciseHistory(int $uid, int $exerciseId): array
    {
        $rows = $this->db->all(
            "SELECT we.id AS we_id, we.variant_key, w.id AS workout_id, w.started_at, w.unit, w.gym_name, s.weight, s.reps, s.duration_s, s.distance_m, s.level
             FROM workout_exercises we
             JOIN workouts w ON w.id=we.workout_id
             JOIN workout_sets s ON s.workout_exercise_id=we.id
             WHERE we.user_id=? AND we.exercise_id=? AND w.status='completed' AND s.done=1 AND s.warmup=0
             ORDER BY w.started_at, we.pos, s.pos",
            [$uid, $exerciseId]
        );
        $out = [];
        foreach ($rows as $r) {
            if (!isset($out[$r['we_id']])) {
                $out[$r['we_id']] = [
                    'workout_id' => $r['workout_id'],
                    'date' => to_iso($r['started_at']),
                    'unit' => $r['unit'],
                    'gym_name' => $r['gym_name'],
                    'variant_key' => $r['variant_key'],
                    'sets' => [],
                ];
            }
            $out[$r['we_id']]['sets'][] = $r['duration_s'] !== null || $r['reps'] === null
                ? ['duration_s' => (int) $r['duration_s'], 'distance_m' => $r['distance_m'] === null ? null : (float) $r['distance_m'], 'level' => $r['level'] === null ? null : (float) $r['level']]
                : ['weight' => (float) $r['weight'], 'reps' => (int) $r['reps']];
        }
        return array_values($out);
    }

    private const LB_PER_KG = 2.20462262;

    /** Tidies a note: one line of single spaces, at most 200 characters. */
    public static function cleanNote(string $note): string
    {
        return mb_substr(trim(preg_replace('/\s+/u', ' ', $note)), 0, 200);
    }

    private static function putNote(Db $db, int $uid, string $key, string $note): void
    {
        $db->run('DELETE FROM exercise_notes WHERE user_id=? AND variant_key=?', [$uid, $key]);
        if ($note !== '') {
            $db->insert('exercise_notes', ['user_id' => $uid, 'variant_key' => $key, 'note' => $note, 'updated_at' => now_utc()]);
        }
    }

    /**
     * Setup notes are kept per exercise and gym (#125): a seat height or grip at
     * one gym rarely applies at another. A workout with no gym has its own key.
     */
    public static function noteKey(int $exerciseId, ?int $gymId): string
    {
        return $exerciseId . '@' . ($gymId ?: 0);
    }

    /**
     * The setup notes an exercise page shows: one per gym.
     *
     * @param array $gyms this account's gyms, as from Generator::gymShape()
     */
    public function exerciseNotes(int $uid, int $exerciseId, array $gyms): array
    {
        $notes = $this->notes($uid);
        $out = [];
        foreach ($gyms as $g) {
            $out[] = ['gym_id' => (int) $g['id'], 'gym_name' => $g['name'], 'note' => $notes[self::noteKey($exerciseId, (int) $g['id'])] ?? null];
        }
        return $out;
    }

    /** Saves (or, when empty, clears) one setup note from the exercise page. */
    public function setNote(int $uid, string $key, string $note): void
    {
        $note = self::cleanNote($note);
        $this->db->tx(fn(Db $db) => self::putNote($db, $uid, $key, $note));
    }

    /** Setup notes (#125) by note key (the column is named variant_key, but holds noteKey()). */
    public function notes(int $uid): array
    {
        $out = [];
        foreach ($this->db->all('SELECT variant_key, note FROM exercise_notes WHERE user_id=?', [$uid]) as $r) {
            $out[(string) $r['variant_key']] = $r['note'];
        }
        return $out;
    }

    /** Adds each exercise's setup note at this gym (or null) to a plan or workout's exercises. */
    public function withNotes(int $uid, array $exercises, ?int $gymId): array
    {
        $notes = $this->notes($uid);
        foreach ($exercises as &$e) {
            $e['note'] = isset($e['exercise_id']) ? ($notes[self::noteKey((int) $e['exercise_id'], $gymId)] ?? null) : null;
        }
        unset($e);
        return $exercises;
    }

    /**
     * A finished workout's recap (#123): its working sets, and for each lift
     * either a new record or a first logged result.
     *
     * Records compare completed working sets (not warm-ups) with this account's
     * earlier completed workouts, Fitbod imports included, by history key, so
     * machines and cables only compare at the same gym. Earlier weights are
     * converted to this workout's unit. Per lift, the heaviest weight beats
     * most reps at a weight; a lift never logged before is a first result.
     * Cardio and stretches are left out.
     */
    public function recap(int $uid, string $id): ?array
    {
        $w = $this->get($uid, $id);
        if (!$w || $w['status'] !== 'completed') {
            return null;
        }
        $startedAt = $this->db->val('SELECT started_at FROM workouts WHERE id=?', [$w['id']]);
        $unit = $w['unit'];
        $tol = static fn(float $weight) => max(0.25, 0.005 * $weight);
        $out = ['working_sets' => 0, 'exercises' => 0, 'unit' => $unit, 'records' => [], 'firsts' => []];
        foreach ($w['exercises'] as $e) {
            if (Catalog::isTimed($e['kind'])) {
                continue;
            }
            $sets = array_values(array_filter($e['sets'], static fn($s) => $s['done'] && !$s['warmup'] && (int) $s['reps'] > 0));
            if (!$sets) {
                continue;
            }
            $out['working_sets'] += count($sets);
            $out['exercises']++;
            // Best reps at each weight this time, heaviest first.
            $now = [];
            foreach ($sets as $s) {
                $key = (string) round((float) $s['weight'], 2);
                $now[$key] = max($now[$key] ?? 0, (int) $s['reps']);
            }
            krsort($now, SORT_NUMERIC);
            $topWeight = (float) array_key_first($now);
            $prev = [];
            foreach ($this->db->all(
                "SELECT s.weight, s.reps, w.unit FROM workout_sets s
                 JOIN workout_exercises we ON we.id=s.workout_exercise_id
                 JOIN workouts w ON w.id=s.workout_id
                 WHERE w.user_id=? AND w.status='completed' AND w.id<>? AND w.started_at<? AND we.variant_key=?
                   AND s.done=1 AND s.warmup=0 AND s.reps>0",
                [$uid, $w['id'], $startedAt, $e['variant_key']]
            ) as $p) {
                $weight = (float) $p['weight'];
                if ($p['unit'] !== $unit) {
                    $weight = $unit === 'kg' ? $weight / self::LB_PER_KG : $weight * self::LB_PER_KG;
                }
                $prev[] = [round($weight, 1), (int) $p['reps']];
            }
            $base = ['exercise_id' => $e['exercise_id'], 'name' => $e['name']];
            if (!$prev) {
                $out['firsts'][] = $base + ['weight' => $topWeight, 'reps' => $now[array_key_first($now)]];
                continue;
            }
            $prevTop = max(array_column($prev, 0));
            if ($topWeight > 0 && $topWeight > $prevTop + $tol($prevTop)) {
                $out['records'][] = $base + ['type' => 'weight', 'weight' => $topWeight, 'reps' => $now[array_key_first($now)], 'previous_weight' => $prevTop];
                continue;
            }
            foreach ($now as $weight => $reps) {
                $weight = (float) $weight;
                $before = 0;
                foreach ($prev as [$pw, $pr]) {
                    if (abs($pw - $weight) <= $tol($weight)) {
                        $before = max($before, $pr);
                    }
                }
                if ($before > 0 && $reps > $before) {
                    $out['records'][] = $base + ['type' => 'reps', 'weight' => $weight, 'reps' => $reps, 'previous_reps' => $before];
                    break;
                }
            }
        }
        return $out;
    }

    /** Streams every logged set as CSV. */
    public function exportCsv(int $uid, $out): void
    {
        $put = static function ($out, array $row): void {
            foreach ($row as $i => $v) {
                // Stop spreadsheet apps treating a name like "=SUM(...)" as a formula.
                if (is_string($v) && $v !== '' && strpbrk($v[0], "=+-@\t\r") !== false) {
                    $row[$i] = "'" . $v;
                }
            }
            fputcsv($out, $row, ',', '"', '');
        };
        $put($out, ['date_utc', 'workout_id', 'gym', 'day', 'exercise', 'equipment', 'set', 'warmup', 'weight', 'unit', 'reps', 'completed', 'seconds', 'distance_m', 'level']);
        $rows = $this->db->all(
            'SELECT w.started_at, w.id AS wid, w.gym_name, w.day_type, w.unit, e.name, e.kind, s.pos, s.warmup, s.weight, s.reps, s.done, s.duration_s, s.distance_m, s.level
             FROM workout_sets s
             JOIN workout_exercises we ON we.id=s.workout_exercise_id
             JOIN workouts w ON w.id=s.workout_id
             JOIN exercises e ON e.id=we.exercise_id
             WHERE w.user_id=?
             ORDER BY w.started_at, we.pos, s.pos',
            [$uid]
        );
        foreach ($rows as $r) {
            $put($out, [
                $r['started_at'], $r['wid'], $r['gym_name'], $r['day_type'], $r['name'], $r['kind'],
                (int) $r['pos'] + 1, (int) $r['warmup'] ? 'yes' : 'no',
                $r['weight'] === null ? '' : rtrim(rtrim(number_format((float) $r['weight'], 2, '.', ''), '0'), '.'),
                $r['unit'], $r['reps'] ?? '', (int) $r['done'] ? 'yes' : 'no',
                $r['duration_s'] ?? '', $r['distance_m'] === null ? '' : rtrim(rtrim(number_format((float) $r['distance_m'], 1, '.', ''), '0'), '.'),
                $r['level'] === null ? '' : rtrim(rtrim(number_format((float) $r['level'], 1, '.', ''), '0'), '.'),
            ]);
        }
    }
}
