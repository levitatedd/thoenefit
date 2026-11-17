<?php
declare(strict_types=1);

use TF\Db;
use TF\Migrator;

// Variety (#211): how much generated workouts rotate their exercises.
// steady = repeat recent lifts, mixed = main lifts steady and the rest
// rotate, varied = everything rotates over time. Everyone starts on mixed.
return static function (Db $db, Migrator $m): void {
    if (!$m->hasColumn('users', 'variety')) {
        $db->pdo->exec("ALTER TABLE users ADD COLUMN variety VARCHAR(10) NOT NULL DEFAULT 'mixed'");
    }
};
