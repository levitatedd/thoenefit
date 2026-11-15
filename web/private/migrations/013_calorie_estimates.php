<?php
declare(strict_types=1);

use TF\Db;
use TF\Migrator;

// Estimated calories (#38): an optional body weight per account, the effort
// chosen when finishing a workout, and the effort to offer next time.
return static function (Db $db, Migrator $m): void {
    $add = static function (string $table, string $column, string $type) use ($db, $m): void {
        if (!$m->hasColumn($table, $column)) {
            $db->pdo->exec("ALTER TABLE $table ADD COLUMN $column $type");
        }
    };
    $add('users', 'body_weight_kg', 'DECIMAL(5,1) NULL');
    $add('users', 'effort', "VARCHAR(10) NOT NULL DEFAULT 'moderate'");
    $add('workouts', 'effort', 'VARCHAR(10) NULL');
};
