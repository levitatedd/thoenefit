<?php
declare(strict_types=1);

use TF\Db;
use TF\Migrator;

// Saved workout routines (#16). Numbered 020, clear of migrations being added
// on other branches at the same time; the runner applies any unrecorded number.
return static function (Db $db, Migrator $m): void {
    $m->table('routines', '
        id {{PK}},
        user_id INT NOT NULL,
        name VARCHAR(80) NOT NULL,
        day_type VARCHAR(20) NOT NULL,
        plan TEXT NOT NULL,
        created_at VARCHAR(19) NOT NULL,
        updated_at VARCHAR(19) NOT NULL,
        last_used_at VARCHAR(19) NULL
    ');
    $m->index('ix_routines_user', 'routines', 'user_id');
};
