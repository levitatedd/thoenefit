<?php
declare(strict_types=1);

use TF\Db;
use TF\Migrator;

// Admin review of movement guides (#277). One row per decision, never updated,
// so earlier feedback stays visible: 'good' or 'revise' for one revision of a
// guide (revise always has a note, optionally naming a pose), or 'reopened' to
// put a guide back in the queue. The newest row for a slug sets its status.
return static function (Db $db, Migrator $m): void {
    $m->table('guide_reviews', '
        id {{PK}},
        slug VARCHAR(80) NOT NULL,
        revision VARCHAR(16) NOT NULL,
        decision VARCHAR(10) NOT NULL,
        pose VARCHAR(40) NULL,
        note TEXT NULL,
        reviewer_id INT NOT NULL,
        created_at VARCHAR(19) NOT NULL
    ');
    $m->index('ix_guide_reviews_slug', 'guide_reviews', 'slug, id');
};
