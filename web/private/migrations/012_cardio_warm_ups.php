<?php
declare(strict_types=1);

use TF\Catalog;
use TF\Db;
use TF\Migrator;

// Cardio warm-ups (#18): a cardio set records time, and optionally distance
// and a machine level, instead of weight and reps. A planned cardio exercise
// records its target time. Each account remembers whether it wants a warm-up.
// Also adds the five cardio machine exercises.
return static function (Db $db, Migrator $m): void {
    $add = static function (string $table, string $column, string $type) use ($db, $m): void {
        if (!$m->hasColumn($table, $column)) {
            $db->pdo->exec("ALTER TABLE $table ADD COLUMN $column $type");
        }
    };
    $add('workout_sets', 'duration_s', 'INT NULL');
    $add('workout_sets', 'distance_m', 'DECIMAL(9,1) NULL');
    $add('workout_sets', 'level', 'DECIMAL(5,1) NULL');
    $add('workout_exercises', 'target_seconds', 'INT NULL');
    $add('users', 'warm_up', 'TINYINT NOT NULL DEFAULT 0');
    Catalog::sync($db);
};
