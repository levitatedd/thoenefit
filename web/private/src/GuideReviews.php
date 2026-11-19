<?php
declare(strict_types=1);

namespace TF;

/**
 * The admin's review queue for movement guides (#277).
 *
 * The guides are the files listed in web/guides/index.json. A guide's revision
 * is a short hash of its file, so any change to the poses makes a new revision
 * and puts the guide back in the queue. Decisions are kept for good: a guide is
 * pending until its current revision is marked good or needs revision, and goes
 * back to pending when it changes or an admin reopens it. A decision is only
 * feedback: it never hides, shows or deploys a guide.
 */
final class GuideReviews
{
    public const DECISIONS = ['good', 'revise'];
    public const MAX_NOTE = 2000;
    /** The common-lift batch (#261) from docs/movement-guide-inventory.md. */
    private const COMMON = ['barbell-bench-press', 'dumbbell-bench-press', 'overhead-press', 'lat-pulldown', 'one-arm-dumbbell-row', 'seated-cable-row',
        'barbell-curl', 'hammer-curl', 'back-squat', 'goblet-squat', 'deadlift', 'dumbbell-rdl'];
    public const BATCHES = ['pilot' => 'Pilot (#259)', 'common' => 'Common lifts (#261)', 'strength' => 'Strength (#262)', 'bodyweight' => 'Bodyweight, stretch and cardio (#263)'];

    public function __construct(private Db $db, private ?string $dir = null)
    {
        $this->dir ??= dirname(__DIR__, 2) . '/guides';
    }

    /** Each listed guide that exists, by slug: file, revision, title and pose ids. */
    public function guides(): array
    {
        $index = json_decode((string) @file_get_contents($this->dir . '/index.json'), true);
        $out = [];
        foreach ((array) ($index['guides'] ?? []) as $slug => $file) {
            $path = $this->dir . '/' . basename((string) $file);
            $raw = is_file($path) ? (string) file_get_contents($path) : '';
            $g = json_decode($raw, true);
            if (!is_array($g)) {
                continue;
            }
            $out[(string) $slug] = [
                'file' => basename((string) $file),
                'revision' => substr(hash('sha256', $raw), 0, 12),
                'title' => (string) ($g['title'] ?? $slug),
                'poses' => array_values(array_map(fn($p) => ['id' => (string) ($p['id'] ?? ''), 'label' => (string) ($p['label'] ?? '')], (array) ($g['poses'] ?? []))),
            ];
        }
        return $out;
    }

    /** Every guide with its status, batch, exercise and review history, plus counts. */
    public function queue(): array
    {
        $guides = $this->guides();
        $slugs = array_keys($guides);
        $ex = [];
        $rows = [];
        if ($slugs) {
            $in = implode(',', array_fill(0, count($slugs), '?'));
            foreach ($this->db->all("SELECT slug, name, kind, cues FROM exercises WHERE user_id IS NULL AND slug IN ($in)", $slugs) as $e) {
                $ex[$e['slug']] = $e;
            }
            $rows = $this->db->all("SELECT r.*, COALESCE(NULLIF(u.display_name, ''), u.username) AS reviewer FROM guide_reviews r LEFT JOIN users u ON u.id = r.reviewer_id WHERE r.slug IN ($in) ORDER BY r.id DESC", $slugs);
        }
        $history = [];
        foreach ($rows as $r) {
            $history[$r['slug']][] = [
                'id' => (int) $r['id'], 'revision' => $r['revision'], 'decision' => $r['decision'], 'pose' => $r['pose'] ?: null,
                'note' => (string) ($r['note'] ?? ''), 'reviewer' => (string) ($r['reviewer'] ?? 'Someone'), 'at' => $r['created_at'],
            ];
        }
        $counts = ['pending' => 0, 'good' => 0, 'revise' => 0];
        $out = [];
        foreach ($guides as $slug => $g) {
            $h = $history[$slug] ?? [];
            $latest = $h[0] ?? null;
            $status = $latest && $latest['revision'] === $g['revision'] && in_array($latest['decision'], self::DECISIONS, true) ? $latest['decision'] : 'pending';
            $counts[$status]++;
            $e = $ex[$slug] ?? null;
            $out[] = $g + [
                'slug' => $slug,
                'name' => $e['name'] ?? $g['title'],
                'cues' => (string) ($e['cues'] ?? ''),
                'batch' => self::batch($slug, (string) ($e['kind'] ?? '')),
                'status' => $status,
                'decision' => $status === 'pending' ? null : $latest,
                'history' => $h,
            ];
        }
        return ['guides' => $out, 'counts' => $counts, 'batches' => self::BATCHES];
    }

    public static function batch(string $slug, string $kind): string
    {
        if ($slug === 'dumbbell-curl') {
            return 'pilot';
        }
        if (in_array($slug, self::COMMON, true)) {
            return 'common';
        }
        return in_array($kind, ['bodyweight', 'stretch', 'cardio'], true) ? 'bodyweight' : 'strength';
    }

    /** Mark the guide's current revision good, or needs revision (with a note). Saving again corrects it. */
    public function decide(array $admin, string $slug, string $revision, string $decision, string $note, string $pose): array
    {
        Auth::requireAdmin($admin);
        $g = $this->guides()[$slug] ?? null;
        if (!$g) {
            throw new HttpError(404, 'There is no guide for that exercise.');
        }
        if ($revision !== $g['revision']) {
            throw new HttpError(409, 'This guide has changed since it was opened. Reload to review the new version.');
        }
        if (!in_array($decision, self::DECISIONS, true)) {
            throw new HttpError(422, 'Choose Mark good or Needs revision.');
        }
        $note = trim($note);
        if ($decision === 'revise' && $note === '') {
            throw new HttpError(422, 'Say what should change.');
        }
        if (mb_strlen($note) > self::MAX_NOTE) {
            throw new HttpError(422, 'Keep the note under ' . self::MAX_NOTE . ' characters.');
        }
        if ($pose !== '' && !in_array($pose, array_column($g['poses'], 'id'), true)) {
            throw new HttpError(422, 'That pose is not in this guide.');
        }
        $this->db->insert('guide_reviews', [
            'slug' => $slug, 'revision' => $revision, 'decision' => $decision, 'pose' => $pose !== '' ? $pose : null,
            'note' => $note !== '' ? $note : null, 'reviewer_id' => (int) $admin['id'], 'created_at' => now_utc(),
        ]);
        return $this->queue();
    }

    /** Put a reviewed guide back in the queue, keeping its earlier decisions. */
    public function reopen(array $admin, string $slug): array
    {
        Auth::requireAdmin($admin);
        $g = $this->guides()[$slug] ?? null;
        if (!$g) {
            throw new HttpError(404, 'There is no guide for that exercise.');
        }
        $this->db->insert('guide_reviews', [
            'slug' => $slug, 'revision' => $g['revision'], 'decision' => 'reopened', 'pose' => null, 'note' => null,
            'reviewer_id' => (int) $admin['id'], 'created_at' => now_utc(),
        ]);
        return $this->queue();
    }
}
