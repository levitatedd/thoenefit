<?php
declare(strict_types=1);

use TF\Db;
use TF\Migrator;

// Setup notes (#125): one private note per account, exercise and gym, such as
// "seat on 4, wide handle". variant_key holds Workouts::noteKey(), "exercise@gym".
return static function (Db $db, Migrator $m): void {
    $m->table('exercise_notes', '
        user_id INT NOT NULL,
        variant_key VARCHAR(40) NOT NULL,
        note VARCHAR(200) NOT NULL,
        updated_at VARCHAR(19) NOT NULL
    ');
    $m->index('ux_exercise_notes', 'exercise_notes', 'user_id, variant_key', true);
};
