<?php
declare(strict_types=1);

namespace TF;

/**
 * Sharing a planned workout so two or more people can train together.
 *
 * What is shared is the structure only: which exercises, in what order, how
 * many sets, the rep range and the rest. Each person's suggested weights come
 * from their own history, and each logs into their own workout.
 *
 * The structure is taken as it stands when the other person accepts: if the
 * sender has started the workout and changed it since sharing, the accepted
 * copy follows the workout as it is at that moment. After that the two
 * workouts are independent.
 */
final class Shares
{
    /** A share that nobody answered, or an accepted one nobody started, lapses after this long. */
    private const TTL_HOURS = 24;

    private Db $db;

    public function __construct(Db $db)
    {
        $this->db = $db;
    }

    /** Cleans a plan sent by the phone down to the fields that are shared. */
    private function cleanPlan(int $fromUser, array $plan): array
    {
        $visible = [];
        foreach ($this->db->all('SELECT id FROM exercises WHERE user_id IS NULL OR user_id=?', [$fromUser]) as $r) {
            $visible[(int) $r['id']] = true;
        }
        $out = [];
        foreach (array_slice(array_values((array) ($plan['exercises'] ?? [])), 0, 40) as $e) {
            $id = (int) ($e['exercise_id'] ?? 0);
            if (!isset($visible[$id])) {
                continue;
            }
            $out[] = self::line($id, $e);
        }
        if (!$out) {
            throw new HttpError(422, 'There are no exercises in this workout to share.');
        }
        return ['day_type' => mb_substr((string) ($plan['day_type'] ?? 'custom'), 0, 20), 'exercises' => $out];
    }

    private static function line(int $exerciseId, array $e): array
    {
        $min = max(1, min(100, (int) ($e['rep_min'] ?? 8)));
        return [
            'exercise_id' => $exerciseId,
            'target_sets' => max(1, min(20, (int) ($e['target_sets'] ?? 3))),
            'rep_min' => $min,
            'rep_max' => max($min, min(100, (int) ($e['rep_max'] ?? 12))),
            'rest_seconds' => max(0, min(900, (int) ($e['rest_seconds'] ?? 90))),
        ];
    }

    /**
     * Sends a plan to the given people, or (with no people) refreshes the plan
     * on shares already sent under this key that have not been answered yet.
     *
     * @param int[] $toIds      accounts to send to
     * @param int[] $allowedIds accounts that may be shared with (active, not the sender)
     */
    public function send(int $fromUser, string $shareKey, array $toIds, array $allowedIds, array $plan, ?string $workoutId = null): void
    {
        if (!is_uuid($shareKey)) {
            throw new HttpError(422, 'Share key is missing or malformed.');
        }
        $shareKey = strtolower($shareKey);
        $json = json_encode($this->cleanPlan($fromUser, $plan));
        $now = now_utc();
        if ($workoutId !== null && (!is_uuid($workoutId) || !$this->db->val('SELECT id FROM workouts WHERE id=? AND user_id=?', [strtolower($workoutId), $fromUser]))) {
            $workoutId = null;
        }
        $this->db->run("UPDATE workout_shares SET plan=?, updated_at=? WHERE from_user=? AND share_key=? AND status='pending'", [$json, $now, $fromUser, $shareKey]);
        $allowed = array_flip(array_map('intval', $allowedIds));
        foreach (array_unique(array_map('intval', $toIds)) as $to) {
            if ($to === $fromUser || !isset($allowed[$to])) {
                throw new HttpError(422, 'That person cannot be shared with.');
            }
            $row = $this->db->one('SELECT id, status FROM workout_shares WHERE from_user=? AND share_key=? AND to_user=?', [$fromUser, $shareKey, $to]);
            if (!$row) {
                $this->db->insert('workout_shares', [
                    'share_key' => $shareKey, 'from_user' => $fromUser, 'to_user' => $to, 'status' => 'pending',
                    'plan' => $json, 'workout_id' => $workoutId ? strtolower($workoutId) : null, 'created_at' => $now, 'updated_at' => $now,
                ]);
            } elseif (in_array($row['status'], ['declined', 'expired', 'started'], true)) {
                // Sending again to someone who said no, never answered, or has already
                // trained from an earlier version puts the current plan in front of them.
                $this->db->run("UPDATE workout_shares SET status='pending', plan=?, created_at=?, updated_at=? WHERE id=?", [$json, $now, $now, $row['id']]);
            }
        }
        if ($workoutId) {
            $this->link($fromUser, $shareKey, $workoutId);
        }
    }

    /** Ties the sender's shares to the workout they started from the shared plan. */
    public function link(int $fromUser, string $shareKey, string $workoutId): void
    {
        if (is_uuid($shareKey) && is_uuid($workoutId)) {
            $this->db->run('UPDATE workout_shares SET workout_id=? WHERE from_user=? AND share_key=?', [strtolower($workoutId), $fromUser, strtolower($shareKey)]);
        }
    }

    /** The shared structure as it stands right now. */
    private function structure(array $share): array
    {
        $plan = json_decode($share['plan'], true) ?: ['day_type' => 'custom', 'exercises' => []];
        if ($share['status'] !== 'pending' || !$share['workout_id']) {
            return $plan;
        }
        $w = $this->db->one('SELECT id, day_type FROM workouts WHERE id=? AND user_id=?', [$share['workout_id'], $share['from_user']]);
        if (!$w) {
            return $plan; // not synced yet, or discarded: the plan as shared still stands
        }
        $lines = [];
        foreach ($this->db->all('SELECT id, exercise_id, target_sets, rep_min, rep_max, rest_seconds FROM workout_exercises WHERE workout_id=? ORDER BY pos', [$w['id']]) as $e) {
            // Planned sets = the working sets the sender has on the card now (warm-ups are personal).
            $n = (int) $this->db->val('SELECT COUNT(*) FROM workout_sets WHERE workout_exercise_id=? AND warmup=0', [$e['id']]);
            $lines[] = self::line((int) $e['exercise_id'], ['target_sets' => $n > 0 ? $n : $e['target_sets']] + $e);
        }
        return $lines ? ['day_type' => $w['day_type'], 'exercises' => $lines] : $plan;
    }

    private function expire(): void
    {
        $this->db->run(
            "UPDATE workout_shares SET status='expired', updated_at=? WHERE status IN ('pending','accepted') AND updated_at<?",
            [now_utc(), now_utc(time() - self::TTL_HOURS * 3600)]
        );
    }

    /** Shares waiting for this person: not yet answered, or accepted and not yet started. */
    public function incoming(int $uid): array
    {
        $this->expire();
        $rows = $this->db->all(
            "SELECT s.*, u.display_name FROM workout_shares s JOIN users u ON u.id=s.from_user
             WHERE s.to_user=? AND s.status IN ('pending','accepted') ORDER BY s.created_at DESC",
            [$uid]
        );
        $out = [];
        foreach ($rows as $s) {
            $st = $this->structure($s);
            $ids = array_column($st['exercises'], 'exercise_id');
            $names = [];
            if ($ids) {
                foreach ($this->db->all('SELECT id, name FROM exercises WHERE id IN (' . Db::marks($ids) . ')', $ids) as $r) {
                    $names[(int) $r['id']] = $r['name'];
                }
            }
            $out[] = [
                'id' => (int) $s['id'],
                'from_name' => $s['display_name'],
                'status' => $s['status'],
                'day_type' => $st['day_type'],
                'exercises' => array_values(array_filter(array_map(static fn($id) => $names[$id] ?? null, $ids))),
                'sets' => array_sum(array_column($st['exercises'], 'target_sets')),
                'sent_at' => to_iso($s['created_at']),
            ];
        }
        return $out;
    }

    /** Who a plan was sent to under this key, and what each has done with it. */
    public function outgoing(int $uid, string $shareKey): array
    {
        if (!is_uuid($shareKey)) {
            return [];
        }
        $this->expire();
        $out = [];
        $rows = $this->db->all(
            'SELECT s.to_user, s.status, u.display_name FROM workout_shares s JOIN users u ON u.id=s.to_user WHERE s.from_user=? AND s.share_key=? ORDER BY s.id',
            [$uid, strtolower($shareKey)]
        );
        foreach ($rows as $r) {
            $out[] = ['to' => (int) $r['to_user'], 'name' => $r['display_name'], 'status' => $r['status']];
        }
        return $out;
    }

    private function mine(int $uid, int $id, array $statuses): array
    {
        $this->expire();
        $s = $this->db->one('SELECT * FROM workout_shares WHERE id=? AND to_user=?', [$id, $uid]);
        if (!$s || !in_array($s['status'], $statuses, true)) {
            throw new HttpError(404, 'That shared workout is no longer available.');
        }
        return $s;
    }

    /** Accepting freezes the structure as it stands at this moment. */
    public function accept(int $uid, int $id): void
    {
        $s = $this->mine($uid, $id, ['pending']);
        $this->db->run("UPDATE workout_shares SET status='accepted', plan=?, updated_at=? WHERE id=?", [json_encode($this->structure($s)), now_utc(), $id]);
        // Only one shared plan can be lined up at a time; a newer accept replaces an older one.
        $this->db->run("UPDATE workout_shares SET status='declined', updated_at=? WHERE to_user=? AND status='accepted' AND id<>?", [now_utc(), $uid, $id]);
    }

    public function decline(int $uid, int $id): void
    {
        $this->mine($uid, $id, ['pending', 'accepted']);
        $this->db->run("UPDATE workout_shares SET status='declined', updated_at=? WHERE id=?", [now_utc(), $id]);
    }

    /** Called when the recipient's workout from an accepted share reaches the server. */
    public function markStarted(int $uid, int $id, string $workoutId): void
    {
        $this->db->run(
            "UPDATE workout_shares SET status='started', recipient_workout_id=?, updated_at=? WHERE id=? AND to_user=? AND status IN ('accepted','started')",
            [strtolower($workoutId), now_utc(), $id, $uid]
        );
    }

    /**
     * The accepted plan as a ready-to-start workout for the recipient: the
     * sender's exercises, order, sets, rep ranges and rest, with weights
     * suggested from the recipient's own history at the recipient's gym.
     */
    public function draft(array $user, array $gym, int $id, Generator $gen): array
    {
        $uid = (int) $user['id'];
        $s = $this->mine($uid, $id, ['accepted']);
        $plan = json_decode($s['plan'], true) ?: ['day_type' => 'custom', 'exercises' => []];
        $fromName = (string) $this->db->val('SELECT display_name FROM users WHERE id=?', [$s['from_user']]);
        $blocks = [];
        $minutes = 0.0;
        foreach ($plan['exercises'] as $i => $line) {
            $ex = $this->exerciseFor($uid, (int) $line['exercise_id']);
            if (!$ex) {
                continue; // the exercise was deleted since the plan was shared
            }
            $b = $gen->block($user, $gym, $ex, false, $line);
            $b['slot'] = 'shared' . $i;
            $b['locked'] = true;
            $b['reason'] = "From $fromName's workout. " . $b['reason'];
            $minutes += $b['minutes'];
            $blocks[] = $b;
        }
        return [
            'share_id' => (int) $s['id'],
            'shared_by' => $fromName,
            'day_type' => isset(Generator::DAY_LABELS[$plan['day_type']]) ? $plan['day_type'] : 'custom',
            'day_label' => Generator::DAY_LABELS[$plan['day_type']] ?? 'Custom',
            'gym_id' => $gym['id'],
            'gym_name' => $gym['name'],
            'unit' => $user['unit'],
            'minutes' => (int) round($minutes),
            'est_minutes' => (int) round($minutes),
            'exercises' => $blocks,
            'skipped' => [],
            'recovery' => $gen->muscleStats($uid),
        ];
    }

    /**
     * The exercise as this person can use it. Built-in exercises and their own
     * are used as they are. Someone else's own exercise is copied into this
     * person's library once (matched by name on later shares), so both people
     * do the same movement and each keeps their own history for it.
     */
    private function exerciseFor(int $uid, int $exerciseId): ?array
    {
        $row = $this->db->one('SELECT * FROM exercises WHERE id=?', [$exerciseId]);
        if (!$row) {
            return null;
        }
        if ($row['user_id'] === null || (int) $row['user_id'] === $uid) {
            return Catalog::shape($row);
        }
        $own = $this->db->one('SELECT * FROM exercises WHERE user_id=? AND LOWER(name)=LOWER(?) ORDER BY archived, id LIMIT 1', [$uid, $row['name']]);
        if ($own) {
            return Catalog::shape($own);
        }
        $id = $this->db->insert('exercises', [
            'user_id' => $uid,
            'slug' => 'custom-' . bin2hex(random_bytes(6)),
            'name' => $row['name'],
            'kind' => $row['kind'],
            'equipment' => $row['equipment'],
            'pattern' => $row['pattern'],
            'muscles_main' => $row['muscles_main'],
            'muscles_assist' => $row['muscles_assist'],
            'cues' => $row['cues'],
            'priority' => (int) $row['priority'],
        ]);
        return Catalog::shape($this->db->one('SELECT * FROM exercises WHERE id=?', [$id]));
    }
}
