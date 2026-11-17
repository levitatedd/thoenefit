<?php
declare(strict_types=1);

namespace TF;

/**
 * The calendar on History (#228): finished workouts by day, and a plan that
 * puts the split's rotation onto the account's training days.
 *
 * The plan always starts from now. It begins with the next day type in the
 * split (the one Today offers) on the next training day, which is today when
 * today is a training day and nothing is finished yet. So a missed day is never
 * lost: that day type simply lands on the next training day, and everything
 * after it moves along. Workouts are still built on the day; the plan only says
 * which day type comes when.
 *
 * Single days can be changed: 'rest' takes a training day out, 'train' adds
 * one. Overrides only apply from today on.
 */
final class Calendar
{
    /** Short names for the calendar cells. */
    public const SHORT = [
        'full' => 'Full', 'upper' => 'Upper', 'lower' => 'Lower',
        'push' => 'Push', 'pull' => 'Pull', 'legs' => 'Legs', 'custom' => 'Custom', 'fitbod' => 'Import',
    ];

    /** How far ahead a plan goes. */
    private const MAX_DAYS = 400;

    public function __construct(private Db $db, private Generator $gen)
    {
    }

    /** Stored as ISO weekdays (1 = Monday ... 7 = Sunday), e.g. "1,2,4". */
    public static function parseDays(?string $stored): array
    {
        $days = array_values(array_unique(array_filter(array_map('intval', explode(',', (string) $stored)), static fn($d) => $d >= 1 && $d <= 7)));
        sort($days);
        return $days;
    }

    public static function storeDays(array $days): ?string
    {
        $days = self::parseDays(implode(',', array_map('intval', $days)));
        return $days ? implode(',', $days) : null;
    }

    private static function zone(string $timezone): \DateTimeZone
    {
        try {
            return new \DateTimeZone($timezone);
        } catch (\Exception $e) {
            return new \DateTimeZone('UTC');
        }
    }

    /**
     * One month: { month, today, training_days, has_plan, days: { 'Y-m-d': { done: [...], plan, override } } }.
     * Only days with something on them are listed.
     */
    public function month(array $user, string $month, string $timezone, ?int $now = null): array
    {
        $uid = (int) $user['id'];
        $zone = self::zone($timezone);
        $now = $now ?? time();
        $today = (new \DateTimeImmutable('@' . $now))->setTimezone($zone)->format('Y-m-d');
        if (!preg_match('/^\d{4}-(0[1-9]|1[0-2])$/', $month)) {
            $month = substr($today, 0, 7);
        }
        $first = new \DateTimeImmutable($month . '-01', $zone);
        $last = $first->modify('last day of this month');
        $days = [];

        // Finished workouts, by the day they started in the person's time zone.
        $from = gmdate('Y-m-d H:i:s', $first->getTimestamp() - 86400);
        $to = gmdate('Y-m-d H:i:s', $last->getTimestamp() + 2 * 86400);
        $rows = $this->db->all(
            "SELECT id, day_type, gym_name, started_at FROM workouts WHERE user_id=? AND status='completed' AND started_at>=? AND started_at<? ORDER BY started_at",
            [$uid, $from, $to],
        );
        foreach ($rows as $r) {
            $day = (new \DateTimeImmutable(to_iso($r['started_at'])))->setTimezone($zone)->format('Y-m-d');
            if (substr($day, 0, 7) !== $month) {
                continue;
            }
            $days[$day]['done'][] = [
                'id' => $r['id'],
                'day_type' => $r['day_type'],
                'short' => self::SHORT[$r['day_type']] ?? 'Workout',
                'label' => Generator::DAY_LABELS[$r['day_type']] ?? 'Workout',
                'gym_name' => $r['gym_name'],
            ];
        }

        $training = self::parseDays($user['training_days'] ?? null);
        $overrides = $this->overrides($uid, $today);
        foreach ($overrides as $day => $action) {
            if (substr($day, 0, 7) === $month) {
                $days[$day]['override'] = $action;
            }
        }
        $plan = $this->plan($user, $training, $overrides, $today, $last->format('Y-m-d'), $zone);
        foreach ($plan as $day => $type) {
            if (substr($day, 0, 7) === $month) {
                $days[$day]['plan'] = ['day_type' => $type, 'short' => self::SHORT[$type] ?? $type, 'label' => Generator::DAY_LABELS[$type] ?? $type];
            }
        }
        ksort($days);
        foreach ($days as &$d) {
            $d += ['done' => [], 'plan' => null, 'override' => null];
        }
        unset($d);
        return [
            'month' => $month,
            'today' => $today,
            'training_days' => $training,
            'has_plan' => $training !== [] || in_array('train', $overrides, true),
            'days' => (object) $days,
        ];
    }

    /**
     * Day type per date from today to $until (inclusive). Today counts only if
     * it is a training day and nothing has been finished today.
     */
    public function plan(array $user, array $training, array $overrides, string $today, string $until, \DateTimeZone $zone): array
    {
        if ($training === [] && !in_array('train', $overrides, true)) {
            return [];
        }
        $uid = (int) $user['id'];
        $rotation = Generator::SPLIT_DAYS[$user['split_type']] ?? Generator::SPLIT_DAYS['full'];
        $i = array_search($this->gen->nextDayType($uid, (string) $user['split_type']), $rotation, true) ?: 0;
        $doneToday = $this->finishedOn($uid, $today, $zone);
        $out = [];
        $d = new \DateTimeImmutable($today, $zone);
        for ($n = 0; $n < self::MAX_DAYS; $n++, $d = $d->modify('+1 day')) {
            $day = $d->format('Y-m-d');
            if ($day > $until) {
                break;
            }
            if ($day === $today && $doneToday) {
                continue; // today's training is already done
            }
            $action = $overrides[$day] ?? null;
            $trains = $action === 'train' || ($action !== 'rest' && in_array((int) $d->format('N'), $training, true));
            if ($trains) {
                $out[$day] = $rotation[$i % count($rotation)];
                $i++;
            }
        }
        return $out;
    }

    private function finishedOn(int $uid, string $day, \DateTimeZone $zone): bool
    {
        $start = new \DateTimeImmutable($day, $zone);
        return (bool) $this->db->val(
            "SELECT 1 FROM workouts WHERE user_id=? AND status='completed' AND started_at>=? AND started_at<?",
            [$uid, gmdate('Y-m-d H:i:s', $start->getTimestamp()), gmdate('Y-m-d H:i:s', $start->modify('+1 day')->getTimestamp())],
        );
    }

    /** Overrides from today on, as [day => 'rest'|'train']. Older ones are cleared away. */
    private function overrides(int $uid, string $today): array
    {
        $this->db->run('DELETE FROM schedule_overrides WHERE user_id=? AND on_day<?', [$uid, $today]);
        $out = [];
        foreach ($this->db->all('SELECT on_day, action FROM schedule_overrides WHERE user_id=? ORDER BY on_day', [$uid]) as $r) {
            $out[$r['on_day']] = $r['action'];
        }
        return $out;
    }

    /**
     * Change one day: 'rest' (skip a planned day), 'train' (add a day), 'move'
     * (rest this day and train the next one instead) or 'clear' (back to plan).
     */
    public function setDay(array $user, string $day, string $action, string $timezone, ?int $now = null): void
    {
        $uid = (int) $user['id'];
        $zone = self::zone($timezone);
        $today = (new \DateTimeImmutable('@' . ($now ?? time())))->setTimezone($zone)->format('Y-m-d');
        $date = \DateTimeImmutable::createFromFormat('!Y-m-d', $day, $zone);
        if (!$date || $date->format('Y-m-d') !== $day) {
            throw new HttpError(422, 'That is not a date.');
        }
        if ($day < $today) {
            throw new HttpError(422, 'Only today and later days can be changed.');
        }
        if (!in_array($action, ['rest', 'train', 'move', 'clear'], true)) {
            throw new HttpError(422, 'Unknown change.');
        }
        $put = function (string $d, ?string $a) use ($uid): void {
            $this->db->run('DELETE FROM schedule_overrides WHERE user_id=? AND on_day=?', [$uid, $d]);
            if ($a !== null) {
                $this->db->insert('schedule_overrides', ['user_id' => $uid, 'on_day' => $d, 'action' => $a, 'created_at' => now_utc()]);
            }
        };
        if ($action === 'clear') {
            $put($day, null);
            return;
        }
        if ($action === 'move') {
            $put($day, 'rest');
            $next = $date->modify('+1 day');
            $training = self::parseDays($user['training_days'] ?? null);
            $nextKey = $next->format('Y-m-d');
            $existing = $this->db->val('SELECT action FROM schedule_overrides WHERE user_id=? AND on_day=?', [$uid, $nextKey]);
            // Only add the next day when it would not train anyway.
            if ($existing === 'rest' || (!$existing && !in_array((int) $next->format('N'), $training, true))) {
                $put($nextKey, 'train');
            }
            return;
        }
        $put($day, $action);
    }
}
