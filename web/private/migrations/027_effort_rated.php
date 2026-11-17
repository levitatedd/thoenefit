<?php
declare(strict_types=1);

use TF\Db;
use TF\Migrator;

// Effort ratings that plan future workouts (#198): 1 when the lifter actually
// chose Light, Moderate or Hard on finishing, 0 when the effort is only the
// default kept for the calorie estimate. Existing workouts can't tell the two
// apart, so they count as not rated and keep the usual planning rules.
return static function (Db $db, Migrator $m): void {
    if (!$m->hasColumn('workouts', 'effort_rated')) {
        $db->pdo->exec('ALTER TABLE workouts ADD COLUMN effort_rated SMALLINT NOT NULL DEFAULT 0');
    }
};
