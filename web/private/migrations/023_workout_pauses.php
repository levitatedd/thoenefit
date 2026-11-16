<?php
declare(strict_types=1);

use TF\Db;
use TF\Migrator;

// Pausing a workout (#111). paused_s is the time already spent paused;
// paused_at is when the current pause began (null while running). Both ride
// on the workout document, so pausing works offline like everything else.
// Existing workouts were never paused: 0 and null.
return static function (Db $db, Migrator $m): void {
    if (!$m->hasColumn('workouts', 'paused_s')) {
        $db->pdo->exec('ALTER TABLE workouts ADD COLUMN paused_s INT NOT NULL DEFAULT 0');
    }
    if (!$m->hasColumn('workouts', 'paused_at')) {
        $db->pdo->exec('ALTER TABLE workouts ADD COLUMN paused_at VARCHAR(19) NULL');
    }
};
