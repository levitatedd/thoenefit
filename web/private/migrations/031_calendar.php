<?php
declare(strict_types=1);

use TF\Db;
use TF\Migrator;

// The calendar on History (#228): the weekdays someone usually trains, stored as
// ISO weekdays ("1,2,4" = Mon, Tue, Thu; empty = no plan), and single days
// changed from the plan ('rest' or 'train').
return static function (Db $db, Migrator $m): void {
    if (!$m->hasColumn('users', 'training_days')) {
        $db->pdo->exec('ALTER TABLE users ADD COLUMN training_days VARCHAR(20) NULL');
    }
    $m->table('schedule_overrides', '
        id {{PK}},
        user_id INT NOT NULL,
        on_day VARCHAR(10) NOT NULL,
        action VARCHAR(10) NOT NULL,
        created_at VARCHAR(19) NOT NULL
    ');
    $m->index('ux_schedule_overrides', 'schedule_overrides', 'user_id, on_day', true);
};
