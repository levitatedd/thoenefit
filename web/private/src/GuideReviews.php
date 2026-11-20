<?php
declare(strict_types=1);

namespace TF;

/**
 * The admin's review queue for movement guides (#277).
 *
 * The guides are the files listed in web/guides/index.json. A guide's revision
 * identifies its pose file and rendered artwork, so either can put the guide
 * back in the queue. Decisions are kept for good: a guide is
 * pending until its current revision is marked good or needs revision, and goes
 * back to pending when it changes or an admin reopens it. A decision is only
 * feedback: it never hides, shows or deploys a guide.
 */
final class GuideReviews
{
    public const DECISIONS = ['good', 'revise'];
    public const MAX_NOTE = 2000;
    /** Why someone flags a guide (#282). */
    public const REASONS = ['position' => 'Body position looks wrong', 'equipment' => 'Wrong grip or equipment', 'unclear' => 'Too fast or hard to follow', 'other' => 'Something else'];
    public const MAX_FLAG_NOTE = 500;
    public const FLAGS_PER_DAY = 5;
    /** The common-lift batch (#261) from docs/movement-guide-inventory.md. */
    private const COMMON = ['barbell-bench-press', 'dumbbell-bench-press', 'overhead-press', 'lat-pulldown', 'one-arm-dumbbell-row', 'seated-cable-row',
        'barbell-curl', 'hammer-curl', 'back-squat', 'goblet-squat', 'deadlift', 'dumbbell-rdl'];
    public const BATCHES = ['pilot' => 'Pilot (#259)', 'common' => 'Common lifts (#261)', 'strength' => 'Strength (#262)', 'bodyweight' => 'Bodyweight, stretch and cardio (#263)'];

    /** Needs revision issues are filed under this one: Create reviewed movement guides. */
    public const PARENT_ISSUE = 261;
    private string $token;
    private string $repo;
    private \Closure $http;

    public function __construct(private Db $db, private ?string $dir = null, array $config = [], ?\Closure $http = null)
    {
        $this->dir ??= dirname(__DIR__, 2) . '/guides';
        $gh = $config['github'] ?? [];
        $this->token = trim((string) ($gh['token'] ?? ''));
        $this->repo = trim((string) ($gh['repo'] ?? 'levitatedd/thoenefit'));
        $this->http = $http ?? Feedback::request(...);
    }

    /** Each listed guide that exists, by slug: file, revision, title and pose ids. */
    public function guides(): array
    {
        $index = json_decode((string) @file_get_contents($this->dir . '/index.json'), true);
        $art = json_decode((string) @file_get_contents($this->dir . '/renders.json'), true);
        $out = [];
        foreach ((array) ($index['guides'] ?? []) as $slug => $file) {
            $path = $this->dir . '/' . basename((string) $file);
            $raw = is_file($path) ? (string) file_get_contents($path) : '';
            $g = json_decode($raw, true);
            if (!is_array($g)) {
                continue;
            }
            $render = $art['renders'][$slug] ?? null;
            // The launch artwork keeps its original file-only revision so saved reviews and flags still match.
            $revision = is_string($render) && $render !== ($art['legacy'][$slug] ?? null)
                ? hash('sha256', $render . "\0" . $raw)
                : hash('sha256', $raw);
            $out[(string) $slug] = [
                'file' => basename((string) $file),
                'revision' => substr($revision, 0, 12),
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
            $flagRows = $this->db->all("SELECT f.*, COALESCE(NULLIF(u.display_name, ''), u.username) AS person FROM guide_flags f LEFT JOIN users u ON u.id = f.user_id WHERE f.slug IN ($in) ORDER BY f.id DESC", $slugs);
        }
        $flags = [];
        foreach ($flagRows ?? [] as $f) {
            $flags[$f['slug']][] = [
                'id' => (int) $f['id'], 'revision' => $f['revision'], 'reason' => $f['reason'], 'pose' => $f['pose'] ?: null,
                'note' => (string) ($f['note'] ?? ''), 'by' => (string) ($f['person'] ?? 'Someone'), 'at' => $f['created_at'],
            ];
        }
        $history = [];
        foreach ($rows as $r) {
            $history[$r['slug']][] = [
                'id' => (int) $r['id'], 'revision' => $r['revision'], 'decision' => $r['decision'], 'pose' => $r['pose'] ?: null,
                'note' => (string) ($r['note'] ?? ''), 'reviewer' => (string) ($r['reviewer'] ?? 'Someone'), 'at' => $r['created_at'],
                'issue_number' => isset($r['issue_number']) ? (int) $r['issue_number'] : null, 'issue_url' => $r['issue_url'] ?? null,
            ];
        }
        $counts = ['pending' => 0, 'good' => 0, 'revise' => 0];
        $out = [];
        foreach ($guides as $slug => $g) {
            $h = $history[$slug] ?? [];
            $latest = $h[0] ?? null;
            $decided = $latest && $latest['revision'] === $g['revision'] && in_array($latest['decision'], self::DECISIONS, true);
            // A flag on this revision since the last decision (or reopen) is open, and puts the guide back in the queue.
            $since = $latest && $latest['revision'] === $g['revision'] ? $latest['at'] : '';
            $f = array_map(fn($x) => $x + ['open' => $x['revision'] === $g['revision'] && $x['at'] > $since], $flags[$slug] ?? []);
            $open = count(array_filter($f, fn($x) => $x['open']));
            $status = $decided && !$open ? $latest['decision'] : 'pending';
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
                'flags' => $f,
                'open_flags' => $open,
            ];
        }
        return ['guides' => $out, 'counts' => $counts, 'batches' => self::BATCHES, 'reasons' => self::REASONS];
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
        $id = $this->db->insert('guide_reviews', [
            'slug' => $slug, 'revision' => $revision, 'decision' => $decision, 'pose' => $pose !== '' ? $pose : null,
            'note' => $note !== '' ? $note : null, 'reviewer_id' => (int) $admin['id'], 'created_at' => now_utc(),
        ]);
        if ($decision === 'revise') {
            $this->fileIssue($id, $slug, $g, $note, $pose);
        }
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

    /**
     * Anyone signed in can flag the guide they are looking at (#282). It is saved
     * against the current revision and shows in the admin's queue; it never
     * changes what anyone sees.
     */
    public function flag(array $user, string $slug, string $reason, string $pose, string $note, ?int $now = null): void
    {
        $now ??= time();
        $g = $this->guides()[$slug] ?? null;
        if (!$g) {
            throw new HttpError(404, 'There is no guide for that exercise.');
        }
        if (!isset(self::REASONS[$reason])) {
            throw new HttpError(422, 'Choose what looks wrong.');
        }
        if ($pose !== '' && !in_array($pose, array_column($g['poses'], 'id'), true)) {
            throw new HttpError(422, 'That pose is not in this guide.');
        }
        $note = trim($note);
        if (mb_strlen($note) > self::MAX_FLAG_NOTE) {
            throw new HttpError(422, 'Keep the note under ' . self::MAX_FLAG_NOTE . ' characters.');
        }
        $today = (int) $this->db->val('SELECT COUNT(*) FROM guide_flags WHERE user_id=? AND created_at>=?', [(int) $user['id'], now_utc($now - 86400)]);
        if ($today >= self::FLAGS_PER_DAY) {
            throw new HttpError(429, 'Thanks, that is plenty for today. Try again tomorrow.');
        }
        $this->db->insert('guide_flags', [
            'slug' => $slug, 'revision' => $g['revision'], 'reason' => $reason, 'pose' => $pose !== '' ? $pose : null,
            'note' => $note !== '' ? $note : null, 'user_id' => (int) $user['id'], 'created_at' => now_utc($now),
        ]);
    }

    /**
     * Needs revision becomes a GitHub issue (a sub-issue of #261), so the fix
     * lands in the backlog for whoever authors the poses. The repository is
     * public: the issue names the guide and carries the admin's note, never a
     * person. If GitHub can't be reached the decision is still saved.
     */
    private function fileIssue(int $id, string $slug, array $g, string $note, string $pose): void
    {
        if ($this->token === '') {
            return;
        }
        $name = (string) ($this->db->val('SELECT name FROM exercises WHERE user_id IS NULL AND slug=?', [$slug]) ?: $g['title']);
        $poseLabel = 'The whole guide';
        foreach ($g['poses'] as $p) {
            if ($p['id'] === $pose) {
                $poseLabel = "{$p['label']} (`{$p['id']}`)";
            }
        }
        $quoted = implode("\n", array_map(fn($l) => '> ' . $l, explode("\n", str_replace("\r\n", "\n", $note))));
        $body = "Marked **Needs revision** in the app's movement guide review (#277).\n\n"
            . "- Exercise: {$name} (`{$slug}`)\n- Guide file: `web/guides/{$g['file']}`\n- Version reviewed: `{$g['revision']}`\n- Pose: {$poseLabel}\n\n"
            . "## What should change\n\n{$quoted}\n\n"
            . "## Approach\n\n- Update the poses in `web/guides/{$g['file']}` following `docs/movement-guides.md`.\n"
            . "- Run `node tests/guides.test.mjs` and `node docs/guides/render-previews.mjs`, and check the sheet.\n"
            . "- Once the changed file is on fit-test, the guide returns to the review queue by itself.\n\n"
            . "**Done when:** the admin marks the new version Good in the review queue.\n\n"
            . 'Follow-up to #' . self::PARENT_ISSUE . '. Tracked in #1.';
        try {
            [$status, $issue] = ($this->http)('POST', "https://api.github.com/repos/{$this->repo}/issues", $this->token, [
                'title' => "Revise the {$name} movement guide",
                'body' => $body,
                'labels' => ['bug'],
            ]);
            if ($status !== 201 || !isset($issue['number'])) {
                error_log('ThoeneFit guide review: GitHub answered ' . $status);
                return;
            }
            $this->db->update('guide_reviews', ['issue_number' => (int) $issue['number'], 'issue_url' => mb_substr((string) ($issue['html_url'] ?? ''), 0, 200)], 'id=?', [$id]);
            if (isset($issue['id'])) {
                ($this->http)('POST', "https://api.github.com/repos/{$this->repo}/issues/" . self::PARENT_ISSUE . '/sub_issues', $this->token, ['sub_issue_id' => (int) $issue['id']]);
            }
        } catch (\Throwable $e) {
            error_log('ThoeneFit guide review: ' . $e->getMessage());
        }
    }
}
