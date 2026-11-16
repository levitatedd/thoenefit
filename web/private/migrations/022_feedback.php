<?php
declare(strict_types=1);

use TF\Db;
use TF\Migrator;

// Feedback sent from the app as GitHub issues (#20). One row per submission,
// so people can see what they sent and the admin can see who sent what.
// Names stay here; they are never sent to GitHub.
return static function (Db $db, Migrator $m): void {
    $m->table('feedback', '
        id {{PK}},
        user_id INT NOT NULL,
        kind VARCHAR(10) NOT NULL,
        title VARCHAR(120) NOT NULL,
        issue_number INT NULL,
        issue_url VARCHAR(200) NULL,
        status VARCHAR(10) NOT NULL,
        checked_at VARCHAR(19) NULL,
        created_at VARCHAR(19) NOT NULL
    ');
    $m->index('ix_feedback_user', 'feedback', 'user_id, created_at');
};
