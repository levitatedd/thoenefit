<?php
declare(strict_types=1);

use TF\Db;
use TF\Migrator;

// Who can see an account's workout history (#15, #13): 'private' (only the
// account itself) or 'members' (anyone signed in). Everyone starts private,
// so nobody's history is shown to others until they choose to share it.
return static function (Db $db, Migrator $m): void {
    if (!$m->hasColumn('users', 'history_visibility')) {
        $db->pdo->exec("ALTER TABLE users ADD COLUMN history_visibility VARCHAR(10) NOT NULL DEFAULT 'private'");
    }
};
