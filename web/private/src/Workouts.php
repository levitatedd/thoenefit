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
        $existing = $this->db->one('SELECT user_id, rev FROM workouts WHERE id=?', [$id]);
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

        $kinds = [];
        foreach ($this->db->all('SELECT id, kind FROM exercises WHERE user_id IS NULL OR user_id=?', [$uid]) as $r) {
            $kinds[(int) $r['id']] = $r['kind'];
        }

        $exRows = [];
        $setRows = [];
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
            'rev' => $rev,
            'updated_at' => now_utc(),
        ];

        $this->db->tx(function (Db $db) use ($id, $uid, $existing, $row, $exRows, $setRows, $status) {
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

        return ['ok' => true, 'rev' => $rev];
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
                'sets' => $sets[$e['id']] ?? [],
            ];
        }
        return $out;
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
        foreach ($this->db->all("SELECT workout_id, weight, reps FROM workout_sets WHERE workout_id IN ($marks) AND done=1 AND warmup=0", $ids) as $s) {
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

    /** Every completed session of one exercise, oldest first, for the trend chart. */
    public function exerciseHistory(int $uid, int $exerciseId): array
    {
        $rows = $this->db->all(
            "SELECT we.id AS we_id, we.variant_key, w.id AS workout_id, w.started_at, w.unit, w.gym_name, s.weight, s.reps
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
            $out[$r['we_id']]['sets'][] = ['weight' => (float) $r['weight'], 'reps' => (int) $r['reps']];
        }
        return array_values($out);
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
        $put($out, ['date_utc', 'workout_id', 'gym', 'day', 'exercise', 'equipment', 'set', 'warmup', 'weight', 'unit', 'reps', 'completed']);
        $rows = $this->db->all(
            'SELECT w.started_at, w.id AS wid, w.gym_name, w.day_type, w.unit, e.name, e.kind, s.pos, s.warmup, s.weight, s.reps, s.done
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
            ]);
        }
    }
}
