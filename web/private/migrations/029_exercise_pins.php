<?php
declare(strict_types=1);

use TF\Db;
use TF\Migrator;

// Pinned exercises on Trends (#126): up to five per account, in the order pinned.
return static function (Db $db, Migrator $m): void {
    $m->table('exercise_pins', '
        id {{PK}},
        user_id INT NOT NULL,
        exercise_id INT NOT NULL,
        created_at VARCHAR(19) NOT NULL
    ');
    $m->index('ux_exercise_pins', 'exercise_pins', 'user_id, exercise_id', true);
};
