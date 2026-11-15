<?php
declare(strict_types=1);

namespace TF;

/**
 * Saved workout routines (#16): a named list of exercises with their planned
 * sets, rep range and rest, like "Monday Push". Starting one builds a fresh
 * plan with weights suggested from the person's own history and their last
 * logged weight and reps shown for each exercise.
 */
final class Routines
{
    private const MAX_PER_USER = 50;
    private const MAX_EXERCISES = 40;

    private Db $db;

    public function __construct(Db $db)
    {
        $this->db = $db;
    }

    /** This person's routines, most recently used or saved first. */
    public function all(int $uid): array
    {
        $rows = $this->db->all('SELECT * FROM routines WHERE user_id=? ORDER BY COALESCE(last_used_at, updated_at) DESC, id DESC', [$uid]);
        $names = [];
        $ids = [];
        foreach ($rows as $r) {
            foreach ((json_decode($r['plan'], true)['exercises'] ?? []) as $e) {
                $ids[(int) $e['exercise_id']] = true;
            }
        }
        if ($ids) {
            $list = array_keys($ids);
            foreach ($this->db->all('SELECT id, name FROM exercises WHERE id IN (' . Db::marks($list) . ')', $list) as $e) {
                $names[(int) $e['id']] = $e['name'];
            }
        }
        $out = [];
        foreach ($rows as $r) {
            $plan = json_decode($r['plan'], true) ?: ['exercises' => []];
            $out[] = [
                'id' => (int) $r['id'],
                'name' => $r['name'],
                'day_type' => $r['day_type'],
                'exercises' => array_values(array_filter(array_map(static fn($e) => $names[(int) $e['exercise_id']] ?? null, $plan['exercises']))),
                'sets' => array_sum(array_column($plan['exercises'], 'target_sets')),
                'updated_at' => to_iso($r['updated_at']),
                'last_used_at' => to_iso($r['last_used_at']),
            ];
        }
        return $out;
    }

    private function mine(int $uid, int $id): array
    {
        $r = $this->db->one('SELECT * FROM routines WHERE id=? AND user_id=?', [$id, $uid]);
        if (!$r) {
            throw new HttpError(404, 'That routine no longer exists.');
        }
        return $r;
    }

    private static function cleanName(string $name): string
    {
        $name = trim(preg_replace('/\s+/u', ' ', $name));
        if ($name === '') {
            throw new HttpError(422, 'Give the routine a name.');
        }
        return mb_substr($name, 0, 80);
    }

    /** Keeps only exercises this person can use, with sane numbers. */
    private function cleanPlan(int $uid, array $plan): array
    {
        $visible = [];
        foreach ($this->db->all('SELECT id FROM exercises WHERE user_id IS NULL OR user_id=?', [$uid]) as $r) {
            $visible[(int) $r['id']] = true;
        }
        $out = [];
        foreach (array_slice(array_values((array) ($plan['exercises'] ?? [])), 0, self::MAX_EXERCISES) as $e) {
            $id = (int) ($e['exercise_id'] ?? 0);
            if (!isset($visible[$id])) {
                continue;
            }
            $min = max(1, min(100, (int) ($e['rep_min'] ?? 8)));
            $out[] = [
                'exercise_id' => $id,
                'target_sets' => max(1, min(20, (int) ($e['target_sets'] ?? 3))),
                'rep_min' => $min,
                'rep_max' => max($min, min(100, (int) ($e['rep_max'] ?? 12))),
                'rest_seconds' => max(0, min(900, (int) ($e['rest_seconds'] ?? 90))),
            ];
        }
        if (!$out) {
            throw new HttpError(422, 'There are no exercises to save in this routine.');
        }
        $day = (string) ($plan['day_type'] ?? 'custom');
        return ['day_type' => isset(Generator::DAY_LABELS[$day]) ? $day : 'custom', 'exercises' => $out];
    }

    /**
     * Saves a routine. A name this person already uses (ignoring case) replaces
     * that routine, so saving "Monday Push" again updates it rather than making
     * a second one.
     *
     * @return array{id: int, replaced: bool}
     */
    public function save(int $uid, string $name, array $plan): array
    {
        $name = self::cleanName($name);
        $clean = $this->cleanPlan($uid, $plan);
        $now = now_utc();
        $existing = null;
        foreach ($this->db->all('SELECT id, name FROM routines WHERE user_id=?', [$uid]) as $r) {
            if (mb_strtolower($r['name']) === mb_strtolower($name)) {
                $existing = (int) $r['id'];
            }
        }
        $row = ['name' => $name, 'day_type' => $clean['day_type'], 'plan' => json_encode(['exercises' => $clean['exercises']]), 'updated_at' => $now];
        if ($existing) {
            $this->db->update('routines', $row, 'id=? AND user_id=?', [$existing, $uid]);
            return ['id' => $existing, 'replaced' => true];
        }
        if ((int) $this->db->val('SELECT COUNT(*) FROM routines WHERE user_id=?', [$uid]) >= self::MAX_PER_USER) {
            throw new HttpError(422, 'You can keep up to ' . self::MAX_PER_USER . ' routines. Delete one in Settings first.');
        }
        $id = $this->db->insert('routines', $row + ['user_id' => $uid, 'created_at' => $now]);
        return ['id' => $id, 'replaced' => false];
    }

    public function rename(int $uid, int $id, string $name): void
    {
        $this->mine($uid, $id);
        $name = self::cleanName($name);
        foreach ($this->db->all('SELECT id, name FROM routines WHERE user_id=? AND id<>?', [$uid, $id]) as $r) {
            if (mb_strtolower($r['name']) === mb_strtolower($name)) {
                throw new HttpError(409, 'You already have a routine called ' . $r['name'] . '.');
            }
        }
        // Renaming is not using or changing it, so its place in the list stays.
        $this->db->run('UPDATE routines SET name=? WHERE id=? AND user_id=?', [$name, $id, $uid]);
    }

    public function delete(int $uid, int $id): void
    {
        $this->mine($uid, $id);
        $this->db->run('DELETE FROM routines WHERE id=? AND user_id=?', [$id, $uid]);
    }

    /** Called when a workout started from this routine reaches the server, so the routine moves to the top. */
    public function markUsed(int $uid, int $id): void
    {
        $this->db->run('UPDATE routines SET last_used_at=? WHERE id=? AND user_id=?', [now_utc(), $id, $uid]);
    }

    /**
     * The routine as a ready-to-start plan: its exercises, order, sets, rep
     * ranges and rest, with weights suggested from this person's history at
     * this gym and their last logged weight and reps for each exercise.
     */
    public function draft(array $user, array $gym, int $id, Generator $gen): array
    {
        $uid = (int) $user['id'];
        $r = $this->mine($uid, $id);
        $plan = json_decode($r['plan'], true) ?: ['exercises' => []];
        $blocks = [];
        $skipped = [];
        $minutes = 0.0;
        foreach ($plan['exercises'] as $i => $line) {
            $row = $this->db->one('SELECT * FROM exercises WHERE id=? AND (user_id IS NULL OR user_id=?)', [(int) $line['exercise_id'], $uid]);
            if (!$row) {
                $skipped[] = 'An exercise in this routine no longer exists, so it was left out.';
                continue;
            }
            $ex = Catalog::shape($row);
            $b = $gen->block($user, $gym, $ex, false, $line);
            $b['slot'] = 'routine' . $i;
            $b['locked'] = true;
            $why = "From your routine {$r['name']}.";
            if (!Catalog::supports($ex, $gym['equipment'])) {
                $why .= " {$gym['name']} may not have the equipment for this one.";
            }
            $b['reason'] = $why . ' ' . $b['reason'];
            $minutes += $b['minutes'];
            $blocks[] = $b;
        }
        return [
            'routine_id' => (int) $r['id'],
            'routine_name' => $r['name'],
            'day_type' => $r['day_type'],
            'day_label' => Generator::DAY_LABELS[$r['day_type']] ?? 'Custom',
            'gym_id' => $gym['id'],
            'gym_name' => $gym['name'],
            'unit' => $user['unit'],
            'minutes' => (int) round($minutes),
            'est_minutes' => (int) round($minutes),
            'exercises' => $blocks,
            'skipped' => array_values(array_unique($skipped)),
            'recovery' => $gen->muscleStats($uid),
        ];
    }
}
