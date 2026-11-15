<?php
declare(strict_types=1);

use TF\Db;
use TF\Migrator;

// Workout shares: one row per person a planned workout was sent to.
return static function (Db $db, Migrator $m): void {
    $m->table('workout_shares', '
        id {{PK}},
        share_key CHAR(36) NOT NULL,
        from_user INT NOT NULL,
        to_user INT NOT NULL,
        status VARCHAR(10) NOT NULL,
        plan TEXT NOT NULL,
        workout_id CHAR(36) NULL,
        recipient_workout_id CHAR(36) NULL,
        created_at VARCHAR(19) NOT NULL,
        updated_at VARCHAR(19) NOT NULL
    ');
    $m->index('ix_shares_to', 'workout_shares', 'to_user, status');
    $m->index('ix_shares_from', 'workout_shares', 'from_user, share_key');
};
