<?php
declare(strict_types=1);

use TF\Db;
use TF\Migrator;

// Difficulty ratings (#170): how many more reps the lifter could have done at
// the end of a typical working set, 0-4 (4 means 4 or more), rated once per
// exercise in a workout. It rides on the workout document like the sets, so it
// works offline. Existing workouts have no rating: null.
return static function (Db $db, Migrator $m): void {
    if (!$m->hasColumn('workout_exercises', 'reps_left')) {
        $db->pdo->exec('ALTER TABLE workout_exercises ADD COLUMN reps_left SMALLINT NULL');
    }
};
