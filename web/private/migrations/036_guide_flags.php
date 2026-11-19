<?php
declare(strict_types=1);

use TF\Db;
use TF\Migrator;

// People flagging a movement guide that looks wrong (#282). One row per flag,
// against the guide revision they saw. A flag puts the guide back in the
// admin's review queue until the admin decides on that revision again.
// Also links a Needs revision decision to the GitHub issue it opens.
return static function (Db $db, Migrator $m): void {
    $m->table('guide_flags', '
        id {{PK}},
        slug VARCHAR(80) NOT NULL,
        revision VARCHAR(16) NOT NULL,
        reason VARCHAR(12) NOT NULL,
        pose VARCHAR(40) NULL,
        note TEXT NULL,
        user_id INT NOT NULL,
        created_at VARCHAR(19) NOT NULL
    ');
    $m->index('ix_guide_flags_slug', 'guide_flags', 'slug, id');
    $m->index('ix_guide_flags_user', 'guide_flags', 'user_id, created_at');
    // A Needs revision decision opens a GitHub issue for the fix; keep its link.
    if (!$m->hasColumn('guide_reviews', 'issue_number')) {
        $db->pdo->exec('ALTER TABLE guide_reviews ADD COLUMN issue_number INT NULL');
    }
    if (!$m->hasColumn('guide_reviews', 'issue_url')) {
        $db->pdo->exec('ALTER TABLE guide_reviews ADD COLUMN issue_url VARCHAR(200) NULL');
    }
};
